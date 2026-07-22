import { BaseHost, Communication, WsClientHost, type Message } from '@dazl/engine-core';
import { WsServerHost } from '@dazl/engine-runtime-node';
import { safeListeningHttpServer } from 'create-listening-server';
import type { Socket as NetSocket } from 'node:net';
import { deferred } from 'promise-assist';
import * as io from 'socket.io';

/**
 * CommLab is a temporary test-kit facade for writing communication tests over
 * real transports (real socket.io server + client, real `Communication` instances).
 *
 * It intentionally hides the current engine wiring (hosts, env registration,
 * ready handshakes) behind a small, clear vocabulary so tests read as
 * setup / action / expectation without knowledge of the underlying API.
 * The implementation may later be folded into the engine itself.
 *
 * ```ts
 * const lab = await CommLab.create();
 * const server = lab.addServerEnv('processing');
 * const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });
 *
 * server.exposeApi('echo', { echo: (s: string) => s });
 * const echo = client.remoteApi<{ echo(s: string): Promise<string> }>('processing', 'echo');
 *
 * lab.network.dropNextClientToServer();  // fault injection
 * await lab.network.cutConnection();     // real TCP-level disconnect (auto-reconnects)
 * await client.waitForReconnect('processing');
 * ```
 */

/** A snapshot of one Communication instance's internal bookkeeping, used as a leak/liveness oracle. */
export interface ComStatusSnapshot {
    rootEnvId: string;
    pendingEnvs: Record<string, number>;
    pendingMessages: Record<string, number>;
    handlers: Record<string, number>;
    eventDispatchers: string[];
    apis: string[];
    readyEnvs: string[];
    environments: Record<string, Record<string, string>>;
    pendingCallbacks: Record<string, { to: string; isTimeoutScheduled: boolean }>;
    messageIdPrefix: string;
}

interface ComStatusAccess {
    getComStatus(): ComStatusSnapshot;
}

/** Applies scripted faults to a single direction of message flow. */
class FaultGate {
    private dropRemaining = 0;
    private duplicateRemaining = 0;
    private holding = false;
    private held: Message[] = [];

    constructor(private deliver: (message: Message) => void) {}

    pass(message: Message) {
        if (this.dropRemaining > 0) {
            this.dropRemaining--;
            return;
        }
        if (this.holding) {
            this.held.push(message);
            return;
        }
        this.deliver(message);
        if (this.duplicateRemaining > 0) {
            this.duplicateRemaining--;
            this.deliver(message);
        }
    }

    dropNext(count = 1) {
        this.dropRemaining += count;
    }

    duplicateNext(count = 1) {
        this.duplicateRemaining += count;
    }

    hold() {
        this.holding = true;
    }

    release({ reversed = false }: { reversed?: boolean } = {}) {
        this.holding = false;
        const toSend = reversed ? this.held.reverse() : this.held;
        this.held = [];
        for (const message of toSend) {
            this.deliver(message);
        }
    }
}

/**
 * A host that sits between a Communication instance and the real WsClientHost,
 * routing every message through per-direction fault gates.
 */
class FaultInjectingHost extends BaseHost {
    readonly outgoing: FaultGate;
    readonly incoming: FaultGate;

    constructor(inner: WsClientHost) {
        super('fault-injecting-host');
        this.outgoing = new FaultGate((message) => inner.postMessage(message));
        this.incoming = new FaultGate((message) => this.emitMessageHandlers(message));
        inner.addEventListener('message', ({ data }) => this.incoming.pass(data));
    }

    override postMessage(message: Message) {
        this.outgoing.pass(message);
    }
}

/** Controls the (single) client<->server link of the lab. */
export class NetworkControl {
    constructor(
        private tcpSockets: Set<NetSocket>,
        private clientGates: () => Array<{ outgoing: FaultGate; incoming: FaultGate }>,
    ) {}

    /** Silently drop the next `count` messages sent from any client to the server. */
    dropNextClientToServer(count = 1) {
        for (const { outgoing } of this.clientGates()) {
            outgoing.dropNext(count);
        }
    }

    /** Deliver the next client-to-server message twice. */
    duplicateNextClientToServer(count = 1) {
        for (const { outgoing } of this.clientGates()) {
            outgoing.duplicateNext(count);
        }
    }

    /** Queue client-to-server messages instead of delivering them. */
    holdClientToServer() {
        for (const { outgoing } of this.clientGates()) {
            outgoing.hold();
        }
    }

    /** Deliver all held client-to-server messages, optionally in reverse order. */
    releaseClientToServer(options: { reversed?: boolean } = {}) {
        for (const { outgoing } of this.clientGates()) {
            outgoing.release(options);
        }
    }

    /** Silently drop the next `count` messages sent from the server to any client. */
    dropNextServerToClient(count = 1) {
        for (const { incoming } of this.clientGates()) {
            incoming.dropNext(count);
        }
    }

    /**
     * Destroy the underlying TCP connections — a real, ungraceful network drop.
     * socket.io clients auto-reconnect (see `ClientEnv.waitForReconnect`).
     */
    cutConnection() {
        for (const socket of this.tcpSockets) {
            socket.destroy();
        }
        this.tcpSockets.clear();
    }
}

/** An environment living on the server side of the socket. */
export class ServerEnv {
    constructor(
        public readonly name: string,
        public readonly com: Communication,
    ) {}

    /** Register an API implementation that remote environments can call. */
    exposeApi<T extends object>(apiId: string, implementation: T): T {
        return this.com.registerAPI({ id: apiId }, implementation);
    }

    /** Resolves with the environment id of any environment the server sees disposed. */
    onceEnvironmentDisposed(): Promise<string> {
        const { promise, resolve } = deferred<string>();
        const handler = (envId: string) => {
            this.com.unsubscribeToEnvironmentDispose(handler);
            resolve(envId);
        };
        this.com.subscribeToEnvironmentDispose(handler);
        return promise;
    }

    /** Internal bookkeeping snapshot of this environment (leak/liveness oracle). */
    status(): ComStatusSnapshot {
        return (this.com as unknown as ComStatusAccess).getComStatus();
    }
}

/** An environment living on the client side of the socket, connected to server envs. */
export class ClientEnv {
    constructor(
        public readonly name: string,
        public readonly com: Communication,
        private wsHost: WsClientHost,
        private faultHost: FaultInjectingHost,
        private serverEnvNames: string[],
    ) {}

    /** Get a typed async proxy to an API exposed by a server environment. */
    remoteApi<T extends object>(
        targetEnv: string,
        apiId: string,
        serviceComConfig?: Parameters<Communication['apiProxy']>[2],
    ) {
        return this.com.apiProxy<T>({ id: targetEnv }, { id: apiId }, serviceComConfig);
    }

    /** Resolves once the given environment reports a re-connection (after a cut). */
    waitForReconnect(targetEnv: string): Promise<void> {
        const { promise, resolve } = deferred();
        const handler = (envId: string) => {
            if (envId === targetEnv) {
                this.com.unsubscribeToEnvironmentReconnect(handler);
                resolve();
            }
        };
        this.com.subscribeToEnvironmentReconnect(handler);
        return promise;
    }

    /** Re-sync all RemoteValue subscriptions (mirrors the production reconnect flow). */
    resyncRemoteValues(targetEnv: string): Promise<void> {
        return this.com.reconnectRemoteValues(targetEnv);
    }

    /** Internal bookkeeping snapshot of this environment (leak/liveness oracle). */
    status(): ComStatusSnapshot {
        return (this.com as unknown as ComStatusAccess).getComStatus();
    }

    /** @internal used by the lab for wiring and disposal */
    getInternals() {
        return { wsHost: this.wsHost, faultHost: this.faultHost, serverEnvNames: this.serverEnvNames };
    }
}

export interface AddClientEnvOptions {
    /** server environments this client should be able to call */
    connectTo: string[];
}

export class CommLab {
    private serverEnvs = new Map<string, ServerEnv>();
    private clientEnvs = new Map<string, ClientEnv>();
    readonly network: NetworkControl;

    private constructor(
        private url: string,
        private wsServerHost: WsServerHost,
        private socketServer: io.Server,
        private tcpSockets: Set<NetSocket>,
    ) {
        this.network = new NetworkControl(this.tcpSockets, () =>
            [...this.clientEnvs.values()].map((client) => {
                const { faultHost } = client.getInternals();
                return { outgoing: faultHost.outgoing, incoming: faultHost.incoming };
            }),
        );
    }

    /** Spin up a real socket.io server on an ephemeral port. */
    static async create(): Promise<CommLab> {
        const { httpServer, port } = await safeListeningHttpServer(3070);
        const socketServer = new io.Server(httpServer, { cors: {} });
        const tcpSockets = new Set<NetSocket>();
        httpServer.on('connection', (socket) => {
            tcpSockets.add(socket);
            socket.once('close', () => tcpSockets.delete(socket));
        });
        const wsServerHost = new WsServerHost(socketServer.of('lab'));
        return new CommLab(`http://localhost:${port}/lab`, wsServerHost, socketServer, tcpSockets);
    }

    /** Create an environment on the server side of the socket. */
    addServerEnv(name: string): ServerEnv {
        const env = new ServerEnv(name, new Communication(this.wsServerHost, name));
        this.serverEnvs.set(name, env);
        return env;
    }

    /**
     * Create an environment on the client side of the socket, connected to the
     * given server environments over a real socket.io connection (with fault
     * injection in between). Mirrors the production wiring: the socket transport
     * is registered as the host of each remote env, and connect/reconnect events
     * mark those envs as ready.
     */
    async addClientEnv(name: string, { connectTo }: AddClientEnvOptions): Promise<ClientEnv> {
        const wsHost = new WsClientHost(this.url, {
            reconnectionDelay: 50,
            reconnectionDelayMax: 200,
            timeout: 2000,
            auth: { clientId: name },
        });
        const faultHost = new FaultInjectingHost(wsHost);
        const com = new Communication(new BaseHost(), name);
        com.registerMessageHandler(faultHost);
        for (const serverEnvName of connectTo) {
            com.registerEnv(serverEnvName, faultHost);
        }
        wsHost.subscribers.on('connect', () => {
            for (const serverEnvName of connectTo) {
                com.handleReady({ from: serverEnvName });
            }
        });
        await wsHost.connected;

        const env = new ClientEnv(name, com, wsHost, faultHost, connectTo);
        this.clientEnvs.set(name, env);
        return env;
    }

    async dispose() {
        for (const client of this.clientEnvs.values()) {
            const { wsHost } = client.getInternals();
            await client.com.dispose();
            if (!wsHost.isDisposed()) {
                await wsHost.dispose();
            }
        }
        this.clientEnvs.clear();
        for (const server of this.serverEnvs.values()) {
            await server.com.dispose().catch(() => undefined);
        }
        this.serverEnvs.clear();
        if (!this.wsServerHost.isDisposed()) {
            await this.wsServerHost.dispose();
        }
        await this.socketServer.close();
        this.network.cutConnection();
    }
}

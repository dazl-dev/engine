import { createDisposables } from '@dazl/create-disposables';
import { BaseHost, Communication, WsClientHost, getCurrentCaller, setActiveCallerContext } from '@dazl/engine-core';
import { WsServerHost } from '@dazl/engine-runtime-node';
import { expect } from 'chai';
import { safeListeningHttpServer } from 'create-listening-server';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Socket } from 'node:net';
import { deferred } from 'promise-assist';
import * as io from 'socket.io';

interface IIdentityTestApi {
    whoAmI: () => unknown;
}

interface IAsyncIdentityTestApi {
    whoAmI: () => Promise<unknown>;
}

interface IGatedApi {
    /** Resolves once `gate` resolves; returns identity captured at call entry and at completion. */
    callGated: (label: string) => Promise<{ label: string; entry: unknown; exit: unknown }>;
}

describe('Caller identity propagation', () => {
    const COMMUNICATION_ID = 'identity-test';

    let socketServer: io.Server | undefined;
    let serverTopology: Record<string, string> = {};
    let port: number;

    const disposables = createDisposables();
    const disposeAfterTest = <T extends { dispose: () => void }>(obj: T) => {
        disposables.add(() => obj.dispose());
        return obj;
    };
    afterEach(() => disposables.dispose());

    beforeEach(async () => {
        setActiveCallerContext(new AsyncLocalStorage());
        disposables.add(() => setActiveCallerContext(undefined));
        const { httpServer: server, port: servingPort } = await safeListeningHttpServer(3060);
        port = servingPort;
        socketServer = new io.Server(server, { cors: {} });
        const connections = new Set<Socket>();
        disposables.add(async () => {
            await socketServer?.close();
            socketServer = undefined;
        });
        disposables.add(() => (serverTopology = {}));
        const onConnection = (connection: Socket): void => {
            connections.add(connection);
            disposables.add(() => {
                connections.delete(connection);
            });
        };
        server.on('connection', onConnection);
        disposables.add(() => {
            for (const connection of connections) {
                connection.destroy();
            }
        });
    });

    /**
     * Single-hop: client → server. The server extracts identity from the handshake,
     * stamps every inbound message, and the API handler reads it via getCurrentCaller().
     */
    it('exposes caller identity inside server-side API handler', async () => {
        const nameSpace = socketServer!.of('processing');
        serverTopology['server-host'] = `http://localhost:${port}/processing`;

        const serverHost = disposeAfterTest(new WsServerHost(nameSpace));
        serverHost.setIdentityExtractor((handshake) => ({ userId: handshake.auth?.userId ?? 'anonymous' }));

        const serverCom = new Communication(serverHost, 'server-host', {}, {}, true);
        serverCom.registerAPI<IIdentityTestApi>(
            { id: COMMUNICATION_ID },
            {
                whoAmI: () => getCurrentCaller(),
            },
        );

        const clientHost = disposeAfterTest(
            new WsClientHost(serverTopology['server-host'], { auth: { userId: 'u-42' } }),
        );
        await clientHost.connected;
        const clientCom = new Communication(clientHost, 'client-host', serverTopology);

        const api = clientCom.apiProxy<IIdentityTestApi>({ id: 'server-host' }, { id: COMMUNICATION_ID });

        expect(await api.whoAmI()).to.deep.equal({ userId: 'u-42' });
    });

    /**
     * Concurrent calls from different clients to the same server-side API must each
     * see their own identity. AsyncLocalStorage is the mechanism that prevents the
     * identities from bleeding across in-flight calls.
     */
    it('keeps caller identities isolated across concurrent in-flight calls', async () => {
        const nameSpace = socketServer!.of('processing');
        serverTopology['server-host'] = `http://localhost:${port}/processing`;

        const serverHost = disposeAfterTest(new WsServerHost(nameSpace));
        serverHost.setIdentityExtractor((handshake) => ({ userId: handshake.auth?.userId as string }));

        const gateA = deferred<void>();
        const gateB = deferred<void>();
        const gateC = deferred<void>();
        const gates: Record<string, { promise: Promise<void>; resolve: () => void }> = {
            A: gateA,
            B: gateB,
            C: gateC,
        };

        const serverCom = new Communication(serverHost, 'server-host', {}, {}, true);
        serverCom.registerAPI<IGatedApi>(
            { id: COMMUNICATION_ID },
            {
                callGated: async (label) => {
                    const entry = getCurrentCaller();
                    await gates[label]!.promise;
                    const exit = getCurrentCaller();
                    return { label, entry, exit };
                },
            },
        );

        const makeClient = async (userId: string) => {
            const host = disposeAfterTest(new WsClientHost(serverTopology['server-host']!, { auth: { userId } }));
            await host.connected;
            const com = new Communication(host, `client-${userId}`, serverTopology);
            return com.apiProxy<IGatedApi>({ id: 'server-host' }, { id: COMMUNICATION_ID });
        };

        const apiA = await makeClient('user-A');
        const apiB = await makeClient('user-B');
        const apiC = await makeClient('user-C');

        // Fire all three concurrently; they all suspend inside the handler awaiting their gate.
        const pA = apiA.callGated('A');
        const pB = apiB.callGated('B');
        const pC = apiC.callGated('C');

        // Resolve in a deliberately interleaved order so the runtime cannot rely on FIFO.
        gateB.resolve();
        gateC.resolve();
        gateA.resolve();

        const [resA, resB, resC] = await Promise.all([pA, pB, pC]);

        // Identity must be stable from entry through completion of each handler invocation.
        expect(resA).to.deep.equal({
            label: 'A',
            entry: { userId: 'user-A' },
            exit: { userId: 'user-A' },
        });
        expect(resB).to.deep.equal({
            label: 'B',
            entry: { userId: 'user-B' },
            exit: { userId: 'user-B' },
        });
        expect(resC).to.deep.equal({
            label: 'C',
            entry: { userId: 'user-C' },
            exit: { userId: 'user-C' },
        });
    });

    /**
     * Chained: client → processing → workspace.
     *
     * The original client connects via socket; the WsServerHost stamps its identity
     * on every inbound message. The processing env handles the call and delegates
     * to the workspace env (in-process, sharing a BaseHost bus). The workspace
     * handler must observe the *original* client's identity, not undefined and not
     * processing's own.
     */
    it('propagates caller identity through chained service calls (client → processing → workspace)', async () => {
        const nameSpace = socketServer!.of('processing');
        serverTopology['processing-env'] = `http://localhost:${port}/processing`;

        const serverHost = disposeAfterTest(new WsServerHost(nameSpace));
        serverHost.setIdentityExtractor((handshake) => ({ userId: handshake.auth?.userId as string }));

        // Shared in-process bus between processing and workspace. Processing also
        // listens on the WsServerHost so it receives messages coming from the
        // socket client.
        const innerBus = new BaseHost('inner-bus');

        const processingCom = new Communication(innerBus, 'processing-env', {}, {}, true);
        processingCom.registerMessageHandler(serverHost);

        const workspaceCom = new Communication(innerBus, 'workspace-env', {}, {}, true);

        workspaceCom.registerAPI<IIdentityTestApi>({ id: 'workspace-api' }, { whoAmI: () => getCurrentCaller() });

        const workspaceProxy = processingCom.apiProxy<IIdentityTestApi>(
            { id: 'workspace-env' },
            { id: 'workspace-api' },
        );

        processingCom.registerAPI<IAsyncIdentityTestApi>(
            { id: 'processing-api' },
            { whoAmI: () => workspaceProxy.whoAmI() },
        );

        const clientHost = disposeAfterTest(
            new WsClientHost(serverTopology['processing-env'], { auth: { userId: 'u-99' } }),
        );
        await clientHost.connected;
        const clientCom = new Communication(clientHost, 'client-env', serverTopology);

        const api = clientCom.apiProxy<IAsyncIdentityTestApi>({ id: 'processing-env' }, { id: 'processing-api' });

        expect(await api.whoAmI()).to.deep.equal({ userId: 'u-99' });
    });

    /**
     * A client subscribes to a server-side event API. The subscribe handler on the
     * server should observe the original client's identity at subscription time
     * (e.g. so the service can scope events to that user).
     */
    it('propagates caller identity into a remote listener subscription handler', async () => {
        interface ISubscribableApi {
            sub: (cb: (data: string) => void) => void;
            unsub: (cb: (data: string) => void) => void;
        }

        const nameSpace = socketServer!.of('processing');
        serverTopology['server-host'] = `http://localhost:${port}/processing`;

        const serverHost = disposeAfterTest(new WsServerHost(nameSpace));
        serverHost.setIdentityExtractor((handshake) => ({ userId: handshake.auth?.userId as string }));

        const subscriberIdentity = deferred<unknown>();

        const serverCom = new Communication(serverHost, 'server-host', {}, {}, true);
        serverCom.registerAPI<ISubscribableApi>(
            { id: COMMUNICATION_ID },
            {
                sub: (_cb) => {
                    subscriberIdentity.resolve(getCurrentCaller());
                },
                unsub: (_cb) => {},
            },
        );

        const clientHost = disposeAfterTest(
            new WsClientHost(serverTopology['server-host'], { auth: { userId: 'sub-user' } }),
        );
        await clientHost.connected;
        const clientCom = new Communication(clientHost, 'client-host', serverTopology);

        const api = clientCom.apiProxy<ISubscribableApi>(
            { id: 'server-host' },
            { id: COMMUNICATION_ID },
            {
                sub: { listener: true, removeListener: 'unsub' },
                unsub: { removeListener: 'sub' },
            },
        );

        await api.sub(() => {});

        expect(await subscriberIdentity.promise).to.deep.equal({ userId: 'sub-user' });
    });

    /**
     * Same idea for unsubscribe: when the last listener is removed and the runtime
     * sends an UnListenMessage, the server-side unsub handler should observe the
     * caller's identity (e.g. to clean up per-user state).
     */
    it('propagates caller identity into a remote listener unsubscription handler', async () => {
        interface ISubscribableApi {
            sub: (cb: (data: string) => void) => void;
            unsub: (cb: (data: string) => void) => void;
        }

        const nameSpace = socketServer!.of('processing');
        serverTopology['server-host'] = `http://localhost:${port}/processing`;

        const serverHost = disposeAfterTest(new WsServerHost(nameSpace));
        serverHost.setIdentityExtractor((handshake) => ({ userId: handshake.auth?.userId as string }));

        const unsubscriberIdentity = deferred<unknown>();

        const serverCom = new Communication(serverHost, 'server-host', {}, {}, true);
        serverCom.registerAPI<ISubscribableApi>(
            { id: COMMUNICATION_ID },
            {
                sub: (_cb) => {},
                unsub: (_cb) => {
                    unsubscriberIdentity.resolve(getCurrentCaller());
                },
            },
        );

        const clientHost = disposeAfterTest(
            new WsClientHost(serverTopology['server-host'], { auth: { userId: 'unsub-user' } }),
        );
        await clientHost.connected;
        const clientCom = new Communication(clientHost, 'client-host', serverTopology);

        const api = clientCom.apiProxy<ISubscribableApi>(
            { id: 'server-host' },
            { id: COMMUNICATION_ID },
            {
                sub: { listener: true, removeListener: 'unsub' },
                unsub: { removeListener: 'sub' },
            },
        );

        const handler = () => {};
        await api.sub(handler);
        await api.unsub(handler);

        expect(await unsubscriberIdentity.promise).to.deep.equal({ userId: 'unsub-user' });
    });
});

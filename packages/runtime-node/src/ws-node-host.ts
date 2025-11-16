import type io from 'socket.io';
import { BaseHost, type Message } from '@dazl/engine-core';
import { SafeDisposable, type IDisposable } from '@dazl/patterns';

export class WsHost extends BaseHost {
    constructor(private socket: io.Socket) {
        super();
        this.socket.on('message', (message) => {
            this.emitMessageHandlers(message);
        });
    }
    public postMessage(data: any) {
        this.socket.emit('message', data);
    }
}

type ClientEnvId = string;
type ClientId = string;

export class WsServerHost extends BaseHost implements IDisposable {
    private clients = new Map<
        ClientId,
        {
            socket: io.Socket;
            namespacedEnvIds: Set<ClientEnvId>;
            disposeTimer?: NodeJS.Timeout;
            disposed: boolean;
        }
    >();
    private disposables = new SafeDisposable(WsServerHost.name);
    dispose = this.disposables.dispose;
    isDisposed = this.disposables.isDisposed;
    private disposeGraceMs: number;

    constructor(
        private server: io.Server | io.Namespace,
        config: { disposeGraceMs?: number } = {},
    ) {
        super();
        this.disposeGraceMs = config.disposeGraceMs ?? 120_000;
        this.server.on('connection', this.onConnection);
        this.disposables.add('connection', () => this.server.off('connection', this.onConnection));
        this.disposables.add('clear handlers', () => this.handlers.clear());
        this.disposables.add('dispose clients', () => {
            // clear pending dispose timers and emit dispose messages for all env IDs
            for (const client of this.clients.values()) {
                if (client.disposeTimer) {
                    clearTimeout(client.disposeTimer);
                }
                this.emitDisposeMessagesForClient(client.namespacedEnvIds);
            }
            this.clients.clear();
        });
    }

    private extractClientIdAndEnvId(namespacedId: string): { stableClientId: string; envId: string } | undefined {
        const slashIndex = namespacedId.indexOf('/');
        if (slashIndex === -1) {
            return undefined;
        }
        return {
            stableClientId: namespacedId.slice(0, slashIndex),
            envId: namespacedId.slice(slashIndex + 1),
        };
    }

    private emitConnectionDisruptedMessagesForClient(namespacedEnvIds: Set<ClientEnvId>): void {
        for (const envId of namespacedEnvIds) {
            this.emitMessageHandlers({
                type: 'connection_disrupted',
                from: envId,
                origin: envId,
                to: '*',
                forwardingChain: [],
            });
        }
    }

    private emitDisposeMessagesForClient(namespacedEnvIds: Set<ClientEnvId>): void {
        for (const envId of namespacedEnvIds) {
            this.emitMessageHandlers({
                type: 'dispose',
                from: envId,
                origin: envId,
                to: '*',
                forwardingChain: [],
            });
        }
    }

    public postMessage(data: Message) {
        if (data.to !== '*') {
            const parsed = this.extractClientIdAndEnvId(data.to);
            if (parsed) {
                const client = this.clients.get(parsed.stableClientId);

                if (client) {
                    data.to = parsed.envId;
                    client.socket.emit('message', data);
                    return;
                }
            }
            // If not found in any client, broadcast
            this.server.emit('message', data);
        } else {
            this.server.emit('message', data);
        }
    }

    private onConnection = (socket: io.Socket): void => {
        const clientId = socket.handshake.auth?.clientId;
        if (!clientId) {
            socket.disconnect(true);
            return;
        }

        // Handle reconnection: update socket and clear dispose timer
        const existingClient = this.clients.get(clientId);
        if (existingClient) {
            // Clear dispose timer if exists
            if (existingClient.disposeTimer) {
                clearTimeout(existingClient.disposeTimer);
                existingClient.disposeTimer = undefined;
            }

            // remove old socket listeners
            existingClient.socket.removeAllListeners();
            // Update socket reference
            existingClient.socket = socket;

            if (existingClient.disposed) {
                socket.send('server-lost-client-state');
                existingClient.disposed = false;
            } else {
                socket.send('server-connection-restored');
                existingClient.namespacedEnvIds.forEach((envId) => {
                    this.emitMessageHandlers({
                        type: 'ready',
                        from: envId,
                        origin: envId,
                        to: '*',
                        forwardingChain: [],
                    });
                });
            }
        } else if (!existingClient) {
            // New connection: create client entry
            this.clients.set(clientId, {
                socket,
                namespacedEnvIds: new Set(),
                disposed: false,
            });
        }

        const onMessage = (message: Message): void => {
            const client = this.clients.get(clientId);
            if (!client || client.disposed) return;
            // Namespace the env IDs with stableClientId to differentiate between clients
            const namespacedFrom = `${clientId}/${message.from}`;
            const namespacedOrigin = `${clientId}/${message.origin}`;

            // Track namespaced env IDs for this client
            client.namespacedEnvIds.add(namespacedFrom);
            client.namespacedEnvIds.add(namespacedOrigin);

            // Modify message with namespaced IDs for routing
            message.from = namespacedFrom;
            message.origin = namespacedOrigin;

            this.emitMessageHandlers(message);
        };
        socket.on('message', onMessage);

        socket.once('disconnect', () => {
            socket.off('message', onMessage);

            const client = this.clients.get(clientId);
            if (!client) return;

            // set client as pending so that messages are queued for it
            this.emitConnectionDisruptedMessagesForClient(client.namespacedEnvIds);

            // Delay dispose to allow for socket recovery
            client.disposeTimer = setTimeout(() => {
                const clientToDispose = this.clients.get(clientId);
                if (!clientToDispose) return;

                clientToDispose.disposed = true;
                this.emitDisposeMessagesForClient(clientToDispose.namespacedEnvIds);
            }, this.disposeGraceMs);
        });
    };
}

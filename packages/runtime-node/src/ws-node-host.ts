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

type EnvId = string;
type StableId = string;

export class WsServerHost extends BaseHost implements IDisposable {
    private clients = new Map<
        StableId,
        {
            socket: io.Socket;
            namespacedEnvIds: Set<EnvId>;
            disposeTimer?: NodeJS.Timeout;
        }
    >();
    private disposables = new SafeDisposable(WsServerHost.name);
    dispose = this.disposables.dispose;
    isDisposed = this.disposables.isDisposed;
    private disposeDelayMs: number;

    constructor(
        private server: io.Server | io.Namespace,
        config: { disposeDelayMs?: number } = {},
    ) {
        super();
        this.disposeDelayMs = config.disposeDelayMs ?? 120000; // 2 minutes default
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

    private extractClientIdAndEnvId(namespacedId: string): { stableClientId: string; envId: string } | null {
        const slashIndex = namespacedId.indexOf('/');
        if (slashIndex === -1) {
            return null;
        }
        return {
            stableClientId: namespacedId.substring(0, slashIndex),
            envId: namespacedId.substring(slashIndex + 1),
        };
    }

    private emitDisposeMessagesForClient(namespacedEnvIds: Set<EnvId>): void {
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
        const stableClientId = socket.handshake.auth?.clientId as string | undefined;

        if (!stableClientId) {
            throw new Error('Client must provide a stable client ID in socket.handshake.auth.clientId');
        }

        // Handle reconnection: update socket and clear dispose timer
        const existingClient = this.clients.get(stableClientId);
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
        } else {
            // New connection: create client entry
            this.clients.set(stableClientId, {
                socket,
                namespacedEnvIds: new Set(),
            });
        }

        const onMessage = (message: Message): void => {
            const client = this.clients.get(stableClientId);
            if (!client) return;
            // Namespace the env IDs with stableClientId to differentiate between clients
            const namespacedFrom = `${stableClientId}/${message.from}`;
            const namespacedOrigin = `${stableClientId}/${message.origin}`;

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

            const client = this.clients.get(stableClientId);
            if (!client) return;

            // Delay dispose to allow for socket recovery
            client.disposeTimer = setTimeout(() => {
                const clientToDispose = this.clients.get(stableClientId);
                if (!clientToDispose) return;

                this.clients.delete(stableClientId);
                this.emitDisposeMessagesForClient(clientToDispose.namespacedEnvIds);
            }, this.disposeDelayMs);
        });
    };
}

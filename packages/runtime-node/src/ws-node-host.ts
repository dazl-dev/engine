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

export interface WsNodeOptions {
    disposeGraceMs?: number;
}

interface LogEntry {
    timestamp: string;
    event: string;
    clientId?: string;
    details: any;
}

export class WsServerHost extends BaseHost implements IDisposable {
    private clients = new Map<
        ClientId,
        {
            socket?: io.Socket;
            namespacedEnvIds: Set<ClientEnvId>;
            disposeTimer?: NodeJS.Timeout;
            disposed: boolean;
        }
    >();
    private disposables = new SafeDisposable(WsServerHost.name);
    dispose = this.disposables.dispose;
    isDisposed = this.disposables.isDisposed;
    private disposeGraceMs: number;
    private logs: LogEntry[] = [];

    constructor(
        private server: io.Server | io.Namespace,
        config: WsNodeOptions = {},
    ) {
        super();
        this.disposeGraceMs = config.disposeGraceMs ?? 120_000;
        this.log('SERVER_INITIALIZED', { disposeGraceMs: this.disposeGraceMs });
        console.log(`[WsServerHost] Server initialized with disposeGraceMs: ${this.disposeGraceMs}ms`);

        this.server.on('connection', this.onConnection);
        this.disposables.add('connection', () => this.server.off('connection', this.onConnection));
        this.disposables.add('clear handlers', () => this.handlers.clear());
        this.disposables.add('dispose clients', () => {
            console.log('[WsServerHost] Disposing all clients');
            this.log('SERVER_DISPOSING_ALL_CLIENTS', { clientCount: this.clients.size });
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

    private log(event: string, details: any, clientId?: string): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            event,
            clientId,
            details,
        };
        this.logs.push(entry);
        // Keep last 1000 logs
        if (this.logs.length > 4000) {
            this.logs.shift();
        }
    }

    private extractClientIdAndEnvId(namespacedId: string): { stableClientId: string; envId: string } | undefined {
        const slashIndex = namespacedId.indexOf('/');
        if (slashIndex === -1) {
            console.log(`[WsServerHost] Failed to extract client ID and env ID from: ${namespacedId}`);
            this.log('EXTRACT_CLIENT_ENV_ID_FAILED', { namespacedId });
            return undefined;
        }
        const result = {
            stableClientId: namespacedId.slice(0, slashIndex),
            envId: namespacedId.slice(slashIndex + 1),
        };
        console.log(`[WsServerHost] Extracted clientId: ${result.stableClientId}, envId: ${result.envId}`);
        return result;
    }

    private emitConnectionDisruptedMessagesForClient(namespacedEnvIds: Set<ClientEnvId>): void {
        console.log(`[WsServerHost] Emitting connection disrupted messages for ${namespacedEnvIds.size} env IDs`);
        this.log('EMIT_CONNECTION_DISRUPTED', { envIds: Array.from(namespacedEnvIds) });
        for (const envId of namespacedEnvIds) {
            console.log(`[WsServerHost] Connection disrupted for envId: ${envId}`);
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
        console.log(`[WsServerHost] Emitting dispose messages for ${namespacedEnvIds.size} env IDs`);
        this.log('EMIT_DISPOSE', { envIds: Array.from(namespacedEnvIds) });
        for (const envId of namespacedEnvIds) {
            console.log(`[WsServerHost] Disposing envId: ${envId}`);
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
            console.log(`[WsServerHost] postMessage to specific target: ${data.to}, type: ${data.type}`);
            this.log('POST_MESSAGE_TARGETED', { to: data.to, type: data.type, from: data.from });

            const parsed = this.extractClientIdAndEnvId(data.to);
            if (parsed) {
                const client = this.clients.get(parsed.stableClientId);

                if (client) {
                    console.log(`[WsServerHost] Client found, sending message to ${parsed.envId}`);
                    data.to = parsed.envId;
                    client.socket?.emit('message', data);
                    this.log('POST_MESSAGE_SENT_TO_CLIENT', {
                        clientId: parsed.stableClientId,
                        envId: parsed.envId,
                        type: data.type,
                    });
                    return;
                } else {
                    console.log(`[WsServerHost] Client not found for ${parsed.stableClientId}, broadcasting`);
                    this.log('POST_MESSAGE_CLIENT_NOT_FOUND', { clientId: parsed.stableClientId });
                }
            }
            // If not found in any client, broadcast
            console.log('[WsServerHost] Broadcasting message to all clients');
            this.server.emit('message', data);
            this.log('POST_MESSAGE_BROADCAST', { type: data.type });
        } else {
            console.log(`[WsServerHost] Broadcasting message to all clients, type: ${data.type}`);
            this.server.emit('message', data);
            this.log('POST_MESSAGE_BROADCAST_ALL', { type: data.type, from: data.from });
        }
    }

    private onConnection = (socket: io.Socket): void => {
        const clientId = socket.handshake.auth?.clientId;
        console.log(
            `[WsServerHost] New connection attempt, clientId: ${clientId || 'MISSING'}, socketId: ${socket.id}`,
        );

        if (!clientId) {
            console.error('[WsServerHost] Connection rejected: missing clientId');
            this.log('CONNECTION_REJECTED', { reason: 'missing clientId', socketId: socket.id });
            socket.disconnect(true);
            return;
        }

        // Handle reconnection: update socket and clear dispose timer
        const existingClient = this.clients.get(clientId);
        if (existingClient) {
            console.log(`[WsServerHost] Reconnection detected for clientId: ${clientId}`);
            this.log(
                'CLIENT_RECONNECTION',
                {
                    clientId,
                    socketId: socket.id,
                    hadDisposeTimer: !!existingClient.disposeTimer,
                    wasDisposed: existingClient.disposed,
                },
                clientId,
            );

            // Clear dispose timer if exists
            if (existingClient.disposeTimer !== undefined) {
                console.log(`[WsServerHost] Clearing dispose timer for clientId: ${clientId}`);
                clearTimeout(existingClient.disposeTimer);
                existingClient.disposeTimer = undefined;
            }

            existingClient.socket = socket;

            if (existingClient.disposed) {
                console.warn(`[WsServerHost] Client ${clientId} was disposed, sending server-lost-client-state`);
                socket.send('server-lost-client-state');
                existingClient.disposed = false;
                this.log('CLIENT_STATE_LOST', { clientId }, clientId);
            } else {
                console.log(
                    `[WsServerHost] Client ${clientId} reconnected successfully, restoring ${existingClient.namespacedEnvIds.size} envIds`,
                );
                socket.send('server-connection-restored');
                this.log(
                    'CLIENT_CONNECTION_RESTORED',
                    { clientId, envIds: Array.from(existingClient.namespacedEnvIds) },
                    clientId,
                );

                existingClient.namespacedEnvIds.forEach((envId) => {
                    console.log(`[WsServerHost] Emitting ready for envId: ${envId}`);
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
            console.log(`[WsServerHost] New client connection: ${clientId}`);
            this.log('CLIENT_NEW_CONNECTION', { clientId, socketId: socket.id }, clientId);
            this.clients.set(clientId, {
                socket,
                namespacedEnvIds: new Set(),
                disposed: false,
            });
        }

        const onMessage = (message: Message): void => {
            if (typeof message === 'string' && message === 'givemeinfo') {
                console.log(`[WsServerHost] Info request received from clientId: ${clientId}`);
                this.log('INFO_REQUEST', { clientId }, clientId);

                // Gather server info
                const info = {
                    timestamp: new Date().toISOString(),
                    disposeGraceMs: this.disposeGraceMs,
                    totalClients: this.clients.size,
                    clients: Array.from(this.clients.entries()).map(([id, client]) => ({
                        clientId: id,
                        connected: !!client.socket,
                        disposed: client.disposed,
                        hasPendingDispose: !!client.disposeTimer,
                        envIds: Array.from(client.namespacedEnvIds),
                    })),
                    logs: this.logs,
                };

                socket.emit('message', {
                    type: 'server-info',
                    data: info,
                });
                console.log(`[WsServerHost] Sent server info to clientId: ${clientId}`, info);
                return;
            }

            const client = this.clients.get(clientId);
            if (!client) {
                console.error(`[WsServerHost] Message received from unknown clientId: ${clientId}`);
                this.log('MESSAGE_FROM_UNKNOWN_CLIENT', { clientId, messageType: message.type }, clientId);
                return;
            }

            if (client.disposed) {
                console.warn(`[WsServerHost] Message received from disposed clientId: ${clientId}`);
                this.log('MESSAGE_FROM_DISPOSED_CLIENT', { clientId, messageType: message.type }, clientId);
                return;
            }

            console.log(
                `[WsServerHost] Message received from ${clientId}: type=${message.type}, from=${message.from}, to=${message.to}`,
            );
            this.log(
                'MESSAGE_RECEIVED',
                { clientId, type: message.type, from: message.from, to: message.to, origin: message.origin },
                clientId,
            );

            // Namespace the env IDs with stableClientId to differentiate between clients
            const namespacedFrom = `${clientId}/${message.from}`;
            const namespacedOrigin = `${clientId}/${message.origin}`;

            // Track namespaced env IDs for this client
            client.namespacedEnvIds.add(namespacedFrom);
            client.namespacedEnvIds.add(namespacedOrigin);

            console.log(`[WsServerHost] Namespaced message: from=${namespacedFrom}, origin=${namespacedOrigin}`);
            this.log(
                'MESSAGE_NAMESPACED',
                { clientId, namespacedFrom, namespacedOrigin, envIdsCount: client.namespacedEnvIds.size },
                clientId,
            );

            // Modify message with namespaced IDs for routing
            message.from = namespacedFrom;
            message.origin = namespacedOrigin;

            this.emitMessageHandlers(message);
        };
        socket.on('message', onMessage);

        socket.on('error', (error) => {
            console.error(`[WsServerHost] Socket error for clientId: ${clientId}`, error);
            this.log('SOCKET_ERROR', { clientId, error: error.message, stack: error.stack }, clientId);
        });

        socket.once('disconnect', (reason) => {
            console.log(`[WsServerHost] Client disconnected: ${clientId}, reason: ${reason}`);
            this.log('CLIENT_DISCONNECTED', { clientId, reason, socketId: socket.id }, clientId);

            socket.off('message', onMessage);

            const client = this.clients.get(clientId);
            if (!client) {
                console.error(`[WsServerHost] Client not found during disconnect: ${clientId}`);
                this.log('CLIENT_NOT_FOUND_ON_DISCONNECT', { clientId }, clientId);
                return;
            }

            if (client.socket !== socket) {
                this.log('[WsServerHost] Disconnected socket does not match current client socket, ignoring', {oldSocketId: socket.id, newSocketId: client.socket?.id}, clientId);
                socket.removeAllListeners();
                return;
            }

            console.log(
                `[WsServerHost] Setting client ${clientId} as disrupted, starting grace period of ${this.disposeGraceMs}ms`,
            );
            // set client as pending so that messages are queued for it
            this.emitConnectionDisruptedMessagesForClient(client.namespacedEnvIds);

            // Delay dispose to allow for socket recovery
            client.disposeTimer = setTimeout(() => {
                console.log(`[WsServerHost] Grace period expired for clientId: ${clientId}, disposing client`);
                this.log('CLIENT_DISPOSE_TIMEOUT', { clientId, disposeGraceMs: this.disposeGraceMs }, clientId);

                const clientToDispose = this.clients.get(clientId);
                if (!clientToDispose) {
                    console.error(`[WsServerHost] Client not found during dispose timeout: ${clientId}`);
                    this.log('CLIENT_NOT_FOUND_ON_DISPOSE', { clientId }, clientId);
                    return;
                }

                console.log(
                    `[WsServerHost] Disposing client ${clientId} with ${clientToDispose.namespacedEnvIds.size} envIds`,
                );
                clientToDispose.disposed = true;
                clientToDispose.socket?.removeAllListeners();
                clientToDispose.socket = undefined;

                this.emitDisposeMessagesForClient(clientToDispose.namespacedEnvIds);
                this.log(
                    'CLIENT_DISPOSED',
                    { clientId, envIds: Array.from(clientToDispose.namespacedEnvIds) },
                    clientId,
                );
            }, this.disposeGraceMs);

            this.log('CLIENT_DISPOSE_TIMER_SET', { clientId, disposeGraceMs: this.disposeGraceMs }, clientId);
        });
    };
}

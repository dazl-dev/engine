import type io from 'socket.io';
import { BaseHost, CallerIdentity, LogLevel, logToConsole, type Message } from '@dazl/engine-core';
import { SafeDisposable, type IDisposable } from '@dazl/patterns';

export interface IConnectionEvent {
    clientId: string;
    socket: io.Socket;
}
export type IConnectionHandler = (event: IConnectionEvent) => void;

export interface ConnectionHandlers {
    onConnectionOpen?: IConnectionHandler;
    onConnectionClose?: IConnectionHandler;
    onConnectionReconnect?: IConnectionHandler;
}

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

/**
 * Extracts caller identity from Socket.IO handshake.
 */
export type IdentityExtractor = (handshake: io.Socket['handshake'], clientId: string) => CallerIdentity | undefined;

/**
 * Whether a connection is a trusted peer: an environment that forwards calls
 * made by *its* clients, having already established who they are.
 */
export type PeerTrustPredicate = (handshake: io.Socket['handshake'], clientId: string) => boolean;

export interface WsServerHostOptions {
    /**
     * Connections whose messages may keep the `callerIdentity` they arrive with,
     * instead of having it replaced by this host's own (see
     * {@link WsServerHost}).
     *
     * For a topology where a client reaches this environment through another
     * one: the first server host authenticates the client and stamps the
     * identity, and this host has no handshake of its own to derive it from -
     * without this, the identity is dropped on the second hop and the call
     * arrives anonymous.
     *
     * Say yes only for a connection the deployment itself authenticates (a
     * shared secret in the handshake, a private network). Any client that this
     * returns true for can name whoever it likes.
     */
    trustsForwardedIdentity?: PeerTrustPredicate;
}

/**
 * Server side of the socket transport.
 *
 * Identity is decided per connection, not per message: a client cannot name
 * itself, because `callerIdentity` on everything it sends is replaced with what
 * this host derived from its handshake. The exception is a connection accepted
 * as a trusted peer - see {@link WsServerHostOptions.trustsForwardedIdentity}.
 */
export class WsServerHost extends BaseHost implements IDisposable {
    private connectionHandlers = new Set<IConnectionHandler>();
    private disconnectionHandlers = new Set<IConnectionHandler>();
    private reconnectionHandlers = new Set<IConnectionHandler>();
    private socketToEnvId = new Map<string, { socket: io.Socket; clientID: string }>();
    private clientIdToSocket = new Map<string, io.Socket>();
    private disposables = new SafeDisposable(WsServerHost.name);
    private identityStore = new Map<string, CallerIdentity>();
    private identityExtractor?: IdentityExtractor;
    private trustsForwardedIdentity?: PeerTrustPredicate;
    /** Clients accepted as peers, resolved once per connection. */
    private trustedPeers = new Set<string>();
    dispose = this.disposables.dispose;
    isDisposed = this.disposables.isDisposed;

    constructor(
        private server: io.Server | io.Namespace,
        identityExtractor?: IdentityExtractor,
        options?: WsServerHostOptions,
    ) {
        super();
        this.server.on('connection', this.onConnection);
        this.disposables.add('connection', () => this.server.off('connection', this.onConnection));
        this.disposables.add('clear handlers', () => this.handlers.clear());
        this.disposables.add('clear connection handlers', () => this.connectionHandlers.clear());
        this.disposables.add('clear disconnection handlers', () => this.disconnectionHandlers.clear());
        this.disposables.add('clear reconnection handlers', () => this.reconnectionHandlers.clear());
        this.identityExtractor = identityExtractor;
        this.trustsForwardedIdentity = options?.trustsForwardedIdentity;
        this.disposables.add('clear trusted peers', () => this.trustedPeers.clear());
    }

    public registerConnectionHandler(handler: IConnectionHandler) {
        this.connectionHandlers.add(handler);
        return () => {
            this.connectionHandlers.delete(handler);
        };
    }

    public registerDisconnectionHandler(handler: IConnectionHandler) {
        this.disconnectionHandlers.add(handler);
        return () => {
            this.disconnectionHandlers.delete(handler);
        };
    }

    public registerReconnectionHandler(handler: IConnectionHandler) {
        this.reconnectionHandlers.add(handler);
        return () => {
            this.reconnectionHandlers.delete(handler);
        };
    }

    public postMessage(data: Message) {
        if (data.to !== '*') {
            if (this.socketToEnvId.has(data.to)) {
                const { socket, clientID } = this.socketToEnvId.get(data.to)!;
                data.to = clientID;
                socket.emit('message', data);
            } else {
                this.server.emit('message', data);
            }
        } else {
            this.server.emit('message', data);
        }
    }

    private callWithErrorHandling(callback: () => void): void {
        try {
            callback();
        } catch (error) {
            logToConsole({
                message: error instanceof Error ? `${error.message} ${error.stack}` : String(error),
                level: LogLevel.ERROR,
                timestamp: Date.now(),
            });
        }
    }

    private onConnection = (socket: io.Socket): void => {
        const clientId = socket.handshake.auth?.clientId || socket.id;
        const existingSocket = this.clientIdToSocket.get(clientId);

        this.clientIdToSocket.set(clientId, socket);

        const trustsForwardedIdentity = this.trustsForwardedIdentity;
        if (trustsForwardedIdentity) {
            this.callWithErrorHandling(() => {
                if (trustsForwardedIdentity(socket.handshake, clientId)) {
                    this.trustedPeers.add(clientId);
                } else {
                    this.trustedPeers.delete(clientId);
                }
            });
        }

        const extractor = this.identityExtractor;
        if (extractor) {
            this.callWithErrorHandling(() => {
                const identity = extractor(socket.handshake, clientId);
                if (identity) {
                    this.identityStore.set(clientId, identity);
                } else {
                    this.identityStore.delete(clientId);
                }
            });
        }

        const connectionEvent: IConnectionEvent = {
            clientId,
            socket,
        };

        if (existingSocket && existingSocket.connected) {
            existingSocket.disconnect(true); // disconnect previous connection
            for (const handler of this.reconnectionHandlers) {
                this.callWithErrorHandling(() => handler(connectionEvent));
            }
        } else {
            for (const handler of this.connectionHandlers) {
                this.callWithErrorHandling(() => handler(connectionEvent));
            }
        }

        const nameSpace = (original: string) => `${clientId}/${original}`;
        const onMessage = (message: Message): void => {
            // this mapping should not be here because of forwarding of messages
            // maybe change message forwarding to have 'forward destination' and correct 'from'
            // also maybe we can put the init of the map on 'connection' event
            // maybe we can notify from client about the new connected id
            const originId = nameSpace(message.origin);
            const fromId = nameSpace(message.from);
            this.socketToEnvId.set(fromId, { socket, clientID: message.from });
            this.socketToEnvId.set(originId, { socket, clientID: message.origin });
            // modify message to be able to forward it
            message.from = fromId;
            message.origin = originId;
            const connectionIdentity = this.identityStore.get(clientId);
            if (this.trustedPeers.has(clientId)) {
                // a peer forwarding someone else's call: keep the identity the
                // host that authenticated them already stamped, and fall back to
                // this connection's own for calls the peer makes itself
                message.callerIdentity = message.callerIdentity ?? connectionIdentity;
            } else {
                // always set, even to undefined, so a client cannot pass its own
                message.callerIdentity = connectionIdentity;
            }

            this.emitMessageHandlers(message);
        };
        socket.on('message', onMessage);

        socket.once('disconnect', () => {
            socket.off('message', onMessage);
            for (const [envId, { socket: soc }] of this.socketToEnvId.entries()) {
                if (socket === soc) {
                    this.socketToEnvId.delete(envId);
                    this.emitMessageHandlers({
                        type: 'dispose',
                        from: envId,
                        origin: envId,
                        to: '*',
                        forwardingChain: [],
                    });
                }
            }
            if (this.clientIdToSocket.get(clientId) === socket) {
                this.identityStore.delete(clientId);
                this.trustedPeers.delete(clientId);
                this.clientIdToSocket.delete(clientId);
                for (const handler of this.disconnectionHandlers) {
                    this.callWithErrorHandling(() => handler(connectionEvent));
                }
            }
        });
    };
}

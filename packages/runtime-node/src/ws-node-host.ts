import type io from 'socket.io';
import { BaseHost, LogLevel, logToConsole, type Message } from '@dazl/engine-core';
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

export class WsServerHost extends BaseHost implements IDisposable {
    private connectionHandlers = new Set<IConnectionHandler>();
    private disconnectionHandlers = new Set<IConnectionHandler>();
    private reconnectionHandlers = new Set<IConnectionHandler>();
    private socketToEnvId = new Map<string, { socket: io.Socket; clientID: string }>();
    private clientIdToSocket = new Map<string, io.Socket>();
    private disposables = new SafeDisposable(WsServerHost.name);
    dispose = this.disposables.dispose;
    isDisposed = this.disposables.isDisposed;

    constructor(private server: io.Server | io.Namespace) {
        super();
        this.server.on('connection', this.onConnection);
        this.disposables.add('connection', () => this.server.off('connection', this.onConnection));
        this.disposables.add('clear handlers', () => this.handlers.clear());
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
                this.clientIdToSocket.delete(clientId);
                for (const handler of this.disconnectionHandlers) {
                    this.callWithErrorHandling(() => handler(connectionEvent));
                }
            }
        });
    };
}

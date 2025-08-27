import { io, Socket, type SocketOptions } from 'socket.io-client';
import type { Message } from '../message-types.js';
import { BaseHost } from './base-host.js';
import { EventEmitter, IDisposable, SafeDisposable } from '@dazl/patterns';
import { deferred } from 'promise-assist';

export class WsClientHost extends BaseHost implements IDisposable {
    private disposables = new SafeDisposable(WsClientHost.name);
    dispose = this.disposables.dispose;
    isDisposed = this.disposables.isDisposed;
    public connected: Promise<void>;
    private socketClient: Socket;
    public subscribers = new EventEmitter<{ disconnect: void; reconnect: void }>();

    constructor(url: string, options?: Partial<SocketOptions>) {
        super();
        this.disposables.add('close socket', () => this.socketClient.close());
        this.disposables.add('clear subscribers', () => this.subscribers.clear());

        const { path, ...query } = Object.fromEntries(new URL(url).searchParams);

        const { promise, resolve, reject } = deferred();
        this.connected = promise;

        this.socketClient = io(url, {
            transports: ['websocket'],
            forceNew: true,
            withCredentials: true, // Pass Cookie to socket io connection
            path,
            query,
            ...options,
        });

        this.socketClient.once('connect_error', (error) => {
            reject(new Error(`Failed to connect to socket server`, { cause: error }));
        });

        this.socketClient.on('connect', () => {
            this.socketClient.on('message', (data: unknown) => {
                this.emitMessageHandlers(data as Message);
            });
            resolve();
        });

        this.socketClient.on('disconnect', () => {
            this.subscribers.emit('disconnect', undefined);
            this.socketClient.close();
        });

        this.socketClient.on('reconnect', () => {
            this.subscribers.emit('reconnect', undefined);
        });

        this.socketClient.connect();
    }

    public postMessage(data: any) {
        this.socketClient.emit('message', data);
    }
}

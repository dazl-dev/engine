import { io, ManagerOptions, Socket, type SocketOptions } from 'socket.io-client';
import type { Message } from '../message-types.js';
import { BaseHost } from './base-host.js';
import { EventEmitter, IDisposable, SafeDisposable } from '@dazl/patterns';
import { deferred, type PromiseRejectCb, type PromiseResolveCb } from 'promise-assist';

export class WsClientHost extends BaseHost implements IDisposable {
    private reinitCount = 0;
    private disposables = new SafeDisposable(WsClientHost.name);
    dispose = this.disposables.dispose;
    isDisposed = this.disposables.isDisposed;
    public connected: Promise<void>;
    private socketClient!: Socket;
    public subscribers = new EventEmitter<{
        disconnect: string;
        reconnect: void;
        connect: void;
        'server-lost-client-state': void;
        'server-connection-restored': void;
    }>();
    private stableClientId = crypto.randomUUID();

    constructor(url: string, options?: Partial<ManagerOptions & SocketOptions>) {
        super();
        this.disposables.add('close socket', () => this.socketClient.close());
        this.disposables.add('clear subscribers', () => this.subscribers.clear());

        const { path, ...query } = Object.fromEntries(new URL(url).searchParams);

        const { promise, resolve, reject } = deferred();
        this.connected = promise;

        this.initSocketIO(url, path, query, options, reject, resolve);
    }

    private initSocketIO(
        url: string,
        path: string | undefined,
        query: { [k: string]: string },
        options: Partial<ManagerOptions & SocketOptions> | undefined,
        reject: PromiseRejectCb,
        resolve: PromiseResolveCb<void>,
    ) {
        this.socketClient = io(url, {
            transports: ['websocket'],
            withCredentials: true, // Pass Cookie to socket io connection
            path,
            query,
            forceNew: true,
            auth: {
                clientId: this.stableClientId,
            },
            ...options,
        });

        this.socketClient.once('connect_error', (error) => {
            if (error.message === 'timeout' && this.reinitCount < 3) {
                this.reinitCount++;
                this.socketClient.close();
                this.initSocketIO(
                    url,
                    path,
                    query,
                    {
                        ...options,
                        timeout: (options?.timeout ?? 20000) * (this.reinitCount + 1),
                    },
                    reject,
                    resolve,
                );
                return;
            }
            reject(new Error(`Failed to connect to socket server`, { cause: error }));
        });

        this.socketClient.on('connect', () => {
            this.reinitCount = Infinity;
            this.subscribers.emit('connect', undefined);
            resolve();
        });

        this.socketClient.on('message', (data: unknown) => {
            if (
                typeof data === 'string' &&
                (data === 'server-lost-client-state' || data === 'server-connection-restored')
            ) {
                this.subscribers.emit(data, undefined);
                return;
            }
            this.emitMessageHandlers(data as Message);
        });

        this.socketClient.on('disconnect', (reason: string) => {
            this.subscribers.emit('disconnect', reason);
        });

        this.socketClient.on('reconnect', () => {
            this.subscribers.emit('reconnect', undefined);
        });

        this.socketClient.connect();
    }

    public postMessage(data: any) {
        this.socketClient.emit('message', data);
    }
    close() {
        this.socketClient.close();
    }
    disconnectSocket() {
        if (this.socketClient.connected) {
            this.socketClient.disconnect();
        }
    }
    reconnectSocket() {
        if (!this.socketClient.connected) {
            this.socketClient.connect();
        }
    }
    isConnected(): boolean {
        return this.socketClient.connected;
    }
}

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

            // Log server-info messages
            if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'server-info') {
                console.log('[WS Dev] Server Info Received:', data);
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

        // Inject dev button for testing
        this.injectDevButton();
    }

    private injectDevButton() {
        if (typeof document === 'undefined') return;

        const button = document.createElement('button');
        button.textContent = '🔧 Get Server Info';
        button.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 10000;
            padding: 10px 15px;
            background: #6366f1;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            transition: all 0.2s;
        `;

        button.addEventListener('mouseenter', () => {
            button.style.background = '#4f46e5';
            button.style.transform = 'translateY(-2px)';
            button.style.boxShadow = '0 6px 8px rgba(0,0,0,0.15)';
        });

        button.addEventListener('mouseleave', () => {
            button.style.background = '#6366f1';
            button.style.transform = 'translateY(0)';
            button.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
        });

        button.addEventListener('click', () => {
            console.log('[WS Dev] Sending "givemeinfo" message...');
            this.socketClient.emit('message', 'givemeinfo');
        });

        document.body.appendChild(button);

        // Clean up button on dispose
        this.disposables.add('remove dev button', () => {
            button.remove();
        });
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

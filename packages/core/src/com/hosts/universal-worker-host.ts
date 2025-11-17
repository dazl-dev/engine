import type {
    UniversalMessageHandler,
    UniversalWorker,
    UniversalWorkerUserMethods,
} from '@dazl/isomorphic-worker/types';
import { type Target } from '../types.js';

export class UniversalWorkerHost implements Target {
    private messageHandlersMap = new Map<(event: { data: any; source: Target }) => void, UniversalMessageHandler>();

    constructor(
        private worker: UniversalWorker | UniversalWorkerUserMethods,
        public name: string,
    ) {}

    public addEventListener(type: 'message', callback: (event: { data: any; source: Target }) => void): void {
        const handler = (message: any) => callback(message);
        this.messageHandlersMap.set(callback, handler);

        this.worker.addEventListener(type, handler);
    }

    public removeEventListener(type: 'message', callback: (event: { data: any; source: Target }) => void): void {
        const handler = this.messageHandlersMap.get(callback);
        if (handler) {
            this.worker.removeEventListener(type, handler);
        }
        this.messageHandlersMap.delete(callback);
    }

    public postMessage(data: any): void {
        this.worker.postMessage(data);
    }
}

import { Message, Target } from '@dazl/engine-core';
import { parentPort } from 'node:worker_threads';

export class ParentPortHost implements Target {
    constructor(public name = 'base-host') {
        if (!parentPort) {
            throw new Error('parent port host must be initialized in a worker thread');
        }
        parentPort?.on('message', (message: Message) => {
            this.emitMessageHandlers(message);
        });
    }
    protected handlers = new Map<'message', Set<(e: { data: Message; source: Target }) => void>>();

    public addEventListener(
        name: 'message',
        handler: (e: { data: Message; source: Target }) => void,
        _capture?: boolean,
    ) {
        const handlers = this.handlers.get(name);
        if (!handlers) {
            this.handlers.set(name, new Set([handler]));
        } else {
            handlers.add(handler);
        }
    }

    public removeEventListener(name: 'message', handler: (e: { data: Message }) => void, _capture?: boolean) {
        const handlers = this.handlers.get(name);
        if (handlers) {
            handlers.delete(handler);
        }
    }

    public postMessage(message: Message) {
        parentPort?.postMessage(message);
    }

    protected emitMessageHandlers(message: Message) {
        for (const handler of this.handlers.get('message') || []) {
            handler({ data: message, source: this });
        }
    }
}

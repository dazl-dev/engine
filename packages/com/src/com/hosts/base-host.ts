import type { Message } from '../message-types';
import type { Target } from '../../types';

export class BaseHost implements Target {
    public name = 'base-host';
    public parent: BaseHost | undefined = undefined;
    protected handlers = new Map<'message', Set<(e: { data: Message }) => void>>();

    public addEventListener(name: 'message', handler: (e: { data: Message }) => void, _capture?: boolean) {
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
        this.emitMessageHandlers(message);
    }

    public open() {
        const host = new BaseHost();
        host.parent = this;
        return host;
    }

    protected emitMessageHandlers(message: Message) {
        for (const handler of this.handlers.get('message') || []) {
            handler({ data: message });
        }
    }
}

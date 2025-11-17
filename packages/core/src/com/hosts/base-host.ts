import type { Message } from '../message-types.js';
import type { Target } from '../types.js';

export class BaseHost implements Target {
    constructor(public name = 'base-host') {}
    public parent: BaseHost | undefined = undefined;
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

    public removeEventListener(
        name: 'message',
        handler: (e: { data: Message; source: Target }) => void,
        _capture?: boolean,
    ) {
        const handlers = this.handlers.get(name);
        if (handlers) {
            handlers.delete(handler);
        }
    }

    public postMessage(message: Message) {
        this.emitMessageHandlers(message);
    }

    public open(name = 'child-host') {
        const host = new BaseHost(name);
        host.parent = this;
        return host;
    }

    protected emitMessageHandlers(message: Message) {
        for (const handler of this.handlers.get('message') || []) {
            handler({ data: message, source: this.parent || this });
        }
    }
}

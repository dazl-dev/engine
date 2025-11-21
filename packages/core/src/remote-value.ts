export type Listener<T> = (data: T) => void;
export type AsyncRemoteValue<T> = {
    getValue: () => Promise<T>;
    stream: (handler: Listener<T>) => void;
    subscribe: (handler: Listener<T>) => void;
    unsubscribe: (handler: Listener<T>) => void;
};

export const remoteValueAsyncMethods = new Set(['getValue', 'stream', 'subscribe', 'unsubscribe'] as const);
export type RemoteValueAsyncMethods = typeof remoteValueAsyncMethods extends Set<infer U> ? U : never;

export class RemoteValue<T> {
    private handlers = new Set<Listener<T>>();
    private value: T;

    constructor(initialValue: T) {
        this.value = initialValue;
    }

    getValue = (): T => {
        return this.value;
    };

    subscribe = (handler: Listener<T>) => {
        this.handlers.add(handler);
    };
    stream = (handler: Listener<T>) => {
        this.subscribe(handler);
        handler(this.value);
    };

    unsubscribe = (handler: Listener<T>) => {
        this.handlers.delete(handler);
    };

    /**
     * Set the value and notify all subscribers with the new data.
     * Only notifies if the value has changed.
     */
    setValueAndNotify = (data: T) => {
        if (this.value === data) {
            return;
        }
        this.value = data;
        for (const handler of this.handlers) {
            handler(data);
        }
    };
}

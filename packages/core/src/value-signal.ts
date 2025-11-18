export type Listener<T> = (data: T, version: number) => void;
export type AsyncRemoteValue<T> = {
    getValue: () => Promise<T>;
    stream: (handler: Listener<T>) => void;
    subscribe: (handler: Listener<T>) => void;
    unsubscribe: (handler: Listener<T>) => void;
};

export type RemotelyAccessibleSignalMethods = 'subscribe' | 'unsubscribe' | 'getValue';

export class RemoteValue<T> {
    private handlers = new Set<Listener<T>>();
    private value: T;
    private version: number = 0;

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
        handler(this.value, this.version);
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
        this.version++;
        this.value = data;
        for (const handler of this.handlers) {
            handler(data, this.version);
        }
    };
}

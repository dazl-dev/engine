export type RemoteValueListener<T> = (data: T, version: number) => void;
export type ReconnectFunction<T> = (currentVersion: number) => Promise<{
    value: T;
    version: number;
} | null>;

export type AsyncRemoteValue<T> = {
    getValue: () => Promise<T>;
    stream: (handler: RemoteValueListener<T>) => void;
    subscribe: (handler: RemoteValueListener<T>) => void;
    unsubscribe: (handler: RemoteValueListener<T>) => void;
};

export const remoteValueAsyncMethods = new Set([
    'getValue',
    'stream',
    'subscribe',
    'unsubscribe',
    'reconnect',
] as const);
export type RemoteValueAsyncMethods = typeof remoteValueAsyncMethods extends Set<infer U> ? U : never;

export class RemoteValue<T> {
    private handlers = new Set<RemoteValueListener<T>>();
    private value: T;
    private version: number = 0;

    constructor(initialValue: T) {
        this.value = initialValue;
    }

    getValue = (): T => {
        return this.value;
    };

    subscribe = (handler: RemoteValueListener<T>) => {
        this.handlers.add(handler);
    };
    stream = (handler: RemoteValueListener<T>) => {
        this.subscribe(handler);
        handler(this.value, this.version);
    };

    unsubscribe = (handler: RemoteValueListener<T>) => {
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

    /**
     * Reconnect method to sync version and retrieve latest value if needed.
     * Returns the latest value and version if there's a mismatch, otherwise returns null.
     */
    reconnect = (currentVersion: number): { value: T; version: number } | null => {
        if (currentVersion !== this.version) {
            return { value: this.value, version: this.version };
        }
        return null;
    };
}

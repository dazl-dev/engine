export type RemoteAggregatedValueListener<T> = (data: T | T[], version: number, modifier: 'item' | 'all') => void;

export type AsyncRemoteAggregatedValue<T> = {
    getValue: () => Promise<T[]>;
    subscribe: (handler: RemoteAggregatedValueListener<T>) => void;
    unsubscribe: (handler: RemoteAggregatedValueListener<T>) => void;
};

export class RemoteAggregatedValue<T> {
    private allItems: T[] = [];
    private limit: number;
    private handlers = new Set<RemoteAggregatedValueListener<T>>();
    private version: number = 0;

    constructor({ limit = 10 }: { limit?: number } = {}) {
        this.limit = limit;
    }

    getValue = (): T[] => {
        return this.allItems;
    };

    subscribe = (handler: RemoteAggregatedValueListener<T>) => {
        handler(this.allItems, this.version, 'all');
        this.handlers.add(handler);
    };

    unsubscribe = (handler: RemoteAggregatedValueListener<T>) => {
        this.handlers.delete(handler);
    };

    push(item: T) {
        this.allItems.push(item);
        if (this.allItems.length > this.limit) {
            this.allItems.shift();
        }
        this.version++;
        for (const handler of this.handlers) {
            handler(item, this.version, 'item');
        }
    }

    clear() {
        this.allItems = [];
        this.version++;
        for (const handler of this.handlers) {
            handler([], this.version, 'all');
        }
    }

    /**
     * Reconnect method to sync version and retrieve latest value if needed.
     * Returns the latest value and version if there's a mismatch, otherwise returns null.
     */
    reconnect = (currentVersion: number): { value: T[]; version: number } | null => {
        if (currentVersion !== this.version) {
            return { value: this.allItems, version: this.version };
        }
        return null;
    };
}

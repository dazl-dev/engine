interface CallerContext {
    getStore(): unknown;
    run<R>(identity: unknown, callback: () => R): R;
}
let callerStore: CallerContext | undefined | null;

async function initCallerContext() {
    if (callerStore !== undefined) {
        return callerStore !== null;
    }
    try {
        const moduleName = 'node:async_hooks';
        const { AsyncLocalStorage } = await import(moduleName);
        callerStore = new AsyncLocalStorage();
        return true;
    } catch {
        callerStore = null;
        return false;
    }
}

export function getCurrentCaller(): unknown {
    return callerStore?.getStore();
}

export async function runWithCaller<R>(isNode: boolean, identity: unknown, fn: () => R): Promise<R> {
    if (isNode) {
        await initCallerContext();
    }
    if (callerStore) {
        return callerStore.run(identity, fn);
    }
    return fn();
}

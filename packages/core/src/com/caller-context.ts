export interface CallerContext {
    getStore(): unknown;
    run<R>(store: unknown, callback: () => R): R;
}

let activeCallerContext: CallerContext | undefined;
export function setActiveCallerContext(ctx: CallerContext | undefined): void {
    activeCallerContext = ctx;
}

export function getCurrentCaller(): unknown {
    return activeCallerContext?.getStore();
}

export function runWithCaller<R>(identity: unknown, fn: () => R): R {
    if (identity !== undefined && activeCallerContext) {
        return activeCallerContext.run(identity, fn);
    }
    return fn();
}

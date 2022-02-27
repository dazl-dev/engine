import type playwright from 'playwright-core';
import { deferred } from '@wixc3/engine-core';

/**
 * Hooks the console of a `playwright.Page` to Node's console,
 * printing anything from the page in Node.
 */
export function hookPageConsole(
    page: playwright.Page,
    filterMessage: (msgType: string, args: unknown[]) => boolean = () => true
): () => void {
    let currentMessage: Promise<void> = Promise.resolve();

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    page.on('console', listenToPageMessage);

    async function listenToPageMessage(msg: playwright.ConsoleMessage) {
        const messageType = msg.type();
        const consoleFn = messageTypeToConsoleFn[messageType];
        if (!consoleFn) {
            return;
        }

        const { promise, resolve } = deferred();
        const previousMessage = currentMessage;
        currentMessage = promise;
        const rawMessageText = msg.text(); // contains non-processed formatting
        try {
            const msgArgs: unknown[] = await Promise.all(msg.args().map((arg) => arg.jsonValue()));
            await previousMessage;
            if (filterMessage(messageType, msgArgs)) {
                consoleFn.apply(console, msgArgs);
            }
        } catch (e) {
            console.log(rawMessageText);
        } finally {
            resolve();
        }
    }

    return () => {
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        page.off('console', listenToPageMessage);
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const messageTypeToConsoleFn: { [key: string]: (...args: any[]) => void } = {
    log: console.log,
    warning: console.warn,
    error: console.error,
    info: console.info,
    assert: console.assert,
    debug: console.debug,
    trace: console.trace,
    dir: console.dir,
    dirxml: console.dirxml,
    profile: console.profile,
    profileEnd: console.profileEnd,
    startGroup: console.group,
    startGroupCollapsed: console.groupCollapsed,
    endGroup: console.groupEnd,
    table: console.table,
    count: console.count,
    timeEnd: console.timeEnd,

    // we ignore calls to console.clear, as we don't want the page to clear our terminal
    // clear: console.clear
};

import type playwright from 'playwright-core';
import { startDevServer } from '@wixc3/engineer';
import { createBrowserProvider } from '@wixc3/engine-test-kit';

export interface StartServerNewProcessOptions {
    projectPath: string;
    featureName: string;
    runtimeOptions?: Record<string, string | boolean>;
    launchOptions?: playwright.LaunchOptions;
}

export const startServerNewProcess = async ({
    projectPath,
    featureName,
    runtimeOptions = {},
    launchOptions,
}: StartServerNewProcessOptions) => {
    const { dispose, devServerFeature } = await startDevServer({
        targetApplicationPath: projectPath,
        featureName,
        autoLaunch: true,
        singleFeature: true,
        // We are using forked to guarentee that each node env runs in its own process
        // This is retquired in this set of tests because it validates changes to globals
        nodeEnvironmentsMode: 'forked',
        runtimeOptions,
    });

    const runningPort = await new Promise<number>((resolve) => {
        devServerFeature.serverListeningHandlerSlot.register(({ port }) => {
            resolve(port);
        });
    });

    const featureUrl = `http://localhost:${runningPort}/main.html?feature=${featureName}`;

    return { dispose, runningPort, browserProvider: createBrowserProvider(launchOptions), featureUrl };
};

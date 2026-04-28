import { bindMetricsListener, bindRpcListener, ParentPortHost } from '@dazl/engine-runtime-node';
import { workerData } from 'node:worker_threads';
import { AsyncLocalStorage } from 'node:async_hooks';
import { COM, FeatureClass, RuntimeEngine, TopLevelConfig } from '@dazl/engine-core';
import CallerIdentityFeature from '../feature/caller-identity.feature.js';
import { cEnv } from '../feature/envs.js';
import '../feature/caller-identity.c.env.js';

const options = workerData?.runtimeOptions as Map<string, string> | undefined;
const verbose = options?.get('verbose') ?? false;
const env = cEnv;

if (verbose) {
    console.log(`[${env.env}: Started with options: `, options);
}

let activateValue: unknown;
export function getActivateValue() {
    return activateValue;
}

export function runEnv({
    Feature = CallerIdentityFeature,
    topLevelConfig = [],
}: { Feature?: FeatureClass; topLevelConfig?: TopLevelConfig } = {}) {
    return new RuntimeEngine(
        env,
        [
            ...(workerData
                ? [
                      COM.configure({
                          config: {
                              host: new ParentPortHost(env.env),
                              id: env.env,
                              callerContext: new AsyncLocalStorage(),
                          },
                      }),
                  ]
                : []),
            ...topLevelConfig,
        ],
        new Map(options?.entries() ?? []),
    ).run(Feature);
}

if (workerData) {
    const unbindMetricsListener = bindMetricsListener();
    let running: ReturnType<typeof runEnv>;
    const unbindActivateListener = bindRpcListener('activate', (value: unknown) => {
        activateValue = value;
        unbindActivateListener();
        running = runEnv();
    });
    const unbindTerminationListener = bindRpcListener('terminate', async () => {
        if (verbose) {
            console.log(`[${env.env}]: Termination Requested. Waiting for engine.`);
        }
        unbindTerminationListener();
        unbindMetricsListener();
        try {
            const engine = await running;
            if (verbose) {
                console.log(`[${env.env}]: Terminating`);
            }
            return engine.shutdown();
        } catch (e) {
            console.error('[${env.name}]: Error while shutting down', e);
            return;
        }
    });
} else {
    console.log('running engine in test mode');
}

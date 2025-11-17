import { bindMetricsListener, bindRpcListener, ParentPortHost } from '@dazl/engine-runtime-node';
import { workerData } from 'node:worker_threads';
import { COM, FeatureClass, RuntimeEngine, TopLevelConfig } from '@dazl/engine-core';
import TestFeature from '../feature/test-feature.js';
import { aEnv } from '../feature/envs.js';
import '../feature/test-feature.a.env.js';

const options = workerData?.runtimeOptions as Map<string, string> | undefined;
const verbose = options?.get('verbose') ?? false;
const env = aEnv;

if (verbose) {
    console.log(`[${env.env}: Started with options: `, options);
}

export function runEnv({
    Feature = TestFeature,
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
    // used by dispose to wait for engine to be ready
    const running = runEnv();
} else {
    console.log('running engine in test mode');
}

import { AnyEnvironment, Communication, IRunOptions, UniversalWorkerHost } from '@dazl/engine-core';
import { Worker } from '@dazl/isomorphic-worker/worker';
import { type UniversalWorkerOptions } from '@dazl/isomorphic-worker/types';
import { createDisposables } from '@dazl/patterns';
import { getMetricsFromWorker } from './metrics-utils.js';
import { rpcCall } from './micro-rpc.js';
import type { RunningNodeEnvironment } from './node-env-manager.js';

export interface WorkerThreadInitializer2 extends RunningNodeEnvironment {
    initialize: () => Promise<void>;
}

export interface WorkerThreadInitializerOptions2 {
    workerURL: URL;
    runtimeOptions?: IRunOptions;
    env: Pick<AnyEnvironment, 'env' | 'endpointType'>;
    communication: Communication;
}

export function runWorker(instanceId: string, workerURL: URL, runtimeOptions?: IRunOptions) {
    const envRuntimeOptions = new Map(runtimeOptions?.entries());
    envRuntimeOptions.set('environment_id', instanceId);
    return new Worker(workerURL, {
        name: instanceId,
        workerData: { runtimeOptions: envRuntimeOptions },
        execArgv: process.execArgv,
    } as UniversalWorkerOptions);
}

export function workerThreadInitializer2({
    communication,
    env,
    workerURL,
    runtimeOptions,
}: WorkerThreadInitializerOptions2): WorkerThreadInitializer2 {
    const disposables = createDisposables('workerThreadInitializer');
    const instanceId = communication.getEnvironmentInstanceId(env.env, env.endpointType);
    const envIsReady = communication.envReady(instanceId);
    let worker: Worker;
    const initialize = async () => {
        const envRuntimeOptions = new Map(runtimeOptions?.entries());
        envRuntimeOptions.set('environment_id', instanceId);

        worker = new Worker(workerURL, {
            name: instanceId,
            workerData: { runtimeOptions: envRuntimeOptions },
            execArgv: process.execArgv,
        } as UniversalWorkerOptions);

        disposables.add({
            name: 'terminate worker',
            dispose: async () => {
                if (process.env.ENGINE_GRACEFUL_TERMINATION !== 'false') {
                    try {
                        await rpcCall(worker, 'terminate', 15000);
                    } catch (e) {
                        console.error(
                            `failed terminating environment gracefully ${instanceId}, terminating worker.`,
                            e,
                        );
                    }
                }
                await worker.terminate();
            },
            timeout: 20_000,
        });

        const host = new UniversalWorkerHost(worker, instanceId);
        communication.registerEnv(instanceId, host);
        communication.registerMessageHandler(host);

        disposables.add('communication', () => {
            communication.clearEnvironment(instanceId);
            communication.removeMessageHandler(host);
        });

        await envIsReady;
    };

    return {
        id: instanceId,
        initialize,
        dispose: () => disposables.dispose(),
        getMetrics: () => getMetricsFromWorker(worker),
    };
}

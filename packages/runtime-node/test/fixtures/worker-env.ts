import { Communication } from '@dazl/engine-core';
import { ParentPortHost } from '@dazl/engine-runtime-node';
import { workerData } from 'node:worker_threads';

const { envName, mainEnvName } = workerData as { envName: string; mainEnvName: string };

const host = new ParentPortHost(envName);
const com = new Communication(host, envName);
com.registerEnv(mainEnvName, host);

const listeners = new Set<(value: string) => void>();

com.registerAPI(
    { id: 'workerApi' },
    {
        add: (a: number, b: number) => a + b,
        fail: (message: string) => {
            throw new Error(message);
        },
        hang: () => new Promise(() => undefined),
        subscribe: (cb: (value: string) => void) => {
            listeners.add(cb);
        },
        emitAll: (value: string) => {
            for (const listener of listeners) {
                listener(value);
            }
        },
    },
);

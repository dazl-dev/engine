import { BaseHost, Communication, UniversalWorkerHost } from '@dazl/engine-core';
import { Worker } from '@dazl/isomorphic-worker/worker';
import type { UniversalWorkerOptions } from '@dazl/isomorphic-worker/types';
import { expect } from 'chai';
import { sleep, waitFor } from 'promise-assist';

interface WorkerApiProxy {
    add(a: number, b: number): Promise<number>;
    fail(message: string): Promise<void>;
    hang(): Promise<void>;
    subscribe(cb: (value: string) => void): Promise<void>;
    emitAll(value: string): Promise<void>;
}

interface ComStatusAccess {
    getComStatus(): { pendingCallbacks: Record<string, unknown> };
}

const workerEnvUrl = new URL('./fixtures/worker-env.js', import.meta.url);

function spawnWorkerEnv(com: Communication, envName: string) {
    const options: UniversalWorkerOptions = {
        name: envName,
        workerData: { envName, mainEnvName: com.getEnvironmentId() },
    };
    const worker = new Worker(workerEnvUrl, options);
    const host = new UniversalWorkerHost(worker, envName);
    com.registerMessageHandler(host);
    com.registerEnv(envName, host);
    return worker;
}

describe('transport over real worker threads (UniversalWorkerHost)', function () {
    this.timeout(30_000);

    let com: Communication;
    let workers: Worker[];

    beforeEach(() => {
        com = new Communication(new BaseHost(), 'main');
        workers = [];
    });

    afterEach(async () => {
        await com.dispose();
        for (const worker of workers) {
            await worker.terminate();
        }
    });

    it('calls an API in a real worker thread and gets the result back', async () => {
        workers.push(spawnWorkerEnv(com, 'worker'));
        await com.envReady('worker');

        const api = com.apiProxy<WorkerApiProxy>({ id: 'worker' }, { id: 'workerApi' });

        expect(await api.add(2, 3)).to.equal(5);
    });

    it('propagates errors thrown inside the worker back to the caller', async () => {
        workers.push(spawnWorkerEnv(com, 'worker'));
        await com.envReady('worker');

        const api = com.apiProxy<WorkerApiProxy>({ id: 'worker' }, { id: 'workerApi' });

        let caught: Error | undefined;
        await api.fail('worker exploded').catch((e: Error) => (caught = e));
        expect(caught?.message).to.include('worker exploded');
    });

    it('streams events from the worker to a main-side listener', async () => {
        workers.push(spawnWorkerEnv(com, 'worker'));
        await com.envReady('worker');

        const api = com.apiProxy<WorkerApiProxy>(
            { id: 'worker' },
            { id: 'workerApi' },
            { subscribe: { listener: true } },
        );
        const received: string[] = [];
        await api.subscribe((value) => received.push(value));

        await api.emitAll('tick-1');
        await api.emitAll('tick-2');

        await waitFor(() => expect(received).to.eql(['tick-1', 'tick-2']));
    });

    it('two worker environments served by the same main communication stay independent', async () => {
        workers.push(spawnWorkerEnv(com, 'worker-a'), spawnWorkerEnv(com, 'worker-b'));
        await Promise.all([com.envReady('worker-a'), com.envReady('worker-b')]);

        const apiA = com.apiProxy<WorkerApiProxy>({ id: 'worker-a' }, { id: 'workerApi' });
        const apiB = com.apiProxy<WorkerApiProxy>({ id: 'worker-b' }, { id: 'workerApi' });

        expect(await Promise.all([apiA.add(1, 1), apiB.add(2, 2)])).to.eql([2, 4]);
    });

    it('DOCUMENTED GAP: terminating a worker mid-call leaves the caller pending with no error', async () => {
        workers.push(spawnWorkerEnv(com, 'worker'));
        await com.envReady('worker');

        const api = com.apiProxy<WorkerApiProxy>({ id: 'worker' }, { id: 'workerApi' });
        expect(await api.add(1, 1)).to.equal(2);

        let settled = false;
        api.hang()
            .then(() => (settled = true))
            .catch(() => (settled = true));
        await sleep(50);
        await workers[0]!.terminate();
        await sleep(200);

        expect(settled, 'call neither resolves nor rejects after worker termination').to.equal(false);
        const status = (com as unknown as ComStatusAccess).getComStatus();
        expect(Object.keys(status.pendingCallbacks)).to.have.lengthOf(1);
    });

    it('clearEnvironment rejects in-flight calls, and a restarted worker env serves new calls', async () => {
        workers.push(spawnWorkerEnv(com, 'worker'));
        await com.envReady('worker');

        const api = com.apiProxy<WorkerApiProxy>({ id: 'worker' }, { id: 'workerApi' });
        let rejection: Error | undefined;
        const inFlight = api.hang().catch((e: Error) => (rejection = e));
        await sleep(50);
        await workers[0]!.terminate();
        com.clearEnvironment('worker');
        await inFlight;

        expect(rejection, 'explicit clearEnvironment rejects the pending call').to.be.instanceOf(Error);

        workers.push(spawnWorkerEnv(com, 'worker'));
        await com.envReady('worker');
        expect(await api.add(3, 4), 'new calls work after restart').to.equal(7);
    });
});

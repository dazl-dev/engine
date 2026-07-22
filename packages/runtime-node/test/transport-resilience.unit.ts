import { RemoteValue } from '@dazl/engine-core';
import { expect } from 'chai';
import { sleep, waitFor } from 'promise-assist';
import { CommLab } from '../test-kit/comm-lab.js';

/**
 * Transport resilience scenarios over a REAL socket.io connection.
 *
 * These tests document the communication layer's behavior under network
 * faults (cuts, drops, duplication, reordering). Tests marked
 * "documented gap" pin down current — undesired — behavior on purpose:
 * when the gap is fixed, the test should be flipped to assert the new contract.
 */
describe('transport resilience (real socket)', function () {
    this.timeout(15_000);

    let lab: CommLab;
    afterEach(async () => {
        await lab.dispose();
    });

    it('completes a remote api call between real socket peers', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });
        server.exposeApi('calculator', { add: (a: number, b: number) => a + b });

        const calculator = client.remoteApi<{ add(a: number, b: number): Promise<number> }>(
            'processing',
            'calculator',
        );
        const result = await calculator.add(1, 2);

        expect(result).to.equal(3);
    });

    it('receives server-pushed events for a registered listener', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });
        const listeners = new Set<(value: string) => void>();
        server.exposeApi('ticker', {
            onTick: (listener: (value: string) => void) => void listeners.add(listener),
            offTick: (listener: (value: string) => void) => void listeners.delete(listener),
            emitTick: (value: string) => listeners.forEach((listener) => listener(value)),
        });
        const ticker = client.remoteApi<{
            onTick(listener: (value: string) => void): Promise<void>;
            emitTick(value: string): Promise<void>;
        }>('processing', 'ticker', { onTick: { listener: true, removeListener: 'offTick' } });
        const received: string[] = [];
        await ticker.onTick((value) => received.push(value));

        await ticker.emitTick('tick-1');

        await waitFor(() => expect(received).to.eql(['tick-1']));
    });

    it('recovers api calls after the connection is cut and auto-reconnects', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });
        server.exposeApi('echo', { echo: (value: string) => value });
        const echo = client.remoteApi<{ echo(value: string): Promise<string> }>('processing', 'echo');
        expect(await echo.echo('before')).to.equal('before');

        const reconnected = client.waitForReconnect('processing');
        lab.network.cutConnection();
        await reconnected;

        expect(await echo.echo('after')).to.equal('after');
    });

    it('resumes event subscriptions after a reconnect (listener re-registration)', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });
        const listeners = new Set<(value: string) => void>();
        server.exposeApi('ticker', {
            onTick: (listener: (value: string) => void) => void listeners.add(listener),
            offTick: (listener: (value: string) => void) => void listeners.delete(listener),
            emitTick: (value: string) => listeners.forEach((listener) => listener(value)),
        });
        const ticker = client.remoteApi<{
            onTick(listener: (value: string) => void): Promise<void>;
            emitTick(value: string): Promise<void>;
        }>('processing', 'ticker', { onTick: { listener: true, removeListener: 'offTick' } });
        const received: string[] = [];
        await ticker.onTick((value) => received.push(value));
        await ticker.emitTick('before-cut');
        await waitFor(() => expect(received).to.eql(['before-cut']));

        const reconnected = client.waitForReconnect('processing');
        lab.network.cutConnection();
        await reconnected;
        await waitFor(async () => {
            await ticker.emitTick('after-reconnect');
            expect(received).to.include('after-reconnect');
        });

        expect(received[0]).to.equal('before-cut');
        expect(received).to.include('after-reconnect');
    });

    it('a RemoteValue subscriber converges to the latest value after a reconnect', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });
        const counter = new RemoteValue<number>(0);
        server.exposeApi('state', { counter });
        const state = client.remoteApi<{ counter: RemoteValue<number> }>('processing', 'state');
        const received: Array<{ value: number; version: number }> = [];
        state.counter.subscribe((value: number, version: number) => received.push({ value, version }));
        // subscription registration is emit-only; a getValue round-trip guarantees it was processed
        expect(await state.counter.getValue()).to.equal(0);
        counter.setValueAndNotify(1);
        await waitFor(() => expect(received).to.eql([{ value: 1, version: 1 }]));

        const reconnected = client.waitForReconnect('processing');
        lab.network.cutConnection();
        counter.setValueAndNotify(2);
        counter.setValueAndNotify(3);
        await reconnected;
        await client.resyncRemoteValues('processing');

        await waitFor(() => {
            const last = received[received.length - 1];
            expect(last?.value, 'latest value').to.equal(3);
            expect(last?.version, 'latest version').to.equal(3);
        });
    });

    it('documented gap: a dropped call message leaves the caller pending with no retry', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });
        let serverCalls = 0;
        server.exposeApi('echo', {
            echo: (value: string) => {
                serverCalls++;
                return value;
            },
        });
        const echo = client.remoteApi<{ echo(value: string): Promise<string> }>('processing', 'echo');
        lab.network.dropNextClientToServer();

        let settled = false;
        echo.echo('lost').then(
            () => (settled = true),
            () => (settled = true),
        );
        await sleep(300);

        expect(serverCalls, 'server never received the call').to.equal(0);
        expect(settled, 'caller still pending — no retry, no fast failure').to.equal(false);
        expect(Object.keys(client.status().pendingCallbacks), 'one leaked pending callback').to.have.lengthOf(1);
    });

    it('documented gap: a duplicated call message invokes the remote api twice', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });
        let serverCalls = 0;
        server.exposeApi('recorder', {
            record: () => {
                serverCalls++;
            },
        });
        const recorder = client.remoteApi<{ record(): Promise<void> }>('processing', 'recorder');
        lab.network.duplicateNextClientToServer();

        await recorder.record();

        await waitFor(() => expect(serverCalls, 'api executed once per delivery').to.equal(2));
    });

    it('documented gap: reordered messages are applied out of order (no sequencing)', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });
        const receivedOrder: string[] = [];
        server.exposeApi('recorder', {
            record: (value: string) => {
                receivedOrder.push(value);
            },
        });
        const recorder = client.remoteApi<{ record(value: string): Promise<void> }>('processing', 'recorder');

        lab.network.holdClientToServer();
        const first = recorder.record('first');
        const second = recorder.record('second');
        await sleep(50); // let both calls serialize into the held queue
        lab.network.releaseClientToServer({ reversed: true });
        await Promise.all([first, second]);

        expect(receivedOrder).to.eql(['second', 'first']);
    });

    it('documented behavior: the server disposes all client env state on any socket drop', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });
        server.exposeApi('echo', { echo: (value: string) => value });
        const echo = client.remoteApi<{ echo(value: string): Promise<string> }>('processing', 'echo');
        await echo.echo('establish-connection');
        const disposedEnv = server.onceEnvironmentDisposed();

        lab.network.cutConnection();

        expect(await disposedEnv).to.contain('editor');
    });

    it('leaves no pending callbacks or leaked listener handlers after subscribe/unsubscribe cycles', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });
        const listeners = new Set<(value: string) => void>();
        server.exposeApi('ticker', {
            onTick: (listener: (value: string) => void) => void listeners.add(listener),
            offTick: (listener: (value: string) => void) => void listeners.delete(listener),
        });
        const ticker = client.remoteApi<{
            onTick(listener: (value: string) => void): Promise<void>;
            offTick(listener: (value: string) => void): Promise<void>;
        }>('processing', 'ticker', {
            onTick: { listener: true, removeListener: 'offTick' },
            offTick: { removeListener: 'onTick' },
        });

        for (let i = 0; i < 3; i++) {
            const listener = () => undefined;
            await ticker.onTick(listener);
            await ticker.offTick(listener);
        }

        await waitFor(() => {
            const status = client.status();
            expect(Object.keys(status.pendingCallbacks), 'pending callbacks').to.have.lengthOf(0);
            const handlerCounts = Object.values(status.handlers);
            expect(
                handlerCounts.every((count) => count === 0),
                `no dangling handlers: ${JSON.stringify(status.handlers)}`,
            ).to.equal(true);
        });
        await waitFor(() => expect(listeners.size, 'server side listeners removed').to.equal(0));
    });
});

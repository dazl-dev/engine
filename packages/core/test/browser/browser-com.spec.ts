import { RemoteValue } from '@dazl/engine-core';
import { expect } from 'chai';
import { waitFor, sleep } from 'promise-assist';
import { WebCommLab } from './web-comm-lab.js';

const describeInBrowser = typeof window === 'undefined' ? describe.skip : describe;

/**
 * Communication scenarios over REAL browser transports: same-origin iframes
 * (genuine cross-document `window.postMessage`) and `MessageChannel` port
 * pairs. Tests marked "documented gap" pin down current — undesired —
 * behavior on purpose: when the gap is fixed, flip the test.
 */
describeInBrowser('browser transports (real postMessage)', function () {
    this.timeout(10_000);

    let lab: WebCommLab;
    afterEach(async () => {
        await lab.dispose();
    });

    it('completes a remote api call between the page and a real iframe', async () => {
        lab = new WebCommLab();
        const main = lab.addWindowEnv('main');
        const frame = lab.addIframeEnv('frame');
        lab.linkEnvs(main, frame);
        frame.exposeApi('calculator', { add: (a: number, b: number) => a + b });

        const calculator = main.remoteApi<{ add(a: number, b: number): Promise<number> }>('frame', 'calculator');

        expect(await calculator.add(1, 2)).to.equal(3);
    });

    it('delivers iframe-pushed events to a listener registered by the page', async () => {
        lab = new WebCommLab();
        const main = lab.addWindowEnv('main');
        const frame = lab.addIframeEnv('frame');
        lab.linkEnvs(main, frame);
        const listeners = new Set<(value: string) => void>();
        frame.exposeApi('ticker', {
            onTick: (listener: (value: string) => void) => void listeners.add(listener),
            offTick: (listener: (value: string) => void) => void listeners.delete(listener),
            emitTick: (value: string) => listeners.forEach((listener) => listener(value)),
        });
        const ticker = main.remoteApi<{
            onTick(listener: (value: string) => void): Promise<void>;
            emitTick(value: string): Promise<void>;
        }>('frame', 'ticker', { onTick: { listener: true, removeListener: 'offTick' } });
        const received: string[] = [];
        await ticker.onTick((value) => received.push(value));

        await ticker.emitTick('tick-1');

        await waitFor(() => expect(received).to.eql(['tick-1']));
    });

    it('streams a RemoteValue from an iframe to the page', async () => {
        lab = new WebCommLab();
        const main = lab.addWindowEnv('main');
        const frame = lab.addIframeEnv('frame');
        lab.linkEnvs(main, frame);
        const counter = new RemoteValue<number>(0);
        frame.exposeApi('state', { counter });
        const state = main.remoteApi<{ counter: RemoteValue<number> }>('frame', 'state');
        const received: number[] = [];
        state.counter.subscribe((value: number) => received.push(value));
        expect(await state.counter.getValue()).to.equal(0);

        counter.setValueAndNotify(1);
        counter.setValueAndNotify(2);

        await waitFor(() => expect(received).to.eql([1, 2]));
    });

    it('completes calls between two peers over a real MessageChannel port pair', async () => {
        lab = new WebCommLab();
        const [main, worker] = lab.addPortLinkedEnvs('main', 'worker');
        worker.exposeApi('echo', { echo: (value: string) => value });

        const echo = main.remoteApi<{ echo(value: string): Promise<string> }>('worker', 'echo');

        expect(await echo.echo('over-the-port')).to.equal('over-the-port');
    });

    it('documented gap: a call to a killed iframe stays pending forever (no liveness detection)', async () => {
        lab = new WebCommLab();
        const main = lab.addWindowEnv('main');
        const frame = lab.addIframeEnv('frame');
        lab.linkEnvs(main, frame);
        frame.exposeApi('echo', { echo: (value: string) => value });
        const echo = main.remoteApi<{ echo(value: string): Promise<string> }>('frame', 'echo');
        expect(await echo.echo('alive')).to.equal('alive');

        lab.killIframe(frame);
        let settled = false;
        echo.echo('to-the-void').then(
            () => (settled = true),
            () => (settled = true),
        );
        await sleep(300);

        expect(settled, 'caller still pending — nobody notices the iframe is gone').to.equal(false);
    });

    it('documented gap: a hostile iframe can invoke page apis (no origin validation)', async () => {
        lab = new WebCommLab();
        const main = lab.addWindowEnv('main');
        const invocations: string[] = [];
        main.exposeApi('privileged', { doDangerousThing: (arg: string) => void invocations.push(arg) });

        lab.spawnHostileIframe({
            type: 'call',
            to: 'main',
            from: 'evil-env',
            origin: 'evil-env',
            data: { api: 'privileged', method: 'doDangerousThing', args: ['pwned'] },
            forwardingChain: [],
        });

        // the parent auto-registers the unknown sender and executes the call
        await waitFor(() => expect(invocations).to.eql(['pwned']));
    });
});

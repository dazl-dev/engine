import { RemoteAggregatedValue } from '@dazl/engine-core';
import * as chai from 'chai';
import { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { waitFor } from 'promise-assist';
import { CommLab } from '../test-kit/comm-lab.js';

chai.use(chaiAsPromised);

/**
 * Topology and semantics scenarios over a REAL socket.io connection:
 * multi-client setups, cross-client forwarding through the server,
 * RemoteAggregatedValue, error propagation, and per-client fault scoping.
 */
describe('transport topology (real socket)', function () {
    this.timeout(15_000);

    let lab: CommLab;
    afterEach(async () => {
        await lab.dispose();
    });

    it('propagates a remote api error back to the caller', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });
        server.exposeApi('failing', {
            explode: () => {
                throw new Error('boom from server');
            },
        });

        const failing = client.remoteApi<{ explode(): Promise<void> }>('processing', 'failing');

        await expect(failing.explode()).to.be.rejectedWith('boom from server');
    });

    it('serves two clients independently from one server env', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const clientA = await lab.addClientEnv('editor-a', { connectTo: ['processing'] });
        const clientB = await lab.addClientEnv('editor-b', { connectTo: ['processing'] });
        let calls = 0;
        server.exposeApi('counter', { next: () => ++calls });

        const counterA = clientA.remoteApi<{ next(): Promise<number> }>('processing', 'counter');
        const counterB = clientB.remoteApi<{ next(): Promise<number> }>('processing', 'counter');

        expect(await counterA.next()).to.equal(1);
        expect(await counterB.next()).to.equal(2);
        expect(await counterA.next()).to.equal(3);
    });

    it('scopes an injected fault to a single client while others keep working', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const clientA = await lab.addClientEnv('editor-a', { connectTo: ['processing'] });
        const clientB = await lab.addClientEnv('editor-b', { connectTo: ['processing'] });
        const seen: string[] = [];
        server.exposeApi('recorder', { record: (value: string) => void seen.push(value) });
        const recorderA = clientA.remoteApi<{ record(value: string): Promise<void> }>('processing', 'recorder');
        const recorderB = clientB.remoteApi<{ record(value: string): Promise<void> }>('processing', 'recorder');

        lab.network.dropNextClientToServer(1, { client: 'editor-a' });
        void recorderA.record('from-a-dropped');
        await recorderB.record('from-b');

        expect(seen).to.eql(['from-b']);
        expect(Object.keys(clientA.status().pendingCallbacks)).to.have.lengthOf(1);
        expect(Object.keys(clientB.status().pendingCallbacks)).to.have.lengthOf(0);
    });

    it('forwards calls between two clients through the server env', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        server.exposeApi('echo', { echo: (value: string) => value });
        // the server namespaces each client env as `<clientId>/<envName>`
        const provider = await lab.addClientEnv('provider', { connectTo: ['processing'] });
        const consumer = await lab.addClientEnv('consumer', { connectTo: ['processing', 'provider/provider'] });
        provider.exposeApi('greeter', { greet: (name: string) => `hello ${name}` });

        // the provider makes one round trip so the server learns its route
        const echo = provider.remoteApi<{ echo(value: string): Promise<string> }>('processing', 'echo');
        await echo.echo('announce');
        const greeter = consumer.remoteApi<{ greet(name: string): Promise<string> }>('provider/provider', 'greeter');

        expect(await greeter.greet('world')).to.equal('hello world');
    });

    it('streams a RemoteAggregatedValue to a client over the socket', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });
        const items = new RemoteAggregatedValue<string>();
        server.exposeApi('feed', { items });
        const feed = client.remoteApi<{ items: RemoteAggregatedValue<string> }>('processing', 'feed');
        const events: Array<{ value: string | string[]; version: number; modifier: 'item' | 'all' }> = [];
        feed.items.subscribe((value: string | string[], version: number, modifier: 'item' | 'all') =>
            events.push({ value, version, modifier }),
        );
        await waitFor(() => expect(events).to.eql([{ value: [], version: 0, modifier: 'all' }]));

        items.push('a');
        items.push('b');

        await waitFor(() =>
            expect(events).to.eql([
                { value: [], version: 0, modifier: 'all' },
                { value: 'a', version: 1, modifier: 'item' },
                { value: 'b', version: 2, modifier: 'item' },
            ]),
        );
        expect(await feed.items.getValue()).to.eql(['a', 'b']);
    });
});

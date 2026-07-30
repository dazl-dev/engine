import { expect } from 'chai';
import { sleep, waitFor } from 'promise-assist';
import { CommLab } from '../test-kit/comm-lab.js';

interface KvStore {
    set(key: string, value: string): void;
    getAll(): Record<string, string>;
}

interface KvStoreProxy {
    set(key: string, value: string): Promise<void>;
    getAll(): Promise<Record<string, string>>;
}

function seededRandom(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

describe('transport chaos (seeded random fault schedules)', function () {
    this.timeout(30_000);

    let lab: CommLab;

    afterEach(async () => {
        await lab.dispose();
    });

    for (const seed of [1, 42, 1337]) {
        it(`converges under a random duplicate/hold/reorder schedule (seed=${seed})`, async () => {
            lab = await CommLab.create();
            const server = lab.addServerEnv('processing');
            const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });

            const stored: Record<string, string> = {};
            server.exposeApi<KvStore>('kv', {
                set: (key, value) => {
                    stored[key] = value;
                },
                getAll: () => ({ ...stored }),
            });
            const kv = client.remoteApi<KvStoreProxy>('processing', 'kv');

            const random = seededRandom(seed);
            const expected: Record<string, string> = {};
            const pendingSets: Array<Promise<void>> = [];
            let holding = false;

            for (let op = 0; op < 60; op++) {
                const roll = random();
                if (roll < 0.15) {
                    lab.network.duplicateNextClientToServer();
                } else if (roll < 0.25 && !holding) {
                    holding = true;
                    lab.network.holdClientToServer();
                } else if (roll < 0.35 && holding) {
                    holding = false;
                    lab.network.releaseClientToServer({ reversed: random() < 0.5 });
                } else {
                    const key = `key-${op}`;
                    const value = `value-${Math.floor(random() * 1000)}`;
                    expected[key] = value;
                    pendingSets.push(kv.set(key, value));
                    if (random() < 0.3) {
                        await sleep(5);
                    }
                }
            }

            if (holding) {
                lab.network.releaseClientToServer({ reversed: random() < 0.5 });
            }
            await Promise.all(pendingSets);

            expect(await kv.getAll()).to.eql(expected);
            await waitFor(() => {
                expect(Object.keys(client.status().pendingCallbacks)).to.have.lengthOf(0);
                expect(Object.keys(server.status().pendingCallbacks)).to.have.lengthOf(0);
            });
        });
    }

    it('DOCUMENTED GAP: every randomly dropped call leaves one stuck pending callback (seed=7)', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });

        const stored: Record<string, string> = {};
        server.exposeApi<KvStore>('kv', {
            set: (key, value) => {
                stored[key] = value;
            },
            getAll: () => ({ ...stored }),
        });
        const kv = client.remoteApi<KvStoreProxy>('processing', 'kv');

        const random = seededRandom(7);
        let droppedCalls = 0;

        for (let op = 0; op < 30; op++) {
            const key = `key-${op}`;
            if (random() < 0.25) {
                lab.network.dropNextClientToServer();
                droppedCalls++;
                void kv.set(key, 'dropped');
            } else {
                await kv.set(key, 'delivered');
            }
        }

        expect(droppedCalls).to.be.greaterThan(0);
        await sleep(200);
        expect(Object.keys(client.status().pendingCallbacks)).to.have.lengthOf(droppedCalls);
        const delivered = await kv.getAll();
        expect(Object.values(delivered).filter((v) => v === 'dropped')).to.have.lengthOf(0);
    });
});

describe('transport message-count guardrails', function () {
    this.timeout(30_000);

    let lab: CommLab;

    afterEach(async () => {
        await lab.dispose();
    });

    it('a remote call costs exactly one message in each direction', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });

        server.exposeApi('echo', { echo: (value: string) => value });
        const echo = client.remoteApi<{ echo(value: string): Promise<string> }>('processing', 'echo');
        await echo.echo('warmup');

        const before = lab.network.stats();
        for (let i = 0; i < 50; i++) {
            await echo.echo(`call-${i}`);
        }
        const after = lab.network.stats();

        expect(after.clientToServer - before.clientToServer, 'client->server messages for 50 calls').to.equal(50);
        expect(after.serverToClient - before.serverToClient, 'server->client messages for 50 calls').to.equal(50);
    });

    it('an event subscription costs one listen message plus one message per emitted event', async () => {
        lab = await CommLab.create();
        const server = lab.addServerEnv('processing');
        const client = await lab.addClientEnv('editor', { connectTo: ['processing'] });

        const listeners = new Set<(value: string) => void>();
        server.exposeApi('ticker', {
            subscribe: (cb: (value: string) => void) => {
                listeners.add(cb);
            },
            emitAll: (value: string) => {
                for (const listener of listeners) {
                    listener(value);
                }
            },
        });
        const ticker = client.remoteApi<{
            subscribe(cb: (value: string) => void): Promise<void>;
            emitAll(value: string): Promise<void>;
        }>('processing', 'ticker', { subscribe: { listener: true } });

        const received: string[] = [];
        await ticker.subscribe((value) => received.push(value));

        const before = lab.network.stats();
        for (let i = 0; i < 10; i++) {
            await ticker.emitAll(`tick-${i}`);
        }
        await waitFor(() => expect(received).to.have.lengthOf(10));
        const after = lab.network.stats();

        expect(after.clientToServer - before.clientToServer, 'client->server messages for 10 emits').to.equal(10);
        expect(after.serverToClient - before.serverToClient, 'server->client: 10 callbacks + 10 events').to.equal(20);
    });
});

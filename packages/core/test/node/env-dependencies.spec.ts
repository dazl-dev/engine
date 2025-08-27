import {
    BaseHost,
    COM,
    Environment,
    Feature,
    Service,
    run as runEngine,
    type AsyncApi,
    type EnvironmentInstanceToken,
    type MultiEnvAsyncApi,
} from '@dazl/engine-core';
import * as chai from 'chai';
import { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinonChai from 'sinon-chai';
import type { EQUAL } from 'typescript-type-utils';
import { typeCheck } from '../type-check.js';

chai.use(sinonChai);
chai.use(chaiAsPromised);

describe('ENV dependencies', () => {
    it('simple env dependency', async () => {
        const baseEnv = new Environment('baseEnv', 'node', 'multi', []);
        const extendingEnv = new Environment('extendingEnv', 'node', 'multi', [baseEnv]);
        class entryFeature extends Feature<'test'> {
            id = 'test' as const;
            api = {
                service: Service.withType<{
                    increment: (n: number) => number;
                }>().defineEntity(baseEnv),
                service2: Service.withType<{
                    multiplyThenIncrement: (n: number) => number;
                }>().defineEntity(extendingEnv),
            };
        }
        entryFeature.setup(baseEnv, ({}) => {
            return {
                service: {
                    increment: (n) => n + 1,
                },
            };
        });
        entryFeature.setup(extendingEnv, ({ service }) => {
            return {
                service2: {
                    multiplyThenIncrement: (n) => service.increment(n * 2),
                },
            };
        });
        const engine = await runEngine({ entryFeature, env: extendingEnv });
        const runningFeature = engine.get(entryFeature);
        expect(runningFeature.api.service2.multiplyThenIncrement(5)).to.equal(11);
        expect(runningFeature.api.service.increment(5)).to.equal(6);
    });
    it('env and feature dependency dependency', async () => {
        const baseEnv = new Environment('baseEnv', 'node', 'multi');
        const extendingEnv = new Environment('extendingEnv', 'node', 'multi', [baseEnv]);
        class entryFeature extends Feature<'entry'> {
            id = 'entry' as const;
            api = {
                service: Service.withType<{
                    increment: (n: number) => number;
                }>().defineEntity(baseEnv),
                service2: Service.withType<{
                    multiplyThenIncrement: (n: number) => number;
                }>().defineEntity(extendingEnv),
            };
        }
        class extendingFeature extends Feature<'extending'> {
            id = 'extending' as const;
            api = {
                service: Service.withType<{
                    increment: (n: number) => number;
                }>().defineEntity(baseEnv),
                service2: Service.withType<{
                    multiplyThenIncrement: (n: number) => number;
                }>().defineEntity(extendingEnv),
            };
            dependencies = [entryFeature];
        }
        entryFeature.setup(baseEnv, ({}) => {
            return {
                service: {
                    increment: (n) => n + 1,
                },
            };
        });
        extendingFeature.setup(baseEnv, ({}, { entry: { service } }) => {
            return {
                service,
            };
        });

        entryFeature.setup(extendingEnv, ({ service }) => {
            return {
                service2: {
                    multiplyThenIncrement: (n) => service.increment(n * 2),
                },
            };
        });
        extendingFeature.setup(extendingEnv, ({}, { entry: { service: entryService, service2 } }) => {
            console.log(entryService.increment(2));
            return {
                service2,
            };
        });
        const engine = await runEngine({ entryFeature, env: extendingEnv });
        const runningFeature = engine.get(entryFeature);

        expect(runningFeature.api.service2.multiplyThenIncrement(5)).to.equal(11);
        expect(runningFeature.api.service.increment(5)).to.equal(6);
    });
    it('deep environment dependencies', async () => {
        const env1 = new Environment('env1', 'node', 'multi');
        const env2 = new Environment('env2', 'node', 'multi', [env1]);
        const env3 = new Environment('env3', 'node', 'multi', [env2]);

        type EchoService = {
            echo: (n: string) => string;
        };
        class entryFeature extends Feature<'entry'> {
            id = 'entry' as const;
            api = {
                service1: Service.withType<EchoService>().defineEntity(env1),
                service2: Service.withType<EchoService>().defineEntity(env2),
                service3: Service.withType<EchoService>().defineEntity(env3),
            };
        }
        entryFeature.setup(env1, ({}) => {
            return {
                service1: {
                    echo: (val) => `env1 ${val}`,
                },
            };
        });
        entryFeature.setup(env2, ({}) => {
            return {
                service2: {
                    echo: (val) => `env2 ${val}`,
                },
            };
        });

        entryFeature.setup(env3, ({}) => {
            return {
                service3: {
                    echo: (val) => `env3 ${val}`,
                },
            };
        });

        const engine = await runEngine({ entryFeature, env: env3 });
        const runningFeature = engine.get(entryFeature);
        expect(runningFeature.api.service1.echo('Test')).to.equal('env1 Test');
        expect(runningFeature.api.service2.echo('Test')).to.equal('env2 Test');
        expect(runningFeature.api.service3.echo('Test')).to.equal('env3 Test');
        (class TestFeatureDeps extends Feature<'testFeatureDeps'> {
            id = 'testFeatureDeps' as const;
            api = {};
            dependencies = [entryFeature];
        }).setup(env3, ({}, { entry: _entry }) => {
            // We only asset that the types are correct feature runtime does not care.
            typeCheck(
                (
                    _runningFeature: EQUAL<
                        typeof _entry,
                        {
                            service1: EchoService;
                            service2: EchoService;
                            service3: EchoService;
                        }
                    >,
                ) => true,
            );
        });
    });
    it('env dependency preserve multi when accessing from other env', async () => {
        const baseEnv = new Environment('baseEnv', 'node', 'multi');
        const extendingEnv = new Environment('extendingEnv', 'node', 'multi', [baseEnv]);
        const otherEnv = new Environment('otherEnv', 'node', 'single');

        const otherEnvHost = new BaseHost(otherEnv.env);
        const extEnvHost = otherEnvHost.open(extendingEnv.env);

        class TestFeature extends Feature<'test'> {
            id = 'test' as const;
            api = {
                service: Service.withType<{
                    increment: (n: number) => number;
                }>()
                    .defineEntity(baseEnv)
                    .allowRemoteAccess(),
                service2: Service.withType<{
                    multiplyThenIncrement: (n: number) => number;
                }>()
                    .defineEntity(extendingEnv)
                    .allowRemoteAccess(),
                caller: Service.withType<{
                    multiplyThenIncrement: (n: number) => Promise<number>;
                }>().defineEntity(otherEnv),
            };
            dependencies = [COM];
        }

        TestFeature.setup(baseEnv, (_entry) => {
            typeCheck(
                (_service: EQUAL<(typeof _entry)['service'], MultiEnvAsyncApi<{ increment: (n: number) => number }>>) =>
                    true,
            );
            typeCheck(
                (
                    _service2: EQUAL<
                        (typeof _entry)['service2'],
                        {
                            get(token: EnvironmentInstanceToken): AsyncApi<{
                                multiplyThenIncrement: (n: number) => number;
                            }>;
                        }
                    >,
                ) => true,
            );

            return {
                service: {
                    increment(n) {
                        return n + 1;
                    },
                },
            };
        });

        TestFeature.setup(extendingEnv, (entry) => {
            typeCheck((_service: EQUAL<(typeof entry)['service'], { increment: (n: number) => number }>) => true);
            typeCheck(
                (
                    _service2: EQUAL<
                        (typeof entry)['service2'],
                        {
                            get(
                                token: EnvironmentInstanceToken,
                            ): AsyncApi<{ multiplyThenIncrement: (n: number) => number }>;
                        }
                    >,
                ) => true,
            );

            return {
                service2: {
                    multiplyThenIncrement(n) {
                        return entry.service.increment(n * 2);
                    },
                },
            };
        });

        TestFeature.setup(otherEnv, (entry) => {
            typeCheck(
                (_service: EQUAL<(typeof entry)['service'], MultiEnvAsyncApi<{ increment: (n: number) => number }>>) =>
                    true,
            );
            typeCheck(
                (
                    _service2: EQUAL<
                        (typeof entry)['service2'],
                        {
                            get(
                                token: EnvironmentInstanceToken,
                            ): AsyncApi<{ multiplyThenIncrement: (n: number) => number }>;
                        }
                    >,
                ) => true,
            );
            return {
                caller: {
                    multiplyThenIncrement(n) {
                        return entry.service2.get({ id: extEnvHost.name }).multiplyThenIncrement(n);
                    },
                },
            };
        });

        await runEngine({
            entryFeature: TestFeature,
            env: extendingEnv,
            topLevelConfig: [
                COM.configure({
                    config: {
                        host: extEnvHost,
                    },
                }),
            ],
        });

        const runnningOtherEnv = await runEngine({
            entryFeature: TestFeature,
            env: otherEnv,
            topLevelConfig: [
                COM.configure({
                    config: {
                        host: otherEnvHost,
                    },
                }),
            ],
        });

        runnningOtherEnv.get(COM).api.communication.registerEnv(extendingEnv.env, extEnvHost);
        const res = await runnningOtherEnv.get(TestFeature).api.caller.multiplyThenIncrement(3);
        expect(res).to.equal(7);
    });
});

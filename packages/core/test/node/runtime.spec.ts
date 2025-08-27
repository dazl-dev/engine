import {
    AllEnvironments,
    COM,
    CREATE_RUNTIME,
    Config,
    Value,
    ContextualEnvironment,
    ENGINE,
    Environment,
    Feature,
    FeatureInput,
    IDENTIFY_API,
    MapSlot,
    REGISTER_VALUE,
    RUN_OPTIONS,
    RuntimeEngine,
    Service,
    Slot,
    Universal,
    run as runEngine,
    type DisposeFunction,
    type IRunOptions,
} from '@dazl/engine-core';
import * as chai from 'chai';
import { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { spy } from 'sinon';
import sinonChai from 'sinon-chai';
import type { EQUAL } from 'typescript-type-utils';
import { typeCheck } from '../type-check.js';

chai.use(sinonChai);
chai.use(chaiAsPromised);

describe('Feature', () => {
    it('single feature entry', async () => {
        class entryFeature extends Feature<'test'> {
            id = 'test' as const;
            api = {
                config: Config.withType<{
                    name: string;
                }>().defineEntity({ name: 'test' }),
            };
        }
        const engine = await runEngine({ entryFeature, env: AllEnvironments });
        expect(engine.get(entryFeature).api.config.name).to.be.equal('test');
    });

    it('single feature entry with dependencies', async () => {
        class f1 extends Feature<'test1'> {
            id = 'test1' as const;
            api = {
                config: Config.withType<{
                    name: string;
                }>().defineEntity({ name: 'test1' }),
            };
        }
        class f2 extends Feature<'test2'> {
            id = 'test2' as const;
            api = {
                config: Config.withType<{
                    name: string;
                }>().defineEntity({ name: 'test2' }),
            };
            dependencies = [f1];
        }
        const engine = await runEngine({
            entryFeature: [f1, f2],
            env: AllEnvironments,
        });

        expect(engine.get(f1).api.config.name).to.equal('test1');
        expect(engine.get(f2).api.config.name).to.equal('test2');
    });

    it('feature entry with optional dependency', async () => {
        class TestFeature extends Feature<'testFeature'> {
            id = 'testFeature' as const;
            api = {
                testValue: Value.withType<string>().defineEntity(Universal),
            };
        }
        TestFeature.setup(Universal, () => {
            return { testValue: 'value from inner dep' };
        });
        class UsingRequired extends Feature<'usingRequired'> {
            id = 'usingRequired' as const;
            api = {};
            dependencies = [TestFeature];
        }
        class UsingOptional extends Feature<'usingOptional'> {
            id = 'usingOptional' as const;
            api = {
                valueFromDep: Value.withType<string | undefined>().defineEntity(Universal),
            };
            optionalDependencies = [TestFeature];
        }
        UsingOptional.setup(Universal, ({}, { testFeature }) => {
            return { valueFromDep: testFeature?.testValue };
        });

        {
            // check with just optional dependency
            const engine = await runEngine({
                entryFeature: [UsingOptional],
                env: AllEnvironments,
            });
            expect(engine.get(UsingOptional).api.valueFromDep, 'optional only dep').to.eql(undefined);
        }
        {
            // check with a following dependency that requires the dependency
            const engine = await runEngine({
                entryFeature: [UsingOptional, UsingRequired],
                env: AllEnvironments,
            });
            expect(engine.get(UsingOptional).api.valueFromDep, 'required dep').to.eql('value from inner dep');
        }
    });

    it('report good error when onDispose fail during run phase', async () => {
        class entryFeature extends Feature<'test'> {
            id = 'test' as const;
            api = {};
        }
        entryFeature.setup(Universal, ({ onDispose, run }) => {
            onDispose(() => {
                return Promise.reject(new Error('dispose error'));
            });

            run(() => {
                return Promise.reject(new Error('run error'));
            });
        });

        let error: AggregateError | undefined;
        try {
            await runEngine({ entryFeature, env: AllEnvironments });
        } catch (e) {
            error = e as AggregateError;
        }
        expect(error).to.be.instanceOf(AggregateError);
        expect(error?.errors.length).to.be.equal(2);
        expect(error?.errors[0].message).to.include('run error');
        expect(error?.errors[1].message).to.include('dispose error');
        expect(error?.message).to.be.equal('Failed to shutdown engine after error in run phase');
    });

    it('feature run stage', async () => {
        class f0 extends Feature<'test1'> {
            id = 'test1' as const;
            api = {};
        }
        class entryFeature extends Feature<'test2'> {
            id = 'test2' as const;
            api = {};
            dependencies = [f0];
        }
        const calls: string[] = [];

        f0.setup(AllEnvironments, ({ run }) => {
            run(() => {
                calls.push('f0 run');
            });
        });

        entryFeature.setup(AllEnvironments, ({ run }) => {
            run(() => {
                calls.push('f1 run');
            });
        });

        await runEngine({ entryFeature, env: AllEnvironments });

        expect(calls).to.eql(['f0 run', 'f1 run']);
    });

    it('feature setup/run stage should not happen twice', async () => {
        class f0 extends Feature<'test1'> {
            id = 'test1' as const;
            api = {};
        }
        class f1 extends Feature<'test2'> {
            id = 'test2' as const;
            api = {};
            dependencies = [f0];
        }
        const calls: string[] = [];

        f0.setup(AllEnvironments, ({ run }) => {
            calls.push('f0 setup');
            run(() => {
                calls.push('f0 run');
            });
        });

        f1.setup(AllEnvironments, ({ run }) => {
            calls.push('f1 setup');
            run(() => {
                calls.push('f1 run');
            });
        });

        await runEngine({ entryFeature: [f0, f1, f0, f1], env: AllEnvironments });

        expect(calls).to.eql(['f0 setup', 'f1 setup', 'f0 run', 'f1 run']);
    });

    it('feature setup/run stage should happen per environment', async () => {
        const spyEnvOne = spy();
        const spyEnvTwo = spy();
        const oneEnv = new Environment('one', 'node', 'single');
        const twoEnv = new Environment('two', 'node', 'single');
        class entryFeature extends Feature<'test'> {
            id = 'test' as const;
            api = {};
        }
        entryFeature.setup(oneEnv, spyEnvOne);
        entryFeature.setup(twoEnv, spyEnvTwo);
        await runEngine({ entryFeature, env: oneEnv });
        expect(spyEnvOne).to.have.callCount(1);
        expect(spyEnvTwo).to.have.callCount(0);
    });

    it('feature should provide requirements (outputs) of each environment', async () => {
        const MAIN1 = new Environment('main1', 'window', 'single');
        class f0 extends Feature<'test'> {
            id = 'test' as const;
            api = {
                service1: Service.withType<{
                    echo(x: string): string;
                }>().defineEntity(Universal),
                service2: Service.withType<{
                    echo(x: string): string;
                }>().defineEntity(MAIN1),
            };
        }
        f0.setup(Universal, () => {
            return {
                service1: {
                    echo(x: string) {
                        return x + '-main1';
                    },
                },
            };
        });

        f0.setup(MAIN1, () => {
            return {
                service2: {
                    echo(x: string) {
                        return x + '-main2';
                    },
                },
            };
        });
        const engine = await runEngine({ entryFeature: [f0], env: MAIN1 });
        const { service1, service2 } = engine.get(f0).api;
        expect(service1.echo('ECHO')).to.eql('ECHO-main1');
        expect(service2.echo('ECHO')).to.eql('ECHO-main2');
    });

    it('feature should throw if setup is called with same environment twice', () => {
        const mainEnv = new Environment('main1', 'window', 'single');
        class f0 extends Feature<'test'> {
            id = 'test' as const;
            api = {
                service1: Service.withType<{
                    echo(x: string): string;
                }>().defineEntity(mainEnv),
            };
        }
        expect(() => {
            f0.setup(mainEnv, () => {
                return {
                    service1: {
                        echo(x: string) {
                            return x + '-main1';
                        },
                    },
                };
            });

            f0.setup(mainEnv, () => {
                return {
                    service1: {
                        echo(x: string) {
                            return x + '-main2';
                        },
                    },
                };
            });
        }).to.throw('Feature can only have single setup for each environment.');
    });

    it('Universal input apis should be available universally', async () => {
        const env = new Environment('main', 'window', 'single');
        class f0 extends Feature<'test'> {
            id = 'test' as const;
            api = {
                slot1: Slot.withType<{
                    echo(x: string): string;
                }>().defineEntity(Universal),
                service1: Service.withType<{
                    echo(x: string): string;
                }>().defineEntity(Universal),
                service2: Service.withType<{
                    echo(x: string): string;
                }>().defineEntity(env),
            };
        }
        f0.setup(Universal, ({ slot1 }) => {
            return {
                service1: {
                    echo(x: string) {
                        return `${x}-${[...slot1].length}`;
                    },
                },
            };
        });
        f0.setup(env, ({ service1, slot1 }) => {
            return {
                service2: {
                    echo(x: string) {
                        return `${service1.echo(x)}-main2-${[...slot1].length}`;
                    },
                },
            };
        });
        const engine = await runEngine({ entryFeature: [f0], env });
        const { slot1, service1, service2 } = engine.get(f0).api;
        expect([...slot1].length).to.eql(0);
        expect(service1.echo('ECHO')).to.eql('ECHO-0');
        expect(service2.echo('ECHO')).to.eql('ECHO-0-main2-0');
    });

    describe('Feature Config', () => {
        it('support multiple top level partial configs', async () => {
            class entryFeature extends Feature<'test'> {
                id = 'test' as const;
                api = {
                    config: Config.withType<{
                        a: string;
                        b: string;
                        c: number[];
                    }>().defineEntity({
                        a: '',
                        b: '',
                        c: [],
                    }),
                };
            }

            const engine = await runEngine({
                entryFeature,
                topLevelConfig: [
                    entryFeature.configure({
                        config: { a: 'a' },
                    }),
                    entryFeature.configure({
                        config: { b: 'b', c: [1] },
                    }),
                ],
                env: AllEnvironments,
            });

            expect(engine.get(entryFeature).api.config).to.be.eql({
                a: 'a',
                b: 'b',
                c: [1],
            });
        });

        it('support config merger', async () => {
            class entryFeature extends Feature<'test'> {
                id = 'test' as const;
                api = {
                    config: Config.withType<{
                        a: string;
                        b: string;
                        c: number[];
                    }>().defineEntity({ a: '', b: '', c: [] }, (a, b) => {
                        return {
                            a: a.a || b.a || '',
                            b: a.b || b.b || '',
                            c: a.c.concat(b.c || []),
                        };
                    }),
                };
            }

            const engine = await runEngine({
                entryFeature,
                topLevelConfig: [
                    entryFeature.configure({
                        config: { a: 'a', c: [1] },
                    }),
                    entryFeature.configure({
                        config: { b: 'b', c: [2] },
                    }),
                ],
                env: AllEnvironments,
            });

            expect(engine.get(entryFeature).api.config).to.be.eql({
                a: 'a',
                b: 'b',
                c: [1, 2],
            });
        });
    });

    describe('Support Map Slots', () => {
        it('single feature that supports map slots', async () => {
            const mainEnv = new Environment('main', 'node', 'single');
            const maps = class TestSlotsFeature extends Feature<'testSlotsFeature'> {
                id = 'testSlotsFeature' as const;
                api = {
                    mapSlot: MapSlot.withType<string, string>().defineEntity(mainEnv),
                    retrieveService: Service.withType<{
                        getValue(key: string): string | undefined;
                    }>().defineEntity(mainEnv),
                };
            }.setup(mainEnv, ({ mapSlot }) => {
                return {
                    retrieveService: {
                        getValue(key: string) {
                            return mapSlot.get(key);
                        },
                    },
                };
            });
            const entryFeature = class TestSlotsSecondFeature extends Feature<'testSlotsSecondFeature'> {
                id = 'testSlotsSecondFeature' as const;
                api = {};
                dependencies = [maps];
            }.setup(mainEnv, ({}, { testSlotsFeature: { mapSlot } }) => {
                mapSlot.register('1', 'test');
                mapSlot.register('2', 'test2');
            });

            const engine = await runEngine({ entryFeature, env: mainEnv });
            expect(engine.get(maps).api.retrieveService.getValue('1')).to.be.equal('test');
        });

        it('two features that adds to slots', async () => {
            const mainEnv = new Environment('main', 'node', 'single');
            const maps = class TestSlotsFeature extends Feature<'testSlotsFeature'> {
                id = 'testSlotsFeature' as const;
                api = {
                    mapSlot: MapSlot.withType<string, string>().defineEntity(mainEnv),
                    retrieveService: Service.withType<{
                        getValue(key: string): string | undefined;
                    }>().defineEntity(mainEnv),
                };
            }.setup(mainEnv, ({ mapSlot }) => {
                return {
                    retrieveService: {
                        getValue(key: string) {
                            return mapSlot.get(key);
                        },
                    },
                };
            });
            const f1 = class TestSlotsFirstFeature extends Feature<'testSlotsFirstFeature'> {
                id = 'testSlotsFirstFeature' as const;
                api = {};
                dependencies = [maps];
            }.setup(mainEnv, ({}, { testSlotsFeature: { mapSlot } }) => {
                mapSlot.register('1', 'test');
                mapSlot.register('2', 'test2');
            });
            const f2 = class TestSlotsSecondFeature extends Feature<'testSlotsSecondFeature'> {
                id = 'testSlotsSecondFeature' as const;
                api = {};
                dependencies = [maps];
            }.setup(mainEnv, ({}, { testSlotsFeature: { mapSlot } }) => {
                mapSlot.register('2', 'test2');
            });

            const engine = await runEngine({ entryFeature: [f1, f2], env: mainEnv });
            expect(engine.get(maps).api.retrieveService.getValue('1')).to.be.equal('test');
            expect(engine.get(maps).api.retrieveService.getValue('2')).to.be.equal('test2');
        });

        it('try to get value from the slot, when the key is not in the map', async () => {
            const mainEnv = new Environment('main', 'node', 'single');
            const maps = class TestSlotsFeature extends Feature<'testSlotsFeature'> {
                id = 'testSlotsFeature' as const;
                api = {
                    mapSlot: MapSlot.withType<string, string>().defineEntity(mainEnv),
                    retrieveService: Service.withType<{
                        getValue(key: string): string | undefined;
                    }>().defineEntity(mainEnv),
                };
            }.setup(mainEnv, ({ mapSlot }) => {
                return {
                    retrieveService: {
                        getValue(key: string) {
                            return mapSlot.get(key);
                        },
                    },
                };
            });
            const entryFeature = class TestSlotsFirstFeature extends Feature<'testSlotsFirstFeature'> {
                id = 'testSlotsFirstFeature' as const;
                api = {};
                dependencies = [maps];
            }.setup(mainEnv, () => undefined);

            const engine = await runEngine({ entryFeature, env: mainEnv });

            expect(engine.get(maps).api.retrieveService.getValue('1')).to.be.equal(undefined);
        });
    });

    describe('Identifiable entities', () => {
        interface Identity {
            featureID: string;
            entityKey: string;
        }
        class Identifiable extends FeatureInput<Readonly<Identity>, Environment, any> {
            public identity!: Identity;
            constructor() {
                super(Universal, Universal);
            }
            public [IDENTIFY_API](featureID: string, entityKey: string) {
                this.identity = {
                    entityKey,
                    featureID,
                };
            }
            public [CREATE_RUNTIME](_context: RuntimeEngine, featureID: string, entityKey: string) {
                return {
                    featureID,
                    entityKey,
                };
            }

            public [REGISTER_VALUE](
                _context: RuntimeEngine,
                _providedValue: undefined,
                inputValue: any,
                _featureID: string,
                _entityKey: string,
            ) {
                return inputValue;
            }

            public getIdentity() {
                return this.identity;
            }
        }
        it('when creating a new feature the APIs should be identified ', async () => {
            class Ids extends Feature<'testIdentify'> {
                id = 'testIdentify' as const;
                api = {
                    identifiable: new Identifiable(),
                };
            }

            expect(Ids.api().identifiable.getIdentity()).to.be.eql({
                featureID: 'testIdentify',
                entityKey: 'identifiable',
            });

            const engine = await runEngine({
                entryFeature: Ids,
                env: new Environment('main', 'node', 'single'),
            });

            expect(engine.get(Ids).feature.api.identifiable.getIdentity()).to.be.eql({
                featureID: 'testIdentify',
                entityKey: 'identifiable',
            });
        });
    });
});

describe('feature interaction', () => {
    it('should run engine with two features interacting', async () => {
        const mainEnv = new Environment('main', 'node', 'single');
        const echoFeature = class EchoFeature extends Feature<'echoFeature'> {
            id = 'echoFeature' as const;
            api = {
                transformers: Slot.withType<(s: string) => string>().defineEntity(mainEnv),
                echoService: Service.withType<{
                    echo(s: string): string;
                }>().defineEntity(mainEnv),
            };
        }.setup(mainEnv, ({ transformers }) => {
            return {
                echoService: {
                    echo(s: string) {
                        return [...transformers].reduce((item, transformer) => {
                            return transformer(item);
                        }, s);
                    },
                },
            };
        });

        ////////////////////////////////////////////////////////
        const entryFeature = class Feature2 extends Feature<'feature2'> {
            id = 'feature2' as const;
            api = {
                config: Config.withType<{
                    prefix: string;
                    suffix: string;
                }>().defineEntity({ prefix: '', suffix: '' }),
            };
            dependencies = [echoFeature];
        }.setup(mainEnv, ({ config }, { echoFeature: { transformers } }) => {
            transformers.register((s: string) => {
                return `${config.prefix}${s}${config.suffix}`;
            });
        });

        const engine = await runEngine({
            entryFeature,
            topLevelConfig: [
                entryFeature.configure({
                    config: { prefix: '!' },
                }),
                entryFeature.configure({
                    config: { suffix: '?' },
                }),
            ],
            env: mainEnv,
        });

        expect(engine.get(echoFeature).api.echoService.echo('yoo')).to.be.equal('!yoo?');
    });
});

describe('Contextual environments', () => {
    it('Feature should define contextual environment, set up the environment context and use it in the environment setup', async () => {
        const workerEnv = new Environment('webworker', 'webworker', 'single');
        const processing = new ContextualEnvironment('processing', 'single', [workerEnv]);

        interface ProcessingContext {
            name: string;
        }
        class entryFeature extends Feature<'echoFeature'> {
            id = 'echoFeature' as const;
            api = {
                echoService: Service.withType<{
                    echo(s: string): string;
                }>().defineEntity(processing),
            };
            dependencies = [COM];
            context = {
                processingContext: processing.withContext<ProcessingContext>(),
                processingContext2: processing.withContext<{
                    age: number;
                }>(),
            };
        }
        entryFeature.setupContext(processing, 'processingContext', () => {
            return {
                name: 'test',
            };
        });

        entryFeature.setupContext(processing, 'processingContext2', () => {
            return {
                age: 1,
            };
        });

        entryFeature.setup(processing, ({}, {}, { processingContext: { name }, processingContext2: { age } }) => {
            return {
                echoService: {
                    echo(s: string) {
                        return `${s} ${name} ${age}`;
                    },
                },
            };
        });

        const engine = await runEngine({ entryFeature, env: processing });

        expect(engine.get(entryFeature).api.echoService.echo('hello')).to.eq('hello test 1');
    });
});

describe('feature disposal', () => {
    it('disposes a feature on engine dispose call', async () => {
        const envName = 'main';
        const mainEnv = new Environment(envName, 'window', 'single');
        class entryFeature extends Feature<'test'> {
            id = 'test' as const;
            api = {};
        }
        const dispose = spy(() => Promise.resolve());
        entryFeature.setup(mainEnv, ({ onDispose }, {}) => {
            onDispose(dispose);
        });

        const engine = await runEngine({
            entryFeature,
            env: mainEnv,
        });

        await engine.shutdown();

        expect(dispose).to.have.have.callCount(1);
    });

    it('allows feature to register to onDispose several times', async () => {
        const envName = 'main';
        const mainEnv = new Environment(envName, 'window', 'single');
        class entryFeature extends Feature<'test'> {
            id = 'test' as const;
            api = {};
        }
        const dispose = spy(() => Promise.resolve());
        const dispose2 = spy(() => Promise.resolve());

        entryFeature.setup(mainEnv, ({ onDispose }, {}) => {
            onDispose(dispose);
            onDispose(dispose2);
        });

        const engine = await runEngine({
            entryFeature,
            env: mainEnv,
        });

        await engine.shutdown();

        expect(dispose).to.have.have.callCount(1);
        expect(dispose2).to.have.have.callCount(1);
    });

    it('throws an error if on of the onDispose functiones was rejected', async () => {
        const envName = 'main';
        const mainEnv = new Environment(envName, 'window', 'single');
        class entryFeature extends Feature<'test'> {
            id = 'test' as const;
            api = {};
        }
        const disposeFirst = spy(() => Promise.resolve());
        const disposeSecond = spy(() => Promise.reject(new Error('err')));

        entryFeature.setup(mainEnv, ({ onDispose }, {}) => {
            onDispose(disposeFirst);
            onDispose(disposeSecond);
        });

        const engine = await runEngine({
            entryFeature,
            env: mainEnv,
        });

        await expect(engine.shutdown()).to.be.rejectedWith('err');

        expect(disposeFirst).to.have.have.callCount(1);
        expect(disposeSecond).to.have.have.callCount(1);
    });

    it('disposes a feature only once', async () => {
        const envName = 'main';
        const mainEnv = new Environment(envName, 'window', 'single');
        class entryFeature extends Feature<'test'> {
            id = 'test' as const;
            api = {};
        }
        const dispose = spy(() => new Promise((res) => setTimeout(res, 0)));
        entryFeature.setup(mainEnv, ({ onDispose }, {}) => {
            onDispose(dispose);
        });

        const engine = await runEngine({
            entryFeature,
            env: mainEnv,
        });

        const runtimeFeature = engine.get(entryFeature);

        await Promise.all([runtimeFeature.dispose(), runtimeFeature.dispose()]);

        expect(dispose).to.have.have.callCount(1);
    });

    it('abort the engineShutdownSignal', async () => {
        const envName = 'main';
        const mainEnv = new Environment(envName, 'window', 'single');
        class entryFeature extends Feature<'test'> {
            id = 'test' as const;
            api = {};
        }
        const onEvent = spy((msg) => msg);
        entryFeature.setup(mainEnv, ({ engineShutdownSignal, onDispose }, {}) => {
            onDispose(() => onEvent('dispose'));
            engineShutdownSignal.addEventListener('abort', () => onEvent('abort'));
        });

        const engine = await runEngine({
            entryFeature,
            env: mainEnv,
        });

        await engine.shutdown();

        expect(onEvent).to.have.have.callCount(2);
        expect(onEvent.getCalls().map((call) => call.args[0])).to.be.eql(['abort', 'dispose']);
    });
});

describe('service with remove access environment visibility', () => {
    it('local services in the same env uses the provided implementation', async () => {
        const processing = new Environment('processing', 'webworker', 'multi');
        const main = new Environment('main', 'webworker', 'single');
        class EchoFeature extends Feature<'echoFeature'> {
            id = 'echoFeature' as const;
            api = {
                echoService: Service.withType<{
                    echo(s: string): string;
                }>()
                    .defineEntity(processing)
                    .allowRemoteAccess(),
            };
            dependencies = [COM];
        }
        EchoFeature.setup(processing, ({ echoService }) => {
            // this is the proxy! because we did not defined the service yet.
            expect(typeof echoService.get === 'function');

            return {
                echoService: {
                    echo(s: string) {
                        return s;
                    },
                },
            };
        });
        EchoFeature.setup(main, ({ echoService }) => {
            // this is the proxy! because we are in different env.
            expect(typeof echoService.get === 'function');
        });
        class testFeature extends Feature<'test'> {
            id = 'test' as const;
            api = {};
            dependencies = [EchoFeature];
        }

        testFeature.setup(processing, ({}, { echoFeature: { echoService } }) => {
            // this is the real service since we are in the same env!.
            expect(typeof echoService.echo === 'function');
        });

        testFeature.setup(main, ({}, { echoFeature: { echoService } }) => {
            // this is the proxy! because we are in different env.
            expect(typeof echoService.get === 'function');
        });

        await runEngine({
            entryFeature: testFeature,
            env: processing,
        });

        await runEngine({
            entryFeature: testFeature,
            env: main,
        });
    });
});
describe.skip('Environments And Entity Visibility (ONLY TEST TYPES)', () => {
    it('should verify visibility of slots', () => {
        const main = new Environment('main', 'window', 'single');
        const processing = new Environment('processing', 'webworker', 'single');
        class EchoFeature extends Feature<'echoFeature'> {
            id = 'echoFeature' as const;
            api = {
                slot: Slot.withType<{
                    name: string;
                }>().defineEntity(main),
            };
            dependencies = [COM];
        }
        EchoFeature.setup(main, ({ slot }) => {
            slot.register({ name: 'test' });
        });
        EchoFeature.setup(processing, (feature) => {
            const _engine = feature[ENGINE];

            typeCheck(
                (
                    _noSlot: EQUAL<
                        typeof feature,
                        {
                            id: 'echoFeature';
                            [RUN_OPTIONS]: IRunOptions;
                            [ENGINE]: typeof _engine;
                            engineShutdownSignal: AbortSignal;
                            run(fn: () => unknown): unknown;
                            onDispose(fn: DisposeFunction): unknown;
                        }
                    >,
                ) => true,
            );
        });
    });

    it('allow spawn of new environments and use remote services', () => {
        const main = new Environment('main', 'window', 'single');
        const processing = new Environment('processing', 'webworker', 'single');
        class echoFeature extends Feature<'echoFeature'> {
            id = 'echoFeature' as const;
            api = {
                echoService: Service.withType<{
                    echo(s: string): string;
                }>()
                    .defineEntity(processing)
                    .allowRemoteAccess(),
            };
            dependencies = [COM];
        }
        echoFeature.setup(processing, () => {
            return {
                echoService: {
                    echo(s: string) {
                        return s;
                    },
                },
            };
        });

        const checks = [];
        class testFeature extends Feature<'test'> {
            id = 'test' as const;
            api = {};
            dependencies = [echoFeature];
        }

        testFeature.setup(processing, ({ run }, { echoFeature: { echoService } }) => {
            run(() => {
                checks.push(echoService.echo('echo1'));
            });
        });

        testFeature.setup(main, ({ run }, { echoFeature: { echoService } }) => {
            run(async () => {
                const val = await echoService.echo('echo2');
                checks.push(val);
            });
        });
    });
});

describe.skip('Environments Type tests 1', () => {
    it('feature remote api should be available inside same feature setup', () => {
        const processing = new Environment('processing', 'webworker', 'single');
        class echoFeature extends Feature<'echoFeature'> {
            id = 'echoFeature' as const;
            api = {
                // processing,
                echoService: Service.withType<{
                    echo(s: string): string;
                }>()
                    .defineEntity(processing)
                    .allowRemoteAccess(),
            };
            dependencies = [COM];
        }
        echoFeature.setup(processing, ({}, {}) => {
            return {
                echoService: {
                    echo(s: string) {
                        return s;
                    },
                },
            };
        });
    });
});

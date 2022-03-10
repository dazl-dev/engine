import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { COM, Environment, Feature, runEngineApp, Service, socketClientInitializer } from '@wixc3/engine-core';
import { createBrowserProvider } from '@wixc3/engine-test-kit';
import { launchEngineHttpServer, NodeEnvironmentsManager, IStaticFeatureDefinition } from '@wixc3/engine-runtime-node';
import { createDisposables } from '@wixc3/create-disposables';
import type io from 'socket.io';

import SocketServerNodeFeature, {
    serverEnv as socketServerEnv,
} from '@fixture/engine-multi-socket-node/dist/feature/x.feature';

import ServerNodeFeature, { serverEnv } from '@fixture/engine-multi-node/dist/feature/x.feature';

chai.use(chaiAsPromised);

const runFeatureOptions = { featureName: 'engine-node/x' };

const env = new Environment('dev', 'node', 'single');
const comEntry: IStaticFeatureDefinition = {
    filePath: require.resolve('@wixc3/engine-core/dist/communication.feature'),
    packageName: '@wixc3/engine-core',
    scopedName: 'engine-core/communication',
};

const server2Env = new Environment('server-two', 'node', 'single');

const engineNodeEntry: IStaticFeatureDefinition = {
    dependencies: [comEntry.scopedName],
    envFilePaths: {
        server: require.resolve('@fixture/engine-node/dist/feature/x.server.env'),
    },
    exportedEnvs: [
        {
            name: 'server',
            type: 'node',
            env: serverEnv,
        },
    ],
    filePath: require.resolve('@fixture/engine-node/dist/feature/x.feature'),
    packageName: '@fixture/engine-node',
    scopedName: 'engine-node/x',
};

const engineMultiNodeSocketCommunication: IStaticFeatureDefinition = {
    dependencies: [comEntry.scopedName],
    filePath: require.resolve('@fixture/engine-multi-socket-node/dist/feature/x.feature'),
    scopedName: 'engine-multi-socket-node/x',
    packageName: '@fixture/engine-multi-socket-node',
    envFilePaths: {
        server: require.resolve('@fixture/engine-multi-socket-node/dist/feature/x.server.env'),
        'server-two': require.resolve('@fixture/engine-multi-socket-node/dist/feature/x.server-two.env'),
    },
    exportedEnvs: [
        { name: 'server', type: 'node', env: serverEnv },
        { name: 'server-two', type: 'node', env: server2Env },
    ],
};

const engineMultiNodeIPCCommunication: IStaticFeatureDefinition = {
    dependencies: [comEntry.scopedName],
    filePath: require.resolve('@fixture/engine-multi-socket-node/dist/feature/x.feature'),
    scopedName: 'engine-multi-socket-node/x',
    packageName: '@fixture/engine-multi-socket-node',
    envFilePaths: {
        server: require.resolve('@fixture/engine-multi-socket-node/dist/feature/x.server.env'),
        'server-two': require.resolve('@fixture/engine-multi-socket-node/dist/feature/x.server-two.env'),
    },
    exportedEnvs: [
        { name: 'server', type: 'node', env: serverEnv },
        { name: 'server-two', type: 'node', env: server2Env },
    ],
};
describe('Node environments manager', function () {
    this.timeout(10_000);
    const disposables = createDisposables();
    const browserProvider = createBrowserProvider();
    let socketServer: io.Server;
    let port: number;

    beforeEach(async () => {
        const server = await launchEngineHttpServer();
        ({ socketServer, port } = server);
        disposables.add(server.close);
    });

    after(() => browserProvider.dispose());

    afterEach(disposables.dispose);

    it('launches a new node environment', async () => {
        const nodeEnvironmentManager = new NodeEnvironmentsManager(
            socketServer,
            {
                features: new Map<string, IStaticFeatureDefinition>(
                    Object.entries({
                        [engineNodeEntry.scopedName]: engineNodeEntry,
                        [comEntry.scopedName]: comEntry,
                    })
                ),
                port,
            },
            process.cwd()
        );

        disposables.add(() => nodeEnvironmentManager.closeAll());
        await nodeEnvironmentManager.runServerEnvironments(runFeatureOptions);

        const allOpenEnvironments = nodeEnvironmentManager.getFeaturesWithRunningEnvironments();
        expect(allOpenEnvironments).to.be.not.an('undefined');
        expect(allOpenEnvironments).to.be.an('Array');
        expect(allOpenEnvironments[0]).to.contain(runFeatureOptions.featureName);
    });

    it('lists only open environments', async () => {
        const nodeEnvironmentManager = new NodeEnvironmentsManager(
            socketServer,
            {
                features: new Map<string, IStaticFeatureDefinition>(
                    Object.entries({
                        [engineNodeEntry.scopedName]: engineNodeEntry,
                        [comEntry.scopedName]: comEntry,
                    })
                ),
                port,
            },
            process.cwd()
        );

        disposables.add(() => nodeEnvironmentManager.closeAll());

        const allOpenEnvironments = nodeEnvironmentManager.getFeaturesWithRunningEnvironments();

        expect(allOpenEnvironments).to.be.an('Array');
        expect(allOpenEnvironments.length).to.equal(0);

        await nodeEnvironmentManager.runServerEnvironments(runFeatureOptions);

        expect(nodeEnvironmentManager.getFeaturesWithRunningEnvironments()[0]).to.contain(
            runFeatureOptions.featureName
        );
    });

    it('fails to launch if wrong config name or feature name are provided', async () => {
        const nodeEnvironmentManager = new NodeEnvironmentsManager(
            socketServer,
            {
                features: new Map<string, IStaticFeatureDefinition>(
                    Object.entries({
                        [engineNodeEntry.scopedName]: engineNodeEntry,
                        [comEntry.scopedName]: comEntry,
                    })
                ),
                port,
            },
            process.cwd()
        );

        disposables.add(() => nodeEnvironmentManager.closeAll());

        await expect(
            nodeEnvironmentManager.runServerEnvironments({ featureName: 'test' })
        ).to.eventually.be.rejectedWith(
            'cannot find feature test. available features: engine-node/x, engine-core/communication'
        );
    });

    it('closes open environments', async () => {
        const nodeEnvironmentManager = new NodeEnvironmentsManager(
            socketServer,
            {
                features: new Map<string, IStaticFeatureDefinition>(
                    Object.entries({
                        [engineNodeEntry.scopedName]: engineNodeEntry,
                        [comEntry.scopedName]: comEntry,
                    })
                ),
                port,
            },
            process.cwd()
        );

        disposables.add(() => nodeEnvironmentManager.closeAll());

        await nodeEnvironmentManager.runServerEnvironments(runFeatureOptions);
        await expect(nodeEnvironmentManager.closeEnvironment({ featureName: 'test' })).to.eventually.be.rejectedWith(
            'there are no node environments running for test'
        );
    });

    describe('Node environment manager socket communication', () => {
        const proxyFeature = new Feature({
            id: 'test',
            api: {
                echoService: Service.withType<{ echo: () => Promise<string> }>().defineEntity(env),
            },
            dependencies: [SocketServerNodeFeature, COM],
        }).setup(env, ({}, { XTestFeature: { echoService }, COM: { communication } }) => {
            void socketClientInitializer({ communication, env: socketServerEnv });

            return {
                echoService: {
                    echo: () => {
                        return echoService.echo();
                    },
                },
            };
        });

        it('allows socket communication between node environments', async () => {
            const nodeEnvironmentManager = new NodeEnvironmentsManager(
                socketServer,
                {
                    features: new Map<string, IStaticFeatureDefinition>(
                        Object.entries({
                            [engineMultiNodeSocketCommunication.scopedName]: engineMultiNodeSocketCommunication,
                            [comEntry.scopedName]: comEntry,
                        })
                    ),
                    port,
                },
                process.cwd()
            );

            disposables.add(() => nodeEnvironmentManager.closeAll());

            await nodeEnvironmentManager.runServerEnvironments({
                featureName: engineMultiNodeSocketCommunication.scopedName,
            });

            const { dispose, engine } = runEngineApp({
                env,
                features: [proxyFeature],
                config: [
                    COM.use({
                        config: {
                            resolvedContexts: {},
                            topology: nodeEnvironmentManager.getTopology('engine-multi-socket-node/x'),
                        },
                    }),
                ],
            });
            disposables.add(() => dispose());

            expect(await engine.get(proxyFeature).api.echoService.echo()).to.eq('hello gaga');
        });

        it('allows socket communication between node environments when running in forked mode', async () => {
            const nodeEnvironmentManager = new NodeEnvironmentsManager(
                socketServer,
                {
                    features: new Map<string, IStaticFeatureDefinition>(
                        Object.entries({
                            [engineMultiNodeSocketCommunication.scopedName]: engineMultiNodeSocketCommunication,
                            [comEntry.scopedName]: comEntry,
                        })
                    ),
                    port,
                },
                process.cwd()
            );

            disposables.add(() => nodeEnvironmentManager.closeAll());

            await nodeEnvironmentManager.runServerEnvironments({
                featureName: engineMultiNodeSocketCommunication.scopedName,
                mode: 'forked',
            });

            const { dispose, engine } = runEngineApp({
                env,
                features: [proxyFeature],
                config: [
                    COM.use({
                        config: {
                            resolvedContexts: {},
                            topology: nodeEnvironmentManager.getTopology(engineMultiNodeSocketCommunication.scopedName),
                        },
                    }),
                ],
            });
            disposables.add(() => dispose());

            expect(await engine.get(proxyFeature).api.echoService.echo()).to.eq('hello gaga');
        });
    });
    describe('Node environment manager ipc communication', () => {
        const testFeature = new Feature({
            id: 'test',
            api: {
                echoService: Service.withType<{ echo: () => Promise<string> }>().defineEntity(env),
            },
            dependencies: [ServerNodeFeature, COM],
        }).setup(env, ({}, { XTestFeature: { echoService }, COM: { communication } }) => {
            void socketClientInitializer({ communication, env: serverEnv });

            return {
                echoService: {
                    echo: () => {
                        return echoService.echo();
                    },
                },
            };
        });

        it('allows local communication between node environments', async () => {
            const nodeEnvironmentManager = new NodeEnvironmentsManager(
                socketServer,
                {
                    features: new Map<string, IStaticFeatureDefinition>(
                        Object.entries({
                            [engineMultiNodeIPCCommunication.scopedName]: engineMultiNodeIPCCommunication,
                            [comEntry.scopedName]: comEntry,
                        })
                    ),
                    port,
                },
                process.cwd()
            );

            disposables.add(() => nodeEnvironmentManager.closeAll());

            await nodeEnvironmentManager.runServerEnvironments({
                featureName: engineMultiNodeIPCCommunication.scopedName,
            });

            const { dispose, engine } = runEngineApp({
                env,
                features: [testFeature],
                config: [
                    COM.use({
                        config: {
                            resolvedContexts: {},
                            topology: nodeEnvironmentManager.getTopology(engineMultiNodeIPCCommunication.scopedName),
                        },
                    }),
                ],
            });
            disposables.add(() => dispose());

            expect(await engine.get(testFeature).api.echoService.echo()).to.eq('hello gaga');
        });

        it('allows local communication between node environments when running in forked mode', async () => {
            const nodeEnvironmentManager = new NodeEnvironmentsManager(
                socketServer,
                {
                    features: new Map<string, IStaticFeatureDefinition>(
                        Object.entries({
                            [engineMultiNodeIPCCommunication.scopedName]: engineMultiNodeIPCCommunication,
                            [comEntry.scopedName]: comEntry,
                        })
                    ),
                    port,
                },
                process.cwd()
            );

            disposables.add(() => nodeEnvironmentManager.closeAll());

            await nodeEnvironmentManager.runServerEnvironments({
                featureName: engineMultiNodeIPCCommunication.scopedName,
                mode: 'forked',
            });

            const { dispose, engine } = runEngineApp({
                env,
                features: [testFeature],
                config: [
                    COM.use({
                        config: {
                            resolvedContexts: {},
                            topology: nodeEnvironmentManager.getTopology(engineMultiNodeIPCCommunication.scopedName),
                        },
                    }),
                ],
            });
            disposables.add(() => dispose());

            expect(await engine.get(testFeature).api.echoService.echo()).to.eq('hello gaga');
        });
    });
});

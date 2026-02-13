import { expect } from 'chai';
import sinon from 'sinon';
import { BaseHost, COM, Communication, WsClientHost } from '@dazl/engine-core';
import {
    IConnectionHandler,
    launchEngineHttpServer,
    NodeEnvManager,
    type NodeEnvsFeatureMapping,
    WsServerHost,
} from '@dazl/engine-runtime-node';
import { aEnv, bEnv } from '../test-kit/feature/envs.js';
import { EchoService } from '../test-kit/feature/types.js';
import { runEnv as runAEnv } from '../test-kit/entrypoints/a.node.js';
import testFeature from '../test-kit/feature/test-feature.js';

describe('NodeEnvManager', () => {
    const disposables = new Set<() => Promise<void> | void>();
    afterEach(async () => {
        for (const dispose of Array.from(disposables).reverse()) {
            await dispose();
        }
        disposables.clear();
    });
    const disposeAfterTest = <T extends { dispose: () => void }>(obj: T) => {
        disposables.add(() => obj.dispose());
        return obj;
    };

    const meta = { url: import.meta.resolve('../test-kit/entrypoints/') };
    const testCommunicationId = 'test';

    describe('NodeEnvManager with 2 node envs, remote api call', () => {
        let manager: NodeEnvManager;
        let communication: Communication;
        let nodeEnvsPort: number;
        beforeEach(async () => {
            const featureEnvironmentsMapping: NodeEnvsFeatureMapping = {
                featureToEnvironments: {
                    'test-feature': [aEnv.env, bEnv.env],
                },
                availableEnvironments: {
                    a: {
                        env: aEnv.env,
                        endpointType: 'single',
                        envType: 'node',
                    },
                    b: {
                        env: bEnv.env,
                        endpointType: 'single',
                        envType: 'node',
                    },
                },
            };

            manager = disposeAfterTest(new NodeEnvManager(meta, featureEnvironmentsMapping));
            const { port } = await manager.autoLaunch(new Map([['feature', 'test-feature']]));
            nodeEnvsPort = port;
            communication = disposeAfterTest(getClientCom(port));
        });

        it('should reach env "a"', async () => {
            const api = communication.apiProxy<EchoService>({ id: aEnv.env }, { id: 'test-feature.echoAService' });

            expect(await api.echo()).to.equal('a');
        });
        it('should reach env "a", env "a" should reach env "b"', async () => {
            const api = communication.apiProxy<EchoService>({ id: aEnv.env }, { id: 'test-feature.echoAService' });

            expect(await api.echoChained()).to.equal('b');
        });
        it('should reach env "b", env "b" should reach env "a"', async () => {
            const api = communication.apiProxy<EchoService>({ id: bEnv.env }, { id: 'test-feature.echoBService' });

            expect(await api.echoChained()).to.equal('a');
        });

        it('should handle two communication with the same', async () => {
            // setup new com instance with the same id
            const communication2 = disposeAfterTest(new Communication(new BaseHost(), testCommunicationId));
            const host = disposeAfterTest(new WsClientHost('http://localhost:' + nodeEnvsPort, {}));

            communication2.registerEnv(aEnv.env, host);
            communication2.registerEnv(bEnv.env, host);
            communication2.registerMessageHandler(host);

            const api1 = communication.apiProxy<EchoService>({ id: bEnv.env }, { id: 'test-feature.echoBService' });
            const api2 = communication2.apiProxy<EchoService>({ id: aEnv.env }, { id: 'test-feature.echoAService' });
            const result1 = api1.echo();
            const result2 = api2.echo();

            expect(await result1).to.equal('b');
            expect(await result2).to.equal('a');
        });
    });

    describe('NodeEnvManager with 2 node envs, one remote the other in a worker thread', () => {
        let nodeEnvsManager: NodeEnvManager;
        let communication: Communication;

        beforeEach(async () => {
            const { port: aPort, socketServer, close } = await launchEngineHttpServer();
            disposables.add(() => close());

            await runAEnv({
                Feature: testFeature,
                topLevelConfig: [
                    COM.configure({
                        config: {
                            host: disposeAfterTest(new WsServerHost(socketServer)),
                            id: aEnv.env,
                        },
                    }),
                ],
            });

            const featureEnvironmentsMapping: NodeEnvsFeatureMapping = {
                featureToEnvironments: {
                    'test-feature': [aEnv.env, bEnv.env],
                },
                availableEnvironments: {
                    a: {
                        env: aEnv.env,
                        endpointType: 'single',
                        envType: 'remote',
                        remoteUrl: `http://localhost:${aPort}`,
                    },
                    b: {
                        env: bEnv.env,
                        endpointType: 'single',
                        envType: 'node',
                    },
                },
            };

            nodeEnvsManager = disposeAfterTest(new NodeEnvManager(meta, featureEnvironmentsMapping));
            const { port } = await nodeEnvsManager.autoLaunch(new Map([['feature', 'test-feature']]));
            communication = disposeAfterTest(getClientCom(port));
        });

        it('should reach env "a"', async () => {
            const api = communication.apiProxy<EchoService>({ id: aEnv.env }, { id: 'test-feature.echoAService' });

            expect(await api.echo()).to.equal('a');
        });

        it('should reach env "a", env "a" should reach env "b"', async () => {
            const api = communication.apiProxy<EchoService>({ id: aEnv.env }, { id: 'test-feature.echoAService' });

            expect(await api.echoChained()).to.equal('b');
        });
        it('should reach env "b", env "b" should reach env "a"', async () => {
            const api = communication.apiProxy<EchoService>({ id: bEnv.env }, { id: 'test-feature.echoBService' });

            expect(await api.echoChained()).to.equal('a');
        });
    });

    describe('NodeEnvManager with connection handlers', () => {
        it('should call connection, reconnection and disconnection handlers', async () => {
            const connectionHandler = sinon.spy();
            const disconnectionHandler = sinon.spy();
            const reconnectionHandler = sinon.spy();

            const featureEnvironmentsMapping: NodeEnvsFeatureMapping = {
                featureToEnvironments: {
                    'test-feature': [aEnv.env],
                },
                availableEnvironments: {
                    a: {
                        env: aEnv.env,
                        endpointType: 'single',
                        envType: 'node',
                    },
                },
            };

            const manager = disposeAfterTest(new NodeEnvManager(meta, featureEnvironmentsMapping));
            const { port } = await manager.autoLaunch(new Map([['feature', 'test-feature']]), {
                onConnectionOpen: connectionHandler,
                onConnectionClose: disconnectionHandler,
                onConnectionReconnect: reconnectionHandler,
            });

            // Create a client connection 1
            const initialClientId = 'test-client-id';
            const client1 = new WsClientHost('http://localhost:' + port, {
                auth: {
                    clientId: initialClientId,
                },
            });
            const communication1 = new Communication(new BaseHost(), testCommunicationId);
            communication1.registerEnv(aEnv.env, client1);
            communication1.registerMessageHandler(client1);

            await client1.connected;

            // Verify connection handler was called
            expect(connectionHandler.callCount).to.equal(1);
            const [args1] = connectionHandler.firstCall.args as Parameters<IConnectionHandler>;
            expect(args1.clientId).to.equal(initialClientId);
            expect(args1.socket).to.have.property('id');
            expect(args1.postMessage).to.be.a('function');

            // Replace a client connection
            const waitDisconnectFirstSocket = new Promise<void>((resolve) => {
                args1.socket.on('disconnect', () => {
                    resolve();
                });
            });
            const client2 = new WsClientHost('http://localhost:' + port, {
                auth: {
                    clientId: initialClientId,
                },
            });
            const communication2 = new Communication(new BaseHost(), testCommunicationId);
            communication2.registerEnv(aEnv.env, client2);
            communication2.registerMessageHandler(client2);

            await client2.connected;

            // Verify reconnection handler was called
            expect(reconnectionHandler.callCount).to.equal(1);
            const [args2] = reconnectionHandler.firstCall.args as Parameters<IConnectionHandler>;
            expect(args2.clientId).to.equal(initialClientId);
            expect(args2.socket).to.have.property('id');
            expect(args2.postMessage).to.be.a('function');
            expect(args2.socket.id).to.not.equal(args1.socket.id);

            // Verify disconnection handler was not called after the client connection was replaced
            await waitDisconnectFirstSocket;
            expect(disconnectionHandler.callCount).to.equal(0);

            // Disconnect an active socket
            await new Promise<void>((resolve) => {
                args2.socket.on('disconnect', () => {
                    resolve();
                });
                client2.disconnectSocket();
            });

            // Verify disconnection handler for active connection was called
            expect(disconnectionHandler.callCount).to.equal(1);
            const [disconnectArgs1] = disconnectionHandler.firstCall.args as Parameters<IConnectionHandler>;
            expect(disconnectArgs1.clientId).to.equal(initialClientId);
            expect(disconnectArgs1.postMessage).to.be.a('function');
            expect(disconnectArgs1.socket.id).to.equal(args2.socket.id);

            await communication1.dispose();
            await communication2.dispose();
        });
    });

    function getClientCom(port: number) {
        const host = new WsClientHost('http://localhost:' + port, {});
        const com = new Communication(new BaseHost(), testCommunicationId);
        com.registerEnv(aEnv.env, host);
        com.registerEnv(bEnv.env, host);
        com.registerMessageHandler(host);
        return com;
    }
});

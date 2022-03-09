import chai, { expect } from 'chai';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import { stub, spy } from 'sinon';

import {
    SERVICE_CONFIG,
    multiTenantMethod,
    BaseHost,
    Communication,
    EventEmitterHost,
    EventEmitter,
    Message,
    Environment,
    Feature,
    Service,
    RuntimeEngine,
    COM,
    Slot,
    ReadyMessage,
} from '@wixc3/engine-core';
import { createDisposables } from '@wixc3/create-disposables';
import { waitFor } from 'promise-assist';

chai.use(sinonChai);
chai.use(chaiAsPromised);

class EchoService {
    echo(s: string) {
        return s;
    }
}

describe('Communication', () => {
    const disposables = createDisposables();

    afterEach(disposables.dispose);

    it('single communication', async () => {
        const host = new BaseHost();

        const main = new Communication(host, 'main');

        main.registerAPI(
            { id: 'echoService' },
            {
                echo(s: string) {
                    return s;
                },
            }
        );

        const proxy = main.apiProxy<EchoService>(Promise.resolve({ id: 'main' }), { id: 'echoService' });

        const res = await proxy.echo('Yoo!');

        expect(res).to.be.equal('Yoo!');
    });
    it('multi communication', async () => {
        const host = new BaseHost();
        const main = new Communication(host, 'main');

        const host2 = host.open();
        const main2 = new Communication(host2, 'main2');

        main.registerEnv('main2', host2);

        main2.registerAPI(
            { id: 'echoService' },
            {
                echo(s: string) {
                    return s;
                },
            }
        );

        const proxy = main.apiProxy<EchoService>(Promise.resolve({ id: 'main2' }), { id: 'echoService' });

        const res = await proxy.echo('Yoo!');

        expect(res).to.be.equal('Yoo!');
    });

    it('multitenant multi communication', async () => {
        // creating 3 environments - main as a parent, and 2 child environments
        const host = new BaseHost();
        const main = new Communication(host, 'main');

        const host2 = host.open();
        const child = new Communication(host2, 'child');

        const host3 = host.open();
        const child2 = new Communication(host3, 'child2');

        // registering them to main
        main.registerEnv('child', host2);
        main.registerEnv('child2', host3);

        // a class with a multitenant function
        class MultiEcho {
            [SERVICE_CONFIG] = {
                echo: multiTenantMethod(this.echo),
            };
            echo(id: string, s: string) {
                return `${id} echo ${s}`;
            }
        }

        // registering the MultiEcho service on child2 com
        child2.registerAPI({ id: 'echoService' }, new MultiEcho());

        // creating a proxy between main and child2 and registering it
        const child2Proxy = main.apiProxy<MultiEcho>(Promise.resolve({ id: 'child2' }), { id: 'echoService' });
        child.registerAPI({ id: 'echoService' }, child2Proxy);

        // creating the proxy between child and child2 using the proxy between main and child2
        const childProxy = child.apiProxy<MultiEcho>(Promise.resolve({ id: 'child2' }), { id: 'echoService' });

        const res = await childProxy.echo('Yoo!');

        expect(res).to.be.equal('child echo Yoo!');
    });

    it('doesnt send callback message on a method that was defined not to send one', async () => {
        const host = new BaseHost();
        const main = new Communication(host, 'main', undefined, undefined, undefined, {
            warnOnSlow: true,
        });

        const host2 = host.open();
        const child = new Communication(host2, 'child', undefined, undefined, undefined, {
            warnOnSlow: true,
        });

        // handleMessage is called when message is recieved from remote
        const handleMessageStub = stub(main, 'handleMessage');

        // callMethod is being called when sending call/listen request to other origin
        const childCallMethodStub = stub(child, 'callMethod');

        main.registerEnv('child', host2);

        child.registerAPI({ id: 'echoService' }, new EchoService());
        const proxy = main.apiProxy<EchoService>(
            Promise.resolve({ id: 'child' }),
            { id: 'echoService' },
            {
                echo: {
                    emitOnly: true,
                },
            }
        );
        await proxy.echo('Yo!');

        // we want to check a callback message was not send
        expect(childCallMethodStub).to.have.not.been.called;

        // we need to check that no message was received
        expect(handleMessageStub).to.have.not.been.called;
    });

    it('forwards listen calls', async () => {
        const middlemanHost = new BaseHost();
        const aHost = new BaseHost();
        const bHost = new BaseHost();

        const mainCom = new Communication(middlemanHost, 'middle');
        const bCom = new Communication(bHost, 'bEnv');
        const aCom = new Communication(aHost, 'aEnv');

        disposables.add(mainCom);
        disposables.add(bCom);
        disposables.add(aCom);

        aCom.registerEnv('bEnv', middlemanHost);
        aCom.registerEnv('middle', middlemanHost);

        mainCom.registerEnv('aEnv', aHost);
        mainCom.registerEnv('bEnv', bHost);

        bCom.registerEnv('middle', middlemanHost);
        bCom.registerEnv('aEnv', middlemanHost);

        const mockApi = getMockApi();
        bCom.registerAPI({ id: 'myApi' }, mockApi);

        const mockApiProxyFromAEnv = aCom.apiProxy<typeof mockApi>(
            { id: 'bEnv' },
            { id: 'myApi' },
            {
                listen: {
                    listener: true,
                },
            }
        );

        const spyFn = spy();

        await mockApiProxyFromAEnv.listen(spyFn);

        const spyFn2 = spy();
        await mockApiProxyFromAEnv.listen(spyFn2);
        mockApi.invoke();

        expect(spyFn).to.have.callCount(1);
        expect(spyFn2).to.have.callCount(1);
        expect(spyFn.calledWith(1)).to.eq(true);
    });

    it('forwards listen calls only if listener was configured', async () => {
        const middlemanHost = new BaseHost();
        const aHost = new BaseHost();
        const bHost = new BaseHost();

        const mainCom = new Communication(middlemanHost, 'middle');
        const bCom = new Communication(bHost, 'bEnv');
        const aCom = new Communication(aHost, 'aEnv');

        disposables.add(mainCom);
        disposables.add(bCom);
        disposables.add(aCom);

        aCom.registerEnv('bEnv', middlemanHost);
        aCom.registerEnv('middle', middlemanHost);

        mainCom.registerEnv('aEnv', aHost);
        mainCom.registerEnv('bEnv', bHost);

        bCom.registerEnv('middle', middlemanHost);
        bCom.registerEnv('aEnv', middlemanHost);

        const mockApi = getMockApi();
        bCom.registerAPI({ id: 'myApi' }, mockApi);
        const mockApiProxyFromAEnv = aCom.apiProxy<typeof mockApi>({ id: 'bEnv' }, { id: 'myApi' });

        const spyFn = spy();
        await expect(mockApiProxyFromAEnv.listen(spyFn)).to.be.eventually.rejectedWith(
            'cannot add listener to unconfigured method myApi listen'
        );
    });

    it('forwards dispose calls', async () => {
        const middlemanHost = new BaseHost();
        const aHost = new BaseHost();
        const bHost = new BaseHost();

        const mainCom = new Communication(middlemanHost, 'middle');
        const bCom = new Communication(bHost, 'bEnv');
        const aCom = new Communication(aHost, 'aEnv');

        disposables.add(mainCom);
        disposables.add(bCom);
        disposables.add(aCom);

        aCom.registerEnv('bEnv', middlemanHost);
        bCom.registerEnv('aEnv', middlemanHost);
        mainCom.registerEnv('aEnv', aHost);
        mainCom.registerEnv('bEnv', bHost);
        aCom.handleReady({ from: 'bEnv' } as ReadyMessage);
        bCom.handleReady({ from: 'anv' } as ReadyMessage);

        const echoService = {
            echo() {
                return 'echo';
            },
        };

        bCom.registerAPI({ id: 'myApi' }, echoService);

        const mockApiProxyFromAEnv = aCom.apiProxy<typeof echoService>({ id: 'bEnv' }, { id: 'myApi' });
        const spyFn = spy();
        bCom.subscribeToEnvironmentDispose(spyFn);
        await mockApiProxyFromAEnv.echo();
        aCom.clearEnvironment(aCom.getEnvironmentId());
        await waitFor(() => {
            expect(spyFn).to.have.been.calledWith(aCom.getEnvironmentId());
        });
    });

    it('forwards unlisten calls', async () => {
        const middlemanHost = new BaseHost();
        const aHost = new BaseHost();
        const bHost = new BaseHost();

        const mainCom = new Communication(middlemanHost, 'middle');
        const bCom = new Communication(bHost, 'bEnv');
        const aCom = new Communication(aHost, 'aEnv');

        disposables.add(mainCom);
        disposables.add(bCom);
        disposables.add(aCom);

        aCom.registerEnv('bEnv', middlemanHost);
        aCom.registerEnv('middle', middlemanHost);

        mainCom.registerEnv('aEnv', aHost);
        mainCom.registerEnv('bEnv', bHost);

        bCom.registerEnv('middle', middlemanHost);
        bCom.registerEnv('aEnv', middlemanHost);

        const mockApi = getMockApi();
        bCom.registerAPI({ id: 'myApi' }, mockApi);

        const mockApiProxyFromAEnv = aCom.apiProxy<typeof mockApi>(
            { id: 'bEnv' },
            { id: 'myApi' },
            {
                listen: {
                    listener: true,
                },
                unsubscribe: {
                    removeListener: 'listen',
                },
            }
        );

        const spyFn = spy();
        const spyFn2 = spy();
        await mockApiProxyFromAEnv.listen(spyFn);
        await mockApiProxyFromAEnv.listen(spyFn2);
        await mockApiProxyFromAEnv.unsubscribe(spyFn);

        mockApi.invoke();

        expect(spyFn).to.have.callCount(0);
        expect(spyFn2).to.have.callCount(1);
        expect(mockApi.getListenersCount()).to.eq(1);
        await mockApiProxyFromAEnv.unsubscribe(spyFn2);

        mockApi.invoke();
        expect(spyFn2).to.have.callCount(1);
        expect(mockApi.getListenersCount()).to.eq(0);
    });

    it('communication handshake', async () => {
        const testText = 'Yoo!';
        const echoService: { echo(s: string): string } = {
            echo(s: string) {
                return s;
            },
        };
        const echoServiceComID = { id: 'echoService' };

        const client1RootHost = new BaseHost();
        const client2RootHost = new BaseHost();
        const serverRootHost = new BaseHost();

        const client1 = new Communication(client1RootHost, 'client1');
        const client2 = new Communication(client2RootHost, 'client2');
        const serverEnv = new Communication(serverRootHost, 'server');

        // server env setup
        const client1RemoteHost = client1RootHost.open();
        serverEnv.registerMessageHandler(client1RemoteHost);
        client1.registerEnv('server', client1RemoteHost);

        const client2RemoteHost = client2RootHost.open();
        serverEnv.registerMessageHandler(client2RemoteHost);
        client2.registerEnv('server', client2RemoteHost);

        serverEnv.registerAPI(echoServiceComID, echoService);

        const echoServiceProxyInClient1 = client1.apiProxy<EchoService>(
            Promise.resolve({ id: 'server' }),
            echoServiceComID
        );
        const echoServiceInstanceInClient2 = client2.apiProxy<EchoService>(
            Promise.resolve({ id: 'server' }),
            echoServiceComID
        );

        const resposeToClient1 = await echoServiceProxyInClient1.echo(testText);
        const responseToClient2 = await echoServiceInstanceInClient2.echo(testText);

        expect(resposeToClient1, 'allow communication between calling environment and base').to.be.equal(testText);
        expect(responseToClient2, 'allow communication between calling environment and base').to.be.equal(testText);

        client1.registerAPI(echoServiceComID, echoService);
        const echoServiceProxyFromServerToClient1 = serverEnv.apiProxy<EchoService>(
            { id: 'client1' },
            echoServiceComID
        );

        expect(
            await echoServiceProxyFromServerToClient1.echo(testText),
            'after handshake is done - allow sending message from base to client1'
        ).to.eq(testText);

        client2.registerAPI(echoServiceComID, echoService);
        const echoServiceProxyFromServerToClient2 = serverEnv.apiProxy<EchoService>(
            { id: 'client2' },
            echoServiceComID
        );

        expect(
            await echoServiceProxyFromServerToClient2.echo(testText),
            'after handshake is done - allow sending message from base to client2'
        ).to.eq(testText);
    });

    it('supports answering forwarded message from a forwarded message', async () => {
        /**
         * The flow of the test is as follows:
         * setup communication in a way where:
         *   1 talks to 2
         *   3 talks to 4
         *   1 talks to 3
         *
         * and then initiate a message from 2 to 4, which will be forwarded twice - when it will arrive to 1 and then to 3, and will be forwarded back twice using same mechanism
         */

        const host1 = new BaseHost();
        const host2 = new BaseHost();
        const host3 = new BaseHost();
        const host4 = new BaseHost();

        const com1 = new Communication(host1, 'com1');
        const com2 = new Communication(host2, 'com2');
        const com3 = new Communication(host3, 'com3');
        const com4 = new Communication(host4, 'com4');

        disposables.add(com1);
        disposables.add(com2);
        disposables.add(com3);
        disposables.add(com4);

        // 1 to 2
        const com2ChildHost = host1.open();
        com1.registerEnv('com2', com2ChildHost);
        com2.registerMessageHandler(com2ChildHost);

        // 3 to 4
        const com4ChildHost = host3.open();
        com3.registerEnv('com4', com4ChildHost);
        com4.registerMessageHandler(com4ChildHost);

        // 1 to 3
        const com3ChildHost = host1.open();
        com1.registerEnv('com3', com3ChildHost);
        com3.registerMessageHandler(com3ChildHost);

        // instruct 1 to send messages to 4 using 3
        com1.registerEnv('com4', com3ChildHost);

        // instruct 2 to send messages to 4 using 1
        const com1ChildHost = host1.open();
        com1.registerMessageHandler(com1ChildHost);
        com2.registerEnv('com4', com1ChildHost);

        // create a service at 4
        const echoService = {
            echo: (text: string) => `hello ${text}`,
            fail: (): Promise<string> => {
                return new Promise<string>(() => {
                    throw new Error('fail');
                });
            },
        };
        com4.registerAPI({ id: 'service' }, echoService);

        // call it from 2
        const apiProxy = com2.apiProxy<typeof echoService>({ id: 'com4' }, { id: 'service' });
        expect(await apiProxy.echo('name')).to.eq('hello name');
        await expect(apiProxy.fail()).to.be.rejectedWith('fail');
    });
});

describe('environment-dependencies communication', () => {
    it('supports environment proxy for environment dependencies', async () => {
        const base = new Environment('base', 'node', 'multi');
        // const base = new AbstractEnvironment('base', 'node');
        const env1 = new Environment('env1', 'node', 'single', [base]);

        const env2 = new Environment('env2', 'node', 'single');

        const f = new Feature({
            id: 'base',
            api: {
                service1: Service.withType<{ echo: () => string[] }>().defineEntity(base).allowRemoteAccess(),
                slot1: Slot.withType<string>().defineEntity(base),
                service2: Service.withType<{ echo: () => string[] }>().defineEntity(env1).allowRemoteAccess(),
            },
            dependencies: [COM],
        });

        f.setup(base, ({ slot1 }) => {
            slot1.register(base.env);
            return {
                service1: { echo: () => [...slot1] },
            };
        });

        f.setup(env1, ({ service1, slot1 }) => {
            slot1.register(env1.env);
            return {
                service2: service1,
            };
        });

        const env1Engine = new RuntimeEngine(env1);
        await env1Engine.run([f]);
        const {
            api: { communication: env1Communication },
        } = env1Engine.get(COM);

        const env1Target = (
            env1Communication.getEnvironmentHost(env1Communication.getEnvironmentId()) as BaseHost
        ).open();
        env1Target.name = env1.env;

        f.setup(env2, ({ service2, run }, { COM: { communication } }) => {
            const env2Target = (communication.getEnvironmentHost(communication.getEnvironmentId()) as BaseHost).open();
            env2Target.name = env2.env;

            communication.registerEnv(env1.env, env1Target);
            env1Communication.registerMessageHandler(env1Target);
            env1Communication.registerEnv(env2.env, env2Target);
            communication.registerMessageHandler(env2Target);

            run(async () => {
                expect(await service2.echo()).to.eql([base.env, env1.env]);
            });
        });

        const env1EngineEnv2 = new RuntimeEngine(env2);
        await env1EngineEnv2.run([f]);
    });
});

describe('Event Emitter communication', () => {
    it('single communication', async () => {
        const eventEmitter = new EventEmitter<{ message: Message }>();
        const host = new EventEmitterHost(eventEmitter);

        const main = new Communication(host, 'main');

        main.registerAPI(
            { id: 'echoService' },
            {
                echo(s: string) {
                    return s;
                },
            }
        );

        const proxy = main.apiProxy<EchoService>(Promise.resolve({ id: 'main' }), { id: 'echoService' });

        const res = await proxy.echo('Yoo!');

        expect(res).to.be.equal('Yoo!');
    });

    it('multi communication', async () => {
        const host = new BaseHost();
        const eventEmitter = new EventEmitter<{ message: Message }>();
        const host2 = new EventEmitterHost(eventEmitter);

        const main = new Communication(host, 'main');
        const main2 = new Communication(host2, 'main2');

        main.registerEnv('main2', host2);
        main2.registerAPI(
            { id: 'echoService' },
            {
                echo(s: string) {
                    return s;
                },
            }
        );

        main2.registerEnv('main', host);
        const proxy = main.apiProxy<EchoService>(Promise.resolve({ id: 'main2' }), { id: 'echoService' });

        const res = await proxy.echo('Yoo!');

        expect(res).to.be.equal('Yoo!');
    });
});

function getMockApi() {
    const listeners = new Set<(number: number) => void>();
    const mockApi = {
        listen: function (cb: (number: number) => void) {
            listeners.add(cb);
        },
        invoke() {
            for (const listener of listeners) {
                listener(1);
            }
        },
        unsubscribe: function (cb: (number: number) => void) {
            listeners.delete(cb);
        },
        getListenersCount: function () {
            return listeners.size;
        },
    };
    return mockApi;
}

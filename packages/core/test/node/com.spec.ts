import { createDisposables } from '@dazl/create-disposables';
import {
    BaseHost,
    COM,
    Communication,
    Environment,
    Feature,
    RemoteValue,
    RuntimeEngine,
    SERVICE_CONFIG,
    Service,
    Slot,
    declareComEmitter,
    multiTenantMethod,
} from '@dazl/engine-core';
import * as chai from 'chai';
import { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { sleep, waitFor } from 'promise-assist';
import { spy, stub } from 'sinon';
import sinonChai from 'sinon-chai';

chai.use(sinonChai);
chai.use(chaiAsPromised);

class EchoService {
    echo(s: string) {
        return s;
    }
}

describe('Communication', () => {
    const disposables = createDisposables();

    afterEach(() => disposables.dispose());

    it('single communication', async () => {
        const host = new BaseHost();

        const main = new Communication(host, 'main');

        main.registerAPI(
            { id: 'echoService' },
            {
                echo(s: string) {
                    return s;
                },
            },
        );

        const proxy = main.apiProxy<EchoService>(Promise.resolve({ id: 'main' }), { id: 'echoService' });

        const res = await proxy.echo('Yoo!');

        expect(res).to.be.equal('Yoo!');
    });

    describe('RemoteValue', () => {
        interface ServiceWithRemoteValue {
            counter: RemoteValue<number>;
        }

        function setupCrossEnvCommunication() {
            const hostMain = new BaseHost();
            const hostChild = hostMain.open();
            const comMain = new Communication(hostMain, 'main');
            const comChild = new Communication(hostChild, 'child');

            comMain.registerEnv('child', hostChild);
            comChild.registerEnv('main', hostMain);

            return { comMain, comChild, hostMain, hostChild };
        }

        function createEventCollector<T>() {
            const events: Array<{ value: T; version: number }> = [];
            const handler = (value: T, version: number) => {
                events.push({ value, version });
            };
            return { events, handler };
        }

        const waitOneTickAfter = () => sleep(0);

        it('should subscribe and unsubscribe to value changes', async () => {
            const { comMain, comChild } = setupCrossEnvCommunication();
            const service = { counter: new RemoteValue<number>(0) };
            comChild.registerAPI({ id: 'myService' }, service);

            const proxy = comMain.apiProxy<ServiceWithRemoteValue>({ id: 'child' }, { id: 'myService' });
            const { events, handler } = createEventCollector<number>();

            proxy.counter.subscribe(handler);
            await waitOneTickAfter();

            service.counter.setValueAndNotify(1);
            await waitOneTickAfter();

            expect(events, 'event with change').to.eql([{ value: 1, version: 1 }]);

            proxy.counter.unsubscribe(handler);
            await waitOneTickAfter();

            service.counter.setValueAndNotify(2);
            await waitOneTickAfter();

            expect(events, 'no new events after unsubscribe').to.eql([{ value: 1, version: 1 }]);
        });
        it('should stream current value immediately (subscribe+fetch)', async () => {
            const { comMain, comChild } = setupCrossEnvCommunication();
            const service = { counter: new RemoteValue<number>(5) };
            comChild.registerAPI({ id: 'myService' }, service);

            const proxy = comMain.apiProxy<ServiceWithRemoteValue>({ id: 'child' }, { id: 'myService' });
            const { events, handler } = createEventCollector<number>();

            proxy.counter.stream(handler);
            await waitOneTickAfter();

            expect(events, 'immediate with initial value').to.eql([{ value: 5, version: 0 }]);

            service.counter.setValueAndNotify(10);
            await waitOneTickAfter();

            expect(events, 'initial + notify').to.eql([
                { value: 5, version: 0 },
                { value: 10, version: 1 },
            ]);
        });
        it('should get current value via getValue', async () => {
            const { comMain, comChild } = setupCrossEnvCommunication();
            const service = { counter: new RemoteValue<number>(42) };
            comChild.registerAPI({ id: 'myService' }, service);

            const proxy = comMain.apiProxy<ServiceWithRemoteValue>({ id: 'child' }, { id: 'myService' });

            const value = await proxy.counter.getValue();

            expect(value).to.equal(42);
        });
        it('should support multiple subscribers receiving same updates', async () => {
            const { comMain, comChild } = setupCrossEnvCommunication();
            const service = { counter: new RemoteValue<number>(0) };
            comChild.registerAPI({ id: 'myService' }, service);

            const proxy = comMain.apiProxy<ServiceWithRemoteValue>({ id: 'child' }, { id: 'myService' });
            const collector1 = createEventCollector<number>();
            const collector2 = createEventCollector<number>();

            proxy.counter.subscribe(collector1.handler);
            proxy.counter.subscribe(collector2.handler);
            await waitOneTickAfter();

            service.counter.setValueAndNotify(1);
            await waitOneTickAfter();
            service.counter.setValueAndNotify(2);
            await waitOneTickAfter();

            expect(collector1.events, 'collector1 events').to.eql([
                { value: 1, version: 1 },
                { value: 2, version: 2 },
            ]);
            expect(collector2.events, 'collector2 events').to.eql([
                { value: 1, version: 1 },
                { value: 2, version: 2 },
            ]);
        });
        it('should track version increments across value changes', async () => {
            const { comMain, comChild } = setupCrossEnvCommunication();
            const service = { counter: new RemoteValue<number>(0) };
            comChild.registerAPI({ id: 'myService' }, service);

            const proxy = comMain.apiProxy<ServiceWithRemoteValue>({ id: 'child' }, { id: 'myService' });
            const { events, handler } = createEventCollector<number>();

            proxy.counter.subscribe(handler);
            await waitOneTickAfter();

            service.counter.setValueAndNotify(10);
            await waitOneTickAfter();
            service.counter.setValueAndNotify(20);
            await waitOneTickAfter();
            service.counter.setValueAndNotify(30);
            await waitOneTickAfter();

            expect(events.map((e) => e.version)).to.eql([1, 2, 3]);
        });
        it('should not notify when value does not change', async () => {
            const { comMain, comChild } = setupCrossEnvCommunication();
            const service = { counter: new RemoteValue<number>(5) };
            comChild.registerAPI({ id: 'myService' }, service);

            const proxy = comMain.apiProxy<ServiceWithRemoteValue>({ id: 'child' }, { id: 'myService' });
            const { events, handler } = createEventCollector<number>();

            proxy.counter.subscribe(handler);
            await waitOneTickAfter();

            service.counter.setValueAndNotify(5); // same value
            await waitOneTickAfter();

            expect(events, 'no notifications').to.eql([]);
        });
        it('should handle specific unsubscribe with multiple subscribers', async () => {
            const { comMain, comChild } = setupCrossEnvCommunication();
            const service = { counter: new RemoteValue<number>(0) };
            comChild.registerAPI({ id: 'myService' }, service);

            const proxy = comMain.apiProxy<ServiceWithRemoteValue>({ id: 'child' }, { id: 'myService' });
            const collector1 = createEventCollector<number>();
            const collector2 = createEventCollector<number>();

            proxy.counter.subscribe(collector1.handler);
            proxy.counter.subscribe(collector2.handler);
            await waitOneTickAfter();

            proxy.counter.unsubscribe(collector1.handler);
            await waitOneTickAfter();

            service.counter.setValueAndNotify(1);
            await waitOneTickAfter();

            expect(collector1.events, 'unsubscribed, no events').to.eql([]);
            expect(collector2.events, 'still subscribed').to.eql([{ value: 1, version: 1 }]);
        });
        it('should allow reconnect RemoteValue subscriptions on environment reconnection', async () => {
            const hostServer = new BaseHost();
            const hostClient = new BaseHost();
            const comClient = new Communication(hostClient, 'client');
            const comServer = new Communication(hostServer, 'server');

            comClient.registerEnv('server', hostServer);
            comServer.registerEnv('client', hostClient);

            const service = { counter: new RemoteValue<number>(10) };
            comServer.registerAPI({ id: 'myService' }, service);

            const clientService = comClient.apiProxy<ServiceWithRemoteValue>({ id: 'server' }, { id: 'myService' });
            const { events, handler } = createEventCollector<number>();

            // Subscribe to updates
            clientService.counter.subscribe(handler);
            await waitOneTickAfter();

            // Update value before reconnection
            service.counter.setValueAndNotify(20);
            await waitOneTickAfter();
            expect(events, 'received update before reconnect').to.eql([{ value: 20, version: 1 }]);

            comServer.clearEnvironment(comClient.getEnvironmentId());

            service.counter.setValueAndNotify(30);
            service.counter.setValueAndNotify(50);

            comServer.registerEnv('client', hostClient);

            await comClient.reconnectRemoteValues('server');

            await waitFor(() => {
                // Verify we got the latest synced value
                expect(events.length, 'received reconnection sync').to.be.greaterThan(1);
                const lastEvent = events[events.length - 1];
                expect(lastEvent?.value, 'synced to latest value').to.equal(50);
                expect(lastEvent?.version, 'synced to latest version').to.equal(3);
            });
        });
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
            },
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

    it(`doesn't send callback message on a method that was defined not to send one`, async () => {
        const host = new BaseHost();
        const main = new Communication(host, 'main', undefined, undefined, undefined, {
            warnOnSlow: true,
        });

        const host2 = host.open();
        const child = new Communication(host2, 'child', undefined, undefined, undefined, {
            warnOnSlow: true,
        });

        // handleMessage is called when message is received from remote
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
            },
        );
        await proxy.echo('Yo!');

        // we want to check a callback message was not send
        expect(childCallMethodStub).to.have.not.been.called;

        // we need to check that no message was received
        expect(handleMessageStub).to.have.not.been.called;
    });

    it('forwards to pending envs wait until resolve', async () => {
        const middlemanHost = new BaseHost();
        const aHost = new BaseHost();
        const bHost = new BaseHost();

        const mainCom = new Communication(middlemanHost, 'middle');
        const bCom = new Communication(bHost, 'bEnv');
        const aCom = new Communication(aHost, 'aEnv');

        disposables.add(mainCom);
        disposables.add(bCom);
        disposables.add(aCom);

        aCom.registerEnv('bEnv', middlemanHost); // bEnv is registered with middlemanHost

        mainCom.registerEnv('aEnv', aHost);
        mainCom.registerEnv('bEnv', bHost);

        // bEnv is not ready to receive messages yet
        void mainCom.envReady('bEnv');

        bCom.registerEnv('aEnv', middlemanHost); // aEnv is registered with middlemanHost

        const api = {
            spy: spy(),
        };
        bCom.registerAPI({ id: 'myApi' }, api);

        const mockApiProxyFromAEnv = aCom.apiProxy<typeof api>({ id: 'bEnv' }, { id: 'myApi' });
        const done = mockApiProxyFromAEnv.spy();
        // calling the remote api takes several micro ticks, so we wait one tick.
        await sleep(0);
        expect(api.spy).to.have.callCount(0);
        mainCom.handleReady({ from: 'bEnv' });
        await sleep(0);
        expect(api.spy).to.have.callCount(1);
        await done;
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
            },
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
            'Cannot add listener to un-configured method myApi listen',
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
        aCom.handleReady({ from: 'bEnv' });
        bCom.handleReady({ from: 'anv' });

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
            },
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
        const echoService: {
            echo(s: string): string;
        } = {
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
            echoServiceComID,
        );
        const echoServiceInstanceInClient2 = client2.apiProxy<EchoService>(
            Promise.resolve({ id: 'server' }),
            echoServiceComID,
        );

        const responseToClient1 = await echoServiceProxyInClient1.echo(testText);
        const responseToClient2 = await echoServiceInstanceInClient2.echo(testText);

        expect(responseToClient1, 'allow communication between calling environment and base').to.be.equal(testText);
        expect(responseToClient2, 'allow communication between calling environment and base').to.be.equal(testText);

        client1.registerAPI(echoServiceComID, echoService);
        const echoServiceProxyFromServerToClient1 = serverEnv.apiProxy<EchoService>(
            { id: 'client1' },
            echoServiceComID,
        );

        expect(
            await echoServiceProxyFromServerToClient1.echo(testText),
            'after handshake is done - allow sending message from base to client1',
        ).to.eq(testText);

        client2.registerAPI(echoServiceComID, echoService);
        const echoServiceProxyFromServerToClient2 = serverEnv.apiProxy<EchoService>(
            { id: 'client2' },
            echoServiceComID,
        );

        expect(
            await echoServiceProxyFromServerToClient2.echo(testText),
            'after handshake is done - allow sending message from base to client2',
        ).to.eq(testText);
    });

    it('communication local clear remove listeners form registered services', async () => {
        const echoService = {
            handlers: new Set<(s: string) => void>(),
            emit(s: string) {
                for (const handler of this.handlers) {
                    handler(s);
                }
            },
            sub(fn: (s: string) => void) {
                this.handlers.add(fn);
            },
            unsub(fn: (s: string) => void) {
                this.handlers.delete(fn);
            },
        };
        const echoServiceComID = { id: 'echoService' };

        const client1RootHost = new BaseHost();
        const serverRootHost = new BaseHost();

        const client1 = new Communication(client1RootHost, 'client1');
        const serverEnv = new Communication(serverRootHost, 'server');

        // server env setup
        const client1RemoteHost = client1RootHost.open();
        serverEnv.registerMessageHandler(client1RemoteHost);
        client1.registerEnv('server', client1RemoteHost);

        serverEnv.registerAPI(echoServiceComID, echoService);

        const proxy = client1.apiProxy<typeof echoService>(Promise.resolve({ id: 'server' }), echoServiceComID, {
            ...declareComEmitter('sub', 'unsub'),
        });
        const logs: string[] = [];
        await proxy.sub((e) => {
            logs.push(`event:${e}`);
        });
        echoService.emit('1');
        expect(logs).to.eql(['event:1']);

        serverEnv.clearEnvironment('client1');

        echoService.emit('2');
        expect(logs).to.eql(['event:1']);
        expect(echoService.handlers.size, 'handler was removed').to.eq(0);
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

    it('does not stuck in endless forwarding message', async () => {
        /**
         * The flow of the test is as follows:
         * there are env 1 and env 2.
         * env 2 is registered in com1 but with wrong host
         *
         * call some API from 1 to 2 and check if env 1 is not stuck in endless message forwarding
         */
        const host1 = new BaseHost();
        const host2 = new BaseHost();

        const com1 = new Communication(host1, 'com1');
        const com2 = new Communication(host2, 'com2');

        disposables.add(com1);
        disposables.add(com2);

        // 1 to 2 with wrong host
        com1.registerEnv('com2', host1);

        // create a service at 4
        const echoService = {
            test: () => 'hello',
        };
        com2.registerAPI({ id: 'service' }, echoService);

        // call it from 1
        const apiProxy = com1.apiProxy<typeof echoService>({ id: 'com2' }, { id: 'service' });

        await expect(apiProxy.test()).to.be.rejected;
    });
    it('should report env re connection', () => {
        const onEnvReconnect = spy();
        const hostA = new BaseHost();
        const hostB = new BaseHost();
        const comA = new Communication(hostA, 'A');
        const comB = new Communication(hostB, 'B'); // ready is ignored since nothing is connected
        comA.registerEnv('B', hostB);
        comA.registerMessageHandler(hostB);
        comB.registerEnv('A', hostA);
        comB.registerMessageHandler(hostA);

        comA.subscribeToEnvironmentReconnect(onEnvReconnect);

        new Communication(hostB, 'B'); // first ready

        expect(onEnvReconnect).to.have.have.callCount(0);

        new Communication(hostB, 'B'); // re-connect

        expect(onEnvReconnect).to.have.have.callCount(1);
    });
    it('should auto connect event listeners when env is re-connected', async () => {
        const onEventReconnect = spy();
        const onEventEmitterCall = spy();
        const hostA = new BaseHost('A-host');
        const hostB = hostA.open('B-host');
        const comA = new Communication(hostA, 'A');
        const comB_api1 = { service: getMockApi() };
        const comB = new Communication(hostB, 'B', undefined, undefined, undefined, { apis: comB_api1 });
        comA.registerEnv('B', hostB);
        comB.registerEnv('A', hostA);
        comA.subscribeToEnvironmentReconnect(onEventReconnect);

        // setup api between comA and comB
        const apiProxy = comA.apiProxy<typeof comB_api1.service>(
            { id: 'B' },
            { id: 'service' },
            { listen: { listener: true, emitOnly: true } },
        );

        await apiProxy.listen(onEventEmitterCall);

        comB_api1.service.invoke();

        await waitFor(() => {
            expect(onEventEmitterCall, 'invoked event before reconnect').to.have.have.callCount(1);
        });

        // simulate unavailable communication
        comB.removeMessageHandler(hostB);
        // reconnect
        const comB_api2 = { service: getMockApi() };
        new Communication(hostB, 'B', undefined, undefined, undefined, { apis: comB_api2 });

        await waitFor(() => {
            expect(onEventReconnect, 'reconnected').to.been.calledWith('B');
            expect(comB_api2.service.getListenersCount(), 'event handler re-register').to.eq(1);
        });

        comB_api2.service.invoke();

        await waitFor(() => {
            expect(onEventEmitterCall, 'invoked event after reconnect').to.have.have.callCount(2);
        });
    });
    it('should auto connect event listeners when env is re-connected (replaced host)', async () => {
        const onEventReconnect = spy();
        const onEventEmitterCall = spy();
        const hostA = new BaseHost('A-host');
        const hostB = hostA.open('B-host');
        const comA = new Communication(hostA, 'A');
        const comB_api1 = { service: getMockApi() };
        const comB = new Communication(hostB, 'B', undefined, undefined, undefined, { apis: comB_api1 });
        comA.registerEnv('B', hostB);
        comB.registerEnv('A', hostA);
        comA.subscribeToEnvironmentReconnect(onEventReconnect);

        // setup api between comA and comB
        const apiProxy = comA.apiProxy<typeof comB_api1.service>(
            { id: 'B' },
            { id: 'service' },
            { listen: { listener: true, emitOnly: true } },
        );

        await apiProxy.listen(onEventEmitterCall);

        comB_api1.service.invoke();

        await waitFor(() => {
            expect(onEventEmitterCall, 'invoked event before reconnect').to.have.have.callCount(1);
        });

        // simulate unavailable communication
        comB.removeMessageHandler(hostB);
        // reconnect - simulate another window
        const hostB_2 = new BaseHost('B-host-2'); //hostA.open('B-host-2');
        comA.registerMessageHandler(hostB_2);
        const comB_api2 = { service: getMockApi() };
        new Communication(hostB_2, 'B', undefined, undefined, undefined, { apis: comB_api2 });

        await waitFor(() => {
            expect(onEventReconnect, 'reconnected').to.been.calledWith('B');
            expect(comB_api2.service.getListenersCount(), 'event handler re-register').to.eq(1);
        });

        comB_api2.service.invoke();

        await waitFor(() => {
            expect(onEventEmitterCall, 'invoked event after reconnect').to.have.have.callCount(2);
        });
    });
});

describe('environment-dependencies communication', () => {
    it('supports environment proxy for environment dependencies', async () => {
        const base = new Environment('base', 'node', 'multi');
        // const base = new AbstractEnvironment('base', 'node');
        const env1 = new Environment('env1', 'node', 'single', [base]);

        const env2 = new Environment('env2', 'node', 'single');
        class f extends Feature<'base'> {
            id = 'base' as const;
            api = {
                service1: Service.withType<{
                    echo: () => string[];
                }>()
                    .defineEntity(base)
                    .allowRemoteAccess(),
                slot1: Slot.withType<string>().defineEntity(base),
                service2: Service.withType<{
                    echo: () => string[];
                }>()
                    .defineEntity(env1)
                    .allowRemoteAccess(),
            };
            dependencies = [COM];
        }
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

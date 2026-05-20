import { createDisposables } from '@dazl/create-disposables';
import {
    Communication,
    Environment,
    WsClientHost,
    socketClientInitializer,
    type CallerIdentity,
    type DisposeMessage,
    type Message,
} from '@dazl/engine-core';
import { IdentityExtractor, WsServerHost } from '@dazl/engine-runtime-node';
import { createWaitForCall } from '@dazl/wait-for-call';
import { expect } from 'chai';
import { safeListeningHttpServer } from 'create-listening-server';
import type { Socket } from 'node:net';
import { waitFor } from 'promise-assist';
import sinon, { spy } from 'sinon';
import * as io from 'socket.io';

interface ICommunicationTestApi {
    sayHello: () => string;
    sayHelloWithDataAndParams: (name: string) => string;
}

describe('Socket communication', () => {
    let clientHost: WsClientHost;
    let serverHost: WsServerHost;
    let socketServer: io.Server | undefined;
    let serverTopology: Record<string, string> = {};
    let port: number;
    let nameSpace: io.Namespace;

    const disposables = createDisposables();
    const disposeAfterTest = <T extends { dispose: () => void }>(obj: T) => {
        disposables.add(() => obj.dispose());
        return obj;
    };
    afterEach(() => disposables.dispose());

    beforeEach(async () => {
        const { httpServer: server, port: servingPort } = await safeListeningHttpServer(3050);
        port = servingPort;
        socketServer = new io.Server(server, { cors: {} });
        nameSpace = socketServer.of('processing');
        serverTopology['server-host'] = `http://localhost:${port}/processing`;
        const connections = new Set<Socket>();
        disposables.add(async () => {
            await socketServer?.close();
            socketServer = undefined;
        });
        disposables.add(() => (serverTopology = {}));
        const onConnection = (connection: Socket): void => {
            connections.add(connection);
            disposables.add(() => {
                connections.delete(connection);
            });
        };
        server.on('connection', onConnection);
        disposables.add(() => {
            for (const connection of connections) {
                connection.destroy();
            }
        });

        clientHost = disposeAfterTest(new WsClientHost(serverTopology['server-host']));
        serverHost = disposeAfterTest(new WsServerHost(nameSpace));
        await clientHost.connected;
    });

    it('Should activate a function from the client communication on the server communication and receive response', async () => {
        const COMMUNICATION_ID = 'node-com';
        const clientCom = new Communication(clientHost, 'client-host', serverTopology);

        const serverCom = new Communication(serverHost, 'server-host');

        serverCom.registerAPI<ICommunicationTestApi>(
            { id: COMMUNICATION_ID },
            {
                sayHello: () => 'hello',
                sayHelloWithDataAndParams: (name: string) => `hello ${name}`,
            },
        );

        const methods = clientCom.apiProxy<ICommunicationTestApi>({ id: 'server-host' }, { id: COMMUNICATION_ID });
        expect(await methods.sayHello()).to.eq('hello');
    });

    it('Should activate a function with params from the client communication on the server communication and receive response', async () => {
        const COMMUNICATION_ID = 'node-com';
        const clientCom = new Communication(clientHost, 'client-host', serverTopology);

        const serverCom = new Communication(serverHost, 'server-host');

        serverCom.registerAPI<ICommunicationTestApi>(
            { id: COMMUNICATION_ID },
            {
                sayHello: () => 'hello',
                sayHelloWithDataAndParams: (name: string) => `hello ${name}`,
            },
        );

        const methods = clientCom.apiProxy<ICommunicationTestApi>({ id: 'server-host' }, { id: COMMUNICATION_ID });
        expect(await methods.sayHelloWithDataAndParams('test')).to.eq('hello test');
    });

    it('Should be able to subscribe/unsubscribe to server', async () => {
        const COMMUNICATION_ID = 'node-com';
        const clientCom = new Communication(clientHost, 'client-host', serverTopology);
        const serverCom = new Communication(serverHost, 'server-host');

        let data = 0;
        const listeners = new Set<(data: string) => void>();
        const subscribableApi = {
            getListenerCount() {
                return listeners.size;
            },
            sub(listener: (data: string) => void) {
                listeners.add(listener);
            },
            unsub(listener: (data: string) => void) {
                listeners.delete(listener);
            },
            invoke() {
                data++;
                listeners.forEach((cb) => cb(`${data}`));
            },
        };

        serverCom.registerAPI<typeof subscribableApi>({ id: COMMUNICATION_ID }, subscribableApi);

        const methods = clientCom.apiProxy<typeof subscribableApi>(
            { id: 'server-host' },
            { id: COMMUNICATION_ID },
            {
                sub: {
                    listener: true,
                    removeListener: 'unsub',
                },
                unsub: {
                    removeListener: 'sub',
                },
            },
        );

        const listener = spy();
        await methods.sub(listener);

        await methods.invoke();
        expect(listener.calledWith('1')).to.eql(true);
        await methods.invoke();
        expect(listener.calledWith('2')).to.eql(true);

        expect(await methods.getListenerCount()).to.eql(1);

        listener.resetHistory();
        await methods.unsub(listener);

        await methods.invoke();

        expect(listener.calledWith('3')).to.eql(false);
        expect(await methods.getListenerCount()).to.eql(0);
    });

    it('One client should get messages from 2 server communications', async () => {
        const COMMUNICATION_ID = 'node-com';
        const clientCom = new Communication(clientHost, 'client-host', {
            'server-host': serverTopology['server-host']!,
            'second-server-host': serverTopology['server-host']!,
        });

        const serverCom = new Communication(serverHost, 'server-host');
        const secondServerCom = new Communication(serverHost, 'second-server-host');

        serverCom.registerAPI<ICommunicationTestApi>(
            { id: COMMUNICATION_ID },
            {
                sayHello: () => 'hello',
                sayHelloWithDataAndParams: (name: string) => `hello ${name}`,
            },
        );

        secondServerCom.registerAPI<ICommunicationTestApi>(
            { id: COMMUNICATION_ID },
            {
                sayHello: () => 'bye',
                sayHelloWithDataAndParams: (name: string) => `bye ${name}`,
            },
        );

        const Server1Methods = clientCom.apiProxy<ICommunicationTestApi>(
            { id: 'server-host' },
            { id: COMMUNICATION_ID },
        );
        const Server2Methods = clientCom.apiProxy<ICommunicationTestApi>(
            { id: 'second-server-host' },
            { id: COMMUNICATION_ID },
        );

        expect(await Server1Methods.sayHelloWithDataAndParams('test')).to.eq('hello test');
        expect(await Server2Methods.sayHelloWithDataAndParams('test')).to.eq('bye test');
    });

    it('Two clients should get messages from 1 server communication', async () => {
        const COMMUNICATION_ID = 'node-com';
        const clientCom = new Communication(clientHost, 'client-host', serverTopology);

        const clientCom2 = new Communication(clientHost, 'client2-host', serverTopology);

        const serverCom = new Communication(serverHost, 'server-host');

        serverCom.registerAPI<ICommunicationTestApi>(
            { id: COMMUNICATION_ID },
            {
                sayHello: () => 'hello',
                sayHelloWithDataAndParams: (name: string) => `hello ${name}`,
            },
        );

        const Server1Methods = clientCom.apiProxy<ICommunicationTestApi>(
            { id: 'server-host' },
            { id: COMMUNICATION_ID },
        );
        const Server2Methods = clientCom2.apiProxy<ICommunicationTestApi>(
            { id: 'server-host' },
            { id: COMMUNICATION_ID },
        );

        expect(await Server1Methods.sayHelloWithDataAndParams('test')).to.eq('hello test');
        expect(await Server2Methods.sayHelloWithDataAndParams('test')).to.eq('hello test');
    });

    it('notifies if environment is disconnected', async () => {
        const spy = sinon.spy();
        const clientCom = new Communication(clientHost, 'client-host', serverTopology);
        const { id } = disposeAfterTest(
            await socketClientInitializer({
                communication: clientCom,
                env: new Environment('server-host', 'node', 'single'),
            }),
        );

        expect(id).to.not.eq(undefined);

        const host = clientCom.getEnvironmentHost(id);
        (host as WsClientHost).subscribers.on('disconnect', spy);
        await socketServer?.close();
        socketServer = undefined;
        await waitFor(
            () => {
                expect(spy.callCount).to.be.eq(1);
            },
            {
                timeout: 2_000,
            },
        );
    });

    it('notifies all connected environments if environment is disconnected', async () => {
        const { waitForCall: waitForServerCall, spy: spyServer } =
            createWaitForCall<(ev: { data: Message }) => void>('server');
        const { waitForCall: waitForClient1Call, spy: spyClient1 } =
            createWaitForCall<(ev: { data: Message }) => void>('client');
        const clientHost1 = disposeAfterTest(new WsClientHost(serverTopology['server-host']!));
        const clientHost2 = disposeAfterTest(new WsClientHost(serverTopology['server-host']!));
        const clientCom1 = new Communication(clientHost1, 'client-host1', serverTopology);
        const clientCom2 = new Communication(clientHost2, 'client-host2', serverTopology);
        new Communication(serverHost, 'server-host');
        disposeAfterTest(
            await socketClientInitializer({
                communication: clientCom1,
                env: {
                    env: 'server-host',
                },
            }),
        );
        disposeAfterTest(
            await socketClientInitializer({
                communication: clientCom2,
                env: {
                    env: 'server-host',
                },
            }),
        );
        clientCom1.registerEnv('client-host2', clientCom1.getEnvironmentHost('server-host')!);
        serverHost.addEventListener('message', spyServer);
        clientHost1.addEventListener('message', spyClient1);
        await clientHost2.dispose();
        await waitForServerCall(([arg]) => {
            const message = arg.data as DisposeMessage;
            expect(message.type).to.eql('dispose');
            expect(message.from).to.include('/client-host2');
            expect(message.origin).to.include('/client-host2');
        });
        await waitForClient1Call(([arg]) => {
            const message = arg.data as DisposeMessage;
            expect(message.type).to.eql('dispose');
            expect(message.origin).to.include('/client-host2');
            expect(message.from).to.equal('server-host');
        });
    });

    it('Should disconnect previous connection when same clientId reconnects', async () => {
        const stableClientId = 'stable-client-id';
        const disconnectSpy = sinon.spy();

        const firstClient = disposeAfterTest(
            new WsClientHost(serverTopology['server-host']!, { auth: { clientId: stableClientId } }),
        );
        await firstClient.connected;
        firstClient.subscribers.on('disconnect', disconnectSpy);

        expect(firstClient.isConnected(), 'first connected').to.eql(true);

        const secondClient = disposeAfterTest(
            new WsClientHost(serverTopology['server-host']!, { auth: { clientId: stableClientId } }),
        );
        await secondClient.connected;

        await waitFor(() => expect(firstClient.isConnected(), 'first disconnected').to.eql(false), { timeout: 2_000 });
        expect(disconnectSpy.callCount, 'first disconnected count').to.eq(1);
        expect(secondClient.isConnected(), 'second connected').to.eql(true);
    });

    describe('identity extraction', () => {
        beforeEach(() => {
            void serverHost.dispose();
        });

        async function connectClient(
            identityExtractor?: IdentityExtractor,
            clientOptions?: ConstructorParameters<typeof WsClientHost>[1],
        ) {
            const serverHost = disposeAfterTest(new WsServerHost(nameSpace, identityExtractor));
            const clientHost = disposeAfterTest(new WsClientHost(serverTopology['server-host']!, clientOptions));
            await clientHost.connected;
            return { serverHost, clientHost };
        }

        function collectMessages(host: WsServerHost): Message[] {
            const received: Message[] = [];
            host.addEventListener('message', ({ data }: { data: Message }) => {
                received.push(data);
            });
            return received;
        }

        async function makeCall(serverHost: WsServerHost, clientHost: WsClientHost) {
            const serverCom = new Communication(serverHost, 'server-host');
            const clientCom = new Communication(clientHost, 'client-host', serverTopology);
            serverCom.registerAPI<ICommunicationTestApi>(
                { id: 'test' },
                { sayHello: () => 'hi', sayHelloWithDataAndParams: (n) => n },
            );
            const methods = clientCom.apiProxy<ICommunicationTestApi>({ id: 'server-host' }, { id: 'test' });
            await methods.sayHello();
        }

        it('attaches extracted identity to incoming messages', async () => {
            const stableClientId = 'my-client-id';
            const identity: CallerIdentity = { userId: 'alice', role: 'admin' };
            const extractor = sinon.spy((_handshake: io.Socket['handshake'], _clientId: string) => identity);
            const { serverHost, clientHost } = await connectClient(extractor, { auth: { clientId: stableClientId } });
            const received = collectMessages(serverHost);

            await makeCall(serverHost, clientHost);

            const callMsg = received.find((m) => m.type === 'call');
            expect(callMsg?.callerIdentity).to.eql(identity);
            expect(extractor.firstCall.args[0]).to.have.property('auth');
            expect(extractor.firstCall.args[1]).to.eq(stableClientId);
        });

        it('does not attach callerIdentity when no identityExtractor is provided', async () => {
            const { serverHost, clientHost } = await connectClient();
            const received = collectMessages(serverHost);

            await makeCall(serverHost, clientHost);

            const callMsg = received.find((m) => m.type === 'call');
            expect(callMsg?.callerIdentity).to.eq(undefined);
        });

        it('connection succeeds and messages flow even when identityExtractor throws', async () => {
            const throwingExtractor: IdentityExtractor = () => {
                throw new Error('test error');
            };
            const consoleErrorStub = sinon.stub(console, 'error');
            try {
                const { serverHost, clientHost } = await connectClient(throwingExtractor);
                const received = collectMessages(serverHost);

                await makeCall(serverHost, clientHost);

                const callMsg = received.find((m) => m.type === 'call');
                expect(callMsg).to.not.eq(undefined);
                expect(callMsg?.callerIdentity).to.eq(undefined);
            } finally {
                consoleErrorStub.restore();
            }
        });

        it('uses updated identity when client reconnects with the same clientId', async () => {
            const stableClientId = 'stable-client';
            let currentIdentity: CallerIdentity = { role: 'admin' };
            const extractor: IdentityExtractor = () => ({ ...currentIdentity });

            const serverHost = disposeAfterTest(new WsServerHost(nameSpace, extractor));
            const serverCom = new Communication(serverHost, 'server-host');
            serverCom.registerAPI<ICommunicationTestApi>(
                { id: 'test' },
                { sayHello: () => 'hi', sayHelloWithDataAndParams: (n) => n },
            );

            // First client connects and makes a call
            const received: Message[] = [];
            serverHost.addEventListener('message', ({ data }: { data: Message }) => received.push(data));

            const clientHost1 = disposeAfterTest(
                new WsClientHost(serverTopology['server-host']!, { auth: { clientId: stableClientId } }),
            );
            await clientHost1.connected;
            const clientCom1 = new Communication(clientHost1, 'client-host', serverTopology);
            const methods1 = clientCom1.apiProxy<ICommunicationTestApi>({ id: 'server-host' }, { id: 'test' });
            await methods1.sayHello();

            const firstCallMsg = received.find((m) => m.type === 'call');
            expect(firstCallMsg?.callerIdentity).to.eql({ role: 'admin' });

            // Reconnect with same clientId but updated identity
            currentIdentity = { role: 'guest' };
            received.length = 0;

            const clientHost2 = disposeAfterTest(
                new WsClientHost(serverTopology['server-host']!, { auth: { clientId: stableClientId } }),
            );
            await clientHost2.connected;
            await waitFor(() => expect(clientHost1.isConnected()).to.eq(false), { timeout: 2_000 });

            const clientCom2 = new Communication(clientHost2, 'client-host2', serverTopology);
            const methods2 = clientCom2.apiProxy<ICommunicationTestApi>({ id: 'server-host' }, { id: 'test' });
            await methods2.sayHello();

            const secondCallMsg = received.find((m) => m.type === 'call');
            expect(secondCallMsg?.callerIdentity).to.eql({ role: 'guest' });
        });
    });
});

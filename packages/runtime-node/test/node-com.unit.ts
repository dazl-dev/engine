import {
    BaseHost,
    Communication,
    Environment,
    WsClientHost,
    socketClientInitializer,
    type DisposeMessage,
    type Message,
} from '@dazl/engine-core';
import { IPCHost, WsServerHost } from '@dazl/engine-runtime-node';
import { createDisposables } from '@dazl/create-disposables';
import { createWaitForCall } from '@dazl/wait-for-call';
import { expect } from 'chai';
import { safeListeningHttpServer } from 'create-listening-server';
import { fork } from 'node:child_process';
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
    let socketServer: io.Server;
    let serverTopology: Record<string, string> = {};
    let port: number;

    const disposables = createDisposables();
    afterEach(() => disposables.dispose());

    beforeEach(async () => {
        const { httpServer: server, port: servingPort } = await safeListeningHttpServer(3050);
        port = servingPort;
        socketServer = new io.Server(server, { cors: {} });
        const nameSpace = socketServer.of('processing');
        serverTopology['server-host'] = `http://localhost:${port}/processing`;
        const connections = new Set<Socket>();
        disposables.add(() => socketServer.close());
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

        clientHost = new WsClientHost(serverTopology['server-host']);
        serverHost = new WsServerHost(nameSpace);
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
        const { id } = await socketClientInitializer({
            communication: clientCom,
            env: new Environment('server-host', 'node', 'single'),
        });

        expect(id).to.not.eq(undefined);

        const host = clientCom.getEnvironmentHost(id);
        (host as WsClientHost).subscribers.on('disconnect', spy);
        await socketServer.close();
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
        const clientHost1 = new WsClientHost(serverTopology['server-host']!);
        const clientHost2 = new WsClientHost(serverTopology['server-host']!);
        const clientCom1 = new Communication(clientHost1, 'client-host1', serverTopology);
        const clientCom2 = new Communication(clientHost2, 'client-host2', serverTopology);
        new Communication(serverHost, 'server-host');
        await socketClientInitializer({
            communication: clientCom1,
            env: {
                env: 'server-host',
            },
        });
        await socketClientInitializer({
            communication: clientCom2,
            env: {
                env: 'server-host',
            },
        });
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
});

describe('IPC communication', () => {
    const disposables = createDisposables();
    afterEach(() => disposables.dispose());

    it('communication with forked process', async () => {
        const mainHost = new BaseHost();
        const communication = new Communication(mainHost, 'main');
        const forked = fork(new URL('./process-entry.js', import.meta.url));
        disposables.add(() => forked.kill());
        const host = new IPCHost(forked);
        communication.registerEnv('process', host);
        communication.registerMessageHandler(host);
        const proxy = communication.apiProxy<{ echo(): string }>(
            {
                id: 'process',
            },
            { id: 'myApi' },
        );

        expect(await proxy.echo()).to.eq('yo');
    });

    it('handles forked process closing', async () => {
        const mainHost = new BaseHost();
        const communication = new Communication(mainHost, 'main');
        const forked = fork(new URL('./process-entry.js', import.meta.url));
        const host = new IPCHost(forked);
        communication.registerEnv('process', host);
        communication.registerMessageHandler(host);
        const proxy = communication.apiProxy<{ echo(): string }>(
            {
                id: 'process',
            },
            { id: 'myApi' },
        );

        forked.kill();
        const { waitForCall, spy } = createWaitForCall<(e: Error) => void>();
        proxy.echo().catch(spy);
        await waitForCall((args) => {
            expect(args[0].message).to.have.string(
                'Remote call failed in "process" - environment disconnected at "main"',
            );
        });
    });
});

import { fork } from 'child_process';
import { join } from 'path';
import type { Socket } from 'net';
import { safeListeningHttpServer } from 'create-listening-server';
import io from 'socket.io';

import { expect } from 'chai';
import sinon from 'sinon';
import { waitFor } from 'promise-assist';

import {
    Communication,
    WsClientHost,
    socketClientInitializer,
    BaseHost,
    DisposeMessage,
    Message,
} from '@wixc3/engine-core';
import { IPCHost, WsServerHost } from '@wixc3/engine-core-node';
import { createDisposables } from '@wixc3/create-disposables';
import { createWaitForCall } from '@wixc3/wait-for-call';

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

    beforeEach(async () => {
        const { httpServer: server, port: servingPort } = await safeListeningHttpServer(3050);
        port = servingPort;
        socketServer = new io.Server(server, { cors: {} });
        const nameSpace = socketServer.of('processing');
        serverTopology['server-host'] = `http://localhost:${port}/processing`;
        const connections = new Set<Socket>();
        disposables.add(() => new Promise((res) => socketServer.close(res)));
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

    afterEach(disposables.dispose);

    it('Should activate a function from the client communication on the server communication and receive response', async () => {
        const COMMUNICATION_ID = 'node-com';
        const clientCom = new Communication(clientHost, 'client-host', serverTopology);

        const serverCom = new Communication(serverHost, 'server-host');

        serverCom.registerAPI<ICommunicationTestApi>(
            { id: COMMUNICATION_ID },
            {
                sayHello: () => 'hello',
                sayHelloWithDataAndParams: (name: string) => `hello ${name}`,
            }
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
            }
        );

        const methods = clientCom.apiProxy<ICommunicationTestApi>({ id: 'server-host' }, { id: COMMUNICATION_ID });
        expect(await methods.sayHelloWithDataAndParams('test')).to.eq('hello test');
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
            }
        );

        secondServerCom.registerAPI<ICommunicationTestApi>(
            { id: COMMUNICATION_ID },
            {
                sayHello: () => 'bye',
                sayHelloWithDataAndParams: (name: string) => `bye ${name}`,
            }
        );

        const Server1Methods = clientCom.apiProxy<ICommunicationTestApi>(
            { id: 'server-host' },
            { id: COMMUNICATION_ID }
        );
        const Server2Methods = clientCom.apiProxy<ICommunicationTestApi>(
            { id: 'second-server-host' },
            { id: COMMUNICATION_ID }
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
            }
        );

        const Server1Methods = clientCom.apiProxy<ICommunicationTestApi>(
            { id: 'server-host' },
            { id: COMMUNICATION_ID }
        );
        const Server2Methods = clientCom2.apiProxy<ICommunicationTestApi>(
            { id: 'server-host' },
            { id: COMMUNICATION_ID }
        );

        expect(await Server1Methods.sayHelloWithDataAndParams('test')).to.eq('hello test');
        expect(await Server2Methods.sayHelloWithDataAndParams('test')).to.eq('hello test');
    });

    it('notifies if environment is disconnected', async () => {
        const spy = sinon.spy();
        const clientCom = new Communication(clientHost, 'client-host', serverTopology);
        const { onDisconnect } = await socketClientInitializer({
            communication: clientCom,
            env: {
                env: 'server-host',
                endpointType: 'single',
                envType: 'node',
            },
        });

        expect(onDisconnect).to.not.eq(undefined);

        onDisconnect(spy);
        socketServer.close();
        await waitFor(
            () => {
                expect(spy.callCount).to.be.eq(1);
            },
            {
                timeout: 2_000,
            }
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
                endpointType: 'single',
                envType: 'node',
            },
        });
        await socketClientInitializer({
            communication: clientCom2,
            env: {
                env: 'server-host',
                endpointType: 'single',
                envType: 'node',
            },
        });
        clientCom1.registerEnv('client-host2', clientCom1.getEnvironmentHost('server-host')!);
        serverHost.addEventListener('message', spyServer);
        clientHost1.addEventListener('message', spyClient1);
        clientHost2.dispose();
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

    afterEach(disposables.dispose);
    it('communication with forked process', async () => {
        const mainHost = new BaseHost();
        const communication = new Communication(mainHost, 'main');
        const forked = fork(join(__dirname, 'process-entry.ts'), [], {
            execArgv: '-r @ts-tools/node/r'.split(' '),
            cwd: process.cwd(),
        });
        disposables.add(() => forked.kill());
        const host = new IPCHost(forked);
        communication.registerEnv('process', host);
        communication.registerMessageHandler(host);
        const proxy = communication.apiProxy<{ echo(): string }>(
            {
                id: 'process',
            },
            { id: 'myApi' }
        );

        expect(await proxy.echo()).to.eq('yo');
    });
});

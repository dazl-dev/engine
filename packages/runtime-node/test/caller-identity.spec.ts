import { createDisposables } from '@dazl/create-disposables';
import { BaseHost, Communication, WsClientHost } from '@dazl/engine-core';
import { NodeEnvManager, type NodeEnvsFeatureMapping } from '@dazl/engine-runtime-node';
import { expect } from 'chai';
import { cEnv } from '../test-kit/feature/envs.js';
import { IdentityService } from '../test-kit/feature/types.js';

describe('Caller identity propagation with autoLaunch', () => {
    const disposables = createDisposables();
    const disposeAfterTest = <T extends { dispose: () => void }>(obj: T) => {
        disposables.add(() => obj.dispose());
        return obj;
    };

    afterEach(() => disposables.dispose());

    /**
     * Cross-process: client -> autoLaunched gateway -> worker-thread env.
     */
    it('propagates caller identity from client to worker-thread env', async () => {
        const featureEnvironmentsMapping: NodeEnvsFeatureMapping = {
            featureToEnvironments: {
                'caller-identity': [cEnv.env],
            },
            availableEnvironments: {
                [cEnv.env]: { env: cEnv.env, endpointType: 'single', envType: 'node' },
            },
        };

        const meta = { url: import.meta.resolve('../test-kit/entrypoints/') };
        const manager = new NodeEnvManager(meta, featureEnvironmentsMapping);
        disposables.add(() => manager.dispose());

        const { port: gatewayPort } = await manager.autoLaunch(new Map([['feature', 'caller-identity']]), {
            identityExtractor: (handshake) => ({ userId: handshake.auth?.userId ?? 'anonymous' }),
        });

        const clientHost = disposeAfterTest(
            new WsClientHost(`http://localhost:${gatewayPort}`, { auth: { userId: 'worker-user' } }),
        );
        await clientHost.connected;
        const clientCom = disposeAfterTest(new Communication(new BaseHost(), 'client-host'));
        clientCom.registerEnv(cEnv.env, clientHost);
        clientCom.registerMessageHandler(clientHost);

        const api = clientCom.apiProxy<IdentityService>({ id: cEnv.env }, { id: 'caller-identity.identityService' });

        expect(await api.whoAmI()).to.deep.equal({ userId: 'worker-user' });
    });
});

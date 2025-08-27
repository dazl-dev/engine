import { BaseHost, Communication, declareComEmitter } from '@dazl/engine-core';
import * as chai from 'chai';
import { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { stub } from 'sinon';
import sinonChai from 'sinon-chai';

chai.use(sinonChai);
chai.use(chaiAsPromised);

class EmitterService {
    listeners = new Set<(s: string) => void>();
    dispatch(v: string) {
        for (const s of this.listeners) {
            s(v);
        }
    }
    on(fn: (...args: any[]) => void) {
        this.listeners.add(fn);
    }
    off(fn: (...args: any[]) => void) {
        this.listeners.delete(fn);
    }
    removeAll() {
        this.listeners.clear();
    }
}

describe('com emitter service', () => {
    it('(on, off, removeAll)', async () => {
        const host = new BaseHost();
        const main = new Communication(host, 'main');

        const host2 = host.open();
        const main2 = new Communication(host2, 'main2');

        main.registerEnv('main2', host2);
        const emitterServiceId = { id: 'EmitterService' };
        const api = new EmitterService();
        main2.registerAPI(emitterServiceId, api);

        const proxy = main.apiProxy<EmitterService>(Promise.resolve({ id: 'main2' }), emitterServiceId, {
            ...declareComEmitter<EmitterService>('on', 'off', 'removeAll'),
        });

        const testListenerStub = stub();

        await proxy.on(testListenerStub);

        api.dispatch('');

        expect(api.listeners.size, 'only one listener exists on the other side').to.be.equal(1);
        expect(testListenerStub.callCount).to.be.equal(1);

        await proxy.off(testListenerStub);
        expect(api.listeners.size).to.be.equal(0);

        await proxy.on(testListenerStub);

        api.dispatch('');

        expect(api.listeners.size).to.be.equal(1);
        expect(testListenerStub.callCount).to.be.equal(2);

        await proxy.removeAll();
        expect(api.listeners.size).to.be.equal(0);

        api.dispatch('');
        expect(testListenerStub.callCount, 'no listener calls').to.be.equal(2);
    });

    it('throw on multiple same instance listeners', async () => {
        const host = new BaseHost();
        const main = new Communication(host, 'main');

        const host2 = host.open();
        const main2 = new Communication(host2, 'main2');

        main.registerEnv('main2', host2);
        const emitterServiceId = { id: 'EmitterService' };
        const api = new EmitterService();
        main2.registerAPI(emitterServiceId, api);

        const proxy = main.apiProxy<EmitterService>(Promise.resolve({ id: 'main2' }), emitterServiceId, {
            ...declareComEmitter<EmitterService>('on', 'off', 'removeAll'),
        });

        const testListenerStub = stub();

        await proxy.on(testListenerStub);

        await expect(proxy.on(testListenerStub)).to.eventually.rejectedWith(
            'Cannot register Listener "main__main2_EmitterService@on" twice',
        );
    });
});

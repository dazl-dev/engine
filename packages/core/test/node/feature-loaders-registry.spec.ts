import { FeatureLoadersRegistry, Feature, type IFeatureLoader } from '@dazl/engine-core';
import * as chai from 'chai';
import { expect } from 'chai';
import { spy } from 'sinon';
import sinon from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import { waitFor } from 'promise-assist';
chai.use(sinon);
chai.use(chaiAsPromised);

describe('Feature loader registry', () => {
    it('loads a feature', async () => {
        const loaded = spy();
        class f extends Feature<'test'> {
            id = 'test' as const;
            api = {};
        }
        const featureLoader: IFeatureLoader = {
            depFeatures: [],
            load: () => {
                loaded();
                return f;
            },
            resolvedContexts: {},
            preload: () => Promise.resolve([]),
        };

        const registry = new FeatureLoadersRegistry();
        registry.register('test', featureLoader);
        expect(registry.get('test')).to.eq(featureLoader);
        expect(loaded).to.have.callCount(0);
        await registry.loadEntryFeature('test', {});
        expect(loaded).to.have.callCount(1);
    });

    it('loads a feature with dependencies', async () => {
        const loaded = spy();
        const depLoaded = spy();
        class f extends Feature<'test'> {
            id = 'test' as const;
            api = {};
        }
        const featureLoader: IFeatureLoader = {
            depFeatures: ['dep'],
            load: () => {
                loaded();
                return f;
            },
            resolvedContexts: {},
            preload: () => Promise.resolve([]),
        };

        const depFeatureLoader: IFeatureLoader = {
            depFeatures: [],
            load: () => {
                depLoaded();
                return f;
            },
            resolvedContexts: {},
            preload: () => Promise.resolve([]),
        };

        const registry = new FeatureLoadersRegistry();
        registry.register('test', featureLoader);
        registry.register('dep', depFeatureLoader);
        await registry.loadEntryFeature('test', {});
        expect(depLoaded).to.have.callCount(1);
        expect(loaded).to.have.callCount(1);
    });

    it('does not load a feature without its dependencies', async () => {
        const loaded = spy();
        class f extends Feature<'test'> {
            id = 'test' as const;
            api = {};
        }
        const featureLoader: IFeatureLoader = {
            depFeatures: ['dep'],
            load: () => {
                loaded();
                return f;
            },
            resolvedContexts: {},
            preload: () => Promise.resolve([]),
        };

        const depFeatureLoader: IFeatureLoader = {
            depFeatures: [],
            load: () => {
                return f;
            },
            resolvedContexts: {},
            preload: () => Promise.resolve([]),
        };

        const registry = new FeatureLoadersRegistry();
        registry.register('test', featureLoader);
        const p = registry.loadEntryFeature('test', {});
        const callbackCall = spy();
        void p.then(callbackCall);
        await waitFor(() => expect(callbackCall).to.have.callCount(0), { delay: 100 });
        registry.register('dep', depFeatureLoader);
        await waitFor(() => expect(callbackCall).to.have.callCount(1));
    });

    it('retrieves all feature deep dependencies', async () => {
        class f extends Feature<'test'> {
            id = 'test' as const;
            api = {};
        }
        const featureLoader: IFeatureLoader = {
            depFeatures: ['dep'],
            load: () => {
                return f;
            },
            resolvedContexts: {},
            preload: () => Promise.resolve([]),
        };
        const dep: IFeatureLoader = {
            depFeatures: ['dep1', 'dep2'],
            load: () => {
                return f;
            },
            resolvedContexts: {},
            preload: () => Promise.resolve([]),
        };
        const dep1: IFeatureLoader = {
            depFeatures: ['dep3'],
            load: () => {
                return f;
            },
            resolvedContexts: {},
            preload: () => Promise.resolve([]),
        };
        const dep2: IFeatureLoader = {
            depFeatures: ['dep4'],
            load: () => {
                return f;
            },
            resolvedContexts: {},
            preload: () => Promise.resolve([]),
        };

        const dep3: IFeatureLoader = {
            depFeatures: [],
            load: () => {
                return f;
            },
            resolvedContexts: {},
            preload: () => Promise.resolve([]),
        };

        const dep4: IFeatureLoader = {
            depFeatures: ['dep3'],
            load: () => {
                return f;
            },
            resolvedContexts: {},
            preload: () => Promise.resolve([]),
        };

        const registry = new FeatureLoadersRegistry();
        registry.register('test', featureLoader);
        registry.register('dep', dep);
        registry.register('dep1', dep1);
        registry.register('dep2', dep2);
        registry.register('dep3', dep3);
        registry.register('dep4', dep4);

        expect(await registry.getFeatureDependencies('test')).to.equal;
        ['test', 'dep', 'dep1', 'dep2', 'dep3', 'dep4'];

        expect(await registry.getFeatureDependencies('dep2')).to.equal;
        ['dep2', 'dep3', 'dep4'];
    });
});

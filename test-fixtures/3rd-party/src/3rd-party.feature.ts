import { Environment, Feature } from '@dazl/engine-core';

export const MAIN = new Environment('main', 'window', 'single');

export default class TestFeature extends Feature<'TestFeature'> {
    id = 'TestFeature' as const;
    api = {};
}

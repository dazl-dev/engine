import { COM, Environment, Feature, Service } from '@dazl/engine-core';

export const NODE_1 = new Environment('node_1', 'node', 'single');
export const NODE_2 = new Environment('node_2', 'node', 'single');
export const MAIN = new Environment('main', 'window', 'single');

export default class XTestFeature extends Feature<'XTestFeature'> {
    id = 'XTestFeature' as const;
    api = {
        nodeEnv1: Service.withType<{
            getPid: () => number;
        }>()
            .defineEntity(NODE_1)
            .allowRemoteAccess(),
        nodeEnv2: Service.withType<{
            getPid: () => number;
        }>()
            .defineEntity(NODE_2)
            .allowRemoteAccess(),
    };
    dependencies = [COM];
}

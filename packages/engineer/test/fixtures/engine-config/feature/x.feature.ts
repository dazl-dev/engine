import { COM, Environment, Feature, Service } from '@wixc3/engine-core';

export const NODE_1 = new Environment('node_1', 'node', 'single');
export const NODE_2 = new Environment('node_2', 'node', 'single');
export const MAIN = new Environment('main', 'window', 'single');

export default new Feature({
    id: 'XTestFeature',
    api: {
        node_env_1: Service.withType<{ getPid: () => number }>().defineEntity(NODE_1).allowRemoteAccess(),
        node_env_2: Service.withType<{ getPid: () => number }>().defineEntity(NODE_2).allowRemoteAccess(),
    },
    dependencies: [COM],
});

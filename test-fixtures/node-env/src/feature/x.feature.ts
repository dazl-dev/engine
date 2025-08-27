import { COM, Config, Environment, Feature, Service } from '@dazl/engine-core';
export const mainEnv = new Environment('main', 'window', 'single');
export const serverEnv = new Environment('server', 'node', 'single');

export default class XTestFeature extends Feature<'XTestFeature'> {
    id = 'XTestFeature' as const;
    api = {
        echoService: Service.withType<{
            echo: () => string;
        }>()
            .defineEntity(serverEnv)
            .allowRemoteAccess(),
        config: Config.withType<{
            value: string;
        }>().defineEntity({ value: 'Hello' }, undefined, serverEnv),
    };
    dependencies = [COM];
}

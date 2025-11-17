import { COM, Environment, Feature, Service } from '@dazl/engine-core';

export const serverEnv = new Environment('server', 'node', 'single');

export default class DefaultArgsEcho extends Feature<'defaultArgsEcho'> {
    id = 'defaultArgsEcho' as const;
    api = {
        echoService: Service.withType<{ echo: (s?: string) => string }>().defineEntity(serverEnv).allowRemoteAccess(),
    };
    dependencies = [COM];
}

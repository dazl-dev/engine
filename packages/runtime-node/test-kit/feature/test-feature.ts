import { COM, Feature, Service } from '@dazl/engine-core';
import { aEnv, bEnv } from './envs.js';
import { EchoService } from './types.js';

export default class TestFeature extends Feature<'test-feature'> {
    id = 'test-feature' as const;
    dependencies = [COM];
    api = {
        echoAService: Service.withType<EchoService>().defineEntity(aEnv).allowRemoteAccess(),
        echoBService: Service.withType<EchoService>().defineEntity(bEnv).allowRemoteAccess(),
    };
}

import { COM, Feature, Service } from '@dazl/engine-core';
import { cEnv } from './envs.js';
import { IdentityService } from './types.js';

export default class CallerIdentityFeature extends Feature<'caller-identity'> {
    id = 'caller-identity' as const;
    dependencies = [COM];
    api = {
        identityService: Service.withType<IdentityService>().defineEntity(cEnv).allowRemoteAccess(),
    };
}

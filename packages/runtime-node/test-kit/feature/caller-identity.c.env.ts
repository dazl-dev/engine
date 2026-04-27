import { getCurrentCaller } from '@dazl/engine-core';
import { cEnv } from './envs.js';
import CallerIdentityFeature from './caller-identity.feature.js';

CallerIdentityFeature.setup(cEnv, () => {
    return {
        identityService: {
            whoAmI: () => getCurrentCaller(),
        },
    };
});

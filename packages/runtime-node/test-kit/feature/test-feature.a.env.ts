import { aEnv } from './envs.js';
import TestFeature from './test-feature.js';

TestFeature.setup(aEnv, ({ echoBService }) => {
    return {
        echoAService: {
            echo: () => 'a',
            echoChained: async () => {
                return echoBService.echo();
            },
        },
    };
});

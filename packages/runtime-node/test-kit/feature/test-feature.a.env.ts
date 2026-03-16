import { aEnv } from './envs.js';
import TestFeature from './test-feature.js';
import { getActivateValue } from '../entrypoints/a.node.js';

TestFeature.setup(aEnv, ({ echoBService }) => {
    return {
        echoAService: {
            echo: () => 'a',
            echoChained: async () => {
                return echoBService.echo();
            },
            getActivateValue,
        },
    };
});

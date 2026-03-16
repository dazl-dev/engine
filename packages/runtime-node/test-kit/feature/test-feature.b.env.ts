import { bEnv } from './envs.js';
import TestFeature from './test-feature.js';
import { getActivateValue } from '../entrypoints/b.node.js';

TestFeature.setup(bEnv, ({ echoAService }) => {
    return {
        echoBService: {
            echo: () => 'b',
            echoChained: async () => {
                return echoAService.echo();
            },
            getActivateValue,
        },
    };
});

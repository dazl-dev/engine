import { socketClientInitializer } from '@dazl/engine-core';
import sampleFeature, { MAIN, NODE_1, NODE_2 } from './x.feature.js';

sampleFeature.setup(MAIN, ({ nodeEnv1, nodeEnv2, run }, { COM: { communication } }) => {
    document.body.textContent = `pid_1;$pid_2`;
    run(async () => {
        await socketClientInitializer({ communication, env: NODE_1 });
        await socketClientInitializer({ communication, env: NODE_2 });
        const pid1 = await nodeEnv1.getPid();
        const pid2 = await nodeEnv2.getPid();
        document.body.textContent = `${pid1};${pid2}`;
    });
});

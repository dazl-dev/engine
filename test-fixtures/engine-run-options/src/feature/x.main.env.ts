import sampleFeature, { MAIN, PROC } from './x.feature.js';
import { socketClientInitializer } from '@dazl/engine-core';

sampleFeature.setup(MAIN, ({ run, passedOptions }, { COM: { communication } }) => {
    run(async () => {
        await socketClientInitializer({ communication, env: PROC });
        document.body.textContent = JSON.stringify(await passedOptions.getOptions());
    });
});

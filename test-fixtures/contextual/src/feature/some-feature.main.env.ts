import { socketClientInitializer, webWorkerInitializer, initializeContextualEnv } from '@dazl/engine-core';
import { contextualEnv, mainEnv } from './some-feature.feature.js';
import sampleFeature from './some-feature.feature.js';

sampleFeature.setup(mainEnv, ({ run, serverService }, { COM: { communication } }) => {
    run(async () => {
        await initializeContextualEnv({
            communication,
            env: contextualEnv,
            envInitializers: {
                server: socketClientInitializer,
                webworker: webWorkerInitializer,
            },
        });

        document.body.innerText = await serverService.echo();
    });
});

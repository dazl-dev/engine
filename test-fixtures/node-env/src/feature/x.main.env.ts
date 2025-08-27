import { socketClientInitializer } from '@dazl/engine-core';
import { mainEnv, serverEnv } from './x.feature.js';
import sampleFeature from './x.feature.js';

sampleFeature.setup(mainEnv, ({ run, echoService }, { COM: { communication } }) => {
    const echoValue = document.createElement('div');

    echoValue.id = 'echoValue';

    document.body.append(echoValue);

    run(async () => {
        await socketClientInitializer({ communication, env: serverEnv });
        echoValue.textContent = await echoService.echo();
    });
});

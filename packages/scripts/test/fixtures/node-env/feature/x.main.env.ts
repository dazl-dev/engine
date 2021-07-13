import { socketClientInitializer } from '@wixc3/engine-core';
import { mainEnv, serverEnv } from './x.feature';
import sampleFeature from './x.feature';

sampleFeature.setup(mainEnv, ({ run, echoService }, { COM: { communication } }) => {
    const echoValue = document.createElement('div');

    echoValue.id = 'echoValue';

    document.body.append(echoValue);

    run(async () => {
        await socketClientInitializer({ communication, env: serverEnv });
        echoValue.textContent = await echoService.echo();
    });
});

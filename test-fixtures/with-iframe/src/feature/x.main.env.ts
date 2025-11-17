import { iframeInitializer } from '@dazl/engine-core';
import { mainEnv, iframeEnv } from './x.feature.js';
import sampleFeature from './x.feature.js';

sampleFeature.setup(mainEnv, ({ run, echoService }, { COM: { communication } }) => {
    const myFrame = document.createElement('iframe');
    myFrame.id = 'iframe';
    document.body.append(myFrame);

    run(async () => {
        await iframeInitializer({
            communication,
            env: iframeEnv,
            iframeElement: myFrame,
        });
        await echoService.echo('echo');
    });
});

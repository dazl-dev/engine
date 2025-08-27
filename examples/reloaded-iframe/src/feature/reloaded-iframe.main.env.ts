import { iframeInitializer } from '@dazl/engine-core';
import ReloadedIframe, { iframeEnv, mainEnv } from './reloaded-iframe.feature.js';
import { contentId, echoBtnId, refreshBtnId, timesRefreshedId } from '../consts.js';

ReloadedIframe.setup(mainEnv, ({ run, echoService }, { COM }) => {
    const div = document.createElement('div');
    const timesRefreshed = document.createElement('div');
    const echoButton = document.createElement('button');
    const refreshIframeButton = document.createElement('button');
    let refreshCounter = 0;

    div.id = contentId;
    echoButton.id = echoBtnId;
    refreshIframeButton.id = refreshBtnId;
    timesRefreshed.id = timesRefreshedId;

    div.innerText = `document was called 0 times`;
    timesRefreshed.innerText = `document was refreshed ${refreshCounter} times`;
    echoButton.innerText = 'echo';
    refreshIframeButton.innerText = 'refresh';

    document.body.append(div, echoButton, refreshIframeButton, timesRefreshed);
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);

    run(async () => {
        const envToken = await iframeInitializer({
            communication: COM.communication,
            env: iframeEnv,
            iframeElement: iframe,
        });

        echoButton.onclick = async () => {
            await echoService.get(envToken).echo();
        };
        refreshIframeButton.onclick = () => {
            iframe.contentWindow!.location.reload();
        };

        iframe.onload = () => {
            timesRefreshed.innerText = `document was refreshed ${++refreshCounter} times`;
        };

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        echoService.get(envToken).onEcho((times) => {
            div.innerText = `document was called ${times} times`;
        });
    });
});

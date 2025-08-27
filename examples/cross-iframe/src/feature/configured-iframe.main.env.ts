import { FETCH_OPTIONS_PARAM_NAME, iframeInitializer, installRunOptionsInitMessageHandler } from '@dazl/engine-core';
import { mainEnv, iframeEnv } from './echo.feature.js';
import fixture from './configured-iframe.feature.js';

fixture.setup(mainEnv, ({ run }, { COM: { communication }, echoFeature: { echoService } }) => {
    const myFrame = document.createElement('iframe');
    myFrame.id = 'iframe';
    document.body.append(myFrame);
    const fConfigs = [
        { buttonTestId: 'cross-origin', hostname: '127.0.0.1', params: '&test=p0' },
        { buttonTestId: 'another-cross-origin', hostname: '127.0.0.1', params: '&test=p1' },
        { buttonTestId: 'same-origin', hostname: 'localhost', params: '&test=p2' },
        {
            buttonTestId: 'fetch-from-parent',
            hostname: '127.0.0.1',
            params: `&test=p3&${FETCH_OPTIONS_PARAM_NAME}=true`,
        },
    ];

    for (let i = 0; i < fConfigs.length; i++) {
        const fConfig = fConfigs[i]!;
        const button = document.createElement('button');
        const url = new URL(window.location.href);
        url.pathname = 'iframe.html';
        url.hostname = fConfig.hostname;
        url.search = url.search + fConfig.params;
        button.appendChild(document.createTextNode(url.toString()));
        button.id = fConfig.buttonTestId;
        button.className = `init-iframe-button-${i}`;
        button.onclick = async () => {
            if (url.searchParams.get(FETCH_OPTIONS_PARAM_NAME) === 'true' && myFrame.contentWindow) {
                const removeListener = installRunOptionsInitMessageHandler(myFrame.contentWindow, (postBack) => {
                    removeListener();
                    postBack(url.searchParams.toString());
                });
            }
            const { id } = await iframeInitializer({
                communication,
                env: iframeEnv,
                iframeElement: myFrame,
                src: url.toString(),
            });
            void echoService.get({ id }).echo(id);
        };
        document.body.append(button);
    }
    run(async () => {
        const { id } = await iframeInitializer({
            communication,
            env: iframeEnv,
            iframeElement: myFrame,
        });
        await echoService.get({ id }).echo(id);
    });
});

import { iframeInitializer } from '@dazl/engine-core';
import BaseAppFeature, { client, iframe } from './base-web-application.feature.js';

BaseAppFeature.setup(client, ({ clientSlot, baseAppConfig }, { COM: { communication } }) => {
    const registeredSlots = [...clientSlot];
    clientSlot.subscribe((e) => {
        registeredSlots.push(e);
        clientSlotValue.innerText = registeredSlots.join(',');
    });
    const clientSlotTitle = document.createElement('h1');
    clientSlotTitle.id = 'client-slot-title';
    clientSlotTitle.innerText = 'Client Slot Values';

    const clientSlotValue = document.createElement('span');
    clientSlotValue.innerText = [...clientSlot].join(',');

    const configurableValue = document.createElement('span');
    configurableValue.id = 'configurable';
    configurableValue.innerText = baseAppConfig.message;

    const iframeElement = document.createElement('iframe');
    iframeElement.id = 'iframe-container';

    document.body.append(clientSlotTitle, clientSlotValue, configurableValue, iframeElement);

    iframeInitializer({ communication, env: iframe, iframeElement }).catch(console.error);
});

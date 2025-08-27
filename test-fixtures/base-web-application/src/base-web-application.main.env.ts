import { socketClientInitializer, iframeInitializer } from '@dazl/engine-core';
import BaseAppFeature, { client, server, iframe } from './base-web-application.feature.js';

BaseAppFeature.setup(client, ({ clientSlot, dataProvider }, { COM: { communication } }) => {
    socketClientInitializer({ communication, env: server }).catch(console.error);

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

    const serverSlotTitle = document.createElement('h1');
    serverSlotTitle.id = 'server-slot-title';
    serverSlotTitle.innerText = 'Server Slot Values';

    const serverSlotValue = document.createElement('span');
    serverSlotValue.innerText = '';
    serverSlotValue.id = 'server-slot-value';

    const getSlotValues = document.createElement('button');
    getSlotValues.onclick = async () => {
        const values = await dataProvider.getData();
        serverSlotValue.innerText = values.join(',');
    };
    getSlotValues.innerText = 'Get server slot values';
    getSlotValues.id = 'server-slot';

    const iframeElement = document.createElement('iframe');
    iframeElement.id = 'iframe-container';

    document.body.append(
        clientSlotTitle,
        clientSlotValue,
        serverSlotTitle,
        serverSlotValue,
        getSlotValues,
        iframeElement,
    );

    iframeInitializer({ communication, env: iframe, iframeElement }).catch(console.error);
});

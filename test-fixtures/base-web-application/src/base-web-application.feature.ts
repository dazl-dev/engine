import { Environment, Feature, Slot } from '@wixc3/engine-core';
import { COM, Service } from '@wixc3/engine-com';

export const client = new Environment('main', 'window', 'single');
export const server = new Environment('server', 'node', 'single');
export const iframe = new Environment('iframe', 'iframe', 'single');

export default new Feature({
    id: 'baseApp',
    api: {
        clientSlot: Slot.withType<string>().defineEntity(client),
        serverSlot: Slot.withType<string>().defineEntity(server),
        iframeSlot: Slot.withType<string>().defineEntity(iframe),
        dataProvider: Service.withType<{ getData(): string[] }>().defineEntity(server).allowRemoteAccess(),
    },
    dependencies: [COM],
});

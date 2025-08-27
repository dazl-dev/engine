import { COM, Environment, Feature, Service, Slot } from '@dazl/engine-core';

export const client = new Environment('main', 'window', 'single');
export const server = new Environment('server', 'node', 'single');
export const iframe = new Environment('iframe', 'iframe', 'single');

export default class BaseApp extends Feature<'baseApp'> {
    id = 'baseApp' as const;
    api = {
        clientSlot: Slot.withType<string>().defineEntity(client),
        serverSlot: Slot.withType<string>().defineEntity(server),
        iframeSlot: Slot.withType<string>().defineEntity(iframe),
        dataProvider: Service.withType<{
            getData(): string[];
        }>()
            .defineEntity(server)
            .allowRemoteAccess(),
    };
    dependencies = [COM];
}

import { COM, Environment, Feature, Service } from '@dazl/engine-core';
export const mainEnv = new Environment('main', 'window', 'single');
export const iframeEnv = new Environment('iframe', 'iframe', 'multi');
export interface IEchoService {
    onEcho(handler: (times: number) => void): void;
    echo(): void;
}

export default class IframeReload extends Feature<'iframeReload'> {
    id = 'iframeReload' as const;
    api = {
        echoService: Service.withType<IEchoService>()
            .defineEntity(iframeEnv)
            .allowRemoteAccess({
                onEcho: {
                    listener: true,
                },
            }),
    };
    dependencies = [COM];
}

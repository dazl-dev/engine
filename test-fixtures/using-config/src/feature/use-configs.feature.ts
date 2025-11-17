import { Config, Environment, Feature } from '@dazl/engine-core';

export const main = new Environment('main', 'window', 'single');

export interface IDefaultConfig {
    echoText: string;
}

export default class WithConfigs extends Feature<'withConfigs'> {
    id = 'withConfigs' as const;
    api = {
        config: new Config<IDefaultConfig>({ echoText: 'hello' }),
    };
}

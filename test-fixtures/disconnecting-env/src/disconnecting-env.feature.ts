import { Config, Feature, Environment, COM } from '@dazl/engine-core';

export const serverEnv = new Environment('server', 'node', 'single');

export type ErrorTypeConfig = {
    throwError: 'exception' | 'exit' | 'promise-reject' | false;
    handleUncaught: boolean;
};

export default class DisconnectingEnv extends Feature<'disconnecting-env'> {
    id = 'disconnecting-env' as const;
    api = {
        errorsConfig: Config.withType<ErrorTypeConfig>().defineEntity({
            throwError: 'exit',
            handleUncaught: false,
        }),
    };
    dependencies = [COM];
}

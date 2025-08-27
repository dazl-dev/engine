import {
    ContextualEnvironment,
    Environment,
    flattenTree,
    type AnyEnvironment,
    type EnvironmentMode,
    type MultiEnvironment,
} from '@dazl/engine-core';
import type { IEnvironmentDescriptor } from '../types.js';

const convertEnvToIEnv = (env: AnyEnvironment): IEnvironmentDescriptor => {
    const { env: name, envType: type } = env;
    return {
        name,
        type,
        env,
        flatDependencies: [],
    };
};

export function parseEnv<ENV extends AnyEnvironment>(env: ENV): IEnvironmentDescriptor {
    type MultiEnvironmentType = MultiEnvironment<ENV['envType']>;
    const [parsedEnv, ...dependencies] = [
        ...flattenTree<ENV | MultiEnvironmentType>(env, (node) => node.dependencies),
    ].map((e) => convertEnvToIEnv(e));
    return {
        ...parsedEnv!,
        flatDependencies: dependencies as IEnvironmentDescriptor<MultiEnvironmentType>[],
    };
}

export function parseContextualEnv(
    env: ContextualEnvironment<string, EnvironmentMode, Environment[]>,
): IEnvironmentDescriptor[] {
    const { env: name, environments } = env;
    const [, ...dependencies] = [...flattenTree(env, (node) => node.dependencies)].map((e) => convertEnvToIEnv(e));
    return environments.map<IEnvironmentDescriptor>((childEnv) => ({
        name,
        flatDependencies: dependencies as IEnvironmentDescriptor<MultiEnvironment<typeof childEnv.envType>>[],
        type: childEnv.envType,
        childEnvName: childEnv.env,
        env: new Environment(name, childEnv.envType, 'single'),
    }));
}

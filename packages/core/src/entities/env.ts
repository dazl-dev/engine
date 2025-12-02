import type { EnvironmentTypes } from '../com/types.js';
import { runtimeType } from '../entity-helpers.js';
import type { Context, EnvVisibility, MapBy } from '../types.js';

export type EnvironmentMode = 'single' | 'multi';
export type AnyEnvironment = Environment<
    string,
    EnvironmentTypes,
    EnvironmentMode,
    MultiEnvironment<EnvironmentTypes>[] | []
>;

export type MultiEnvironment<TYPE extends EnvironmentTypes> = Environment<
    string,
    TYPE,
    'multi',
    MultiEnvironment<TYPE>[] | []
>;

export class Environment<
    NAME extends string = string,
    TYPE extends EnvironmentTypes = EnvironmentTypes,
    MODE extends EnvironmentMode = EnvironmentMode,
    DEPS extends MultiEnvironment<TYPE>[] | [] = [],
> {
    constructor(
        public readonly env: NAME,
        public readonly envType: TYPE,
        public readonly endpointType: MODE,
        public readonly dependencies: DEPS = [] as DEPS,
    ) {}
}

export class EnvironmentContext {
    constructor(
        public env: string,
        public activeEnvironmentName: string,
    ) {}
}

export const Universal = new Environment('<Universal>', 'window', 'multi');
export const AllEnvironments = new Environment('<All>', 'window', 'multi');

export const globallyProvidingEnvironments = new Set([Universal.env, AllEnvironments.env]);

export type GloballyProvidingEnvironments = typeof Universal | typeof AllEnvironments;

export function orderedEnvDependencies(env: AnyEnvironment): string[] {
    return env.dependencies?.flatMap(orderedEnvDependencies).concat(env.env) ?? [];
}

export class ContextualEnvironment<
    NAME extends string,
    MODE extends EnvironmentMode,
    ENVS extends Environment<string, EnvironmentTypes, MODE>[],
> extends Environment<NAME, EnvironmentTypes, MODE, []> {
    constructor(
        env: NAME,
        mode: MODE,
        public environments: ENVS,
    ) {
        super(env, 'context', mode);

        if (environments.length === 0) {
            throw new Error(`Contextual Environment ${env} initiated without child environments`);
        }
    }

    public useContext(contextEnv: keyof MapBy<ENVS, 'env'>): EnvironmentContext {
        return new EnvironmentContext(this.env, contextEnv);
    }

    public withContext<I extends object>(): Context<I> {
        return {
            type: runtimeType<I & { dispose(): unknown }>(this.env + ' context'),
        };
    }

    public getEnvironmentById(id: keyof MapBy<ENVS, 'env'>) {
        return this.environments.find(({ env }) => env === id)!;
    }
}

export function normEnvVisibility(envVisibility: EnvVisibility, includeDependencies = true): Set<string> {
    const envSet = new Set<string>();
    const extractDependencies = (env: AnyEnvironment) => {
        for (const { env: depEnv, dependencies } of env.dependencies) {
            envSet.add(depEnv);
            dependencies.map(extractDependencies);
        }
    };
    const envs = Array.isArray(envVisibility) ? envVisibility : [envVisibility];
    for (const e of envs) {
        envSet.add(e.env);
        if (includeDependencies) {
            extractDependencies(e);
        }
    }
    return envSet;
}

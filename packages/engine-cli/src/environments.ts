import { type AnyEnvironment, type EnvironmentTypes, flattenTree } from '@dazl/engine-core';
import { SetMultiMap } from '@dazl/patterns';
import type { IEnvironmentDescriptor, IFeatureDefinition, IStaticFeatureDefinition } from './types.js';

export interface GetResolveEnvironmentsParams {
    featureName?: string;
    filterContexts?: boolean;
    features: Map<string, Pick<IFeatureDefinition, 'exportedEnvs' | 'resolvedContexts'>>;
    environments?: Iterable<IEnvironmentDescriptor>;
    findAllEnvironments?: boolean;
    separateElectronRenderer?: boolean;
}

export interface IResolvedEnvironment {
    childEnvs: string[];
    env: IEnvironmentDescriptor;
}

export function* getExportedEnvironments(
    features: Map<string, { exportedEnvs: IEnvironmentDescriptor<AnyEnvironment>[] }>,
) {
    for (const { exportedEnvs } of features.values()) {
        for (const exportedEnv of exportedEnvs) {
            yield exportedEnv;
        }
    }
}

export function getResolvedEnvironments({
    featureName,
    filterContexts,
    features,
    environments = getExportedEnvironments(features),
    findAllEnvironments,
}: GetResolveEnvironmentsParams) {
    const webEnvs = new Map<string, IResolvedEnvironment>();
    const workerEnvs = new Map<string, IResolvedEnvironment>();
    const electronRendererEnvs = new Map<string, IResolvedEnvironment>();
    const nodeEnvs = new Map<string, IResolvedEnvironment>();
    const electronMainEnvs = new Map<string, IResolvedEnvironment>();
    const workerThreadEnvs = new Map<string, IResolvedEnvironment>();

    const resolvedContexts = findAllEnvironments
        ? getPossibleContexts(features)
        : featureName && filterContexts
          ? convertEnvRecordToSetMultiMap(features.get(featureName)?.resolvedContexts ?? {})
          : getAllResolvedContexts(features);

    for (const env of environments) {
        const { name, childEnvName, type } = env;
        if (!resolvedContexts.hasKey(name) || (childEnvName && resolvedContexts.get(name)?.has(childEnvName))) {
            if (type === 'window' || type === 'iframe') {
                addEnv(webEnvs, env);
            } else if (type === 'webworker') {
                addEnv(workerEnvs, env);
            } else if (type === 'electron-renderer') {
                addEnv(electronRendererEnvs, env);
            } else if (type === 'node') {
                addEnv(nodeEnvs, env);
            } else if (type === 'electron-main') {
                addEnv(electronMainEnvs, env);
            } else if (type === 'workerthread') {
                addEnv(workerThreadEnvs, env);
            } else {
                throw new Error(`unknown environment type: ${type}`);
            }
        }
    }
    return {
        webEnvs,
        workerEnvs,
        electronRendererEnvs,
        electronMainEnvs,
        nodeEnvs,
        workerThreadEnvs,
    };
}

function addEnv(envs: Map<string, IResolvedEnvironment>, environment: IEnvironmentDescriptor) {
    const { childEnvName, name } = environment;
    let env = envs.get(name);
    if (!env) {
        env = {
            childEnvs: [],
            env: environment,
        };
        envs.set(name, env);
    }
    if (childEnvName) {
        env.childEnvs.push(childEnvName);
    }
}

function getAllResolvedContexts(features: Map<string, Pick<IFeatureDefinition, 'resolvedContexts'>>) {
    const allContexts = new SetMultiMap<string, string>();
    for (const { resolvedContexts } of features.values()) {
        convertEnvRecordToSetMultiMap(resolvedContexts, allContexts);
    }
    return allContexts;
}

function getPossibleContexts(features: Map<string, Pick<IFeatureDefinition, 'exportedEnvs'>>) {
    const allContexts = new SetMultiMap<string, string>();
    for (const { exportedEnvs } of features.values()) {
        for (const env of exportedEnvs) {
            if (env.childEnvName) {
                allContexts.add(env.name, env.childEnvName);
            }
        }
    }
    return allContexts;
}

function convertEnvRecordToSetMultiMap(record: Record<string, string>, set = new SetMultiMap<string, string>()) {
    for (const [env, resolvedContext] of Object.entries(record)) {
        set.add(env, resolvedContext);
    }
    return set;
}

export function resolveEnvironments(
    featureName: string,
    features: ReadonlyMap<string, IStaticFeatureDefinition>,
    envTypes?: EnvironmentTypes[] | EnvironmentTypes,
    filterByContext = true,
) {
    const environmentTypesToFilterBy = Array.isArray(envTypes) ? envTypes : [envTypes];
    const filteredEnvironments = new Set<IEnvironmentDescriptor>();

    const featureDefinition = features.get(featureName);
    if (!featureDefinition) {
        const featureNames = Array.from(features.keys());
        throw new Error(`cannot find feature ${featureName}. available features: ${featureNames.sort().join(', ')}`);
    }
    const { resolvedContexts } = featureDefinition;
    const deepDefsForFeature = flattenTree(featureDefinition, (f) =>
        f.dependencies.map((fName) => features.get(fName)!),
    );
    for (const { exportedEnvs = [] } of deepDefsForFeature) {
        for (const exportedEnv of exportedEnvs) {
            if (
                (!envTypes || environmentTypesToFilterBy.includes(exportedEnv.type)) &&
                (!filterByContext ||
                    !exportedEnv.childEnvName ||
                    resolvedContexts[exportedEnv.name] === exportedEnv.childEnvName)
            ) {
                filteredEnvironments.add(exportedEnv);
            }
        }
    }
    return filteredEnvironments;
}

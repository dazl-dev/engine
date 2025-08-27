import { SetMultiMap } from '@dazl/patterns';
import { createEntryPoints } from './create-entrypoints.js';
import type {
    FeatureEnvironmentMapping,
    IConfigDefinition,
    IFeatureDefinition,
    IStaticFeatureDefinition,
} from './types.js';
import { createAllValidConfigurationsEnvironmentMapping } from './configuration-mapping.js';
import { getResolvedEnvironments, resolveEnvironments } from './environments.js';
import type { AnyEnvironment } from '@dazl/engine-core';

export function resolveBuildEntryPoints({
    features,
    configurations,
    mode,
    configName,
    featureName,
    dev,
    publicPath,
    publicConfigsRoute,
    jsOutExtension,
    nodeFormat,
    staticBuild,
    buildElectron,
}: {
    features: Map<string, IFeatureDefinition>;
    configurations: SetMultiMap<string, IConfigDefinition>;
    mode: 'development' | 'production';
    configName: string | undefined;
    featureName: string | undefined;
    dev: boolean;
    publicPath: string;
    publicConfigsRoute: string;
    jsOutExtension: '.js' | '.mjs';
    nodeFormat: 'esm' | 'cjs';
    staticBuild: boolean;
    buildElectron?: boolean;
}) {
    const featureEnvironmentsMapping = createFeatureEnvironmentsMapping(features);
    const configMapping = createAllValidConfigurationsEnvironmentMapping(configurations, mode, configName);

    const environments = getResolvedEnvironments({
        featureName,
        features,
        filterContexts: !!featureName,
        findAllEnvironments: false, // ??
    });

    const entryPoints = createEntryPoints(
        {
            config: [],
            configMapping,
            configurations,
            dev,
            environments,
            featureEnvironmentsMapping,
            features,
            publicConfigsRoute,
            publicPath,
            configName,
            featureName,
            buildElectron,
            staticBuild,
        },
        jsOutExtension,
        nodeFormat,
    );

    return { entryPoints, featureEnvironmentsMapping, configMapping, environments };
}

/**
 * This function generates a mapping from feature name to the environments it should run.
 */
function createFeatureEnvironmentsMapping(
    features: ReadonlyMap<string, IStaticFeatureDefinition>,
): FeatureEnvironmentMapping {
    const featureToEnvironments: Record<string, string[]> = {};
    const availableEnvironments: Record<string, AnyEnvironment> = {};
    for (const feature of features.values()) {
        const envs = resolveEnvironments(feature.scopedName, features, ['node'], true);
        const envNames = [];
        for (const envDescriptor of envs.values()) {
            availableEnvironments[envDescriptor.name] = envDescriptor.env;
            envNames.push(envDescriptor.name);
        }
        featureToEnvironments[feature.scopedName] = envNames;
    }
    return { featureToEnvironments, availableEnvironments };
}

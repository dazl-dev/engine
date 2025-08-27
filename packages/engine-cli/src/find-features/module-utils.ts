import {
    ContextualEnvironment,
    Environment,
    EnvironmentContext,
    flattenTree,
    type FeatureClass,
} from '@dazl/engine-core';
import { basename } from 'node:path';
import { parseFeatureFileName } from './build-constants.js';
import type { IFeatureDefinition, IFeatureModule } from '../types.js';
import { instanceOf } from './instance-of.js';
import { parseContextualEnv, parseEnv } from './parse-env.js';

function isEngineFeature(Class: unknown) {
    return typeof Class === 'function' && (Class as FeatureClass).isEngineFeature;
}

function getFeaturesDeep(feature: FeatureClass) {
    return flattenTree(feature, (f) => f.dependencies());
}

export function analyzeFeatureModule(filePath: string, moduleExports: unknown): IFeatureModule {
    if (typeof moduleExports !== 'object' || moduleExports === null) {
        throw new Error(`${filePath} does not export an object.`);
    }

    const { default: exportedFeature } = moduleExports as { default: FeatureClass };

    if (!isEngineFeature(exportedFeature)) {
        throw new Error(`${filePath} does not "export default" a Feature.`);
    }

    const featureFile: IFeatureModule = {
        filePath,
        name: parseFeatureFileName(basename(filePath)),
        exportedFeature,
        exportedEnvs: [],
        usedContexts: {},
    };

    const { exportedEnvs: envs = [], usedContexts = {} } = featureFile;
    for (const exportValue of Object.values(moduleExports)) {
        if (instanceOf(exportValue, Environment)) {
            if (instanceOf(exportValue, ContextualEnvironment)) {
                envs.push(...parseContextualEnv(exportValue));
            } else {
                envs.push(parseEnv(exportValue));
            }
        } else if (instanceOf(exportValue, EnvironmentContext)) {
            usedContexts[exportValue.env] = exportValue.activeEnvironmentName;
        }
    }
    return featureFile;
}

export function computeUsedContext(featureName: string, features: Map<string, IFeatureDefinition>) {
    const featureToDef = new Map<FeatureClass, IFeatureDefinition>();
    for (const featureDef of features.values()) {
        featureToDef.set(featureDef.exportedFeature, featureDef);
    }

    const feature = features.get(featureName);
    if (!feature) {
        throw new Error(`context compute: cannot find feature "${featureName}"`);
    }

    return Array.from(getFeaturesDeep(feature.exportedFeature))
        .reverse()
        .map((f) => {
            if (!featureToDef.has(f)) {
                throw new Error(
                    `Cannot find feature definition for feature with id: ${f.id}. This usually occurs due to duplicate engine/feature versions. Check your lock file.`,
                );
            }
            return featureToDef.get(f)!;
        })
        .reduce((acc, { usedContexts }) => Object.assign(acc, usedContexts), {} as Record<string, string>);
}

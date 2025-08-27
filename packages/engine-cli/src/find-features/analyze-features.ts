import type { IFileSystemSync } from '@file-services/types';
import { concat } from '@dazl/common';
import { flattenTree } from '@dazl/engine-core';
import type { SetMultiMap } from '@dazl/patterns';
import { childPackagesFromContext, resolveDirectoryContext, type INpmPackage } from '@dazl/resolve-directory-context';
import { isFeatureFile } from './build-constants.js';
import type { IConfigDefinition, IFeatureDefinition } from '../types.js';
import { loadFeaturesFromPaths } from './load-features-from-paths.js';
import { mergeAll, mergeResults } from './merge.js';

export async function analyzeFeatures(
    fs: IFileSystemSync,
    basePath: string,
    featureDiscoveryRoot = '.',
    featureName?: string,
    extensions?: string[],
    conditions?: string[],
) {
    console.time(`Analyzing Features`);
    const featuresAndConfigs = await findFeatures(basePath, fs, featureDiscoveryRoot, extensions, conditions);
    if (featureName) {
        filterByFeatureName(featuresAndConfigs.features, featureName);
    }
    console.timeEnd('Analyzing Features');
    return featuresAndConfigs;
}

function filterByFeatureName(features: Map<string, IFeatureDefinition>, featureName: string) {
    const foundFeature = features.get(featureName);
    if (!foundFeature) {
        throw new Error(
            `cannot find feature: ${featureName} available features:\n${Array.from(features.keys()).sort().join('\n')}`,
        );
    }
    const missingFeatureDeps = new Set<string>();
    const filteredFeatures = [
        ...flattenTree(foundFeature, ({ dependencies }) =>
            dependencies.map((dependencyName) => {
                const feature = features.get(dependencyName);
                if (!feature) {
                    missingFeatureDeps.add(dependencyName);
                    return {} as IFeatureDefinition;
                }
                return feature;
            }),
        ),
    ].map(({ scopedName }) => scopedName);

    if (missingFeatureDeps.size) {
        throw new Error(
            `The following features were not found during feature location: ${Array.from(missingFeatureDeps)
                .sort()
                .join(', ')}`,
        );
    }
    for (const [foundFeatureName] of features) {
        if (!filteredFeatures.includes(foundFeatureName)) {
            features.delete(foundFeatureName);
        }
    }
}

export async function findFeatures(
    path: string,
    fs: IFileSystemSync,
    featureDiscoveryRoot = '.',
    extensions?: string[],
    extraConditions?: string[],
): Promise<FoundFeatures> {
    const packages = childPackagesFromContext(resolveDirectoryContext(path, fs));
    const paths = packages.map(({ directoryPath }) => fs.join(directoryPath, featureDiscoveryRoot));
    const cwd = paths.map((path) => getDirFeatures(fs, path, '.'));
    const feature = paths.map((path) => getDirFeatures(fs, path, 'feature'));
    const features = mergeAll(concat(cwd, feature));
    const fixtures = mergeAll(paths.map((path) => getDirFeatures(fs, path, 'fixtures', 1)));

    return {
        ...mergeResults(
            await loadFeaturesFromPaths(features, fs, packages, undefined, extensions, extraConditions),
            await loadFeaturesFromPaths(fixtures, fs, packages, undefined, extensions, extraConditions),
        ),
        packages,
    };
}

export type DirFeatures = { dirs: Set<string>; files: Set<string> };
function getDirFeatures(fs: IFileSystemSync, path: string, directory: string, maxDepth = 0): DirFeatures {
    const rootPath = fs.join(path, directory);
    let result: DirFeatures = { dirs: new Set<string>(), files: new Set<string>() };
    if (fs.directoryExistsSync(rootPath)) {
        result.dirs.add(rootPath);
        for (const dirItem of fs.readdirSync(rootPath, { withFileTypes: true })) {
            const { name } = dirItem;
            const isFile = dirItem.isFile(); //unbound method
            const isDirectory = dirItem.isDirectory(); // unbound method

            const fullPath = fs.join(rootPath, name);
            if (isFile && isFeatureFile(name)) {
                result.files.add(fullPath);
            } else if (maxDepth > 0 && isDirectory) {
                result = mergeResults(result, getDirFeatures(fs, fullPath, '.', maxDepth - 1));
            }
        }
    }
    return result;
}

export type FoundFeatures = {
    packages: INpmPackage[];
    features: Map<string, IFeatureDefinition>;
    configurations: SetMultiMap<string, IConfigDefinition>;
};

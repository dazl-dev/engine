import { childPackagesFromContext, INpmPackage, resolveDirectoryContext } from '@wixc3/resolve-directory-context';
import type { IFileSystemSync } from '@file-services/types';
import { isFeatureFile } from '../build-constants';
import { loadFeaturesFromPaths } from './load-features-from-paths';
import { concat, SetMultiMap } from '@wixc3/common';
import { mergeAll, mergeResults } from './merge';
import type { IFeatureDefinition } from '../types';
import type { IConfigDefinition } from '@wixc3/engine-runtime-node';

export function findFeatures(path: string, fs: IFileSystemSync, featureDiscoveryRoot = '.'): FoundFeatures {
    const packages = childPackagesFromContext(resolveDirectoryContext(path, fs));
    const paths = packages.map(({ directoryPath }) => fs.join(directoryPath, featureDiscoveryRoot));
    const cwd = paths.map((path) => getDirFeatures(fs, path, '.'));
    const feature = paths.map((path) => getDirFeatures(fs, path, 'feature'));
    const features = mergeAll(concat(cwd, feature));
    const fixtures = mergeAll(paths.map((path) => getDirFeatures(fs, path, 'fixtures', 1)));

    return {
        ...mergeResults(loadFeaturesFromPaths(features, fs, packages), loadFeaturesFromPaths(fixtures, fs, packages)),
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

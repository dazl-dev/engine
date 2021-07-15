import type { IFileSystem } from '@file-services/types';
import type { SetMultiMap, TopLevelConfig } from '@wixc3/engine-core';
import type { IConfigDefinition } from '@wixc3/engine-runtime-node';
import { loadFeaturesFromPackages } from './analyze-feature';
import { resolvePackages } from './utils/resolve-packages';

export function readFeatures(fs: IFileSystem, basePath: string, featuresDirectory?: string) {
    const packages = resolvePackages(basePath);

    return loadFeaturesFromPackages(packages, fs, featuresDirectory);
}

export function evaluateConfig(
    configName: string,
    configurations: SetMultiMap<string, IConfigDefinition>,
    envName: string
) {
    const config: TopLevelConfig = [];
    const configs = configurations.get(configName);
    if (!configs) {
        throw new Error(`no such config ${configName}`);
    }

    for (const { filePath, envName: configEnvName } of configs) {
        if (!configEnvName || configEnvName === envName) {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            config.push(...(require(filePath) as { default: TopLevelConfig }).default);
        }
    }

    return config;
}

import fs from '@file-services/node';
import { TopLevelConfig } from '@wixc3/engine-core';

export interface RunNodeManagerOptions {
    outputPath: string;
    featureName?: string;
    configName?: string;
    verbose?: boolean;
    runtimeArgs?: Record<string, string | boolean>;
    topLevelConfig?: TopLevelConfig;
}

export function resolveRuntimeOptions({
    outputPath,
    featureName,
    configName,
    verbose,
    runtimeArgs,
    topLevelConfig,
}: RunNodeManagerOptions) {
    const runtimeOptions = new Map<string, string | boolean | undefined>();
    runtimeOptions.set('applicationPath', fs.join(outputPath, 'web'));
    runtimeOptions.set('feature', featureName);
    if (verbose) {
        runtimeOptions.set('verbose', 'true');
    }
    if (configName) {
        runtimeOptions.set('config', configName);
    }
    if (runtimeArgs) {
        for (const [key, value] of Object.entries(runtimeArgs)) {
            runtimeOptions.set(key, value);
        }
    }
    if (topLevelConfig) {
        runtimeOptions.set('topLevelConfig', JSON.stringify(topLevelConfig));
    }
    return runtimeOptions;
}

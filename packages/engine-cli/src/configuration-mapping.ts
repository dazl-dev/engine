import type { SetMultiMap } from '@dazl/patterns';
import type { ConfigurationEnvironmentMapping, IConfigDefinition } from './types.js';

export const createAllValidConfigurationsEnvironmentMapping = (
    configurations: SetMultiMap<string, IConfigDefinition>,
    mode: 'development' | 'production',
    configName?: string,
) => {
    const configurationMapping: ConfigurationEnvironmentMapping = {};
    const configEntries = filterConfigurationsByMode(configurations, mode, configName);
    for (const [name, { filePath, envName: configEnvName }] of configEntries) {
        configurationMapping[name] ??= {
            byEnv: {},
            common: [],
        };
        if (!configEnvName) {
            configurationMapping[name].common.push(filePath);
        } else {
            configurationMapping[name].byEnv[configEnvName] ??= [];
            configurationMapping[name].byEnv[configEnvName].push(filePath);
        }
    }
    return configurationMapping;
};

const filterConfigurationsByMode = (
    configurations: SetMultiMap<string, IConfigDefinition>,
    mode: 'development' | 'production',
    configName?: string,
) => {
    if (mode === 'production' && configName) {
        return [...configurations.entries()].filter(([scopedConfigName]) => scopedConfigName === configName);
    }
    return [...configurations.entries()];
};

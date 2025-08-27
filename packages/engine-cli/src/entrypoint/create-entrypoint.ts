import { TopLevelConfig } from '@dazl/engine-core';
import type { SetMultiMap } from '@dazl/patterns';
import { relative } from 'node:path';
import type {
    ConfigurationEnvironmentMapping,
    IConfigDefinition,
    IEnvironmentDescriptor,
    IFeatureDefinition,
} from '../types.js';

const { stringify } = JSON;

//#region types

export interface ICreateEntrypointsOptions {
    features: ReadonlyMap<string, IFeatureDefinition>;
    childEnvs: string[];
    featureName?: string;
    configName?: string;
    publicPath?: string;
    publicPathVariableName?: string;
    configurations: SetMultiMap<string, IConfigDefinition>;
    staticBuild: boolean;
    mode: 'production' | 'development';
    publicConfigsRoute?: string;
    config?: TopLevelConfig;
    eagerEntrypoint?: boolean;
    absImports?: boolean;
    env: IEnvironmentDescriptor;
    featuresBundleName?: string;
}

export interface FeatureLoaderArguments extends IFeatureDefinition {
    childEnvs: string[];
    env: IEnvironmentDescriptor;
    publicPath?: string;
    eagerEntrypoint?: boolean;
    absImports?: boolean;
    loadStatement: (args: LoadStatementArguments) => string;
    featuresBundleName?: string;
}

export type LoadStatement = Pick<
    FeatureLoaderArguments,
    | 'childEnvs'
    | 'env'
    | 'contextFilePaths'
    | 'envFilePaths'
    | 'scopedName'
    | 'loadStatement'
    | 'packageName'
    | 'directoryPath'
    | 'preloadFilePaths'
    | 'eagerEntrypoint'
    | 'absImports'
>;

export interface LoadStatementArguments
    extends Pick<FeatureLoaderArguments, 'filePath' | 'directoryPath' | 'packageName'> {
    moduleIdentifier: string;
    eagerEntrypoint?: boolean;
    absImports?: boolean;
}
//#endregion

//#region feature loaders generation
export function createFeatureLoadersSourceCode(
    features: Iterable<IFeatureDefinition>,
    childEnvs: string[],
    env: IEnvironmentDescriptor,
    eagerEntrypoint?: boolean,
    featuresBundleName?: string,
    absImports?: boolean,
) {
    let entries = '[';

    for (const feature of features) {
        const loaderCode = createLoaderInterface({
            ...feature,
            childEnvs,
            loadStatement: dynamicImportStatement,
            eagerEntrypoint,
            absImports,
            env,
            featuresBundleName,
        });
        entries += `['${feature.scopedName}', ${loaderCode}],`;
    }

    entries += ']';
    return `new Map(${entries})`;
}

function loadEnvAndContextFiles({
    childEnvs,
    contextFilePaths,
    scopedName,
    envFilePaths,
    loadStatement,
    directoryPath,
    packageName,
    preloadFilePaths,
    eagerEntrypoint,
    absImports,
    env,
}: LoadStatement) {
    let usesResolvedContexts = false;
    const loadStatements: string[] = [];
    const preloadStatements: string[] = [];
    for (const childEnvName of childEnvs) {
        const contextFilePath = contextFilePaths[`${env.name}/${childEnvName}`];
        if (contextFilePath) {
            usesResolvedContexts = true;
            loadStatements.push(`if (resolvedContexts[${stringify(env.name)}] === ${stringify(childEnvName)}) {
                ${loadStatement({
                    moduleIdentifier: scopedName,
                    filePath: contextFilePath,
                    directoryPath,
                    packageName,
                    eagerEntrypoint,
                    absImports,
                })}
            }`);
        }
        const preloadFilePath = preloadFilePaths?.[`${env.name}/${childEnvName}`];
        if (preloadFilePath) {
            // If a context env has a preload file, it's the same as resolving a context
            usesResolvedContexts = true;
            preloadStatements.push(`if (resolvedContexts[${stringify(env.name)}] === ${stringify(childEnvName)}) {
                ${loadStatement({
                    directoryPath,
                    filePath: preloadFilePath,
                    moduleIdentifier: scopedName,
                    packageName,
                    eagerEntrypoint,
                    absImports,
                })}
            }`);
        }
    }
    for (const { name: envName } of new Set([env, ...(env.flatDependencies ?? [])])) {
        const envFilePath = envFilePaths[envName];
        if (envFilePath) {
            loadStatements.push(
                loadStatement({
                    moduleIdentifier: `[${envName}]${scopedName}`,
                    filePath: envFilePath,
                    directoryPath,
                    packageName,
                    eagerEntrypoint,
                    absImports,
                }),
            );
        }
    }
    const preloadFilePath = preloadFilePaths?.[env.name];
    if (preloadFilePath) {
        preloadStatements.push(
            loadStatement({
                moduleIdentifier: `[${env.name}]${scopedName}`,
                filePath: preloadFilePath,
                directoryPath,
                packageName,
                eagerEntrypoint,
            }),
        );
    }
    return { usesResolvedContexts, loadStatements, preloadStatements };
}

function createLoaderInterface(args: FeatureLoaderArguments) {
    const {
        filePath,
        dependencies,
        resolvedContexts,
        loadStatement,
        packageName,
        directoryPath,
        eagerEntrypoint,
        absImports,
        featuresBundleName = 'features',
    } = args;
    const { loadStatements, usesResolvedContexts, preloadStatements } = loadEnvAndContextFiles(args);
    return `{
                async load(${usesResolvedContexts ? 'resolvedContexts' : ''}) {
                    ${loadStatements.length ? loadStatements.join('\n') : ''}
                    const featureModule = ${loadStatement({
                        moduleIdentifier: featuresBundleName,
                        filePath,
                        directoryPath,
                        packageName,
                        eagerEntrypoint,
                        absImports,
                    })}
                    return featureModule.default;
                },${
                    preloadStatements.length
                        ? `
                async preload(${usesResolvedContexts ? 'resolvedContexts' : ''}) {
                    ${preloadStatements.join('\n')}
                },`
                        : ''
                }
                depFeatures: ${stringify(dependencies)},
                resolvedContexts: ${stringify(resolvedContexts)},
            }`;
}
//#endregion

//#region config loaders
const getAllValidConfigurations = (configurations: [string, IConfigDefinition][], envName: string) => {
    const configNameToFiles: Record<string, { filePath: string; configEnvName: string | undefined }[]> = {};
    for (const [configName, { filePath, envName: configEnvName }] of configurations) {
        configNameToFiles[configName] ??= [];
        if (!configEnvName || configEnvName === envName) {
            configNameToFiles[configName].push({ filePath, configEnvName });
        }
    }
    return configNameToFiles;
};

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

export function createConfigLoaders({
    configurations,
    mode,
    configName,
    envName,
    staticBuild,
    loadConfigFileTemplate,
}: {
    configurations: SetMultiMap<string, IConfigDefinition>;
    mode: 'development' | 'production';
    configName: string | undefined;
    envName: string;
    staticBuild: boolean;
    loadConfigFileTemplate: (filePath: string, scopedName: string, configEnvName?: string) => string;
}) {
    const loaders: string[] = [];
    if (staticBuild) {
        const configs = getAllValidConfigurations(
            filterConfigurationsByMode(configurations, mode, configName),
            envName,
        );
        for (const [scopedName, availableConfigs] of Object.entries(configs)) {
            const loadStatements = availableConfigs.map(({ filePath, configEnvName }) =>
                loadConfigFileTemplate(filePath, scopedName, configEnvName),
            );
            loaders.push(`    '${scopedName}': async () => (await Promise.all([${loadStatements.join(',')}]))`);
        }
    }
    return `{\n${loaders.join(',\n')}\n}`;
}

//#endregion

function dynamicImportStatement({
    moduleIdentifier,
    filePath,
    eagerEntrypoint,
    directoryPath,
    packageName,
    absImports,
}: LoadStatementArguments) {
    const targetSpecifier = absImports
        ? filePath
        : packageName + '/' + relative(directoryPath, filePath).replace(/\\/g, '/');
    return `await import(/* webpackChunkName: "${moduleIdentifier}" */${
        eagerEntrypoint ? ` /* webpackMode: 'eager' */` : ''
    } ${stringify(targetSpecifier)});`;
}

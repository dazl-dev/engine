import type { Plugin } from 'esbuild';
import type {
    AnyEnvironment,
    EnvironmentTypes,
    FeatureClass,
    MultiEnvironment,
    TopLevelConfig,
} from '@dazl/engine-core';
import type { PerformanceMetrics } from '@dazl/engine-runtime-node';
import type { BuildOptions } from 'esbuild';
import type io from 'socket.io';

export type TopLevelConfigProvider = (envName: string) => TopLevelConfig;
export interface IConfigDefinition {
    name: string;
    envName?: string;
    filePath: string;
}
export interface IFeatureTarget {
    featureName?: string;
    configName?: string;
    runtimeOptions?: Record<string, string | boolean>;
    overrideConfig?: TopLevelConfig | TopLevelConfigProvider;
}

export interface IFeatureMessagePayload {
    featureName: string;
    configName: string;
}

export type RunningFeature = IFeatureMessagePayload & {
    dispose(): void | Promise<void>;
    url?: string;
    getMetrics: () => Promise<PerformanceMetrics>;
};

export interface IExecutableApplication {
    getServerPort(featureTarget?: IFeatureTarget): Promise<number>;
    runFeature(featureTarget: IFeatureTarget): Promise<RunningFeature>;
    closeServer(): Promise<void>;
    init?(): Promise<void>;
}

export interface EngineConfig {
    require?: string[];
    import?: string[];
    featureDiscoveryRoot?: string;
    /** relative path to the location of engine features (packages) */
    featuresDirectory?: string;
    /** relative path to the location of templates for generating engine features (packages) */
    featureTemplatesFolder?: string;
    serveStatic?: StaticConfig[];
    socketServerOptions?: Partial<io.ServerOptions>;
    sourcesRoot?: string;
    favicon?: string;
    buildPlugins?: Plugin[] | OverrideConfigHook;
    customEntrypoints?: string;

    /**
     * extra resolver conditions to add while building project.
     * used for finding features and running in dev time
     */
    buildConditions?: string[];

    /** @default [".js", ".json"] */
    extensions?: string[];
    engineRuntimeArgsFlags?: Record<string, CliFlag<string | boolean>>;
}

export interface StaticConfig {
    route: string;
    directoryPath: string;
}

export type BuildConfiguration = {
    webConfig: BuildOptions;
    nodeConfig: BuildOptions;
    dev?: boolean;
};

export type OverrideConfigHook = (config: BuildConfiguration) => BuildConfiguration;

export type CliFlag<T> = {
    /** e.g. String, Boolean, etc. */
    type: (value: string) => T;
    /** description to be used in help output */
    description: string;
    /** default value */
    defaultValue: T;
};

export interface IFeatureDefinition extends IStaticFeatureDefinition, IFeatureModule {
    isRoot: boolean;
    directoryPath: string;
    toJSON(): IStaticFeatureDefinition;
}

export interface IFeatureModule {
    /**
     * Feature name.
     * @example "gui" for "gui.feature.ts"
     */
    name: string;

    /**
     * Absolute path pointing to the feature file.
     */
    filePath: string;

    /**
     * Actual evaluated Feature instance exported from the file.
     */
    exportedFeature: FeatureClass;

    /**
     * Exported environments from module.
     */
    exportedEnvs: IEnvironmentDescriptor<AnyEnvironment>[];

    /**
     * If module exports any `processingEnv.useContext('webworker')`,
     * it will be set as `'processing': 'webworker'`
     */
    usedContexts?: Record<string, string>;
}
export type FeatureEnvironmentMapping = {
    featureToEnvironments: Record<string, string[]>;
    availableEnvironments: Record<string, AnyEnvironment>;
};

export type ConfigFilePath = string;

export interface ConfigurationEnvironmentMappingEntry {
    common: ConfigFilePath[];
    byEnv: Record<string, ConfigFilePath[]>;
}

export type ConfigurationEnvironmentMapping = Record<string, ConfigurationEnvironmentMappingEntry>;

export interface IStaticFeatureDefinition {
    contextFilePaths: Record<string, string>;
    envFilePaths: Record<string, string>;
    preloadFilePaths: Record<string, string>;
    dependencies: string[];
    /**
     * the feature's name scoped to the package.json package name.
     * @example
     * ```
     * packageName = '@some-scope/my-package'
     * featureName = 'my-feature'
     * scopedName === 'my-package/my-feature'
     * ```
     * if package name is equal to the feature name, then the scoped name will just be the package name
     * if package name ends with - feature, we remove it from the scope
     */
    scopedName: string;
    resolvedContexts: Record<string, string>;
    packageName: string;
    filePath: string;
    exportedEnvs: IEnvironmentDescriptor<AnyEnvironment>[];
}
export interface IEnvironmentDescriptor<ENV extends AnyEnvironment = AnyEnvironment> {
    type: EnvironmentTypes;
    name: string;
    childEnvName?: string;
    flatDependencies?: IEnvironmentDescriptor<MultiEnvironment<ENV['envType']>>[];
    env: ENV;
}

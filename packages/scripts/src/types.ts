import type io from 'socket.io';
import type { Environment, EnvironmentContext, TopLevelConfig, Feature } from '@wixc3/engine-core';
import type { IExternalDefinition, LaunchEnvironmentMode, TopLevelConfigProvider } from '@wixc3/engine-runtime-node';

export type JSRuntime = 'web' | 'webworker' | 'node';

export interface IFeatureTarget {
    featureName?: string;
    configName?: string;
    runtimeOptions?: Record<string, string | boolean>;
    overrideConfig?: TopLevelConfig | TopLevelConfigProvider;
}

export interface VirtualEntry {
    source: string;
    filename: string;
}

export interface EngineEnvironmentDef {
    name: string;
    target: JSRuntime;
    featureMapping: FeatureMapping;
    envFiles: Set<string>;
    contextFiles?: ReadonlySet<string>;
    currentFeatureName: string;
    currentConfigName: string;
    publicPath?: string;
    environmentContexts?: Record<string, string>;
}

export interface EngineContextDef {
    name: string;
    target: JSRuntime;
    featureMapping: FeatureMapping;
    contextFiles: Set<string>;
    currentFeatureName: string;
    currentConfigName: string;
    publicPath?: string;
}

export interface EngineEnvironmentEntry {
    name: string;
    target: JSRuntime;
    isRoot: boolean;
    envFiles: Set<string>;
    featureMapping: FeatureMapping;
    entryFilename: string;
    contextFiles?: Set<string>;
}

export interface WebpackEnvOptions {
    port?: number;
    environments: EngineEnvironmentEntry[];
    contextFiles?: Set<string>;
    basePath: string;
    outputPath: string;
}

export interface SingleFeatureWithConfig {
    featureFilePath: string;
    configurations: { [configName: string]: string };
    context: { [contextName: string]: string };
}

export type SymbolList<T> = Array<{ name: string; value: T }>;

export interface EvaluatedFeature {
    id: string;
    filePath: string;
    features: SymbolList<Feature>;
    environments: SymbolList<Environment>;
    contexts: SymbolList<EnvironmentContext>;
}

export interface FeatureMapping {
    mapping: { [featureName: string]: SingleFeatureWithConfig };
    bootstrapFeatures: string[];
    rootFeatureName: string;
}

export interface LinkInfo {
    url: string;
    feature: string;
    config?: string;
}

export interface TestCommand {
    flavor: string;
    env: string;
    watch: boolean;
    debug: boolean;
}

export interface IFeatureMessagePayload {
    featureName: string;
    configName: string;
}

export interface IPortMessage {
    port: number;
}

export interface StaticConfig {
    route: string;
    directoryPath: string;
}

export interface EngineConfig {
    require?: string[];
    featuresDirectory?: string;
    featureTemplatesFolder?: string;
    featureFolderNameTemplate?: string;
    serveStatic?: StaticConfig[];
    externalFeatureDefinitions: Array<IExternalDefinition>;
    externalFeaturesBasePath?: string;
    serveExternalFeaturesPath?: boolean;
    socketServerOptions?: Partial<io.ServerOptions>;
    sourcesRoot?: string;
    favicon?: string;
    nodeEnvironmentsMode?: LaunchEnvironmentMode;
}

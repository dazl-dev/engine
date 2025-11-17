import { RuntimeEngine } from './runtime-engine.js';
import type { IRunOptions, TopLevelConfig } from './types.js';
import type { AnyEnvironment, FeatureClass } from './entities/index.js';
import { deferred, type IDeferredPromise } from 'promise-assist';

export interface RunEngineOptions<ENV extends AnyEnvironment> {
    entryFeature: FeatureClass | FeatureClass[];
    topLevelConfig?: TopLevelConfig;
    env: ENV;
    runOptions?: IRunOptions;
}

export function run<ENV extends AnyEnvironment>({
    entryFeature,
    topLevelConfig = [],
    env,
    runOptions,
}: RunEngineOptions<ENV>) {
    return new RuntimeEngine(env, topLevelConfig, runOptions).run(entryFeature);
}

export interface IFeatureLoader {
    load: (resolvedContexts: Record<string, string>) => Promise<FeatureClass> | FeatureClass;
    preload: (
        resolveContexts: Record<string, string>,
    ) => Promise<Array<(runtimeOptions: Record<string, string | boolean>) => void | Promise<void>>> | undefined;
    depFeatures: string[];
    resolvedContexts: Record<string, string>;
}

export interface IPreloadModule {
    init?: (runtimeOptions?: Record<string, string | boolean>) => Promise<void> | void;
}

export interface IRunEngineAppOptions<ENV extends AnyEnvironment> {
    config?: TopLevelConfig;
    options?: Map<string, string | boolean>;
    env: ENV;
    publicPath?: string;
    features?: FeatureClass[];
    resolvedContexts: Record<string, string>;
}

export class FeatureLoadersRegistry {
    private pendingLoaderRequests = new Map<string, IDeferredPromise<IFeatureLoader>>();
    private loadedFeatures = new Set<string>();
    constructor(private featureMapping = new Map<string, IFeatureLoader>()) {}
    public register(name: string, featureLoader: IFeatureLoader) {
        this.featureMapping.set(name, featureLoader);
        this.pendingLoaderRequests.get(name)?.resolve(featureLoader);
        this.pendingLoaderRequests.delete(name);
    }
    public get(featureName: string): IFeatureLoader | Promise<IFeatureLoader> {
        const featureLoader = this.featureMapping.get(featureName);
        if (featureLoader) {
            return featureLoader;
        }
        let loaderPromise = this.pendingLoaderRequests.get(featureName);
        if (!loaderPromise) {
            loaderPromise = deferred<IFeatureLoader>();
            this.pendingLoaderRequests.set(featureName, loaderPromise);
        }
        return loaderPromise.promise;
    }
    public getRegistered(): string[] {
        return [...this.featureMapping.keys()];
    }
    /**
     * returns all features which were actially loaded
     */
    private async getLoadedFeatures(
        rootFeatureName: string,
        runtimeOptions: Record<string, string | boolean>,
        resolvedContexts: Record<string, string>,
    ): Promise<FeatureClass[]> {
        const loaded: Array<IFeatureLoader | Promise<IFeatureLoader>> = [];
        const dependencies = await this.getFeatureDependencies(rootFeatureName);
        for (const depName of dependencies.reverse()) {
            if (!this.loadedFeatures.has(depName)) {
                this.loadedFeatures.add(depName);
                const loader = this.get(depName);
                loaded.push(loader);
            }
        }
        const featureLoaders = await Promise.all(loaded as Promise<IFeatureLoader>[]);
        const allPreloadInitFunctions = [];
        for (const featureLoader of featureLoaders) {
            if (featureLoader.preload) {
                const featureInitFunctions = await featureLoader.preload(resolvedContexts);
                if (featureInitFunctions) {
                    allPreloadInitFunctions.push(...featureInitFunctions);
                }
            }
        }
        for (const initFunction of allPreloadInitFunctions) {
            await initFunction(runtimeOptions);
        }
        return Promise.all(featureLoaders.map(async ({ load }) => cjsEsmInterop(await load(resolvedContexts))));
    }
    /**
     * loads the entry feature and all its dependencies
     */
    async loadEntryFeature(rootFeatureName: string, runtimeOptions: Record<string, string | boolean>) {
        const rootFeatureLoader = this.featureMapping.get(rootFeatureName);
        if (!rootFeatureLoader) {
            throw new Error(
                `cannot find feature '${rootFeatureName}'. available features:\n${Array.from(this.featureMapping.keys())
                    .sort()
                    .join('\n')}`,
            );
        }
        const resolvedContexts = { ...rootFeatureLoader.resolvedContexts };
        const features = await this.getLoadedFeatures(rootFeatureName, runtimeOptions, resolvedContexts);
        const entryFeature = features[features.length - 1];
        if (!entryFeature) {
            throw new Error(
                `no features were loaded for ${rootFeatureName} with runtime options ${JSON.stringify(
                    runtimeOptions,
                    null,
                    2,
                )}`,
            );
        }
        return { entryFeature, resolvedContexts };
    }
    /**
     * returns all the dependencies of a feature. doesn't handle duplications
     */
    public async getFeatureDependencies(featureName: string): Promise<string[]> {
        const dependencies: string[] = [featureName];
        const features = [featureName];
        while (features.length) {
            const { depFeatures } = await this.get(features.shift()!);
            for (const depFeature of depFeatures) {
                if (!dependencies.includes(depFeature)) {
                    dependencies.push(depFeature);
                    features.push(depFeature);
                }
            }
        }
        return dependencies;
    }
}
function cjsEsmInterop(featureClass: FeatureClass): FeatureClass | PromiseLike<FeatureClass> {
    return (featureClass as any).__esModule ? (featureClass as any as { default: FeatureClass }).default : featureClass;
}

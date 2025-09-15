import { IRunOptions, type TopLevelConfig } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace globalThis {
    const parent: typeof globalThis | undefined;
    const engineEntryOptions: (options: { urlParams: URLSearchParams; envName: string }) => URLSearchParams;
}

export interface ConfigModule {
    default: TopLevelConfig;
}

export type ConfigLoader = () => Promise<ConfigModule[]>;

export type ConfigLoaders = Record<string, ConfigLoader>;

/**
 * Manage for the runtime configurations loading flow
 */
export class RuntimeConfigurations {
    private fetchedConfigs: Record<string, Promise<TopLevelConfig>> = {};
    private topLevelConfig: TopLevelConfig;
    constructor(
        private envName: string,
        private publicConfigsRoute: string,
        private loaders: ConfigLoaders,
        private options: IRunOptions,
    ) {
        // validate args since we use this class in the entry point template code
        if (!envName) {
            throw new Error('envName must be provided');
        }

        this.topLevelConfig = parseInjectRuntimeConfigConfig(this.options);
    }
    /**
     * load config via configuration loader
     * this is an integration function with the build system
     * the logic and is based on the "config loader" implementation
     */
    public async importConfig(configName: string): Promise<TopLevelConfig> {
        const loader = this.loaders[configName];
        if (!loader || !configName) {
            return [];
        }
        const res = await loader();
        // top level config creates a module that returns a Promise as default export
        const allLoadedConfigs = res.map((module) => module.default ?? module);
        return allLoadedConfigs.flat();
    }
    /**
     * Install a message listener to fetch config for child environments
     * currently only iframe is supported we should expend support for other environments types
     */
    public installChildEnvConfigFetcher(featureName: string, configName: string) {
        if (!this.publicConfigsRoute || !this.isMainEntrypoint() || typeof window === 'undefined') {
            return;
        }

        window.addEventListener('message', ({ data: { id, envName, __from }, source }) => {
            if (!source || id !== this.publicConfigsRoute) {
                return;
            }
            this.fetchConfig(envName, featureName, configName)
                .then((config) => {
                    // with our flow it can only be a window (currently)
                    (source as Window).postMessage(
                        {
                            id,
                            config,
                            __to: __from,
                        },
                        '*',
                    );
                })
                .catch((e) => {
                    // with our flow it can only be a window (currently)
                    (source as Window).postMessage(
                        {
                            id,
                            error: String(e),
                            __to: __from,
                        },
                        '*',
                    );
                });
        });
    }
    /**
     * depending on the environment type (main or child) load the config either from the parent or from the public route
     */
    public async load(envName: string, featureName: string, configName: string): Promise<TopLevelConfig> {
        if (!this.publicConfigsRoute) {
            return Promise.resolve(this.topLevelConfig);
        }
        const loaded = this.isMainEntrypoint()
            ? await this.fetchConfig(envName, featureName, configName)
            : await this.loadFromParent(envName);

        if (this.topLevelConfig.length) {
            return [...loaded, ...this.topLevelConfig];
        }
        return loaded;
    }

    private isMainEntrypoint() {
        return globalThis === this.getOpenerMessageTarget();
    }

    private loadFromParent(envName: string) {
        if (typeof window === 'undefined') {
            return Promise.reject(new Error('loadFromParent is not supported in non-browser environments'));
        }
        let loadConfigPromise = this.fetchedConfigs[envName];
        if (!loadConfigPromise) {
            loadConfigPromise = new Promise((res, rej) => {
                const configsHandler = ({
                    data: { id, config, error },
                }: {
                    data:
                        | { id: string; config: TopLevelConfig; error: never }
                        | { id: string; config: never; error: string };
                }) => {
                    if (id === this.publicConfigsRoute) {
                        window.removeEventListener('message', configsHandler);
                        error ? rej(new Error(error)) : res(config);
                    }
                };
                window.addEventListener('message', configsHandler);
                window.parent.postMessage(
                    {
                        id: this.publicConfigsRoute,
                        envName: envName,
                        __from: this.envName,
                    },
                    '*',
                );
            });
            this.fetchedConfigs[envName] = loadConfigPromise;
        }
        return loadConfigPromise;
    }
    private getOpenerMessageTarget() {
        return globalThis.parent ?? globalThis;
    }

    private fetchConfig(envName: string, featureName: string, configName: string) {
        let url = addTrailingSlashIfNotEmpty(this.publicConfigsRoute) + configName;
        url += '?env=' + envName;
        url += '&feature=' + featureName;
        let promise = this.fetchedConfigs[url];
        if (!promise) {
            promise = fetch(url).then((res) => res.json());
            this.fetchedConfigs[url] = promise;
        }
        return promise;
    }
}

function addTrailingSlashIfNotEmpty(route: string) {
    return route ? (route.endsWith('/') ? route : route + '/') : '';
}

export function parseInjectRuntimeConfigConfig(options: IRunOptions) {
    const rawConfigOption = options.get('topLevelConfig');
    if (typeof rawConfigOption === 'string') {
        if (rawConfigOption === 'undefined') {
            return [];
        }
        const parsedConfig = JSON.parse(rawConfigOption);
        return Array.isArray(parsedConfig) ? parsedConfig : [parsedConfig];
    } else if (rawConfigOption) {
        throw new Error('topLevelConfig must be a string if provided');
    }
    return [];
}

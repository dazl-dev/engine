import fs from '@file-services/node';
import {
    findFeatures,
    evaluateConfig,
    IFeatureDefinition,
    ENGINE_CONFIG_FILE_NAME,
    EngineConfig,
} from '@wixc3/engine-scripts';
import {
    TopLevelConfig,
    Environment,
    Feature,
    EntityRecord,
    DisposableContext,
    RuntimeEngine,
    flattenTree,
    Running,
    AnyEnvironment,
    Dependency,
} from '@wixc3/engine-core';
import { runNodeEnvironment } from '@wixc3/engine-runtime-node';

export interface IRunNodeEnvironmentOptions<ENV extends AnyEnvironment = Environment> {
    featureName: string;
    bundlePath?: string;
    configName?: string;
    runtimeOptions?: Record<string, string | boolean>;
    config?: TopLevelConfig;
    /**
     * from where to locate features
     * @default {process.cwd()}
     */
    basePath?: string;
    /**
     * base folder to locate features from within basePath
     */
    featureDiscoveryRoot?: string;
    env: ENV;
}

export interface IGetRunnigFeatureOptions<
    NAME extends string,
    DEPS extends Dependency[],
    API extends EntityRecord,
    CONTEXT extends Record<string, DisposableContext<any>>,
    ENV extends AnyEnvironment
> extends IRunNodeEnvironmentOptions<ENV> {
    feature: Feature<NAME, DEPS, API, CONTEXT>;
}

export async function runEngineEnvironment<ENV extends AnyEnvironment>({
    featureName,
    configName,
    bundlePath,
    runtimeOptions = {},
    config = [],
    env,
    basePath = process.cwd(),
    featureDiscoveryRoot,
}: IRunNodeEnvironmentOptions<ENV>): Promise<{
    engine: RuntimeEngine<ENV>;
    dispose: () => Promise<void>;
}> {
    const { env: envName, envType } = env;
    const engineConfigFilePath = await fs.promises.findClosestFile(basePath, ENGINE_CONFIG_FILE_NAME);
    const { featureDiscoveryRoot: configFeatureDiscoveryRoot } = (
        engineConfigFilePath ? await importWithProperError(engineConfigFilePath) : {}
    ) as EngineConfig;

    const { features, configurations } = findFeatures(basePath, fs, featureDiscoveryRoot ?? configFeatureDiscoveryRoot);

    if (configName) {
        config = [...evaluateConfig(configName, configurations, envName), ...config];
    }
    const featureDef = features.get(featureName)!;

    const childEnvName = featureDef?.resolvedContexts[envName];
    if (childEnvName) {
        const env = locateEnvironment(featureDef, features, envName, childEnvName);
        if (!env) {
            throw new Error(
                `environment "${envName}" with the context "${childEnvName}" is not found when running "${featureDef.scopedName}" feature`
            );
        }
        if (env.type !== 'node') {
            throw new Error(
                `Trying to run "${envName}" with the "${childEnvName}" context, the target of which is "${env.type}"`
            );
        }
    }
    return runNodeEnvironment({
        featureName,
        features: [...features.entries()],
        bundlePath,
        name: envName,
        type: envType,
        childEnvName,
        config,
        options: Object.entries(runtimeOptions),
        context: basePath,
        env,
    });
}

function locateEnvironment(
    featureDef: IFeatureDefinition,
    features: Map<string, IFeatureDefinition>,
    name: string,
    childEnvName: string
) {
    const deepDefsForFeature = flattenTree<IFeatureDefinition>(
        featureDef,
        (f) => f.dependencies?.map((fName) => features.get(fName)!) ?? []
    );
    for (const { exportedEnvs } of deepDefsForFeature) {
        for (const env of exportedEnvs) {
            if (env.name === name && env.childEnvName === childEnvName) {
                return env;
            }
        }
    }

    return undefined;
}

export async function getRunningFeature<
    NAME extends string,
    DEPS extends Dependency[],
    API extends EntityRecord,
    CONTEXT extends Record<string, DisposableContext<any>>,
    ENV extends AnyEnvironment
>(
    options: IGetRunnigFeatureOptions<NAME, DEPS, API, CONTEXT, ENV>
): Promise<{
    dispose: () => Promise<void>;
    runningApi: Running<Feature<NAME, DEPS, API, CONTEXT>, ENV>;
    engine: RuntimeEngine;
}> {
    const { feature } = options;
    const { engine, dispose } = await runEngineEnvironment(options);
    const { api } = engine.get(feature);
    return {
        runningApi: api,
        engine,
        dispose,
    };
}

async function importWithProperError(filePath: string): Promise<unknown> {
    try {
        return import(filePath);
    } catch (ex: unknown) {
        throw new Error(`failed evaluating file: ${filePath}\n${(ex as Error).message ?? ex}`);
    }
}

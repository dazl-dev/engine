import { Environment } from '@dazl/engine-core';
import { ICreateEntrypointsOptions, createConfigLoaders, createFeatureLoadersSourceCode } from './create-entrypoint.js';
import { ConfigurationEnvironmentMapping, FeatureEnvironmentMapping } from '../types.js';

const { stringify } = JSON;

export function createNodeEnvironmentManagerEntrypoint({
    featureEnvironmentsMapping,
    configMapping,
    moduleType,
}: {
    featureEnvironmentsMapping: FeatureEnvironmentMapping;
    configMapping: ConfigurationEnvironmentMapping;
    moduleType: 'cjs' | 'esm';
}) {
    return `
import { pathToFileURL } from 'node:url';    
import { NodeEnvManager } from '@dazl/engine-runtime-node';

const featureEnvironmentsMapping = ${stringify(featureEnvironmentsMapping)};
const configMapping = ${stringify(configMapping)};
const meta = { url: ${moduleType === 'esm' ? 'import.meta.url' : 'pathToFileURL(__filename).href'} };
export const manager = new NodeEnvManager(meta, featureEnvironmentsMapping, configMapping);

`.trimStart();
}

export function createNodeEntrypoint({
    features,
    childEnvs,
    featureName,
    configName,
    mode,
    configurations,
    config = [],
    eagerEntrypoint,
    env,
    featuresBundleName,
}: ICreateEntrypointsOptions) {
    const runningEnv = new Environment(
        env.name,
        env.type,
        env.env.endpointType,
        env.flatDependencies?.map((d) => d.env) ?? [],
    );
    const featureLoaders = createFeatureLoadersSourceCode(
        features.values(),
        childEnvs,
        env,
        eagerEntrypoint,
        featuresBundleName,
    );
    const configLoaders = createConfigLoaders({
        configurations,
        mode,
        configName,
        envName: env.name,
        staticBuild: true,
        loadConfigFileTemplate: (filePath) => `import(${stringify(filePath)})`,
    });
    return `
import { main, COM } from "@dazl/engine-core";
import { bindRpcListener, bindMetricsListener, parseRuntimeOptions, ParentPortHost } from "@dazl/engine-runtime-node";
import { parseArgs } from "node:util";
import { workerData } from "node:worker_threads";

const options = workerData?.runtimeOptions ?? parseRuntimeOptions();
const verbose = options.get('verbose') ?? false;
const envId = options.get('environment_id') ?? 'unknown_environment';

if (verbose) {
    console.log('[${env.name}]: Started with options: ', options);
}

const unbindMetricsListener = bindMetricsListener();
const unbindTerminationListener = bindRpcListener('terminate', async () => {
    if (verbose) {
        console.log('[${env.name}]: Termination Requested. Waiting for engine.');
    }
    unbindTerminationListener();
    unbindMetricsListener();
    try {
        const engine = await running;
        console.log('[${env.name}]: Terminating');
        return engine.shutdown();
    } catch (e) {
        return;
    }
});
const running = main({
    featureName: ${stringify(featureName)}, 
    configName: ${stringify(configName)},
    env: ${stringify(runningEnv, null, 2)},
    featureLoaders: ${featureLoaders},
    configLoaders: ${configLoaders},
    publicConfigsRoute: "", // disables fetching configs from server
    options,
    contextualConfig: ({ resolvedContexts }) => {
        return [
            ...(workerData ? [COM.configure({
                config: {
                    resolvedContexts,
                    host: new ParentPortHost(),
                    id: envId,
                },
            })] : []),
            ...${stringify(config, null, 2)}
        ];
    },
}).then((engine)=>{
    if (verbose) {
        console.log('[${env.name}]: Running')
    }
    return engine;
}).catch(e => {
    unbindMetricsListener();
    process.exitCode = 1;
    console.error(envId, e, { runtimeOptions: options });
});
`.trimStart();
}

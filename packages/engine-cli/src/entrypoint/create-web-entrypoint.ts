import { Environment } from '@dazl/engine-core';
import { ICreateEntrypointsOptions, createConfigLoaders, createFeatureLoadersSourceCode } from './create-entrypoint.js';

const { stringify } = JSON;

export function createMainEntrypoint({
    features,
    childEnvs,
    featureName,
    configName,
    publicPath,
    publicPathVariableName,
    configurations,
    mode,
    staticBuild,
    publicConfigsRoute,
    config = [],
    eagerEntrypoint,
    absImports,
    env,
    featuresBundleName,
}: ICreateEntrypointsOptions) {
    const runningEnv = new Environment(
        env.name,
        env.type,
        env.env.endpointType,
        env.flatDependencies?.map((d) => d.env) ?? [],
    );
    const configLoaders = createConfigLoaders({
        configurations,
        mode,
        configName,
        envName: env.name,
        staticBuild,
        loadConfigFileTemplate: webLoadConfigFileTemplate,
    });
    const runtimePublicPath = handlePublicPathTemplate(publicPath, publicPathVariableName);
    const featureLoaders = createFeatureLoadersSourceCode(
        features.values(),
        childEnvs,
        env,
        eagerEntrypoint,
        featuresBundleName,
        absImports,
    );

    return `
import { main, COM, getEngineEntryOptions } from '@dazl/engine-core';

const options = getEngineEntryOptions(${stringify(env.name)}, globalThis)
const runtimePublicPath = ${runtimePublicPath};
main({
    featureName: ${stringify(featureName)}, 
    configName: ${stringify(configName)},
    env: ${stringify(runningEnv, null, 2)},
    featureLoaders: ${featureLoaders},
    configLoaders: ${configLoaders},    
    publicConfigsRoute: ${stringify(publicConfigsRoute)},
    options,
    contextualConfig: ({ resolvedContexts }) => {
        return [
            COM.configure({
                config: {
                    publicPath: runtimePublicPath,
                    resolvedContexts,
                },
            }),
            ...${stringify(config, null, 2)}
        ];
    },
}).catch((e)=>{
    console.error(${JSON.stringify(runningEnv.env)}, e, { runtimeOptions: options });
    throw e;
});
`;
}

function handlePublicPathTemplate(publicPath: string | undefined, publicPathVariableName: string | undefined) {
    return `(() => {
let publicPath = ${typeof publicPath === 'string' ? stringify(publicPath) : '__webpack_public_path__'};
if (options.has('publicPath')) {
    publicPath = options.get('publicPath');
} else if (${typeof publicPathVariableName === 'string'}) {
    const topWindow = globalThis.parent ?? globalThis;
    try {
        if(topWindow[${stringify(publicPathVariableName)}]) {
            publicPath = topWindow[${stringify(publicPathVariableName)}];
        }
    } catch(e) {
        /* ignore */
    }
}
__webpack_public_path__= publicPath;
return publicPath;
})()`;
}

const topLevelConfigLoaderPath = '/top-level-config-loader';

function webLoadConfigFileTemplate(filePath: string, scopedName: string, configEnvName = ''): string {
    const request = stringify(
        topLevelConfigLoaderPath +
            `?configLoaderModuleName=@dazl/engine-cli/default-config-loader&scopedName=${scopedName}&envName=${configEnvName}!` +
            filePath,
    );
    return `import(/* webpackChunkName: "[config]${scopedName}${configEnvName}" */ /* webpackMode: 'eager' */ ${request})`;
}

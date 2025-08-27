import { type ILaunchHttpServerOptions, NodeEnvManager } from '@dazl/engine-runtime-node';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FeatureEnvironmentMapping } from './types.js';

export async function runLocalNodeManager(
    featureEnvironmentsMapping: FeatureEnvironmentMapping,
    execRuntimeOptions: Map<string, string | boolean | undefined>,
    outputPath: string = 'dist-engine',
    serverOptions?: ILaunchHttpServerOptions,
) {
    const manager = new NodeEnvManager(
        { url: pathToFileURL(join(outputPath, 'node/')).href },
        featureEnvironmentsMapping,
    );
    const { port } = await manager.autoLaunch(execRuntimeOptions, serverOptions);
    return { port, manager };
}

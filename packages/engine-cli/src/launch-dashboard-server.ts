import { basename, join } from 'node:path';
import { nodeFs as fs } from '@file-services/node';
import express from 'express';
import { LaunchOptions, RouteMiddleware, launchServer } from './start-dev-server.js';
import { runLocalNodeManager } from './run-local-mode-manager.js';
import { NodeConfigManager } from './node-config-manager.js';
import type {
    BuildConfiguration,
    ConfigurationEnvironmentMapping,
    FeatureEnvironmentMapping,
    StaticConfig,
} from './types.js';

export type ConfigLoadingMode = 'fresh' | 'watch' | 'import';

export async function launchDashboardServer(
    rootDir: string,
    serveStatic: StaticConfig[],
    httpServerPort: number,
    socketServerOptions: LaunchOptions['socketServerOptions'],
    featureEnvironmentsMapping: FeatureEnvironmentMapping,
    configMapping: ConfigurationEnvironmentMapping,
    runtimeOptions: Map<string, string | boolean | undefined>,
    outputPath: string,
    configLoadingMode: ConfigLoadingMode,
    analyzeForBuild: () => Promise<unknown>,
    waitForBuildReady?: (cb: () => void) => boolean,
    buildConditions?: string[],
    extensions?: string[],
    buildConfiguration?: BuildConfiguration,
): Promise<ReturnType<typeof launchServer>> {
    const staticMiddlewares = serveStatic.map(({ route, directoryPath }) => ({
        path: route,
        handlers: express.static(directoryPath),
    }));

    const { middleware, run, listOpenManagers } = runOnDemandSingleEnvironment(
        rootDir,
        runtimeOptions,
        featureEnvironmentsMapping,
        configMapping,
        outputPath,
        configLoadingMode,
        waitForBuildReady,
        buildConditions,
        extensions,
    );
    const autoRunFeatureName = runtimeOptions.get('feature') as string | undefined;
    if (autoRunFeatureName) {
        const port = await run(autoRunFeatureName, runtimeOptions.get('config') as string, '');
        if (Array.isArray(buildConfiguration?.webConfig.entryPoints)) {
            buildConfiguration?.webConfig.entryPoints?.map((filePath) => {
                if (typeof filePath === 'string') {
                    const name = basename(filePath);
                    console.log(
                        `Engine application in running at http://localhost:${port}/${name.replace('.web.ts', '.html')}`,
                    );
                }
            });
        }
    } else {
        console.log('No explicit feature name provided skipping auto launch use the dashboard to run features');
    }

    const devMiddlewares: RouteMiddleware[] = [
        {
            path: '/is_alive',
            handlers: (_req, res) => {
                res.json({ alive: true });
            },
        },
        {
            path: '/dashboard',
            handlers: express.static(join(import.meta.dirname, 'dashboard')),
        },
        {
            path: '/api/engine/metadata',
            handlers: (req, res) => {
                res.json({
                    featureEnvironmentsMapping,
                    configMapping,
                    runtimeOptions: Object.fromEntries(runtimeOptions.entries()),
                    outputPath,
                    openManagers: listOpenManagers(),
                });
            },
        },
        {
            path: '/api/engine/run',
            handlers: [express.json(), middleware],
        },
        {
            path: '/api/engine/analyze',
            handlers: (_req, res) => {
                analyzeForBuild()
                    .then(() => {
                        res.json({
                            status: 'done-analyzing',
                        });
                    })
                    .catch((e) => {
                        res.status(500).json({ error: e.message });
                    });
            },
        },
    ];

    return await launchServer({
        httpServerPort,
        socketServerOptions,
        middlewares: [...devMiddlewares, ...staticMiddlewares],
    });
}
function runOnDemandSingleEnvironment(
    rootDir: string,
    runtimeOptions: Map<string, string | boolean | undefined>,
    featureEnvironmentsMapping: FeatureEnvironmentMapping,
    configMapping: ConfigurationEnvironmentMapping,
    outputPath: string,
    configLoadingMode: 'fresh' | 'watch' | 'import',
    waitForBuildReady?: (cb: () => void) => boolean,
    buildConditions?: string[],
    extensions?: string[],
) {
    let currentlyDisposing: Promise<unknown> | undefined;
    const openManagers = new Map<string, Awaited<ReturnType<typeof runLocalNodeManager>>>();
    const configManager =
        configLoadingMode === 'fresh' || configLoadingMode === 'watch'
            ? new NodeConfigManager(configLoadingMode, {
                  absWorkingDir: rootDir,
                  conditions: buildConditions,
                  resolveExtensions: extensions,
              })
            : undefined;

    async function run(featureName: string, configName: string, runtimeArgs: string) {
        try {
            await disposeOpenManagers();
        } catch (e) {
            openManagers.clear();
            currentlyDisposing = undefined;
            console.warn('[Engine]: Error disposing open environments, disposing in background...', e);
        }

        const runOptions = new Map(runtimeOptions.entries());
        runOptions.set('feature', featureName);
        runOptions.set('config', configName);
        if (runtimeArgs.trim()) {
            for (const [key, value] of Object.entries(JSON.parse(runtimeArgs))) {
                runOptions.set(key, String(value));
            }
        }
        const runningNodeManager = await runLocalNodeManager(featureEnvironmentsMapping, runOptions, outputPath, {
            routeMiddlewares: [
                {
                    path: '*splat',
                    handlers: blockDuringBuild(waitForBuildReady),
                },
            ],
        });
        openManagers.set(`${featureName}(+)${configName}(+)${runtimeArgs}`, runningNodeManager);
        return runningNodeManager.port;
    }

    async function disposeOpenManagers() {
        await currentlyDisposing;
        if (openManagers.size > 0) {
            await configManager?.disposeAll();
            const toDispose = [];
            for (const { manager } of openManagers.values()) {
                toDispose.push(manager.dispose());
            }
            currentlyDisposing = Promise.all(toDispose);
            await currentlyDisposing;
            openManagers.clear();
            currentlyDisposing = undefined;
        }
    }

    function middleware(req: express.Request, res: express.Response) {
        let message = `running on demand feature: "${req.body.featureName}" config: "${req.body.configName}"`;
        if (req.body.runtimeArgs) {
            message += ` runtimeArgs: "${req.body.runtimeArgs}"`;
        }
        if (req.body.restart) {
            message += ' with restart';
        }
        console.log(message);
        run(req.body.featureName, req.body.configName, req.body.runtimeArgs)
            .then((port) => {
                res.json({
                    url: genUrl(port, req.body.featureName, req.body.configName),
                    openManagers: listOpenManagers(),
                });
            })
            .catch((e) => {
                res.status(500).json({ error: e.message });
            });
    }

    function listOpenManagers() {
        return Array.from(openManagers.entries(), ([key, { port }]) => {
            const [featureName, configName, runtimeArgs] = key.split('(+)') as [string, string, string];
            return {
                featureName,
                configName,
                runtimeArgs,
                port,
                url: genUrl(port, featureName, configName),
            };
        });
    }

    function genUrl(port: number, featureName: string, configName: string): string {
        return `http://localhost:${port}/main.html?feature=${encodeURIComponent(featureName)}&config=${encodeURIComponent(configName)}`;
    }
    return { middleware, run, listOpenManagers };
}

function blockDuringBuild(waitForBuildReady: ((cb: () => void) => boolean) | undefined) {
    let engineImage;
    return (_req: express.Request, res: express.Response, next: express.NextFunction) => {
        const building = waitForBuildReady?.(() => {
            res.end('<script>location.reload()</script></html>');
        });
        if (building) {
            engineImage ??= fs.readFileSync(join(import.meta.dirname, 'dashboard', 'engine.jpeg'), 'base64');
            res.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width">
                    <title>Fast Refresh</title>
                    <style>
                        html {
                            background: url('data:image/jpeg;base64,${engineImage}');
                            background-size: cover;
                            background-position: center;
                            background-repeat: no-repeat;
                            height: 100%;
                            padding: 0;
                            margin: 0;
                            display: flex;
                            align-items: center;
                            justify-content: center; 
                        }
                        body {
                            height: 100%;
                            width: 100%;
                            margin: 0;
                        }
                        h1 {
                            text-align: center; 
                            color: white;
                            font-size: 14vw;
                            background: radial-gradient(rgba(0, 0, 0, 0.0), rgba(0, 0, 0, 0.9));
                            width: 100%;
                            display: block;
                        }
                    </style>
                </head>
                <body>
                    <h1>Building...</h1>
                </body>`);
        } else {
            next();
        }
    };
}

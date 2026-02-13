import {
    AnyEnvironment,
    Communication,
    IRunOptions,
    Message,
    MultiCounter,
    socketClientInitializer,
} from '@dazl/engine-core';
import { IDisposable, SetMultiMap } from '@dazl/patterns';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { extname } from 'node:path';
import { WsServerHost } from './ws-node-host.js';
import { ILaunchHttpServerOptions, launchEngineHttpServer } from './launch-http-server.js';
import { workerThreadInitializer2 } from './worker-thread-initializer2.js';
import { bindMetricsListener, type PerformanceMetrics } from './metrics-utils.js';

export interface RunningNodeEnvironment {
    id: string;
    dispose(): Promise<void>;
    getMetrics(): Promise<PerformanceMetrics>;
}

export interface NodeEnvConfig extends Pick<AnyEnvironment, 'env' | 'endpointType'> {
    envType: AnyEnvironment['envType'] | 'remote';
    remoteUrl?: string;
}

export type NodeEnvsFeatureMapping = {
    featureToEnvironments: Record<string, string[]>;
    availableEnvironments: Record<string, NodeEnvConfig>;
};

export class NodeEnvManager implements IDisposable {
    private disposables = new Set<() => Promise<void>>();
    isDisposed = () => false;
    dispose = async () => {
        this.isDisposed = () => true;
        for (const disposable of this.disposables) {
            await disposable();
        }
    };
    envInstanceIdCounter = new MultiCounter();
    id = 'node-environment-manager';
    openEnvironments = new SetMultiMap<string, RunningNodeEnvironment>();
    constructor(
        private importMeta: { url: string },
        private featureEnvironmentsMapping: NodeEnvsFeatureMapping,
    ) {}
    public async autoLaunch(
        runtimeOptions: Map<string, string | boolean | undefined>,
        serverOptions: ILaunchHttpServerOptions = {},
    ) {
        process.env.ENGINE_FLOW_V2_DIST_URL = this.importMeta.url;
        const disposeMetricsListener = bindMetricsListener(() => this.collectMetricsFromAllOpenEnvironments());
        const verbose = Boolean(runtimeOptions.get('verbose'));

        const staticDirPath = fileURLToPath(new URL('../web', this.importMeta.url));
        const { port, socketServer, app, close } = await launchEngineHttpServer({ staticDirPath, ...serverOptions });
        runtimeOptions.set('enginePort', port.toString());

        const clientsHost = new WsServerHost(socketServer);
        const disposeOnConnectionOpen = serverOptions.onConnectionOpen
            ? clientsHost.registerConnectionHandler(serverOptions.onConnectionOpen)
            : undefined;
        const disposeOnConnectionClose = serverOptions.onConnectionClose
            ? clientsHost.registerDisconnectionHandler(serverOptions.onConnectionClose)
            : undefined;
        const disposeOnReconnection = serverOptions.onConnectionReconnect
            ? clientsHost.registerReconnectionHandler(serverOptions.onConnectionReconnect)
            : undefined;
        const disposeConnectionHandlers = () => {
            disposeOnConnectionOpen?.();
            disposeOnConnectionClose?.();
            disposeOnReconnection?.();
        };
        clientsHost.addEventListener('message', handleRegistrationOnMessage);
        const forwardingCom = new Communication(clientsHost, 'clients-host-com');
        function handleRegistrationOnMessage({ data }: { data: Message }) {
            const knownClientHost = forwardingCom.getEnvironmentHost(data.from);
            if (knownClientHost === undefined) {
                forwardingCom.registerEnv(data.from, clientsHost);
            } else if (knownClientHost !== clientsHost) {
                console.warn(
                    `[ENGINE]: environment ${data.from} is already registered to a different host, reregistering`,
                );
                forwardingCom.clearEnvironment(data.from);
                forwardingCom.registerEnv(data.from, knownClientHost);
            }
        }
        await this.runFeatureEnvironments(verbose, runtimeOptions, forwardingCom);

        app.get('/health', (_req, res) => {
            res.status(200).end();
        });

        const disposeAutoLaunch = async () => {
            disposeMetricsListener();
            await this.closeAll();
            clientsHost.removeEventListener('message', handleRegistrationOnMessage);
            disposeConnectionHandlers();
            await clientsHost.dispose();
            await close();
        };

        if (this.isDisposed()) {
            await disposeAutoLaunch();
        } else {
            this.disposables.add(disposeAutoLaunch);
        }

        if (process.send) {
            process.send({ port });
        }
        return { port };
    }

    async closeAll() {
        await Promise.all([...this.openEnvironments.values()].map((env) => this.closeEnv(env)));
    }

    private closeEnv(env: RunningNodeEnvironment) {
        this.openEnvironments.delete(env.id, env);
        return env.dispose();
    }

    private async runFeatureEnvironments(
        verbose: boolean,
        runtimeOptions: Map<string, string | boolean | undefined>,
        forwardingCom: Communication,
    ) {
        const featureName = runtimeOptions.get('feature');
        if (!featureName || typeof featureName !== 'string') {
            throw new Error('feature is a required for autoLaunch');
        }

        const hasFeatureDef = Object.hasOwn(this.featureEnvironmentsMapping.featureToEnvironments, featureName);
        if (!hasFeatureDef) {
            throw new Error(`[ENGINE]: no environments found for feature ${featureName}`);
        }

        const envNames = this.featureEnvironmentsMapping.featureToEnvironments[featureName] || [];

        if (verbose) {
            console.log(`[ENGINE]: found the following environments for feature ${featureName}:\n${envNames}`);
        }

        await Promise.all(
            envNames.map((envName) => this.initializeEnvironment(envName, runtimeOptions, forwardingCom, verbose)),
        );
    }

    private createEnvironmentFileUrl(envName: string) {
        const env = this.featureEnvironmentsMapping.availableEnvironments[envName];
        if (!env) {
            throw new Error(`environment ${envName} not found`);
        }
        return new URL(`${env.env}.${env.envType}${extname(this.importMeta.url)}`, this.importMeta.url);
    }

    async initializeEnvironment(
        envName: string,
        runtimeOptions: IRunOptions,
        forwardingCom: Communication,
        verbose: boolean,
    ) {
        const env = this.featureEnvironmentsMapping.availableEnvironments[envName];
        if (!env) {
            throw new Error(`environment ${envName} not found`);
        }
        let runningEnv: RunningNodeEnvironment;
        if (env.envType === 'remote') {
            if (!env.remoteUrl) {
                throw new Error(`Remote URL for environment ${envName} is not defined`);
            }
            runningEnv = await socketClientInitializer({ communication: forwardingCom, env, envUrl: env.remoteUrl });
        } else {
            const envWithInit = workerThreadInitializer2({
                communication: forwardingCom,
                env: env,
                workerURL: this.createEnvironmentFileUrl(envName),
                runtimeOptions: runtimeOptions,
            });
            await envWithInit.initialize();
            runningEnv = envWithInit;
        }

        this.openEnvironments.add(envName, runningEnv);
        if (verbose) {
            console.log(`[ENGINE]: Environment ${runningEnv.id} is ready`);
        }
    }

    async collectMetricsFromAllOpenEnvironments() {
        const metrics = {
            marks: [] as PerformanceEntry[],
            measures: [] as PerformanceEntry[],
        };

        for (const runningEnv of this.openEnvironments.values()) {
            const { marks, measures } = await runningEnv.getMetrics();
            metrics.marks.push(...marks.map((m) => ({ ...m, debugInfo: `${runningEnv.id}:${m.name}` })));
            metrics.measures.push(...measures.map((m) => ({ ...m, debugInfo: `${runningEnv.id}:${m.name}` })));
        }
        return metrics;
    }
}

export function parseRuntimeOptions() {
    const { values: args } = parseArgs({
        strict: false,
        allowPositionals: false,
    });

    return new Map(Object.entries(args));
}

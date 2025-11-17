import { loadEngineConfig, runEngine } from './engine-build.js';
import { resolveRuntimeOptions } from './resolve-runtime-options.js';
import { runLocalNodeManager } from './run-local-mode-manager.js';
import isCI from 'is-ci';
import type {
    ConfigurationEnvironmentMapping,
    FeatureEnvironmentMapping,
    IExecutableApplication,
    IFeatureTarget,
} from './types.js';
import { join } from 'path';
import { checkWatchSignal } from './watch-signal.js';
import { readMetadataFiles } from './metadata-files.js';

export const OUTPUT_PATH = process.env.ENGINE_OUTPUT_PATH || join(process.cwd(), 'dist-engine');

export class ManagedRunEngine implements IExecutableApplication {
    private ready!: Promise<void>;
    private runMetadata!: {
        featureEnvironmentsMapping: FeatureEnvironmentMapping;
        configMapping: ConfigurationEnvironmentMapping;
    };
    constructor(private options: { skipBuild: boolean; allowStale: boolean }) {}
    init() {
        if (this.ready === undefined) {
            this.ready = this.build();
        }
        return this.ready;
    }
    private async build() {
        if (this.options.skipBuild) {
            try {
                const runMetadata = readMetadataFiles(OUTPUT_PATH);
                if (!runMetadata) {
                    throw new Error('Metadata files not found');
                }
                this.runMetadata = runMetadata;
                const hasWatcherActive = await checkWatchSignal(OUTPUT_PATH);
                if (hasWatcherActive) {
                    console.log('[Engine]: Running with prebuilt application and active watcher.');
                    return;
                } else if (isCI || this.options.allowStale) {
                    console.log('[Engine]: Running with cache and without active watcher.');
                    return;
                } else {
                    console.warn(`[Engine]: Running without active watcher. Rebuilding application.`);
                }
            } catch {
                console.warn(
                    `[Engine]: Could not read prebuilt metadata files at ${OUTPUT_PATH}`,
                    '[Engine]: Building fresh engine application',
                    '[Engine]: (in order fully take advantage of the prebuilt, run `engine --watch` before running this flow.)',
                );
            }
        }
        const engineConfig = await loadEngineConfig(process.cwd());

        this.runMetadata = await runEngine({
            build: true,
            clean: true,
            dev: true,
            watch: false,
            run: false,
            outputPath: OUTPUT_PATH,
            engineConfig,
            writeMetadataFiles: true,
        });
    }
    public getServerPort(): Promise<number> {
        throw new Error('not implemented');
    }

    public async runFeature({ featureName, configName = '', overrideConfig, runtimeOptions }: IFeatureTarget) {
        await this.init();

        if (!featureName) {
            throw new Error('featureName and configName are required');
        }

        const execRuntimeOptions = resolveRuntimeOptions({
            configName,
            featureName,
            outputPath: OUTPUT_PATH,
            verbose: false,
            runtimeArgs: {
                ...runtimeOptions,
                topLevelConfig: JSON.stringify(overrideConfig),
            },
        });

        const { port, manager } = await runLocalNodeManager(
            this.runMetadata.featureEnvironmentsMapping,
            execRuntimeOptions,
            OUTPUT_PATH,
        );

        return {
            featureName,
            configName,
            url: `http://localhost:${port}/main.html`,
            dispose: () => manager.dispose(),
            getMetrics: () => manager.collectMetricsFromAllOpenEnvironments(),
        };
    }

    public async closeServer() {}
}

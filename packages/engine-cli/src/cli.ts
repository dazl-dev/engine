import { cli, command } from 'cleye';
import type { EngineConfig } from './types.js';

async function engine() {
    const engineConfigCli = cli({
        help: false,
        flags: {
            engineConfigFilePath: {
                type: String,
                description: 'Engine config file path',
                default: undefined,
            },
        },
    });

    const { loadEngineConfig, runEngine } = await import('./engine-build.js');

    const engineConfig = await loadEngineConfig(process.cwd(), engineConfigCli.flags.engineConfigFilePath);

    const flags = {
        feature: {
            type: String,
            description: 'Feature name',
            default: undefined,
            alias: 'f',
        },
        config: {
            type: String,
            description: 'Config name',
            default: undefined,
            alias: 'c',
        },
        runtimeArgs: {
            type: (value: string) => {
                const args = JSON.parse(value);
                if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
                    return args as Record<string, string | boolean>;
                } else {
                    throw new Error(`Invalid runtime arguments: ${value} (expected JSON object)`);
                }
            },
            description: `Runtime arguments E.g. '{"projectPath": "..."}'`,
            default: {} as Record<string, string | boolean>,
        },
        clean: {
            type: Boolean,
            description: 'Clean output directory',
            default: true,
        },
        dev: {
            type: Boolean,
            description: 'Development mode',
            default: undefined,
        },
        watch: {
            type: Boolean,
            description: 'Watch for changes',
            default: false,
        },
        run: {
            type: Boolean,
            description: 'Run the application',
            default: undefined,
        },
        customEntrypoints: {
            type: String,
            description: 'Custom entrypoint. this feature disable feature analysis',
            default: undefined,
        },
        forceAnalyze: {
            type: Boolean,
            description: 'Force analyze features',
            default: true,
        },
        engineConfigFilePath: {
            type: String,
            description: 'Engine config file path',
            default: undefined,
        },
        publicConfigsRoute: {
            type: String,
            description: 'Public configs route',
            default: 'configs',
        },
        writeMetadataFiles: {
            type: Boolean,
            description: 'Write metadata files',
            default: true,
        },
        buildTargets: {
            type: (value: string) => {
                if (value === 'node' || value === 'web' || value === 'both' || value === 'electron') {
                    return value;
                } else {
                    throw new Error(`Invalid build targets: ${value} (expected node, web, both)`);
                }
            },
            description: 'Build targets (node, web, both)',
            default: 'both',
        },
        publicPath: {
            type: String,
            description: 'Public path',
            default: '',
        },
        title: {
            type: String,
            description: 'Title to set on the generated html file',
            default: undefined,
        },
        staticBuild: {
            type: Boolean,
            description: 'Enable config build via config loaders',
            default: false,
        },
        configLoadingMode: {
            type: (value: string) => {
                if (value === 'fresh' || value === 'watch' || value === 'import') {
                    return value;
                } else {
                    throw new Error(`Invalid config loading mode: ${value}`);
                }
            },
            description: 'Config loading mode (fresh, watch, import)',
            default: undefined,
        },
        verbose: {
            type: Boolean,
            description: 'Verbose output',
            default: false,
        },
    } as const;

    addEngineConfigToCliFlag(engineConfig, flags);

    const argv = cli({
        commands: [
            command({
                name: 'analyze',
                flags: {
                    feature: {
                        type: String,
                        description: 'Feature name',
                        default: undefined,
                    },
                },
            }),
            command({
                name: 'generate',
                parameters: ['<featureName>'],
                help: {
                    usage:
                        'engine generate MyFeature\n' +
                        'engine generate MyFeature --features=packages\n' +
                        'engine generate MyFeature --features=packages --templates=feature-template',
                    description: 'Generates feature from a template',
                },
                flags: {
                    features: {
                        type: String,
                        description:
                            'Path to directory containing features; new one would be created inside it.\n' +
                            'If not provided and not in `engine.config.js`, `cwd` will be used',
                    },
                    templates: {
                        type: String,
                        description:
                            'Path to directory containing templates for feature generation.\n' +
                            'If not provided and not in `engine.config.js`, built-in templates would be used',
                    },
                },
            }),
        ],
        name: 'engine',
        help: {
            usage: false,
            description: 'Run and build engine applications',
        },
        flags,
    } as const);

    const rootDir = process.cwd();
    if (argv.command === 'analyze') {
        const { analyzeCommand } = await import('./analyze-command.js');
        await analyzeCommand({ rootDir, feature: argv.flags.feature, engineConfig });
    } else if (argv.command === 'generate') {
        const featureName = argv._.featureName;
        const { featureTemplatesFolder, featuresDirectory } = engineConfig;
        const featuresPath = argv.flags.features ?? featuresDirectory;
        const templatesPath = argv.flags.templates ?? featureTemplatesFolder;
        const { generateFeature } = await import('./feature-generator/index.js');
        const { nodeFs: fs } = await import('@file-services/node');
        generateFeature({
            fs,
            rootDir,
            featureName,
            templatesPath,
            featuresPath,
        });
    } else {
        const dev = argv.flags.dev ?? argv.flags.watch;
        const run = argv.flags.run ?? dev;
        const configLoadingMode = argv.flags.configLoadingMode ?? (argv.flags.watch ? 'watch' : 'import');
        const runtimeArgs = argv.flags.runtimeArgs;
        addRuntimeArgsFlagsFromEngineConfig(engineConfig, argv.flags, runtimeArgs);

        await runEngine({
            rootDir,
            ...argv.flags,
            runtimeArgs,
            dev,
            run,
            configLoadingMode,
            engineConfig,
        });
    }
}

engine().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});

function addEngineConfigToCliFlag(engineConfig: EngineConfig, flags: Record<string, unknown>) {
    if (engineConfig.engineRuntimeArgsFlags) {
        Object.keys(engineConfig.engineRuntimeArgsFlags).forEach((flagKey) => {
            if (flagKey in flags) {
                throw new Error(
                    `Flag ${flagKey} already exists in engine cli flags. pick another name, or use the runtimeArgs flag.`,
                );
            }
        });
        Object.assign(flags, engineConfig.engineRuntimeArgsFlags);
    }
}

function addRuntimeArgsFlagsFromEngineConfig(
    engineConfig: EngineConfig,
    flags: Record<string, unknown>,
    runtimeArgs: Record<string, string | boolean>,
) {
    if (engineConfig.engineRuntimeArgsFlags) {
        Object.keys(engineConfig.engineRuntimeArgsFlags).forEach((flag) => {
            const value = flags[flag];
            if (value !== undefined) {
                if (typeof value === 'string' || typeof value === 'boolean') {
                    runtimeArgs[flag] = value;
                } else {
                    throw new Error(
                        `Invalid value for flag Runtime Argument ${flag}: ${value as string} (expected string or boolean)`,
                    );
                }
            }
        });
    }
}

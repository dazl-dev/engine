import { join } from 'node:path';
import { BuildOptions, Plugin } from 'esbuild';
import { topLevelConfigPlugin } from './top-level-config-plugin-esbuild.js';
import { htmlPlugin } from './esbuild-html-plugin.js';
import { dynamicEntryPlugin } from './esbuild-dynamic-entry-plugin.js';
import { EntryPoints, EntryPointsPaths } from './create-entrypoints.js';
import type { OverrideConfigHook } from './types.js';

export interface CreateBuildConfigOptions {
    dev: boolean;
    buildPlugins: Plugin[] | OverrideConfigHook;
    publicPath: string;
    outputPath: string;
    buildConditions?: string[];
    extensions?: string[];
    entryPoints: EntryPoints;
    jsOutExtension: '.js' | '.mjs';
    nodeFormat: 'esm' | 'cjs';
    entryPointsPaths?: EntryPointsPaths;
    staticBuild: boolean;
    title?: string;
    favicon?: string;
}

function parseEntryFile(entryFile: string) {
    const parts = entryFile.split('.');
    if (parts.length !== 3) {
        throw new Error(`Invalid entry file: ${entryFile}`);
    }
    const [envName, envType, ext] = parts;
    return { envName, envType, ext, key: `${envName}.${envType}` };
}

export function createBuildConfiguration(options: CreateBuildConfigOptions) {
    const {
        dev,
        outputPath,
        publicPath,
        buildPlugins,
        buildConditions,
        extensions,
        entryPoints,
        jsOutExtension,
        nodeFormat,
        entryPointsPaths,
        staticBuild,
        title,
        favicon,
    } = options;
    const { webEntryPoints, nodeEntryPoints } = entryPoints;
    const { webEntryPointsPaths, nodeEntryPointsPaths } = entryPointsPaths || {};

    const webEntryPointsNoExt = new Set<string>();
    for (const key of webEntryPoints.keys()) {
        webEntryPointsNoExt.add(parseEntryFile(key).key);
    }

    const commonPlugins = Array.isArray(buildPlugins) ? buildPlugins : [];

    const commonConfig = {
        target: 'es2020',
        bundle: true,
        format: 'esm',
        publicPath,
        metafile: true,
        sourcemap: true,
        keepNames: true,
        conditions: buildConditions,
        resolveExtensions: extensions,
        outExtension: { '.js': jsOutExtension },
        loader: {
            '.json': 'json',
            '.png': 'file',
            '.jpeg': 'file',
            '.jpg': 'file',
            '.svg': 'file',
            '.woff': 'file',
            '.woff2': 'file',
            '.ttf': 'file',
        },
        plugins: [...commonPlugins, topLevelConfigPlugin({ emit: staticBuild || !dev })],
    } satisfies BuildOptions;

    const webConfig = {
        ...commonConfig,
        platform: 'browser',
        outdir: join(outputPath, 'web'),
        banner: {
            js: `globalThis.__webpack_public_path__ = ${JSON.stringify(
                publicPath,
            )};\nglobalThis.DEFAULT_WORKER_TYPE = 'module';`,
        },
        plugins: [
            ...commonConfig.plugins,
            dynamicEntryPlugin({
                virtualEntryPoints: webEntryPoints,
                loader: 'js',
                entryPointsOnDisk: webEntryPointsPaths,
            }),
            htmlPlugin({
                toHtmlPath(filename) {
                    const { envName, envType, key } = parseEntryFile(filename);
                    const entry = webEntryPointsNoExt.has(key);
                    if (!entry) {
                        throw new Error(`Could not find entrypoint for ${key} in ${[...webEntryPoints.keys()]}}`);
                    }
                    const htmlFileName = envType === 'electron-renderer' ? `${envName}.${envType}` : envName;
                    return `${htmlFileName}.html`;
                },
                title,
                faviconFilePath: favicon,
            }),
        ],
    } satisfies BuildOptions;

    const nodeConfig = {
        ...commonConfig,
        platform: 'node',
        format: nodeFormat,
        outdir: join(outputPath, 'node'),
        plugins: [
            ...commonConfig.plugins,
            dynamicEntryPlugin({
                virtualEntryPoints: nodeEntryPoints,
                loader: 'js',
                entryPointsOnDisk: nodeEntryPointsPaths,
            }),
        ],
    } satisfies BuildOptions;

    if (typeof buildPlugins === 'function') {
        return buildPlugins({ webConfig, nodeConfig, dev });
    }

    return {
        webConfig,
        nodeConfig,
    };
}

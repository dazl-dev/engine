# @dazl/engine-cli

This package provides a command line interface for the engine.

## Installation

```bash
npm install @dazl/engine-cli
```

## Usage

This package exposes an `engine` command that can be used to start the engine.

```bash
npx engine --watch
```

This will start the engine in watch mode, and open the dev server for the engine dashboard.

## Options

| Option                 | Type                                    | Default Value | Description                                                                |
| ---------------------- | --------------------------------------- | ------------- | -------------------------------------------------------------------------- |
| `buildTargets`         | `node` \| `web` \| `both` \| `electron` | `both`        | Target platform(s) for the build.                                          |
| `help`                 | boolean                                 | `false`       | Displays help information if true.                                         |
| `clean`                | boolean                                 | `true`        | Whether to clean the build directory before building.                      |
| `watch`                | boolean                                 | `false`       | Rebuilds on file changes if true.                                          |
| `dev`                  | boolean                                 | `watch` value | Enables development mode. Defaults to the value of 'watch'.                |
| `run`                  | boolean                                 | `dev` value   | Runs the built application if true. Defaults to the value of 'dev'.        |
| `verbose`              | boolean                                 | `false`       | Enables verbose logging if true.                                           |
| `writeMetadataFiles`   | boolean                                 | `true`        | Whether to write metadata files during the build process.                  |
| `runtimeArgs`          | JSON object                             | `{}`          | Arbitrary arguments to pass at runtime, specified as a JSON string.        |
| `feature`              | string                                  |               | Specifies a particular feature to build or run.                            |
| `config`               | string                                  |               | Path to a specific configuration file to use.                              |
| `publicPath`           | string                                  | `''`          | Base path for serving static files. Defaults to an empty string.           |
| `engineConfigFilePath` | string                                  |               | Path to the engine configuration file.                                     |
| `publicConfigsRoute`   | string                                  | `configs`     | Route under which public configurations are served. Defaults to 'configs'. |

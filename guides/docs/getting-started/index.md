---
sidebar_position: 2
---

# Getting started with the Engine

Best way to understand how the engine works is to create a new project and start playing with it.

## Prerequisites

Before we start playing with the engine, we will need to perform some setup.
First, let's create a new project,

```bash
mkdir hello-engine && cd hello-engine && git init && npm init -y
```

Let's make a node application, in typescript.

```bash
npm install typescript -D

```

In your blank typescript repo:

1. install engine-core package `npm i @dazl/engine-core`
2. install engine-cli as a dev dependency `npm i -D @dazl/engine-cli`
3. if this is a typescript project, in the root of the project create an `engine.config.js` file, and inside we should
   add one of the following:

```ts
/** @type {import('@dazl/engine-cli').EngineConfig} */
export default {
  // the folder where the transpiled js files will be located
  featureDiscoveryRoot: 'dist',
};
```

create `tsconfig.json` file in the root directory

```json
{
  "compilerOptions": {
    "target": "es2020",
    "lib": ["dom", "es2020"],
    "jsx": "react-jsx",
    "module": "commonjs",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "importsNotUsedAsValues": "error",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true
  }
}
```

Then, let's create 2 files in the `src/feature/hello-world` folder (every feature should have it's own `<feature_name>`
directory):

a. hello-world.feature.ts
b. hello-world.my-env.env.ts

### hello-world.feature

Let's paste these contents to the file

```ts
import { Feature, Environment } from '@dazl/engine-core';

// this is the environment in which this feature will set itself up
export const myEnv = new Environment('my-env', 'node', 'single');

// our first feature
export default new Feature({
  id: 'helloWorldFeature',
  api: {},
});
```

We create the feature file, in which we declare what is the feature's API and its Id.
We also create a new environment - `my-env`.

###### \* It is important to export the environment from the feature file, this is how `engineer` picks it up

### hello-world.my-env.env.ts

Let's paste these contents to the file

```ts
import helloWorldFeature, { myEnv } from './hello-world.feature';

helloWorldFeature.setup(myEnv, ({ run }) => {
  console.log('hello');

  run(() => {
    console.log('world');
  });
});
```

We set our feature up in the `my-env` environment.
In the setup phase of the feature, we will print `hello`
In the run phase, we will print `world`.

## Running the feature

In order to run this feature, all we need to do, is in the terminal just to run `npx engineer start -f hello-world` .
This command will locate from the `process.cwd()` or `join(process.cwd(), featureDiscoveryRoot)` if provided,
the `hello-world` feature and run it.

The `-f` and `-c` flags in engineer are calculated as follows:

1. find the name of the closest package.

2. remove the scope, if exists, and the `-feature` suffix of exists.

3. if the feature name is different then the result in #2, append the feature name (as stated in the file name) with
   a `/`.

In our example, the package name was `@example/hello-feature` then the call to engineer would
be `npx engineer start -f hello/hello-world`, while if the package name was `@example/hello-world-feature`, the call to
engineer would be `npx engineer start -f hello-world`

We should see `hello` followed by `world` written in the console.

For a live example, go to `examples/hello-world` and run `npm start`

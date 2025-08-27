# @dazl/engine-core

Run-time abstractions for creating multi-environment web applications while practicing feature-oriented software development.

## Approach

- An application is a set of one or more features.
- A feature contains all the integration code required to get a subset of product functionality implemented.
- Features may depend on other features, consume their exposed services and register into their slots.
- A service is a set of functions exposed as an API of a feature.
- A slot is a registry of any type, which allows pluggability via registration.
- Environments (browser/webworker/iframe) are defined by features, and have semantic names (main/processing/preview).
- Each slot and service is available in a specific environment.
- Services can be marked as accessible cross-environments, which exposes them as async APIs in those environment.

## Feature

A feature is combined of several files:

- `<feature-name>.feature.ts` - feature definition file.
- `<feature-name>.<some-env>.env.ts` - some-env specific setup code.
- `<feature-name>.<another-env>.env.ts` - another-env specific setup code.

### Feature definition file

Feature definition is created in a `<feature-name>.feature.ts` file, and is exposed as the `default` export.

For example:

```ts
/* my-feature.feature.ts */

import { Feature } from '@dazl/engine-core';

/* defining a new feature */
export default new Feature({
  id: 'myFeature' /* unique id for the feature */,

  dependencies: [
    /* other features the feature depends on */
  ],

  api: {
    /* slots, services, and configurations of the feature */
  },
});
```

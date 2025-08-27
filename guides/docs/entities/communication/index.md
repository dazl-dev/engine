---
sidebar_position: 4
---

# Communication

The communication is a feature and an entity that is responsible for communication
between [[environments|runtime.entities.environment]].

This mechanism is responsible for [[services|runtime.entities.service]] to be available in the environments in which the
service is not provided from.

Each time a service declares that it's with the `allowRemoteAccess` [[runtime.entities.service#^remote_access]] a proxy
is created in every other environment, which will trigger the `callMethod` method of the communication instance, and
will call the service on the remote environment.

For communication between two environments to work, they need to establish a communication protocol.
Basically, what is needed to be done is to tell the current communication instance how to send messages to the
communication instance of the other environment.

The `@dazl/engine-core` package exports [[runtime.entities.communication.initializers]], which are responsible for
establishing a connection between engine environments, **when using engineer**

So let's say we have an engine application with two environments declared an exported from the `f1` feature declaration
file

```ts
import { COM } from '@dazl/engine-core';

export const browserEnv = new Environment('main', 'window', 'single');
export const serverEnv = new Environment('server', 'node', 'single');

export default new Feature({
  id: 'f1',
  api: {
    echoService: Service.withType<{ echo(): string }>().providedFrom(serverEnv),
  },
  dependencies: [COM],
});
```

In this point, if we use `engineer` cli, we can just use the \_\_ API to establish a connection between the `main`
and `server` environments, in the `main` environment setup

```ts
import { socketClientInitializer } from '@dazl/engine-core';
import f1, { browserEnv, serverEnv } from './f1.feature';

f1.setup(browserEnv, ({ echoService }, { COM: { communication } }) => {
  socketClientInitializer({ communication, env: serverEnv });
  echoService.echo().then(console.log).catch(console.error);
});
```

From this point in time, a connection is established between the two environments, and they can call each other's
services.

Full [list](initializers.md) of the provided initializers.

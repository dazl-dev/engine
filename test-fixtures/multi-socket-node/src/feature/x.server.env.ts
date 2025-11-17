import { socketClientInitializer } from '@dazl/engine-core';
import sampleFeature, { anotherServerEnv, serverEnv } from './x.feature.js';

sampleFeature.setup(serverEnv, ({ anotherEchoService, run, onDispose }, { COM: { communication } }) => {
    run(async () => {
        const { dispose } = await socketClientInitializer({ communication, env: anotherServerEnv });
        onDispose(dispose);
    });
    return {
        echoService: {
            echo: () => anotherEchoService.echo(),
            getName: () => 'gaga',
        },
    };
});

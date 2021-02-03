import contextualFeature, { procEnv } from './preload-context.feature';
globalThis.envMessages = [...(globalThis.envMessages ?? []), 'procEnvEval'];

contextualFeature.setup(procEnv, () => {
    return {
        procEnvMessages: {
            getProcEnvMessages: () => [...globalThis.envMessages],
        },
    };
});

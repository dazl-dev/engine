import sampleFeature, { NODE_1 } from './x.feature';

sampleFeature.setup(NODE_1, () => {
    return {
        nodeEnv1: {
            getPid: () => process.pid,
        },
    };
});

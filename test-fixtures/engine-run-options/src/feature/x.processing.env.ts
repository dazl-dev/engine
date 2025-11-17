import sampleFeature, { PROC } from './x.feature.js';
import { MyInterfaceClass } from './interface.js';
import { RUN_OPTIONS } from '@dazl/engine-core';

sampleFeature.setup(PROC, ({ [RUN_OPTIONS]: runOptions }) => {
    const options = {
        foo: runOptions.get('foo'),
    };
    return {
        passedOptions: new MyInterfaceClass(options),
    };
});

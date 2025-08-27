import { createMemoryFs } from '@file-services/memory';
import { expect } from 'chai';
import { loadFeatureDirectory } from '@dazl/engine-cli';

describe('loadFeatureDirectory', () => {
    it('locates engine entity files for a given directory', () => {
        const fs = createMemoryFs({
            src: {
                'my-thing.feature.ts': ``,
                'my-thing.main.env.ts': ``,
                'my-config.config.ts': ``,
                'my-config2.config.ts': ``,
                'main.test.context.ts': ``,
            },
        });

        const directoryPath = '/src';
        const results = loadFeatureDirectory(directoryPath, fs);

        expect(results).to.eql({
            directoryPath,
            features: ['/src/my-thing.feature.ts'],
            configurations: ['/src/my-config.config.ts', '/src/my-config2.config.ts'],
            envs: ['/src/my-thing.main.env.ts'],
            contexts: ['/src/main.test.context.ts'],
            preloads: [],
        });
    });

    it('ignores sub directories by default', () => {
        const fs = createMemoryFs({
            src: {
                'my-thing.feature.ts': ``,
                'my-config.config.ts': ``,
                'my-config2.config.ts': ``,
                sub: {
                    'my-config3.config.ts': ``,
                },
            },
        });

        const directoryPath = '/src';
        const { configurations } = loadFeatureDirectory(directoryPath, fs);
        expect(configurations).to.not.include('/src/sub/my-config3.config.ts');
    });

    it('supports multiple features getting picked up', () => {
        const fs = createMemoryFs({
            'my-thing.feature.ts': ``,
            'my-thing2.feature.ts': ``,
            'my-config.config.ts': ``,
            'my-config2.config.ts': ``,
        });

        const directoryPath = '/';
        const results = loadFeatureDirectory(directoryPath, fs);

        expect(results).to.eql({
            directoryPath,
            features: ['/my-thing.feature.ts', '/my-thing2.feature.ts'],
            configurations: ['/my-config.config.ts', '/my-config2.config.ts'],
            envs: [],
            contexts: [],
            preloads: [],
        });
    });

    it('supports preloads of envs and contexts', () => {
        const fs = createMemoryFs({
            src: {
                'my-thing.main.preload.ts': '',
                'my-thing.main.somecontext.preload.ts': '',
            },
        });

        const directoryPath = '/src';
        const results = loadFeatureDirectory(directoryPath, fs);

        expect(results).to.eql({
            directoryPath,
            features: [],
            configurations: [],
            envs: [],
            contexts: [],
            preloads: ['/src/my-thing.main.preload.ts', '/src/my-thing.main.somecontext.preload.ts'],
        });
    });
});

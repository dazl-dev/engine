import { dirname } from 'path';
import { expect } from 'chai';
import { createDisposables } from '@wixc3/engine-core';
import { startServerNewProcess } from './utils';

describe('Parent feature', function () {
    const projectPath = dirname(require.resolve('@example/preload/package.json'));
    const featureName = 'preload/parent';
    const disposables = createDisposables();
    afterEach(disposables.dispose);

    it('When loading a feature that depends on a feature that has preload, the preloads are still loaded first', async () => {
        const { dispose, browserProvider, featureUrl } = await startServerNewProcess({
            projectPath,
            featureName,
        });
        disposables.add(browserProvider.dispose);
        disposables.add(dispose);

        const page = await browserProvider.loadPage(featureUrl);

        await page.waitForSelector('#envMessages');
        const content = await page.$eval('#envMessages', (e) => e.textContent!);
        const parsedContent = JSON.parse(content) as { window: string[]; node: string[]; worker: string[] };

        expect(parsedContent.node).to.eql([
            'node',
            'preload',
            'parentPreload',
            'preloadInit',
            'parentPreloadInit',
            'feature',
            'enveval',
            'parentEnvEval',
        ]);
    });
});

import { expect } from 'chai';
import fs from '@file-services/node';
import { createBrowserProvider } from '@wixc3/engine-test-kit';
import { startDevServer } from '@wixc3/engineer';
import guiFeature from '@wixc3/engineer/gui-feature';
import { join } from 'path';
import { createDisposables } from '@wixc3/create-disposables';

const engineFeatureFixturePath = fs.dirname(require.resolve('@fixture/engine-single-feature/package.json'));

describe('engineer:gui', function () {
    this.timeout(15_000);
    const disposables = createDisposables();
    const browserProvider = createBrowserProvider();

    const setup = async ({ featureName, basePath }: { featureName?: string; basePath: string }) => {
        const { dispose, engine, devServerFeature } = await startDevServer({
            engineerEntry: 'engineer/gui',
            targetApplicationPath: basePath,
            devServerOnly: false,
        });

        const runtimeFeature = engine.get(guiFeature);

        const runningPort = await new Promise<number>((resolve) => {
            devServerFeature.serverListeningHandlerSlot.register(({ port }) => {
                resolve(port);
            });
        });

        disposables.add(dispose);

        return {
            dispose,
            engine,
            runtimeFeature,
            config: { featureName, port: runningPort },
        };
    };

    const loadPage = async (url: string) => {
        const page = await browserProvider.loadPage(url);
        disposables.add(() => page.close());
        return page;
    };

    afterEach(function () {
        this.timeout(30_000);
        return disposables.dispose();
    });
    after(browserProvider.dispose);

    it('should allow visit of dashboard gui', async () => {
        const {
            config: { port },
        } = await setup({ basePath: engineFeatureFixturePath });

        const page = await loadPage(`http://localhost:${port}/dashboard`);

        const text = await page.evaluate(() => document.body.textContent!.trim());

        expect(text).to.include('Feature');
        expect(text).to.include('Config');
    });

    it('should allow visit of dashboard gui through full path', async () => {
        // the project path should be the root of the monorepo, so it will locate the dashboard features
        const {
            config: { port },
        } = await setup({ basePath: join(__dirname, '../../../') });

        const page = await loadPage(`http://localhost:${port}/main-dashboard.html?feature=engineer/gui`);

        await page.locator('body', { hasText: 'Feature' }).waitFor({ state: 'visible' });
        await page.locator('body', { hasText: 'Config' }).waitFor({ state: 'visible' });
    });
});

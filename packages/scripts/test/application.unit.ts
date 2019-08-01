import fs from '@file-services/node';
import { createBrowserProvider, createDisposables } from '@wixc3/engine-test-kit';
import { expect } from 'chai';
import { join } from 'path';
import { waitFor } from 'promise-assist';
import { Page } from 'puppeteer';
import { Application } from '../src/application';
const { directoryExists } = fs.promises;

describe('Application', function() {
    this.timeout(10_000);
    const disposables = createDisposables();
    const browserProvider = createBrowserProvider();

    afterEach(function() {
        this.timeout(30_000);
        return disposables.dispose();
    });
    after(() => browserProvider.dispose());

    const loadPage = async (url: string) => {
        const page = await browserProvider.loadPage(url);
        disposables.add(() => page.close());
        return page;
    };

    const engineFeatureFixturePath = join(__dirname, './fixtures/engine-feature');
    const multiFeatureFixturePath = join(__dirname, './fixtures/engine-multi-feature');

    describe('build', () => {
        it(`supports building features with a single fixture`, async () => {
            const app = new Application(engineFeatureFixturePath);
            await app.build({ featureName: 'x', configName: 'dev' });

            expect(await directoryExists(app.outputPath), 'has dist folder').to.equal(true);
        });
    });

    describe('start', () => {
        it(`serves and allows running a feature`, async () => {
            const app = new Application(engineFeatureFixturePath);
            const { close, port } = await app.start();
            disposables.add(() => close());

            const page = await loadPage(`http://localhost:${port}/main.html`);

            const text = await page.evaluate(() => document.body.textContent!.trim());

            expect(text).to.equal('App is running.');
        });

        const getMultiFeatureValues = (page: Page) =>
            page.evaluate(() => {
                return {
                    mySlot: JSON.parse(document.getElementById('mySlot')!.textContent!),
                    myConfig: JSON.parse(document.getElementById('myConfig')!.textContent!)
                };
            });

        it(`uses first found feature as default`, async () => {
            const app = new Application(multiFeatureFixturePath);
            const { close, port } = await app.start();
            disposables.add(() => close());

            const page = await loadPage(`http://localhost:${port}/main.html`);

            const { myConfig, mySlot } = await getMultiFeatureValues(page);

            expect(myConfig).to.eql({
                tags: []
            });
            expect(mySlot).to.eql([]);
        });

        it(`serves a fixture feature`, async () => {
            const app = new Application(multiFeatureFixturePath);
            const { close, port } = await app.start();
            disposables.add(() => close());

            const page = await loadPage(`http://localhost:${port}/main.html?feature=test/variant`);

            const { myConfig, mySlot } = await getMultiFeatureValues(page);

            expect(myConfig).to.eql({
                tags: []
            });
            expect(mySlot).to.eql(['testing 1 2 3']);
        });

        it(`allows specfiying a config`, async () => {
            const app = new Application(multiFeatureFixturePath);
            const { close, port } = await app.start();
            disposables.add(() => close());

            const page = await loadPage(`http://localhost:${port}/main.html?feature=test/variant&config=test/variant2`);

            const { myConfig, mySlot } = await getMultiFeatureValues(page);

            expect(myConfig).to.eql({
                tags: ['variant', '2']
            });
            expect(mySlot).to.eql(['testing 1 2 3']);
        });
    });

    it.only(`runs node environments`, async () => {
        const featurePath = join(__dirname, './fixtures/node-env');
        const app = new Application(featurePath);
        const runningApp = await app.start({
            featureName: 'engine-local/x',
            configName: 'engine-local/dev'
        });
        disposables.add('closing app', () => runningApp.close());

        const page = await loadPage(`http://localhost:${runningApp.port}/main.html`);

        await waitFor(async () => {
            expect(await page.evaluate(() => document.body.textContent!.trim())).to.equal('Hello');
        });
    });
});

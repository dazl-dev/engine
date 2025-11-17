import { expect } from 'chai';
import { createTempDirectorySync } from 'create-temp-directory';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeConfigManager } from '@dazl/engine-cli';

describe('NodeConfigManager', function () {
    let cm: NodeConfigManager;
    let tmp: ReturnType<typeof createTempDirectorySync>;
    const write = (path: string, content: string) => writeFileSync(join(tmp.path, path), content);
    beforeEach(() => {
        tmp = createTempDirectorySync();
        cm = new NodeConfigManager('watch', { absWorkingDir: tmp.path });
    });
    afterEach(async () => {
        await cm.dispose();
        tmp.remove();
    });

    it('loadConfigs', async () => {
        write('config1.js', 'export default {file: "@test/config1.js"}');
        write('config2.js', 'export default {file: "@test/config2.js"}');

        const configsPaths = await cm.loadConfigs(['./config1.js', './config2.js']);

        expect(configsPaths).to.eql([
            {
                file: '@test/config1.js',
            },
            {
                file: '@test/config2.js',
            },
        ]);
    });

    it('loaded config into cache', async () => {
        write('config1.js', 'export default {file: "@test/config1.js"}');
        write('config2.js', 'export default {file: "@test/config2.js"}');

        await cm.loadConfigs(['./config1.js', './config2.js']);
        const buildStats = cm.runningBuilds.get(cm.hashConfig(['./config1.js', './config2.js']));

        expect(buildStats?.currentValue).to.eql([
            {
                file: '@test/config1.js',
            },
            {
                file: '@test/config2.js',
            },
        ]);
    });

    it('watch loaded config', async () => {
        write('config1.js', 'export default {file: "@test/config1.js"}');
        write('config2.js', 'export default {file: "@test/config2.js"}');

        await cm.loadConfigs(['./config1.js', './config2.js']);

        write('config1.js', 'export default {file: "@test/config1.js", updated: true}');

        await new Promise((r) => setTimeout(r, 500));

        const buildStats = cm.runningBuilds.get(cm.hashConfig(['./config1.js', './config2.js']));

        expect(buildStats?.currentValue).to.eql([
            {
                file: '@test/config1.js',
                updated: true,
            },
            {
                file: '@test/config2.js',
            },
        ]);
    });

    it('dispose build', async () => {
        write('config1.js', 'export default {file: "@test/config1.js"}');
        write('config2.js', 'export default {file: "@test/config2.js"}');
        const configsPaths = ['./config1.js', './config2.js'];
        await cm.loadConfigs(configsPaths);
        await cm.disposeBuild(configsPaths);
        const buildStats = cm.runningBuilds.get(cm.hashConfig(configsPaths));
        expect(buildStats, 'build stats should be undefined').to.equal(undefined);
    });
});

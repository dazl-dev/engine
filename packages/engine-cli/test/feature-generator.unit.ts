import { createMemoryFs } from '@file-services/memory';
import { nodeFs as fs } from '@file-services/node';
import { templateCompilerProvider } from '@dazl/common';
import { expect } from 'chai';
import { expectedDirContents, FEATURE_NAME, templatesDirContents } from './mocks/feature-generator.mocks.js';
import {
    enrichContext,
    generateFeature,
    mapDirectory,
    pathToFeaturesDirectory,
    readDirectoryContentsSync,
    writeDirectoryContentsSync,
} from '@dazl/engine-cli/dist/feature-generator';

describe('Feature Generator', () => {
    it('reads directory contents', () => {
        const memoryFs = createMemoryFs(templatesDirContents);
        const contentsFromFs = readDirectoryContentsSync(memoryFs, '/');
        expect(contentsFromFs).to.eql(templatesDirContents);
    });

    it('writes directory contents', () => {
        const memoryFs = createMemoryFs();
        writeDirectoryContentsSync(memoryFs, expectedDirContents, '/');
        const contentsFromFs = readDirectoryContentsSync(memoryFs, '/');
        expect(contentsFromFs).to.eql(expectedDirContents);
    });

    it('maps directory contents', () => {
        const dirContents = {
            'text1.txt': 'text1.txt content',
            folder: {
                'text2.txt': 'text2.txt content',
            },
        };
        const mapper = (name: string, content?: string) => ({
            name: `map-${name}`,
            content: `map-${content || ''}`,
        });

        const mappedDirectory = mapDirectory(dirContents, mapper);

        expect(mappedDirectory).to.eql({
            'map-text1.txt': 'map-text1.txt content',
            'map-folder': {
                'map-text2.txt': 'map-text2.txt content',
            },
        });
    });

    it('generates a feature directory from templates directory', () => {
        const memoryFs = createMemoryFs({
            templates: templatesDirContents,
        });

        generateFeature({
            fs: memoryFs,
            rootDir: memoryFs.cwd(),
            featureName: FEATURE_NAME,
            featuresPath: '/packages',
            templatesPath: '/templates',
        });

        const featureDir = readDirectoryContentsSync(memoryFs, '/packages');

        expect(featureDir).to.eql(expectedDirContents);
    });

    describe('pathToFeaturesDirectory()', () => {
        const featuresDir = './packages';
        const expectedPath = fs.normalize('/proj/packages');

        it('Goes up in path to features folder', () => {
            expect(pathToFeaturesDirectory(fs, '/proj/packages/some-package', featuresDir)).to.equal(expectedPath);
        });

        it('Adds `featuresDir` to the path if path has no such parent directory', () => {
            expect(pathToFeaturesDirectory(fs, '/proj', featuresDir)).to.equal(expectedPath);
        });

        it('Returns normalized path if features directory name is not specified', () => {
            const expectedPath = fs.normalize('/proj');
            expect(pathToFeaturesDirectory(fs, '/proj')).to.equal(expectedPath);
        });
    });

    describe('enrichContext()', () => {
        const featureName = 'Bla-Bla';
        const enrichedContext = enrichContext({ featureName });
        const templateCompiler = templateCompilerProvider(enrichedContext);

        it('keeps original context', () => {
            const template = '${featureName}';
            const compiled = templateCompiler(template);
            expect(compiled).to.equal('Bla-Bla');
        });

        it('adds camelCase option', () => {
            const template = '${featureName.camelCase}';
            const compiled = templateCompiler(template);
            expect(compiled).to.equal('blaBla');
        });

        it('adds dashCase option', () => {
            const template = '${featureName.dashCase}';
            const compiled = templateCompiler(template);
            expect(compiled).to.equal('bla-bla');
        });

        it('adds pascalCase option', () => {
            const template = '${featureName.pascalCase}';
            const compiled = templateCompiler(template);
            expect(compiled).to.equal('BlaBla');
        });
    });
});

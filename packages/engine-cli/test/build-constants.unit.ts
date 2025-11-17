import { isPreloadFile, parsePreloadFileName } from '@dazl/engine-cli';
import { expect } from 'chai';

describe('isPreloadFile', () => {
    it('should return true for valid preload for regular env', () => {
        expect(isPreloadFile('file.env.preload.ts')).to.eq(true);
    });
    it('should return true for valid preload for context', () => {
        expect(isPreloadFile('file.env.context.preload.ts')).to.eq(true);
    });
    it('should return false for not valid extention', () => {
        expect(isPreloadFile('file.preload.md')).to.eq(false);
    });
    it('should return false for valid extention but not preload', () => {
        expect(isPreloadFile('file.ts')).to.eq(false);
        expect(isPreloadFile('file.js')).to.eq(false);
        expect(isPreloadFile('file.tsx')).to.eq(false);
    });
});

describe('parsePreloadFileName', () => {
    const featureName = 'featureName';
    const envName = 'envName';
    const contextName = 'contextName';
    it('should detect featureName and envName and no childEnvName if childenv', () => {
        expect(parsePreloadFileName(`${featureName}.${envName}.preload.ts`)).to.eql({
            featureName,
            envName,
            childEnvName: undefined,
        });
    });
    it('should detect feaure, env and context with contextual', () => {
        expect(parsePreloadFileName(`${featureName}.${envName}.${contextName}.preload.ts`)).to.eql({
            featureName,
            envName,
            childEnvName: contextName,
        });
    });
    it('should throw if no env', () => {
        expect(() => parsePreloadFileName(`${featureName}.preload.ts`)).to.throw(
            `cannot parse preload file: ${featureName}.preload.ts`,
        );
    });
});

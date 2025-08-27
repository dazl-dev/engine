import { extractModuleRequests } from '@dazl/engine-cli';
import { expect } from 'chai';
import ts from 'typescript';

describe('extractModuleRequests', () => {
    const extract = (fileContents: string) =>
        extractModuleRequests(ts.createSourceFile('test.ts', fileContents, ts.ScriptTarget.ESNext));

    it('finds default imports', () => {
        const fileContents = `import foo from 'target';`;
        expect(extract(fileContents)).to.eql(['target']);
    });

    it('finds default imports with empty named', () => {
        const fileContents = `import foo, {} from 'target';`;
        expect(extract(fileContents)).to.eql(['target']);
    });

    it('finds mixed default and namespace import', () => {
        const fileContents = `import foo, * as bar from 'target';`;
        expect(extract(fileContents)).to.eql(['target']);
    });

    it('finds named imports', () => {
        const fileContents = `import { foo } from 'target';`;
        expect(extract(fileContents)).to.eql(['target']);
    });

    it('finds mixed type/no-type default-named imports', () => {
        const fileContents = `import foo, { type bar } 'target';`;
        expect(extract(fileContents)).to.eql(['target']);
    });

    it('finds mixed type/no-type named imports', () => {
        const fileContents = `import {type a, b, type c} 'target';`;
        expect(extract(fileContents)).to.eql(['target']);
    });

    it('finds bare imports', () => {
        const fileContents = `import 'target';`;
        expect(extract(fileContents)).to.eql(['target']);
    });

    it('finds dynamic imports', () => {
        const fileContents = `const f = await import('target');`;
        expect(extract(fileContents)).to.eql(['target']);
    });

    it('finds require calls', () => {
        const fileContents = `const f = require('target');`;
        expect(extract(fileContents)).to.eql(['target']);
    });

    it('finds named exports', () => {
        const fileContents = `export { foo } from 'target';`;
        expect(extract(fileContents)).to.eql(['target']);
    });

    it('finds namespace exports', () => {
        const fileContents = `export * from 'target';`;
        expect(extract(fileContents)).to.eql(['target']);
    });

    it('finds renamed namespace exports', () => {
        const fileContents = `export * as foo from 'target';`;
        expect(extract(fileContents)).to.eql(['target']);
    });

    // type-only imports/exports

    it('ignores type named imports', () => {
        const fileContents = `import type { foo } from 'target';`;
        expect(extract(fileContents)).to.eql([]);
    });

    it('ignores type named imports symbols', () => {
        const fileContents = `import { type foo } from 'target';`;
        expect(extract(fileContents)).to.eql([]);
    });

    it('ignored all type named imports', () => {
        const fileContents = `import {type a, type b, type c} 'target';`;
        expect(extract(fileContents)).to.eql([]);
    });

    it('ignores type default imports', () => {
        const fileContents = `import type foo from 'target';`;
        expect(extract(fileContents)).to.eql([]);
    });

    it('ignores type namespace imports', () => {
        const fileContents = `import type * as foo from 'target';`;
        expect(extract(fileContents)).to.eql([]);
    });

    it('ignores type namespace exports', () => {
        const fileContents = `export type * from 'target';`;
        expect(extract(fileContents)).to.eql([]);
    });

    it('ignores renamed type namespace exports', () => {
        const fileContents = `export type * as foo from 'target';`;
        expect(extract(fileContents)).to.eql([]);
    });

    it('ignores named type exports', () => {
        const fileContents = `export { type a, type b } from 'target';`;
        expect(extract(fileContents)).to.eql([]);
    });
});

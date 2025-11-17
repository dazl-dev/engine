import { expect } from 'chai';
import { getEngineEntryOptions, IRunOptions } from '@dazl/engine-core';

describe('helpers', () => {
    describe('getEngineEntryOptions', () => {
        it('it gets engine entry options from query string, from script url, from engineEntryOptions', () => {
            const document = {
                currentScript: { dataset: { engineRunOptions: 'http://localhost:3000?one=0&two=1&script=123' } },
            };
            const location = { search: 'one=2&two=2&search=123' };
            const engineEntryOptions = ({
                envName,
                currentRunOptions,
            }: {
                envName: string;
                currentRunOptions: IRunOptions;
            }) => {
                if (envName === 'thisTest') {
                    return new Map([...currentRunOptions, ['injected', '123'], ['one', '1']]);
                }
                return new Map();
            };
            const result = getEngineEntryOptions('thisTest', { document, location, engineEntryOptions });

            expect(result.get('one'), 'Prioritises injected options over search string and script url').to.eql('1');
            expect(result.get('two'), 'Prioritises search params over script url').to.eql('2');
            expect(result.get('script'), 'Gets options from script url').to.eql('123');
            expect(result.get('search'), 'Gets options from search string').to.eql('123');
            expect(result.get('injected'), 'Gets options from engineEntryOptions').to.eql('123');
        });
        it('works without inject function', () => {
            const document = {
                currentScript: { dataset: { engineRunOptions: 'http://localhost:3000?one=0&script=123' } },
            };
            const location = { search: 'one=1&search=123' };
            const result = getEngineEntryOptions('thisTest', { document, location });

            expect(result.get('one'), 'Prioritises injected options over search string and script url').to.eql('1');
            expect(result.get('script'), 'Gets options from script url').to.eql('123');
            expect(result.get('search'), 'Gets options from search string').to.eql('123');
        });
        it('allows to override options completely with getEngineEntryOptions', () => {
            const document = {
                currentScript: { dataset: { engineRunOptions: 'http://localhost:3000?script=123' } },
            };
            const location = { search: 'search=123' };
            const engineEntryOptions = ({ envName }: { envName: string }) => {
                if (envName === 'thisTest') {
                    return new Map([['injected', '123']]);
                }
                return new Map();
            };
            const result = getEngineEntryOptions('thisTest', { document, location, engineEntryOptions });

            expect(result.get('script'), 'Ignores options from script url').to.eql(undefined);
            expect(result.get('search'), 'Ignores options from search string').to.eql(undefined);
            expect(result.get('injected'), 'Gets options from engineEntryOptions').to.eql('123');
        });
    });
});

import { SetMultiMap } from '@dazl/patterns';
import { mergeAll, mergeResults } from '@dazl/engine-cli';
import { expect } from 'chai';

describe('mergeAll', () => {
    it('merges all elements of an iterable', () => {
        const actual: { a: Map<number, number>; b: Set<number> } = mergeAll([
            { a: new Map([[0, 0]]), b: new Set([0]) },
            { a: new Map([[1, 1]]), b: new Set([1]) },
            { a: new Map([[2, 2]]), b: new Set([2]) },
        ]);
        expect(actual).to.eql({
            a: new Map([
                [0, 0],
                [1, 1],
                [2, 2],
            ]),
            b: new Set([0, 1, 2]),
        });
    });
});

describe('mergeResults', () => {
    describe('maps', () => {
        it('merges Maps with no overlap', () => {
            const actual: Map<number, number> = mergeResults(new Map([[0, 0]]), new Map([[1, 1]]));
            expect(actual).to.eql(
                new Map([
                    [0, 0],
                    [1, 1],
                ]),
            );
        });
        it('merges Maps with overlaps, overriding the first arg', () => {
            const actual: Map<number, number> = mergeResults(new Map([[0, 0]]), new Map([[0, 1]]));
            expect(actual).to.eql(new Map([[0, 1]]));
        });
    });

    describe('SetMultiMap', () => {
        it('merges SetMultiMap with no overlap', () => {
            const a = new SetMultiMap([[0, 0]]);
            const b = new SetMultiMap([[1, 1]]);
            const actual: SetMultiMap<number, number> = mergeResults(a, b);
            expect(actual).to.eql(
                new SetMultiMap([
                    [0, 0],
                    [1, 1],
                ]),
            );
        });
        it('merges SetMultiMap with overlaps, merging the value sets', () => {
            const a = new SetMultiMap([[0, 0]]);
            const b = new SetMultiMap([[0, 1]]);
            const actual: SetMultiMap<number, number> = mergeResults(a, b);
            expect(actual).to.eql(
                new SetMultiMap([
                    [0, 0],
                    [0, 1],
                ]),
            );
        });
    });

    describe('Sets', () => {
        it('merges sets', () => {
            const a = new Set([0, 1]);
            const b = new Set([1, 2]);
            const actual: Set<number> = mergeResults(a, b);
            expect(actual).to.eql(new Set([0, 1, 2]));
        });
    });

    describe('objects', () => {
        it('merges objects fields of objects', () => {
            const actual: {
                a: SetMultiMap<number, number>;
                b: Map<number, number>;
            } = mergeResults(
                {
                    a: new SetMultiMap([[0, 0]]),
                    b: new Map([[0, 0]]),
                    c: new Set([0]),
                },
                {
                    a: new SetMultiMap([[0, 1]]),
                    b: new Map([[1, 1]]),
                    c: new Set([1]),
                },
            );
            expect(actual).to.eql({
                a: new SetMultiMap([
                    [0, 0],
                    [0, 1],
                ]),
                b: new Map([
                    [0, 0],
                    [1, 1],
                ]),
                c: new Set([0, 1]),
            });
        });

        it('combines the fields of all objects', () => {
            const actual: {
                a: SetMultiMap<number, number>;
                b: Map<number, number>;
                c: Set<number>;
            } = mergeResults(
                {
                    a: new SetMultiMap([[0, 0]]),
                    b: new Map([[0, 0]]),
                },
                {
                    b: new Map([[1, 1]]),
                    c: new Set([1]),
                },
            );
            expect(actual).to.eql({
                a: new SetMultiMap([[0, 0]]),
                b: new Map([
                    [0, 0],
                    [1, 1],
                ]),
                c: new Set([1]),
            });
        });
    });

    describe('type mismatch', () => {
        it('throws a type mismatch error', () => {
            expect(() => {
                mergeResults(new Set(), new Map());
            }).to.throw(`Invalid results: type mismatch, expected Set, got Map`);
        });
    });

    describe('empty results', () => {
        it('returns the non empty result', () => {
            expect(mergeResults({}, undefined)).to.eql({});
            expect(mergeResults(undefined, {})).to.eql({});
            expect(mergeResults(new Set([1]))).to.eql(new Set([1]));
        });
    });
});

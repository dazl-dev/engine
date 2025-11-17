import { isPlainObject, concat, isMap, isSet, reduce } from '@dazl/common';
import { isSetMultiMap, SetMultiMap } from '@dazl/patterns';

export const mergeAll = <T>(results: Iterable<T>): T =>
    reduce(
        results,
        // @ts-expect-error making overloading the function redundant
        (merged, newItem) => mergeResults(merged, newItem) as T,
        undefined as unknown as T,
    );

export function mergeResults<K, V>(a?: Map<K, V>, b?: Map<K, V>): Map<K, V>;
export function mergeResults<V>(a?: Set<V>, b?: Set<V>): Set<V>;
export function mergeResults<K, V>(a?: SetMultiMap<K, V>, b?: SetMultiMap<K, V>): SetMultiMap<K, V>;
export function mergeResults<M1 extends object, M2 extends object>(a?: M1, b?: M2): M1 & M2;
export function mergeResults<M extends Map<K, V> | Set<V> | SetMultiMap<K, V> | object, K, V>(a?: M, b?: M): M {
    if (a === undefined || b === undefined) {
        return (a ?? b) as M;
    }
    if (isPlainObject(a) && isPlainObject(b)) {
        return reduce(
            concat(Object.entries(a), Object.entries(b)),
            (result, [key, value]) => {
                result[key] = mergeResults(result[key], value as object);
                return result;
            },
            {} as any,
        ) as M;
    }
    const type = getIterableType(a, b);
    if (type) {
        return new type(concat(a as Iterable<any>, b as Iterable<any>)) as M;
    }
    return b; // override older results
}

const getIterableType = (a: any, b: any) =>
    checkType(a, b, isMap, Map) || checkType(a, b, isSet, Set) || checkType(a, b, isSetMultiMap, SetMultiMap);

function checkType(a: any, b: any, check: (a: any) => boolean, type: any) {
    if (check(a)) {
        if (check(b)) {
            return type;
        } else {
            throw new Error(`Invalid results: type mismatch, expected ${type.name}, got ${b?.constructor?.name}`);
        }
    }
    return undefined;
}

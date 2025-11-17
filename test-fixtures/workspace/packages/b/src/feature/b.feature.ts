import { Feature } from '@dazl/engine-core';

export default class B extends Feature<'b'> {
    id = 'b' as const;
    api = {};
}

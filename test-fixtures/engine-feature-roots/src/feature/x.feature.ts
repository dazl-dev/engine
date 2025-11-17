import { Environment, Feature, Slot } from '@dazl/engine-core';

export const MAIN = new Environment('main', 'window', 'single');

export default class XTestFeature extends Feature<'XTestFeature'> {
    id = 'XTestFeature' as const;
    api = {
        mySlot: Slot.withType<{}>().defineEntity(MAIN),
    };
    dependencies = [];
}

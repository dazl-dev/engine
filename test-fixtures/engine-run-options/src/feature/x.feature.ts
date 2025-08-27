import { COM, Environment, Feature, Service } from '@dazl/engine-core';
import type { MyInterfaceClass } from './interface.js';

export const MAIN = new Environment('main', 'window', 'single');
export const PROC = new Environment('processing', 'node', 'single');

export interface Options {
    [key: string]: any;
}

export interface RuntimeOptionsService {
    getOptions: () => Options;
}

export default class XTestFeature extends Feature<'XTestFeature'> {
    id = 'XTestFeature' as const;
    api = {
        passedOptions: Service.withType<MyInterfaceClass>().defineEntity(PROC).allowRemoteAccess(),
    };
    dependencies = [COM];
}

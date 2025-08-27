import { COM, Environment, Feature } from '@dazl/engine-core';
import echoFeature from './echo.feature.js';
export const mainEnv = new Environment('main', 'window', 'single');
export const iframeEnv = new Environment('iframe', 'iframe', 'multi');

export default class ManagedCrossOriginIframeFeature extends Feature<'managedCrossOriginIframeFeature'> {
    id = 'managedCrossOriginIframeFeature' as const;
    api = {};
    dependencies = [COM, echoFeature];
}

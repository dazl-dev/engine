import { Feature } from '@dazl/engine-core';
import MultiEnvFeature, { contextualEnv } from '../feature/some-feature.feature.js';

export default class ServerMultiEnvFeature extends Feature<'serverMultiEnvFeature'> {
    id = 'serverMultiEnvFeature' as const;
    api = {};
    dependencies = [MultiEnvFeature];
}

export const Context = contextualEnv.useContext('server');

import { Environment, Feature } from '@dazl/engine-core';
import App, { client } from '../../feature/app.feature.js';

export const page2 = new Environment('page2', 'window', 'single', [client]);

export default class EngineEnvDependencyUser extends Feature<'engine-env-dependency-user'> {
    id = 'engine-env-dependency-user' as const;
    api = {};
    dependencies = [App];
}

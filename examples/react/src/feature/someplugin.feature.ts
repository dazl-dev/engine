import { Feature } from '@dazl/engine-core';
import guiFeature from './gui.feature.js';

export default class Plugin extends Feature<'plugin'> {
    id = 'plugin' as const;
    api = {};
    dependencies = [guiFeature];
}

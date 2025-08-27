import { Feature } from '@dazl/engine-core';
import UseConfigsFeature from '../feature/use-configs.feature.js';

export default class AlternativeDisplay extends Feature<'alternativeDisplay'> {
    id = 'alternativeDisplay' as const;
    api = {};
    dependencies = [UseConfigsFeature];
}

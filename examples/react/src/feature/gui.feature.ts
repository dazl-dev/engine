import { Feature, Slot } from '@dazl/engine-core';
import type React from 'react';
import reactRendererFeature, { MainEnv } from './react-renderer.feature.js';

export default class GuiFeature extends Feature<'guiFeature'> {
    id = 'guiFeature' as const;
    api = {
        extentionSlot: Slot.withType<React.ReactElement>().defineEntity(MainEnv),
    };
    dependencies = [reactRendererFeature];
}

import { Feature } from '@dazl/engine-core';
import Code from './code-editor/code-editor.feature.js';
import EndWithCompiler from './end-with/end-with.feature.js';
import Preview from './preview/compiler.feature.js';

export default class EnginePlayGroundExample extends Feature<'enginePlayGroundExample'> {
    id = 'enginePlayGroundExample' as const;
    api = {};
    dependencies = [Code, Preview, EndWithCompiler];
}

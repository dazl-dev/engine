import { COM, Environment, Feature, Service, Slot } from '@dazl/engine-core';
import CodeEditor, { PROCESSING } from '../code-editor/code-editor.feature.js';
import type { BaseCompiler, CompilerExtension } from './BaseCompiler.js';

export const PREVIEW = new Environment('preview', 'iframe', 'single');

export default class Preview extends Feature<'preview'> {
    id = 'preview' as const;
    api = {
        complierExtension: Slot.withType<CompilerExtension>().defineEntity(PROCESSING),
        compileService: Service.withType<BaseCompiler>().defineEntity(PROCESSING).allowRemoteAccess(),
    };
    dependencies = [COM, CodeEditor];
}

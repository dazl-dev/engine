import type { AsyncApi } from '@dazl/engine-core';
import type { CodeService } from '../code-editor/code-service.js';

export interface CompilerExtension {
    matcher: (s: string) => boolean;
    compile: (s: string) => string;
}

export class BaseCompiler {
    constructor(
        private codeService: AsyncApi<CodeService>,
        private compilers: () => CompilerExtension[],
    ) {}
    public async compile() {
        const content = await this.codeService.getContent();
        const thing = this.compilers().filter((i) => i.matcher(content));
        if (thing.length) {
            return {
                code: thing.reduce((c, t) => {
                    return t.compile(c);
                }, content),
            };
        }
        return {
            code: content,
        };
    }
}

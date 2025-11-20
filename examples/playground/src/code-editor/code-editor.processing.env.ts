import CodeEditor, { PROCESSING } from './code-editor.feature.js';
import { CodeService } from './code-service.js';

CodeEditor.setup(PROCESSING, ({ run, remoteCodeService, errorService }, {}) => {
    const codeService = new CodeService();

    run(async () => {
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        await remoteCodeService.listen(async () => {
            codeService.setContent(await remoteCodeService.getContent());
            if (codeService.getContent().includes('s')) {
                await errorService.report('`s` is not allowed!');
            }
        });
    });

    return {
        codeService,
    };
});

import reactFeatureFeature from './gui.feature.js';
import { MainEnv } from './react-renderer.feature.js';

reactFeatureFeature.setup(MainEnv, ({ run, extentionSlot }, { renderer: { renderingService } }) => {
    run(() => {
        renderingService.render(() => (
            <div>
                Look at this cool list of extentions<ul>{Array.from(extentionSlot)}</ul>
            </div>
        ));
    });
});

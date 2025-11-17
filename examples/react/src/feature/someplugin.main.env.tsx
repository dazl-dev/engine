import { MainEnv } from './react-renderer.feature.js';
import { Comp } from './someComp.js';
import somepluginFeature from './someplugin.feature.js';

somepluginFeature.setup(MainEnv, ({}, { guiFeature: { extentionSlot } }) => {
    extentionSlot.register(<input type="checkbox" key="checkbox" id="checkbox" />);
    extentionSlot.register(<li key={somepluginFeature.id}>thiss registered</li>);
    extentionSlot.register(<Comp key="cosmp" />);
});

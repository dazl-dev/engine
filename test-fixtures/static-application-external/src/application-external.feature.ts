import { Feature } from '@wixc3/engine-core';
import BaseApp from '@fixture/static-base-web-application-feature/dist/base-web-application.feature';

export default class ExternalFeature extends Feature<'externalFeature'> {
    id = 'externalFeature' as const;
    api = {};
    dependencies = [BaseApp];
}

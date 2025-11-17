import { Feature, Service } from '@dazl/engine-core';
import BaseApp, { server } from '@fixture/base-web-application-feature/dist/base-web-application.feature.js';

export default class ExternalFeature extends Feature<'externalFeature'> {
    id = 'externalFeature' as const;
    api = {
        getValue: Service.withType<{
            provider: () => string;
        }>()
            .defineEntity(server)
            .allowRemoteAccess(),
    };
    dependencies = [BaseApp];
}

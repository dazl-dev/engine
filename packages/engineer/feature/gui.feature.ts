import { Feature, Environment, COM, Config } from '@wixc3/engine-core';
import buildFeature from './dev-server.feature';
import type { IFeatureDefinition } from '@wixc3/engine-scripts';
export const mainDashboardEnv = new Environment('main-dashboard', 'window', 'single');

export interface EngineerConfig {
    features: Map<string, IFeatureDefinition>;
}

export default new Feature({
    id: 'dashboard-gui',
    dependencies: [buildFeature, COM],
    api: {
        /**
         * configuration for building and runnign the dashboard
         */
        engineerConfig: new Config<EngineerConfig>({ features: new Map<string, IFeatureDefinition>() }),
    },
});

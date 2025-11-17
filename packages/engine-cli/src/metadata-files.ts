import fs from 'node:fs';
import path from 'node:path';
import { ConfigurationEnvironmentMapping, FeatureEnvironmentMapping } from './types.js';

export function readMetadataFiles(dir: string) {
    try {
        const envMappingFilePath = path.join(dir, 'metadata', 'engine-feature-environments-mapping.json');
        const featureEnvironmentsMapping = JSON.parse(
            fs.readFileSync(envMappingFilePath, 'utf8'),
        ) as FeatureEnvironmentMapping;
        const engineConfigMappingFilePath = path.join(dir, 'metadata', 'engine-config-mapping.json');
        const configMapping = JSON.parse(
            fs.readFileSync(engineConfigMappingFilePath, 'utf8'),
        ) as ConfigurationEnvironmentMapping;
        return { featureEnvironmentsMapping, configMapping };
    } catch {
        return undefined;
    }
}

export function writeMetaFiles(
    dir: string,
    featureEnvironmentsMapping: FeatureEnvironmentMapping,
    configMapping: ConfigurationEnvironmentMapping,
) {
    const outDir = path.join(dir, 'metadata');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
        path.join(outDir, 'engine-feature-environments-mapping.json'),
        JSON.stringify(featureEnvironmentsMapping, null, 2),
    );
    fs.writeFileSync(path.join(outDir, 'engine-config-mapping.json'), JSON.stringify(configMapping, null, 2));
}

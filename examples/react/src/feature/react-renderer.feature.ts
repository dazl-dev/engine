import { Environment, Feature, Service } from '@dazl/engine-core';
import type React from 'react';

export const MainEnv = new Environment('main', 'window', 'single');

export default class Renderer extends Feature<'renderer'> {
    id = 'renderer' as const;
    api = {
        renderingService: Service.withType<{
            render: (e: React.FunctionComponent) => void;
        }>().defineEntity(MainEnv),
    };
}

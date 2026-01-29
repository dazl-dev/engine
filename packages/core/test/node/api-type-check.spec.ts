import {
    Config,
    ENGINE,
    Environment,
    Feature,
    RUN_OPTIONS,
    Registry,
    RuntimeEngine,
    Service,
    Slot,
    Universal,
    type AsyncApi,
    type AsyncRemoteAggregatedValue,
    type AsyncRemoteValue,
    type DisposeFunction,
    type IRunOptions,
    type RemoteAggregatedValue,
    type RemoteValue,
    type Running,
    type RunningFeatures,
} from '@dazl/engine-core';
import type { EQUAL, ExpectTrue } from 'typescript-type-utils';
import { typeCheck } from '../type-check.js';

/*************** EXAMPLE FEATURE FILES ***************/

const MAIN = new Environment('main', 'window', 'single');
const _ZAG = new Environment('zag', 'window', 'single');
const MAIN_1 = new Environment('main1', 'window', 'single');

// show case both the old and new way of defining features working together
class Logger extends Feature<'logger'> {
    id = 'logger' as const;
    api = {
        config: Config.withType<{ time: number }>().defineEntity({ time: 1 }),
        transport: Slot.withType<{ transportName: string }>().defineEntity(MAIN),
        sink: Service.withType<{ log: (message: string) => void }>().defineEntity(MAIN).allowRemoteAccess(),
    };
    dependencies = [];
}

typeCheck(
    (
        _runningFeature: EQUAL<
            Running<typeof Logger, typeof MAIN>,
            {
                config: { time: number };
                transport: Registry<{
                    transportName: string;
                }>;
                sink: {
                    log: (message: string) => void;
                };
            }
        >,
    ) => true,
);

typeCheck(
    (
        _runningFeature: EQUAL<
            Running<typeof Logger, typeof _ZAG>,
            {
                config: { time: number };

                sink: AsyncApi<{
                    log: (message: string) => void;
                }>;
            }
        >,
    ) => true,
);
/* ------------------------------------------------- */

class GUI extends Feature<'gui'> {
    id = 'gui' as const;
    api = {
        panelSlot: Slot.withType<{ panelID: string }>().defineEntity(MAIN),
        guiService: Service.withType<{ someMethod(): void }>().defineEntity([MAIN, MAIN_1]),
    };
    dependencies = [Logger];
}

typeCheck(
    (
        _runningDependencies: EQUAL<
            RunningFeatures<GUI['dependencies'], GUI['optionalDependencies'], typeof MAIN>,
            { logger: Running<typeof Logger, typeof MAIN> }
        >,
        _runningFeature: EQUAL<
            Running<typeof GUI, typeof MAIN>,
            { panelSlot: Registry<{ panelID: string }>; guiService: { someMethod(): void } }
        >,
    ) => true,
);

/* ------------------------------------------------- */

interface DataService {
    setData: (data: unknown) => unknown;
}

interface ComponentDescription {
    component: string;
    description: string;
}

class AddPanel extends Feature<'addPanel'> {
    id = 'addPanel' as const;
    api = {
        componentDescription: Slot.withType<ComponentDescription>().defineEntity(MAIN),
        service1: Service.withType<DataService>().defineEntity(MAIN),
        service2: Service.withType<DataService>().defineEntity(MAIN_1),
        service3: Service.withType<DataService>().defineEntity(Universal),
    };
    dependencies = [GUI, Logger];
}

typeCheck(
    (
        _runningFeature: EQUAL<
            Running<typeof AddPanel, typeof MAIN>,
            {
                componentDescription: Registry<ComponentDescription>;
                service1: DataService;
                service3: DataService;
            }
        >,
        _runningDependencies: EQUAL<
            RunningFeatures<AddPanel['dependencies'], AddPanel['optionalDependencies'], typeof MAIN>,
            {
                logger: Running<typeof Logger, typeof MAIN>;
                gui: Running<typeof GUI, typeof MAIN>;
            }
        >,
        _: true,
    ) => true,
);

const env = new Environment('main', 'window', 'single');

/*************** EXAMPLE SETUP FILES ***************/
export async function dontRun() {
    AddPanel.setup(MAIN, (feature, features) => {
        feature.componentDescription.register({ component: '', description: '' });
        feature.componentDescription.register({ component: '', description: '' });
        features.logger.transport.register({ transportName: `test${features.logger.config.time}` });

        features.gui.panelSlot.register({ panelID: 'panel1' });
        features.gui.panelSlot.register({ panelID: 'panel2' });

        features.gui.guiService.someMethod();

        const dataPromise = fetch('./some-data');

        const service1 = {
            setData: (data: unknown) => data,
        };

        feature.run(async () => {
            service1.setData(await dataPromise);
        });

        const _engine = feature[ENGINE];

        typeCheck(
            (
                _featureTest: ExpectTrue<
                    EQUAL<
                        typeof feature,
                        {
                            id: 'addPanel';
                            run: (fn: () => unknown) => void;
                            onDispose: (fn: DisposeFunction) => void;
                            [RUN_OPTIONS]: IRunOptions;
                            [ENGINE]: typeof _engine;
                            engineShutdownSignal: AbortSignal;
                            componentDescription: Registry<ComponentDescription>;
                            service3: DataService;
                        }
                    >
                >,
            ) => true,
        );

        typeCheck(
            (
                _engineTest: EQUAL<
                    typeof features,
                    {
                        gui: Running<typeof GUI, typeof MAIN>;
                        logger: Running<typeof Logger, typeof MAIN>;
                    }
                >,
                _: true,
            ) => true,
        );

        return {
            service1,
        };
    });

    const engine = await new RuntimeEngine(env, []).run(AddPanel);
    engine.get(AddPanel).api.service1;
    engine.get(AddPanel).api.service3;
    const _: 'addPanel' = engine.get(AddPanel).feature.id;
    console.log(_);
}

/** AsyncApi checks */

interface SomeApi {
    someMethod: () => boolean;
    someAsyncMethod: () => Promise<number>;
    someRemoteValue: RemoteValue<string>;
    someRemoteAggregatedValue: RemoteAggregatedValue<number>;
    shouldGetFilteredOut: string;
}

type SomeApiPromisified = AsyncApi<SomeApi>;

typeCheck(
    (
        _: EQUAL<
            SomeApiPromisified,
            {
                someMethod(): Promise<boolean>;
                someAsyncMethod(): Promise<number>;
                someRemoteValue: AsyncRemoteValue<string>;
                someRemoteAggregatedValue: AsyncRemoteAggregatedValue<number>;
            }
        >,
    ) => true,
);

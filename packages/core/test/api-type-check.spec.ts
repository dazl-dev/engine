import type { EQUAL, ExpectTrue } from 'typescript-type-utils';
import {
    DisposeFunction,
    Environment,
    IRunOptions,
    RUN_OPTIONS,
    Universal,
    Config,
    Feature,
    Registry,
    Running,
    RunningFeatures,
    RuntimeEngine,
    Slot,
    ENGINE,
    Value,
} from '@wixc3/engine-core';
import { typeCheck } from './type-check';

/*************** EXAMPLE FEATURE FILES ***************/

const MAIN = new Environment('main', 'window', 'single');
const MAIN_1 = new Environment('main1', 'window', 'single');

const logger = new Feature({
    id: 'logger',
    api: {
        config: Config.withType<{ time: number }>().defineEntity({ time: 1 }),
        transport: Slot.withType<{ transportName: string }>().defineEntity(MAIN),
    },
});

/* ------------------------------------------------- */

const gui = new Feature({
    id: 'gui',
    dependencies: [logger],
    api: {
        panelSlot: Slot.withType<{ panelID: string }>().defineEntity([MAIN]),
        guiService: Value.withType<{ someMethod(): void }>().defineEntity([MAIN, MAIN_1]),
    },
});

typeCheck(
    (
        _runningDependencies: EQUAL<
            RunningFeatures<typeof gui['dependencies'], typeof MAIN>,
            { logger: Running<typeof logger, typeof MAIN> }
        >,
        _runningFeature: EQUAL<
            Running<typeof gui, typeof MAIN>,
            { panelSlot: Registry<{ panelID: string }>; guiService: { someMethod(): void } }
        >
    ) => true
);

/* ------------------------------------------------- */

interface DataService {
    setData: (data: unknown) => unknown;
}

interface ComponentDescription {
    component: string;
    description: string;
}

const addPanel = new Feature({
    id: 'addPanel',
    dependencies: [gui, logger],
    api: {
        componentDescription: Slot.withType<ComponentDescription>().defineEntity(MAIN),
        service1: Value.withType<DataService>().defineEntity(MAIN),
        service2: Value.withType<DataService>().defineEntity(MAIN_1),
        service3: Value.withType<DataService>().defineEntity(Universal),
    },
});
typeCheck(
    (
        _runningFeature: EQUAL<
            Running<typeof addPanel, typeof MAIN>,
            {
                componentDescription: Registry<ComponentDescription>;
                service1: DataService;
                service3: DataService;
            }
        >,
        _runningDependencies: EQUAL<
            RunningFeatures<typeof addPanel['dependencies'], typeof MAIN>,
            {
                logger: Running<typeof logger, typeof MAIN>;
                gui: Running<typeof gui, typeof MAIN>;
            }
        >,
        _: true
    ) => true
);

const env = new Environment('main', 'window', 'single');

/*************** EXAMPLE SETUP FILES ***************/
export async function dontRun() {
    addPanel.setup(MAIN, (feature, features) => {
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

        const engine = feature[ENGINE];

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
                            [ENGINE]: typeof engine;
                            componentDescription: Registry<ComponentDescription>;
                            service3: DataService;
                        }
                    >
                >
            ) => true
        );

        typeCheck(
            (
                _engineTest: EQUAL<
                    typeof features,
                    {
                        gui: Running<typeof gui, typeof MAIN>;
                        logger: Running<typeof logger, typeof MAIN>;
                    }
                >,
                _: true
            ) => true
        );

        return {
            service1,
        };
    });

    await new RuntimeEngine(env, []).run(addPanel);
}

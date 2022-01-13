import type { BrowserWindow } from 'electron';
import type { Environment, IRunOptions, Communication } from '@wixc3/engine-core';
import type { IExternalFeatureNodeDescriptor } from '@wixc3/engine-runtime-node';

export interface InitializedBrowserEnvironment {
    id: string;
    dispose: () => void;
    browserWindow: BrowserWindow;
}

export interface IWindowEnvironmentOptions {
    env: Environment;
    browserWindow: BrowserWindow;
    runOptions: IRunOptions;
    communication: Communication;
    featureName?: string;
    configName?: string;
    runtimeArguments?: Record<string, string | number | boolean | undefined | null>;
    externalFeatures?: IExternalFeatureNodeDescriptor[];
}

import type { Environment } from '@wixc3/engine-core';
import type { IEngineRuntimeArguments } from '@wixc3/engine-electron-commons';

export interface IRunOptions extends Omit<IEngineRuntimeArguments, 'nodeEntryPath'> {
    devport: number;
    devtools?: boolean;
    env: Environment;
}

export type IRunOptionsMessage = {
    id: 'runOptions';
    runOptions: IRunOptions;
};
export const isRunOptionsMessage = (value: unknown): value is IRunOptionsMessage => {
    return (value as IRunOptionsMessage).id === 'runOptions';
};

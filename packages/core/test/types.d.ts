import { EQUAL } from 'typescript-type-utils';
import { EnvType, Entity, Environment, RunningInstance } from '@dazl/engine-core';

type MAIN1 = Environment<'main', 'node', 'single'>;
type K = EnvType<[]>;
export type FromEnvArray = EQUAL<EnvType<[MAIN1]>, 'main'>;
export type FromEnv = EQUAL<EnvType<MAIN1>, 'main'>;
export type FromEnvArrayMultiple = EQUAL<EnvType<[MAIN1, Environment<'main1', 'node', 'single'>]>, 'main' | 'main1'>;
export type FromEnvEmptyArray = EQUAL<EnvType<[]>, never>;

export type RunningEmpty = EQUAL<RunningInstance<{ id: ''; api: {} }, MAIN1>, {}>;
export type RunningProvidesApiInputTypes = EQUAL<
    RunningInstance<{ id: ''; api: { x: Entity<string, string, MAIN1, MAIN1, 'input', false> } }, MAIN1>,
    { x: string }
>;
export type RunningProvidesApiOutputTypes = EQUAL<
    RunningInstance<{ id: ''; api: { x: Entity<string, string, MAIN1, MAIN1, 'output', false> } }, MAIN1>,
    { x: string }
>;

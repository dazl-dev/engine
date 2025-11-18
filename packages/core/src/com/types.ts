import { SERVICE_CONFIG } from '../symbols.js';
import { AsyncRemoteValue, RemoteValue } from '../value-signal.js';
import { Message } from './message-types.js';

export type SerializableArguments = unknown[];
export type SerializableMethod = (...args: SerializableArguments) => void;

export type EnvironmentTypes =
    | 'window'
    | 'iframe'
    | 'webworker'
    | 'workerthread'
    | 'node'
    | 'context'
    | 'electron-renderer'
    | 'electron-main';
/**
 * TODO: remove onReconnect and onDisconnect
 */
export interface ActiveEnvironment {
    id: string;
    onDisconnect?: (cb: () => void) => void;
    onReconnect?: (cb: () => void) => void;
}

export type Json = boolean | number | string | null | Json[] | { [key: string]: Json };
export interface Target {
    name?: string;
    closed?: boolean;
    addEventListener(type: 'message', handler: (event: { data: any; source: Target }) => void, capture?: boolean): void;
    removeEventListener(type: 'message', handler: (event: { data: any }) => void, capture?: boolean): void;
    postMessage(data: any, origin?: any): void;
    parent?: Target;
}

export const HOST_REMOVED: Target = {
    name: 'HOST_REMOVED',
    addEventListener: () => void 0,
    removeEventListener: () => void 0,
    postMessage: () => void 0,
} as const;

export type WindowHost = HTMLIFrameElement | Window;

export interface CallbackRecord<T> {
    message: Message;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    timerId?: ReturnType<typeof setTimeout>;
    scheduleOnSlow(): void;
    scheduleOnTimeout(): void;
}

export interface EnvironmentRecord {
    id: string;
    host: Target;
}

export type UnknownFunction = (...args: unknown[]) => unknown;

export type AsyncApi<T extends object> = {
    [P in keyof T]: P extends keyof ServiceConfig<T>
        ? MultiTanentProxyFunction<T, P extends string ? P : never>
        : T[P] extends (...args: any[]) => PromiseLike<any>
          ? T[P]
          : T[P] extends (...args: infer Args) => infer R
            ? (...args: Args) => Promise<R>
            : T[P] extends RemoteValue<infer X>
              ? AsyncRemoteValue<X>
              : never;
} & {
    [K in Extract<keyof T, keyof object>]: never;
};

export type MultiEnvAsyncApi<T extends object> = {
    /**
     * Gets an API of particular instance of multi-instanced environment.
     *
     * @param token environment instance token to get API of.
     */
    get(token: EnvironmentInstanceToken): AsyncApi<T>;
};

export interface EnvironmentInstanceToken {
    id: string;
}

export interface ServiceMethodOptions<T, K> {
    emitOnly?: boolean;
    listener?: boolean;
    removeListener?: Exclude<keyof T, K>;
    removeAllListeners?: Exclude<keyof T, K>;
}

export interface AnyServiceMethodOptions {
    emitOnly?: boolean;
    listener?: boolean;
    removeListener?: string;
    removeAllListeners?: string;
}

export type ServiceComConfig<T> = {
    [K in keyof T]?: T[K] extends (...args: any[]) => unknown ? ServiceMethodOptions<T, K> : never;
};

export type ValuePromise<R> = R extends Promise<unknown> ? R : Promise<R>;

export type ServiceConfig<T extends { [SERVICE_CONFIG]?: any }> = T[typeof SERVICE_CONFIG];

export type MultiTanentProxyFunction<T extends { [SERVICE_CONFIG]?: any }, K extends string> = ReturnType<
    ServiceConfig<T>[K]
>['proxyFunction'];

export type FilterFirstArgument<T> = T extends (_a: infer _First, ...rest: infer Args) => unknown ? Args : never;

export type AnyFunction = (...args: any[]) => unknown;

export interface APIService {
    [SERVICE_CONFIG]?: Record<string, (...args: any[]) => { proxyFunction: AnyFunction }>;
    [fnName: string]: AnyFunction;
}

export interface RemoteAPIServicesMapping {
    [remoteServiceId: string]: Record<string, AnyFunction | AsyncRemoteValue<any>>;
}

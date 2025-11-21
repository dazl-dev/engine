import { isDisposable, SetMultiMap } from '@dazl/patterns';
import { deferred } from 'promise-assist';
import type { ContextualEnvironment, Environment, EnvironmentMode } from '../entities/env.js';
import { errorToJson } from '../helpers/index.js';
import { SERVICE_CONFIG } from '../symbols.js';
import { type IDTag } from '../types.js';
import {
    REMOTE_CALL_FAILED,
    AUTO_REGISTER_ENVIRONMENT,
    FORWARDING_MESSAGE,
    MESSAGE_FROM_UNKNOWN_ENVIRONMENT,
    REGISTER_ENV,
    UNHANDLED,
} from './logs.js';
import {
    deserializeApiCallArguments,
    isWindow,
    isWorkerContext,
    MultiCounter,
    serializeApiCallArguments,
    redactArguments,
} from './helpers.js';
import { BaseHost } from './hosts/base-host.js';
import { WsClientHost } from './hosts/ws-client-host.js';
import type {
    CallbackMessage,
    CallMessage,
    EventMessage,
    ListenMessage,
    Message,
    StatusMessage,
    UnListenMessage,
} from './message-types.js';
import { isMessage } from './message-types.js';
import {
    type AnyServiceMethodOptions,
    type APIService,
    type AsyncApi,
    type CallbackRecord,
    type EnvironmentInstanceToken,
    type EnvironmentRecord,
    HOST_REMOVED,
    type RemoteAPIServicesMapping,
    type SerializableArguments,
    type SerializableMethod,
    type ServiceComConfig,
    type Target,
    type UnknownFunction,
} from './types.js';
import {
    CallbackTimeoutError,
    CircularForwardingError,
    DuplicateRegistrationError,
    EnvironmentDisconnectedError,
    UnConfiguredMethodError,
    UnknownCallbackIdError,
} from './communication-errors.js';
import { type RemoteValueAsyncMethods, type RemoteValue, remoteValueAsyncMethods } from '../remote-value.js';

export interface ConfigEnvironmentRecord extends EnvironmentRecord {
    registerMessageHandler?: boolean;
}

export interface CommunicationOptions {
    warnOnSlow?: boolean;
    publicPath?: string;
    connectedEnvironments?: { [environmentId: string]: ConfigEnvironmentRecord };
    apis?: RemoteAPIServicesMapping;
}

/**
 * Manages all API registrations and message forwarding
 * in each execution context.
 */
export class Communication {
    private rootEnvId: string;
    private rootEnvName: string;
    private idsCounter = new MultiCounter();
    private disposing = false;
    private readonly callbackTimeout = 60_000 * 5; // 5 minutes
    private readonly slowThreshold = 5_000; // 5 seconds
    private pendingEnvs: SetMultiMap<string, () => void> = new SetMultiMap();
    private pendingMessages = new SetMultiMap<string, UnknownFunction>();
    private handlers = new Map<string, { message: ListenMessage; callbacks: Set<UnknownFunction> }>();
    private eventDispatchers = new Map<string, { dispatcher: SerializableMethod; message: ListenMessage }>();
    private apis: RemoteAPIServicesMapping;
    private apisOverrides: RemoteAPIServicesMapping = {};
    private options: Required<CommunicationOptions>;
    private readyEnvs = new Set<string>();
    private environments: { [environmentId: string]: EnvironmentRecord } = {};
    private messageHandlers = new WeakMap<Target, (options: { data: null | Message }) => void>();
    private disposeListeners = new Set<(envId: string) => void>();
    private reConnectListeners = new Set<(envId: string) => void>();
    private pendingCallbacks = new Map<string, CallbackRecord<unknown>>();
    private messageIdPrefix: string;
    // manual DEBUG_MODE
    private DEBUG = false;
    constructor(
        private host: Target,
        id: string,
        public topology: Record<string, string> = {},
        public resolvedContexts: Record<string, string> = {},
        public isServer = false,
        options?: CommunicationOptions,
    ) {
        this.options = {
            warnOnSlow: this.DEBUG,
            publicPath: '',
            connectedEnvironments: {},
            apis: {},
            ...options,
        };
        this.rootEnvId = id;
        this.rootEnvName = id.split('/')[0]!;
        this.registerMessageHandler(host);
        this.registerEnv(id, host);
        this.environments['*'] = { id, host };
        this.messageIdPrefix = `c_${this.rootEnvId}_${Math.random().toString(36).slice(2)}`;
        this.apis = this.options.apis;
        for (const [id, envEntry] of Object.entries(this.options.connectedEnvironments)) {
            if (envEntry.registerMessageHandler) {
                this.registerMessageHandler(envEntry.host);
            }
            this.environments[id] = envEntry;
        }
        this.post(this.getPostEndpoint(host), {
            type: 'ready',
            from: id,
            to: '*',
            origin: id,
        });
    }

    /**
     * Registers environments that spawned in the same execution context as the root environment.
     */
    public registerEnv(id: string, host: Target, forceRegister: boolean = false): void {
        if (this.DEBUG) {
            console.debug(REGISTER_ENV(id, this.rootEnvId));
        }
        const existingEnv = this.environments[id];
        if (!existingEnv || forceRegister) {
            this.environments[id] = { id, host } as EnvironmentRecord;
        } else if (existingEnv.host !== host) {
            throw new DuplicateRegistrationError(id, 'Environment');
        }
    }

    /**
     * Registers local api implementation of the remote service.
     */
    public registerAPI<T extends {}>({ id }: IDTag, api: T): T {
        if (!this.apis[id]) {
            this.apis[id] = api;
            this.applyApiDirectives(id, api);
            return api;
        } else {
            throw new DuplicateRegistrationError(id, 'RemoteService');
        }
    }

    public getEnvironmentContext(endPoint: ContextualEnvironment<string, EnvironmentMode, Environment[]>) {
        return this.resolvedContexts[endPoint.env];
    }

    public getEnvironmentInstanceId(envName: string, endpointType: EnvironmentMode) {
        return endpointType === 'single' ? envName : this.generateEnvInstanceID(envName);
    }

    public getPublicPath() {
        return this.options.publicPath;
    }

    public setTopology(envName: string, envUrl: string) {
        this.topology[envName] = envUrl;
    }

    public subscribeToEnvironmentDispose(handler: (envId: string) => void) {
        this.disposeListeners.add(handler);
    }
    public unsubscribeToEnvironmentDispose(handler: (envId: string) => void) {
        this.disposeListeners.delete(handler);
    }
    public subscribeToEnvironmentReconnect(handler: (envId: string) => void) {
        this.reConnectListeners.add(handler);
    }
    public unsubscribeToEnvironmentReconnect(handler: (envId: string) => void) {
        this.reConnectListeners.delete(handler);
    }

    /**
     * Creates a Proxy for a remote service api.
     */
    public apiProxy<T extends object>(
        instanceToken: EnvironmentInstanceToken | Promise<EnvironmentInstanceToken>,
        { id: api }: IDTag,
        serviceComConfig: ServiceComConfig<T> = {},
    ): AsyncApi<T> {
        return new Proxy(Object.create(null), {
            get: (runtimeCache, key) => {
                // let js runtime know that this is not thenable object
                if (key === 'then') {
                    return undefined;
                }

                /*
                 * Don't allow native Object methods to be proxies.
                 * they used by the debugger and cause messages to be sent everywhere
                 * this behavior made debugging very hard and can cause errors and infinite loops
                 */
                if (Object.hasOwn(Object.prototype, key)) {
                    return Reflect.get(Object.prototype, key);
                }
                if (typeof key === 'string') {
                    let runtimeValue = runtimeCache[key];
                    if (!runtimeValue) {
                        runtimeValue = async (...args: unknown[]) =>
                            this.callMethod(
                                (await instanceToken).id,
                                api,
                                key,
                                args,
                                this.rootEnvId,
                                serviceComConfig as Record<string, AnyServiceMethodOptions>,
                            );
                        runtimeCache[key] = Object.assign(
                            runtimeValue,
                            this.createAsyncRemoteValue<T>(key, serviceComConfig, instanceToken, api),
                        );
                    }
                    return runtimeValue;
                }
            },
        });
    }
    private createAsyncRemoteValue<T extends object>(
        key: string,
        serviceComConfig: ServiceComConfig<T>,
        instanceToken: EnvironmentInstanceToken | Promise<EnvironmentInstanceToken>,
        api: string,
    ) {
        const subSignalId = key + '.' + 'subscribe';
        const unsubSignalId = key + '.' + 'unsubscribe';
        const streamSignalId = key + '.' + 'stream';
        const getValueId = key + '.getValue';

        (serviceComConfig as Record<string, AnyServiceMethodOptions>)[subSignalId] = {
            emitOnly: true,
            listener: true,
        };
        (serviceComConfig as Record<string, AnyServiceMethodOptions>)[unsubSignalId] = {
            emitOnly: true,
            removeListener: subSignalId,
        };
        (serviceComConfig as Record<string, AnyServiceMethodOptions>)[streamSignalId] = {
            emitOnly: true,
            listener: true,
        };

        const asyncRemoteValue = {
            subscribe: async (...args: unknown[]) => {
                return this.callMethod(
                    (await instanceToken).id,
                    api,
                    subSignalId,
                    args,
                    this.rootEnvId,
                    serviceComConfig as Record<string, AnyServiceMethodOptions>,
                );
            },
            unsubscribe: async (fn: UnknownFunction) => {
                return this.callMethod(
                    (await instanceToken).id,
                    api,
                    unsubSignalId,
                    [fn],
                    this.rootEnvId,
                    serviceComConfig as Record<string, AnyServiceMethodOptions>,
                );
            },
            stream: async (fn: UnknownFunction) => {
                return this.callMethod(
                    (await instanceToken).id,
                    api,
                    streamSignalId,
                    [fn],
                    this.rootEnvId,
                    serviceComConfig as Record<string, AnyServiceMethodOptions>,
                );
            },
            getValue: async () => {
                return this.callMethod(
                    (await instanceToken).id,
                    api,
                    getValueId,
                    [],
                    this.rootEnvId,
                    serviceComConfig as Record<string, AnyServiceMethodOptions>,
                );
            },
        };

        return asyncRemoteValue;
    }

    /**
     * Add local handle event listener to Target.
     */
    public registerMessageHandler(target: Target): void {
        const envTarget = (target as BaseHost).parent ?? target;
        const onTargetMessage = ({ data, source }: { data: null | Message; source?: Target }) => {
            if (isMessage(data)) {
                this.handleEvent({ data, source: source || envTarget });
            }
        };
        target.addEventListener('message', onTargetMessage, true);
        this.messageHandlers.set(target, onTargetMessage);
    }

    /**
     * Remove local handle event listener to Target.
     */
    public removeMessageHandler(target: Target): void {
        const messageHandler = this.messageHandlers.get(target);
        if (messageHandler) {
            target.removeEventListener('message', messageHandler, true);
        }
    }

    /**
     * Generate client id for newly spawned environment.
     */
    public generateEnvInstanceID(name: string): string {
        return this.idsCounter.next(`${name}/`);
    }

    /**
     * Calls a remote method in any opened environment.
     */
    public callMethod(
        envId: string,
        api: string,
        method: string,
        args: unknown[],
        origin: string,
        serviceComConfig: Record<string, AnyServiceMethodOptions>,
    ): Promise<unknown> {
        return new Promise<unknown>((res, rej) => {
            const methodConfig = serviceComConfig[method];

            const callbackId = !methodConfig?.emitOnly ? this.idsCounter.next(this.messageIdPrefix) : undefined;

            if (this.isListenCall(args) || methodConfig?.removeAllListeners) {
                this.addOrRemoveListener(
                    envId,
                    api,
                    method,
                    callbackId,
                    origin,
                    methodConfig,
                    args[0] as UnknownFunction,
                    res,
                    rej,
                );
            } else {
                const message: CallMessage = {
                    to: envId,
                    from: this.rootEnvId,
                    type: 'call',
                    data: { api, method, args: serializeApiCallArguments(args) },
                    callbackId,
                    origin,
                };
                this.callWithCallback(envId, message, callbackId, res, rej);
            }
        });
    }
    /**
     * handles Communication incoming message.
     */
    public async handleMessage(message: unknown, source: Target): Promise<void> {
        if (!isMessage(message)) {
            return;
        }

        if (message.type === 'dispose' && message.to === '*') {
            this.clearEnvironment(message.origin, this.rootEnvId);
            return;
        }

        if (message.type !== 'dispose') {
            this.autoRegisterEnvFromMessage(message, source);
        }

        const env = this.environments[message.to];

        if (!env) {
            this.unhandledMessage(message);
            return;
        }
        if (env.id !== this.rootEnvId) {
            this.forwardMessage(message, env);
            return;
        }
        switch (message.type) {
            case 'call':
                await this.handleCall(message);
                break;
            case 'callback':
                this.handleCallback(message);
                break;
            case 'event':
                this.handleEventMessage(message);
                break;
            case 'listen':
                await this.handleListen(message);
                break;
            case 'unlisten':
                await this.handleUnListen(message);
                break;
            case 'ready':
                this.handleReady(message);
                break;
            case 'dispose':
                if (message.from !== this.rootEnvId) {
                    this.clearEnvironment(message.origin, message.from);
                }
                break;
            case 'status':
                this.handleStatus(message);
                break;
            default:
                break;
        }
    }

    public async getAllEnvironmentsStatus() {
        const pending: Promise<ReturnType<Communication['getComStatus']>>[] = [];
        const localStats = this.getComStatus();
        // not us
        const envs = Object.keys(this.environments).filter((envId) => envId !== '*' && envId !== this.rootEnvId);
        for (const envId of envs) {
            const { promise, resolve, reject } = deferred<ReturnType<Communication['getComStatus']>>();
            const callbackId = this.idsCounter.next(this.messageIdPrefix);
            this.callWithCallback(
                envId,
                {
                    from: this.rootEnvId,
                    to: envId,
                    type: 'status',
                    origin: this.rootEnvId,
                    callbackId,
                },
                callbackId,
                resolve,
                reject,
            );
            pending.push(promise);
        }
        return Promise.allSettled(pending).then((results) => {
            const statuses: Record<string, ReturnType<Communication['getComStatus']> | PromiseRejectedResult> = {};
            for (let i = 0; i < results.length; i++) {
                const result = results[i]!;
                const key = envs[i]!;
                if (result.status === 'fulfilled') {
                    if (key !== result.value.rootEnvId) {
                        statuses[key + ' -> ' + result.value.rootEnvId] = result.value;
                    } else {
                        statuses[result.value.rootEnvId] = result.value;
                    }
                } else {
                    statuses[key] = result;
                }
            }
            statuses[this.rootEnvId] = localStats;
            return statuses;
        });
    }
    private getComStatus() {
        return {
            rootEnvId: this.rootEnvId,
            pendingEnvs: countValues(this.pendingEnvs),
            pendingMessages: countValues(this.pendingMessages),
            handlers: Array.from(this.handlers).reduce<Record<string, number>>((acc, [key, { callbacks }]) => {
                acc[key] = callbacks.size;
                return acc;
            }, {}),
            eventDispatchers: Array.from(this.eventDispatchers.keys()),
            apis: Object.keys(this.apis),
            readyEnvs: Array.from(this.readyEnvs),
            environments: Object.entries(this.environments).reduce<Record<string, Record<string, string>>>(
                (acc, [key, value]) => {
                    const info: Record<string, string> = {};
                    try {
                        info.typeName = value.host.constructor.name;
                    } catch (e) {
                        info.typeName = String(e);
                    }
                    try {
                        info.name = value.host.name || 'unknown';
                    } catch (e) {
                        info.name = String(e);
                    }
                    acc[key] = info;
                    return acc;
                },
                {},
            ),
            pendingCallbacks: Array.from(this.pendingCallbacks.entries()).reduce(
                (acc, [key, value]) => {
                    acc[key] = {
                        to: value.message.to,
                        isTimeoutScheduled: value.timerId !== undefined,
                    };
                    return acc;
                },
                {} as Record<string, { to: string; isTimeoutScheduled: boolean }>,
            ),
            messageIdPrefix: this.messageIdPrefix,
        };
    }
    private handleStatus(message: StatusMessage) {
        this.sendTo(message.from, {
            to: message.from,
            from: this.rootEnvId,
            type: 'callback',
            data: this.getComStatus(),
            callbackId: message.callbackId,
            origin: this.rootEnvId,
        });
    }

    private validateRegistration(envTarget: Target, message: Message) {
        if (envTarget === this.host) {
            // if we try to register the host itself, we will get stuck in an infinite loop
            // this happens when the host is a window and the message is from the same window
            if (this.DEBUG) {
                console.debug(AUTO_REGISTER_ENVIRONMENT(redactArguments(message), this.rootEnvId));
            }
            return false;
        }
        return true;
    }
    private autoRegisterEnvFromMessage(message: Message, source: Target) {
        const forceRegister = message.type === 'ready';
        if (!this.environments[message.from] || forceRegister) {
            if (this.DEBUG) {
                console.debug(MESSAGE_FROM_UNKNOWN_ENVIRONMENT(redactArguments(message), this.rootEnvId));
            }
            if (this.validateRegistration(source, message)) {
                this.registerEnv(message.from, source, forceRegister);
            }
        }
        if (!this.environments[message.origin]) {
            if (this.DEBUG) {
                console.debug(MESSAGE_FROM_UNKNOWN_ENVIRONMENT(redactArguments(message), this.rootEnvId), 'origin');
            }
            if (this.validateRegistration(source, message)) {
                this.registerEnv(message.origin, source, forceRegister);
            }
        }
    }

    /**
     * Dispose the Communication and stop listening to messages.
     */
    public async dispose(): Promise<void> {
        this.disposing = true;
        for (const { host, id } of Object.values(this.environments)) {
            if (host instanceof WsClientHost) {
                host.subscribers.clear();
            }
            if (!isWindow(host.parent) && (host as Target).closed !== true && isDisposable(host)) {
                await host.dispose();
            }
            this.removeMessageHandler(host);
            this.locallyClear(id);
        }

        this.locallyClear(this.rootEnvId);
        this.disposeListeners.clear();
        this.reConnectListeners.clear();
        for (const { timerId } of this.pendingCallbacks.values()) {
            clearTimeout(timerId);
        }
        this.pendingCallbacks.clear();
    }

    public getEnvironmentId() {
        return this.rootEnvId;
    }

    public getEnvironmentName() {
        return this.rootEnvName;
    }

    public getEnvironmentHost(envName: string) {
        return this.environments[envName]?.host;
    }

    /**
     * Gets a list of all registered environment instance ids.
     * @returns the list of instance ids.
     */
    public getRegisteredEnvironmentInstances(): string[] {
        return Object.keys(this.environments).filter((id) => id !== '*');
    }

    private createHandlerIdPrefix({ from, to }: { from: string; to: string }) {
        return `${from}__${to}_`;
    }

    private applyApiDirectives(id: string, api: APIService): void {
        const serviceConfig = api[SERVICE_CONFIG];
        if (serviceConfig) {
            this.apisOverrides[id] = {};
            for (const methodName of Object.keys(serviceConfig)) {
                const config = serviceConfig[methodName]!(api);
                if (config.proxyFunction) {
                    this.apisOverrides[id][methodName] = config.proxyFunction;
                }
            }
        }
    }
    public registerPendingEnvironment(instanceId: string, cb = () => {}): void {
        this.pendingEnvs.add(instanceId, cb);
    }
    public envReady(instanceId: string): Promise<void> {
        if (this.readyEnvs.has(instanceId)) {
            return Promise.resolve();
        }
        const { promise, resolve } = deferred();
        this.pendingEnvs.add(instanceId, resolve);
        return promise;
    }

    public clearEnvironment(instanceId: string, from: string = instanceId, emitRemote = true) {
        const connectedEnvs: string[] = Object.keys(this.options.connectedEnvironments);
        if (emitRemote && (this.readyEnvs.has(instanceId) || connectedEnvs.includes(instanceId))) {
            for (const env of [...this.readyEnvs, ...connectedEnvs]) {
                if (![instanceId, from, this.rootEnvId].includes(env)) {
                    this.sendTo(env, {
                        type: 'dispose',
                        from: this.rootEnvId,
                        to: env,
                        origin: instanceId,
                    });
                }
            }
        }
        this.locallyClear(instanceId);
    }

    private locallyClear(instanceId: string) {
        this.readyEnvs.delete(instanceId);
        this.pendingMessages.deleteKey(instanceId);
        this.pendingEnvs.deleteKey(instanceId);
        delete this.environments[instanceId];
        this.clearEventDispatchersByEnvId(instanceId);
        for (const callbackRecord of this.pendingCallbacks.values()) {
            if (callbackRecord.message.to === instanceId) {
                callbackRecord.reject(
                    new EnvironmentDisconnectedError(instanceId, this.rootEnvId, callbackRecord.message),
                );
            }
        }
        for (const dispose of this.disposeListeners) {
            dispose(instanceId);
        }
    }

    private clearEventDispatchersByEnvId(instanceId: string) {
        for (const [dispatcherKey, { message, dispatcher }] of this.eventDispatchers) {
            if (dispatcherKey.endsWith(instanceId)) {
                this.eventDispatchers.delete(dispatcherKey);
                if (message.removeListener) {
                    this.apiCall(message.origin, message.data.api, message.removeListener, [dispatcher]);
                }
            }
        }
    }

    private forwardMessage(message: Message, env: EnvironmentRecord) {
        message.forwardingChain ??= [];
        // check before push
        const cycle = message.forwardingChain.includes(this.rootEnvId);
        // push after check so we see the cycle in the forwardingChain
        message.forwardingChain.push(this.rootEnvId);
        if (cycle) {
            this.sendTo(message.from, {
                from: this.rootEnvId,
                origin: this.rootEnvId,
                to: message.origin,
                callbackId: message.callbackId,
                type: 'callback',
                forwardingChain: message.forwardingChain,
                error: new CircularForwardingError(message, this.rootEnvId, env.id),
            });
            return;
        } else if (this.DEBUG) {
            console.debug(FORWARDING_MESSAGE(redactArguments(message), this.rootEnvId, env.id));
        }
        if (this.pendingEnvs.get(env.id)) {
            this.pendingMessages.add(env.id, () => this.post(this.resolveMessageTarget(env.id), message));
            return;
        }
        this.post(env.host, message);
    }

    private apiCall(origin: string, api: string, callPath: string, args: unknown[]): unknown {
        const method = this.apisOverrides[api]?.[callPath];
        if (typeof method === 'function') {
            return method(...[origin, ...args]);
        }
        // support for RemoteValue
        const [apiName, ...subActions] = callPath.split('.');
        if (
            apiName &&
            subActions.length === 1 &&
            remoteValueAsyncMethods.has(subActions[0] as RemoteValueAsyncMethods)
        ) {
            const remoteValue = this.apis[api]![apiName] as RemoteValue<unknown>;
            const methodName = subActions[0] as RemoteValueAsyncMethods;
            const fnArgs = args as [UnknownFunction];
            return remoteValue[methodName](...fnArgs);
        }
        //
        return (this.apis[api]![callPath] as UnknownFunction)(...args);
    }

    private unhandledMessage(message: Message): void {
        if (this.DEBUG) {
            console.debug(UNHANDLED(redactArguments(message), this.rootEnvId));
        }
    }

    private addOrRemoveListener(
        envId: string,
        api: string,
        method: string,
        callbackId: string | undefined,
        origin: string,
        methodConfig: AnyServiceMethodOptions | undefined,
        fn: UnknownFunction,
        res: (value?: any) => void,
        rej: (reason: unknown) => void,
    ) {
        const removeListenerRef = methodConfig?.removeAllListeners || methodConfig?.removeListener;

        if (removeListenerRef && !methodConfig?.listener) {
            const listenerHandlerId = this.getHandlerId(envId, api, removeListenerRef);
            const listenerHandlersBucket = this.handlers.get(listenerHandlerId);
            if (!listenerHandlersBucket) {
                res();
                return;
            }
            if (methodConfig?.removeListener) {
                listenerHandlersBucket.callbacks.delete(fn);
            } else {
                listenerHandlersBucket.callbacks.clear();
            }
            if (listenerHandlersBucket.callbacks.size === 0) {
                // send remove handler call
                const message: UnListenMessage = {
                    to: envId,
                    from: this.rootEnvId,
                    type: 'unlisten',
                    data: {
                        api,
                        method,
                    },
                    handlerId: listenerHandlerId,
                    origin,
                };
                // sometimes the callback will never happen since target environment is already dead
                this.sendTo(envId, message);
                res();
            } else {
                res();
            }
        } else {
            if (methodConfig?.listener) {
                const handlersBucket = this.handlers.get(this.getHandlerId(envId, api, method));

                if (handlersBucket && handlersBucket.callbacks.size !== 0) {
                    if (handlersBucket.callbacks.has(fn)) {
                        const handlerId = this.getHandlerId(envId, api, method);
                        throw new DuplicateRegistrationError(handlerId, 'Listener');
                    }
                    handlersBucket.callbacks.add(fn);
                    res();
                } else {
                    const message: ListenMessage = {
                        to: envId,
                        from: this.rootEnvId,
                        type: 'listen',
                        data: {
                            api,
                            method,
                        },
                        removeListener: methodConfig.removeListener,
                        handlerId: '',
                        callbackId,
                        origin,
                    };
                    message.handlerId = this.createHandlerRecord(envId, api, method, fn, message);

                    this.callWithCallback(envId, message, callbackId, res, rej);
                }
            } else {
                throw new UnConfiguredMethodError(api, method);
            }
        }
    }
    private callWithCallback(
        envId: string,
        message: Message,
        callbackId: string | undefined,
        res: (value?: any) => void,
        rej: (reason: unknown) => void,
    ) {
        if (callbackId) {
            this.createCallbackRecord(message, callbackId, res, rej);
        }

        this.sendTo(envId, message);

        if (!callbackId) {
            res();
        }
    }
    private sendTo(envId: string, message: Message): void {
        if (this.pendingEnvs.get(envId)) {
            this.pendingMessages.add(envId, () => this.post(this.resolveMessageTarget(envId), message));
        } else {
            this.post(this.resolveMessageTarget(envId), message);
        }
    }

    private post(target: Target, message: Message): void {
        if (isWorkerContext(target)) {
            target.postMessage(message);
        } else {
            target.postMessage(message, '*');
        }
    }

    private resolveMessageTarget(envId: string): Target {
        const env = this.environments[envId] || this.environments[this.rootEnvId];
        if (!env) {
            return HOST_REMOVED;
        }
        const { host } = env;
        if (env.id !== this.rootEnvId) {
            return host;
        } else {
            if (host instanceof BaseHost) {
                return host.parent || host;
            }
            return this.getPostEndpoint(host);
        }
    }

    private getPostEndpoint(target: Target): Window | Worker {
        return isWindow(target) ? (target.opener as Window) || target.parent : (target as Worker);
    }

    private handleEventMessage(message: EventMessage): void {
        const handlers = this.handlers.get(message.handlerId);
        if (!handlers) {
            return;
        }
        for (const handler of handlers.callbacks) {
            handler(...message.data);
        }
    }

    public handleReady({ from }: { from: string }): void {
        const wasEnvironmentAlreadyReady = this.readyEnvs.has(from);
        this.readyEnvs.add(from);
        const pendingEnvCb = this.pendingEnvs.get(from);
        if (pendingEnvCb) {
            this.pendingEnvs.deleteKey(from);
            for (const callbackRecord of this.pendingCallbacks.values()) {
                if (callbackRecord.message.to === from) {
                    callbackRecord.scheduleOnTimeout();
                }
            }
            const pendingMessages = this.pendingMessages.get(from);
            if (pendingMessages) {
                for (const postMessage of pendingMessages) {
                    postMessage();
                }
                this.pendingMessages.deleteKey(from);
            }
            for (const cb of pendingEnvCb) {
                cb();
            }
        } else if (wasEnvironmentAlreadyReady) {
            // clear previous dispatchers
            this.clearEventDispatchersByEnvId(from);
            // re-register listeners
            for (const { message } of this.handlers.values()) {
                // run over listeners that were connected to the previous env
                if (message.to === from) {
                    // resend listener registration
                    this.sendTo(message.to, { ...message, callbackId: undefined });
                }
            }
            for (const reConnectHandler of this.reConnectListeners) {
                reConnectHandler(from);
            }
        }
    }
    private async handleUnListen(message: UnListenMessage) {
        const namespacedHandlerId = message.handlerId + message.origin;
        const dispatcher = this.eventDispatchers.get(namespacedHandlerId)?.dispatcher;
        if (dispatcher) {
            this.eventDispatchers.delete(namespacedHandlerId);
            const data = await this.apiCall(message.origin, message.data.api, message.data.method, [dispatcher]);
            if (message.callbackId) {
                this.sendTo(message.from, {
                    to: message.from,
                    from: this.rootEnvId,
                    type: 'callback',
                    data,
                    callbackId: message.callbackId,
                    origin: this.rootEnvId,
                });
            }
        }
    }

    private async handleListen(message: ListenMessage): Promise<void> {
        try {
            const dispatcher = this.getDispatcher(message.from, message);

            const data = await this.apiCall(message.origin, message.data.api, message.data.method, [dispatcher]);

            if (message.callbackId) {
                this.sendTo(message.from, {
                    to: message.from,
                    from: this.rootEnvId,
                    type: 'callback',
                    data,
                    callbackId: message.callbackId,
                    origin: this.rootEnvId,
                });
            }
        } catch (error) {
            this.sendTo(message.from, {
                to: message.from,
                from: this.rootEnvId,
                type: 'callback',
                error: errorToJson(error),
                callbackId: message.callbackId,
                origin: this.rootEnvId,
            });
        }
    }

    private async handleCall(message: CallMessage): Promise<void> {
        try {
            const args = deserializeApiCallArguments(message.data.args);
            const data = await this.apiCall(message.origin, message.data.api, message.data.method, args);

            if (message.callbackId) {
                this.sendTo(message.from, {
                    to: message.origin,
                    from: this.rootEnvId,
                    type: 'callback',
                    data,
                    callbackId: message.callbackId,
                    origin: this.rootEnvId,
                    DEBUG_CALL_INFO: this.DEBUG ? message.data : undefined,
                });
            }
        } catch (error) {
            this.sendTo(message.from, {
                to: message.from,
                from: this.rootEnvId,
                type: 'callback',
                error: errorToJson(error),
                callbackId: message.callbackId,
                origin: this.rootEnvId,
            });
        }
    }

    private handleCallback(message: CallbackMessage): void {
        const rec = message.callbackId ? this.pendingCallbacks.get(message.callbackId) : null;
        if (rec && message.error) {
            // If the error is not caught later, and logged to the console,
            // it would be nice to indicate which environment the error came from.
            // We shouldn't change the error message or the error name because
            // those could be used by error-handling code. Fortunately, we can
            // add metadata to the stack trace, and Chrome logs the entire stack
            // property to the console. Unfortunately, Firefox doesn't.
            const error = Object.assign(new Error(), message.error);
            error.stack = REMOTE_CALL_FAILED(message.from, error.stack);
            rec.reject(error);
        } else if (rec) {
            rec.resolve(message.data);
        } else {
            // TODO: only in dev mode
            if (message.callbackId) {
                throw new UnknownCallbackIdError(message, this.rootEnvId);
            }
        }
    }

    private getDispatcher(envId: string, message: ListenMessage): SerializableMethod {
        const namespacedHandlerId = message.handlerId + message.origin;
        if (this.eventDispatchers.has(namespacedHandlerId)) {
            return this.eventDispatchers.get(namespacedHandlerId)!.dispatcher;
        } else {
            const dispatcher = (...args: SerializableArguments) => {
                this.sendTo(envId, {
                    to: envId,
                    from: this.rootEnvId,
                    type: 'event',
                    data: args,
                    handlerId: message.handlerId,
                    origin: this.rootEnvId,
                });
            };
            this.eventDispatchers.set(namespacedHandlerId, { dispatcher, message });
            return dispatcher;
        }
    }

    private isListenCall(args: unknown[]): boolean {
        return typeof args[0] === 'function' && args.length === 1;
    }

    private handleEvent = ({ data, source }: { data: Message; source: Target }): void => {
        this.handleMessage(data, source).catch(console.error);
    };

    private getHandlerId(envId: string, api: string, method: string) {
        return `${this.createHandlerIdPrefix({ from: this.rootEnvId, to: envId })}${api}@${method}`;
    }
    private createHandlerRecord(
        envId: string,
        api: string,
        method: string,
        fn: UnknownFunction,
        message: ListenMessage,
    ): string {
        const handlerId = this.getHandlerId(envId, api, method);
        const handlersBucket = this.handlers.get(handlerId);
        if (!handlersBucket) {
            this.subscribeToEnvironmentDispose((disposedEnvId) => {
                if (envId === disposedEnvId) {
                    this.handlers.delete(handlerId);
                }
            });
        }
        handlersBucket
            ? handlersBucket.callbacks.add(fn)
            : this.handlers.set(handlerId, { message, callbacks: new Set([fn]) });
        return handlerId;
    }
    private createCallbackRecord(
        message: Message,
        callbackId: string,
        res: (value: unknown) => void,
        rej: (reason: unknown) => void,
    ) {
        if (!this.disposing) {
            const callbackItem: CallbackRecord<any> = {
                timerId: undefined,
                message,
                resolve: (value: unknown) => {
                    this.pendingCallbacks.delete(callbackId);
                    clearTimeout(callbackItem.timerId);
                    res(value);
                },
                reject: (error: Error) => {
                    this.pendingCallbacks.delete(callbackId);
                    clearTimeout(callbackItem.timerId);
                    if (this.DEBUG) {
                        error.cause = `Caused by: ${JSON.stringify(redactArguments(message), null, 2)}`;
                    }
                    rej(error);
                },
                scheduleOnSlow: () => {
                    setTimeout(() => {
                        if (this.pendingCallbacks.has(callbackId)) {
                            console.warn(new CallbackTimeoutError(callbackId, this.rootEnvId, message).message);
                        }
                    }, this.slowThreshold);
                },
                scheduleOnTimeout: () => {
                    callbackItem.timerId = setTimeout(() => {
                        callbackItem.reject(new CallbackTimeoutError(callbackId, this.rootEnvId, message));
                    }, this.callbackTimeout);
                },
            };
            if (!this.pendingEnvs.hasKey(message.to)) {
                if (this.options.warnOnSlow) {
                    callbackItem.scheduleOnSlow();
                }
                callbackItem.scheduleOnTimeout();
            }
            this.pendingCallbacks.set(callbackId, callbackItem);
        }
    }
}

export function declareComEmitter<T>(
    onMethod: keyof T,
    offMethod: keyof T,
    removeAll?: keyof T,
): Record<string, AnyServiceMethodOptions> {
    if (typeof onMethod !== 'string') {
        throw new Error('onMethod ref must be a string');
    }
    if (typeof offMethod !== 'string') {
        throw new Error('offMethod ref must be a string');
    }
    return {
        [onMethod]: { listener: true, removeListener: offMethod },
        [offMethod]: { removeListener: onMethod },
        ...(removeAll ? { [removeAll]: { removeAllListeners: onMethod } } : undefined),
    };
}

function countValues(set: SetMultiMap<string, unknown>) {
    const result: Record<string, number> = {};
    // SetMultiMap iterator is [key, value] and not [key, Set<value>]
    for (const [key] of set) {
        result[key] ??= 0;
        result[key]++;
    }
    return result;
}

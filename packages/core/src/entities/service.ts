import COM from '../communication.feature.js';
import type {
    AsyncApi,
    EnvironmentInstanceToken,
    EnvironmentTypes,
    MultiEnvAsyncApi,
    ServiceComConfig,
} from '../com/types.js';
import type { RuntimeEngine } from '../runtime-engine.js';
import { CREATE_RUNTIME, REGISTER_VALUE } from '../symbols.js';
import type { EnvVisibility } from '../types.js';
import { AllEnvironments, Environment, normEnvVisibility, Universal } from './env.js';
import { FeatureOutput } from './output.js';

export type ServiceRuntime<T extends object, ProvidedFrom> =
    ProvidedFrom extends Environment<string, EnvironmentTypes, 'single'>
        ? AsyncApi<T>
        : ProvidedFrom extends Environment<string, EnvironmentTypes, 'multi', any>
          ? MultiEnvAsyncApi<T>
          : AsyncApi<T>;

export class Service<
    T extends object,
    PT,
    ProvidedFrom extends EnvVisibility,
    VisibleAt extends EnvVisibility,
    RemoteAccess extends boolean,
> extends FeatureOutput<T, PT, ProvidedFrom, VisibleAt, RemoteAccess> {
    public static withType<T extends object>() {
        return {
            defineEntity<E_ENV extends EnvVisibility>(providedFrom: E_ENV) {
                return new Service<T, T, E_ENV, E_ENV, false>(providedFrom, providedFrom, false);
            },
        };
    }
    private constructor(
        public providedFrom: ProvidedFrom,
        public visibleAt: VisibleAt,
        public remoteAccess: RemoteAccess,
        private options: ServiceComConfig<T> = {},
    ) {
        super(providedFrom, visibleAt, remoteAccess);
    }
    public allowRemoteAccess(options?: ServiceComConfig<T>) {
        return new Service<T, ServiceRuntime<T, ProvidedFrom>, ProvidedFrom, Environment, true>(
            this.providedFrom,
            AllEnvironments,
            true,
            options,
        );
    }

    public [REGISTER_VALUE](
        runtimeEngine: RuntimeEngine,
        providedValue: T | undefined,
        inputValue: PT,
        featureID: string,
        entityKey: string,
    ) {
        if (this.remoteAccess) {
            const { communication } = runtimeEngine.get(COM).api;
            const serviceKey = runtimeEngine.entityID(featureID, entityKey);

            const providedFrom = normEnvVisibility(this.providedFrom, false);
            const shouldIncludeService =
                providedFrom.has(Universal.env) || hasIntersection(providedFrom, runtimeEngine.runningEnvNames);
            if (shouldIncludeService) {
                if (!providedValue) {
                    throw new Error(`
Service is not provided at runtime.
Make sure the environment setup file exists and named correctly: [featureName].[envName].env.[ext]
Service name: ${entityKey}
Feature id: ${featureID}
Environment: ${runtimeEngine.entryEnvironment.env}
`);
                }
                communication.registerAPI({ id: serviceKey }, providedValue);
                return providedValue;
            }

            return inputValue || this.getApiProxy(runtimeEngine, serviceKey);
        }
        return providedValue;
    }

    public [CREATE_RUNTIME](context: RuntimeEngine, featureID: string, entityKey: string) {
        if (this.remoteAccess) {
            return this.getApiProxy(context, context.entityID(featureID, entityKey));
        }
    }

    public getApiProxy(context: RuntimeEngine, serviceKey: string): any {
        const { communication } = context.get(COM).api;
        const instanceId = getSingleInstanceId(this.providedFrom);
        if (instanceId) {
            return communication.apiProxy<T>({ id: instanceId }, { id: serviceKey }, this.options);
        } else {
            return {
                get: (token: EnvironmentInstanceToken) => {
                    return communication.apiProxy<T>(token, { id: serviceKey }, this.options);
                },
            };
        }
    }
}

function getSingleInstanceId(providedFrom: unknown): string | void {
    if (isSingleInstance(providedFrom)) {
        return providedFrom.env;
    }
}

function isSingleInstance(providedFrom: unknown): providedFrom is Environment<string, EnvironmentTypes, 'single'> {
    return (
        !!providedFrom &&
        (providedFrom as Environment).endpointType &&
        (providedFrom as Environment).endpointType === 'single'
    );
}

const hasIntersection = (set1: Set<string>, set2: Set<string>) => {
    for (const item of set1) {
        if (set2.has(item)) {
            return true;
        }
    }
    return false;
};

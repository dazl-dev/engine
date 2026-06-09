import { runtimeType } from '../entity-helpers.js';
import type { RuntimeEngine } from '../runtime-engine.js';
import { CREATE_RUNTIME, REGISTER_VALUE } from '../symbols.js';
import type { Entity, EnvVisibility } from '../types.js';

export abstract class FeatureOutput<
    Type,
    Proxy,
    ProvidedFrom extends EnvVisibility,
    VisibleAt extends EnvVisibility,
    RemoteAccess extends boolean,
> implements Entity<Type, Proxy, ProvidedFrom, VisibleAt, 'output', RemoteAccess> {
    public mode = 'output' as const;
    public type = runtimeType<Type>();
    public proxyType = runtimeType<Proxy>();
    protected constructor(
        public providedFrom: ProvidedFrom,
        public visibleAt: VisibleAt,
        public remoteAccess: RemoteAccess,
    ) {}
    public abstract [CREATE_RUNTIME](context: RuntimeEngine, featureID: string, entityKey: string): Proxy | void;
    public abstract [REGISTER_VALUE](
        context: RuntimeEngine,
        providedValue: Type | undefined,
        inputValue: Proxy,
        featureID: string,
        entityKey: string,
    ): Proxy;
}

import { runtimeType } from '../entity-helpers.js';
import type { RuntimeEngine } from '../runtime-engine.js';
import { CREATE_RUNTIME, REGISTER_VALUE } from '../symbols.js';
import type { Entity, EnvVisibility } from '../types.js';

export abstract class FeatureInput<
    Type,
    ProvidedFrom extends EnvVisibility,
    VisibleAt extends EnvVisibility = ProvidedFrom,
> implements Entity<Type, Type, ProvidedFrom, VisibleAt, 'input', false> {
    public mode = 'input' as const;
    public type = runtimeType<Type>();
    public proxyType = runtimeType<Type>();
    public remoteAccess = false as const;
    protected constructor(
        public providedFrom: ProvidedFrom,
        public visibleAt: VisibleAt,
    ) {}
    public abstract [CREATE_RUNTIME](context: RuntimeEngine, featureID: string, entityKey: string): Type | void;
    public [REGISTER_VALUE](
        _context: RuntimeEngine,
        _providedValue: Type | undefined,
        inputValue: Type,
        _featureID: string,
        _entityKey: string,
    ) {
        return inputValue;
    }
}

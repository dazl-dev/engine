import type { SerializableArguments } from './types.js';

export interface RemoteCallAddress {
    api: string;
    method: string;
}

export interface BaseMessage {
    type: string;
    to: string;
    from: string;
    callbackId?: string;
    error?: Error;
    origin: string;
    forwardingChain?: string[];
}

export interface CallMessage extends BaseMessage {
    type: 'call';
    data: RemoteCallAddress & { args: SerializableArguments };
}

export interface CallbackMessage extends BaseMessage {
    type: 'callback';
    data?: unknown;
    DEBUG_CALL_INFO?: RemoteCallAddress & { args: SerializableArguments };
}

export interface ListenMessage extends BaseMessage {
    type: 'listen';
    data: RemoteCallAddress;
    handlerId: string;
    removeListener?: string;
}

export interface UnListenMessage extends BaseMessage {
    type: 'unlisten';
    data: RemoteCallAddress;
    handlerId: string;
}

export interface EventMessage extends BaseMessage {
    type: 'event';
    data: SerializableArguments;
    handlerId: string;
}

export interface ReadyMessage extends BaseMessage {
    type: 'ready';
}

export interface DisposeMessage extends BaseMessage {
    type: 'dispose';
}

export interface StatusMessage extends BaseMessage {
    type: 'status';
}

export type Message =
    | CallMessage
    | CallbackMessage
    | ListenMessage
    | UnListenMessage
    | EventMessage
    | ReadyMessage
    | DisposeMessage
    | StatusMessage;

export function isMessage(arg: any): arg is Message {
    return typeof arg === 'object' && arg !== null && 'to' in arg && 'from' in arg && 'type' in arg;
}

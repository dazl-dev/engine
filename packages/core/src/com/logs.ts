import type { Message } from './message-types.js';

export const REMOTE_CALL_FAILED = (environment: string, stack?: string) =>
    `Remote call failed in "${environment}"${stack ? `\n${stack}` : ''}`;

export const AUTO_REGISTER_ENVIRONMENT = (message: Message, hostId: string) =>
    `[autoRegisterEnvironment]: skipping host self registration at "${hostId}" for message ${JSON.stringify(message)}`;

export const MESSAGE_FROM_UNKNOWN_ENVIRONMENT = (message: Message, hostId: string, origin = '') =>
    `Received message from unknown environment ${origin ? origin + ' ' : ''} "${
        message.from
    }" at "${hostId}": ${JSON.stringify(message)}`;

export const FORWARDING_MESSAGE = (message: Message, fromEnv: string, toEnv: string) =>
    `forwarding message ${JSON.stringify(message)} from ${fromEnv} to ${toEnv}`;

export const REGISTER_ENV = (id: string, hostId: string) => `registering env ${id} at ${hostId}`;

export const UNHANDLED = (message: Message, hostId: string) =>
    `[DEBUG] unhandledMessage received at ${hostId}. message:\n${JSON.stringify(message, null, 2)}`;

export function reportError(e: unknown) {
    console.error(e);
}

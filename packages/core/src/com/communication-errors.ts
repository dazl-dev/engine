import type { Message } from './message-types.js';
import { redactArguments } from './helpers.js';

export class EngineCommunicationError extends Error {
    constructor(
        errorMessage: string,
        public readonly causedBy?: Message,
    ) {
        super(errorMessage);
        this.name = this.constructor.name;
        Object.setPrototypeOf(this, new.target.prototype);
        if (this.causedBy) {
            this.causedBy = redactArguments(this.causedBy);
        }
    }
}

export class DuplicateRegistrationError extends EngineCommunicationError {
    constructor(id: string, type: 'RemoteService' | 'Environment' | 'Listener') {
        super(`Cannot register ${type} "${id}" twice.`);
    }
}

export class UnConfiguredMethodError extends EngineCommunicationError {
    constructor(api: string, method: string) {
        super(`Cannot add listener to un-configured method ${api} ${method}. use "declareComEmitter" to configure it.`);
    }
}

export class UnknownCallbackIdError extends EngineCommunicationError {
    constructor(message: Message, hostId: string) {
        super(`Unknown callback "${message.callbackId!}" at "${hostId}".`, message);
    }
}

export class CallbackTimeoutError extends EngineCommunicationError {
    constructor(callbackId: string, hostId: string, message: Message) {
        super(`Callback "${callbackId}" timed out at "${hostId}".`, message);
    }
}

export class EnvironmentDisconnectedError extends EngineCommunicationError {
    constructor(environment: string, hostId: string, message: Message) {
        super(`Remote call failed in "${environment}" - environment disconnected at "${hostId}".`, message);
    }
}

export class CircularForwardingError extends EngineCommunicationError {
    constructor(message: Message, fromEnv: string, toEnv: string) {
        super(
            `Forwarding message from "${fromEnv}" to "${toEnv}" is stuck in circular messaging loop:\n\t${JSON.stringify(
                message.forwardingChain,
            )}.
             This probably happened because you are forwarding a message to an environment that is not connected to the root environment`,
            message,
        );
    }
}

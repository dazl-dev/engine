import type { LogMessage, LogMetadata } from '../common-types.js';
import { EventEmitter } from '@dazl/patterns';
import { type LoggerTransport, LogLevel } from '../types.js';

export interface LogValueData {
    value: string;
    metadata?: LogMetadata;
}

export type LogValue = string | LogValueData | (() => string | LogValueData);

export class LoggerService extends EventEmitter<{ message: LogMessage }> {
    private messages: LogMessage[] = [];

    constructor(
        private transports: Iterable<LoggerTransport> = [],
        private baseMetadata: LogMetadata = {},
        private config: {
            severity: LogLevel;
            logToConsole?: boolean;
            maxLogMessages?: number;
        } = { severity: LogLevel.DEBUG },
    ) {
        super();
    }

    public getMessages(): LogMessage[] {
        return this.messages;
    }

    public debug = (value: LogValue) => this.log(value, LogLevel.DEBUG);

    public info = (value: LogValue) => this.log(value, LogLevel.INFO);

    public warn = (value: LogValue) => this.log(value, LogLevel.WARN);

    public error = (value: LogValue) => this.log(value, LogLevel.ERROR);

    public logMessage(message: LogMessage) {
        if (message.level >= this.config.severity) {
            this.addToMessages(message);
            this.emit('message', message);
            if (this.config.logToConsole) {
                logToConsole(message);
            }
            for (const transport of this.transports) {
                transport.handleMessage(message);
            }
        }
    }

    public clearMessages() {
        this.messages = [];
    }

    private log(message: LogValue, severity: LogLevel) {
        const { value, metadata } = getValue(message);

        this.logMessage({
            message: value,
            timestamp: Date.now(),
            level: severity,
            metadata: { base: this.baseMetadata, ...metadata },
        });
    }

    private addToMessages(message: LogMessage) {
        if (this.messages.length + 1 > this.config.maxLogMessages!) {
            this.messages.shift();
        }

        this.messages.push(message);
    }
}

function getValue(message: LogValue): LogValueData {
    const logValue: LogValueData = {
        value: '',
    };

    if (typeof message === 'function') {
        const evaluatedValue = message();

        if (typeof evaluatedValue === 'string') {
            logValue.value = evaluatedValue;
        } else {
            logValue.value = evaluatedValue.value;
            logValue.metadata = evaluatedValue.metadata || logValue.metadata;
        }
    } else if (typeof message === 'string') {
        logValue.value = message;
    } else {
        logValue.value = message.value;
        logValue.metadata = message.metadata;
    }

    return logValue;
}

export function logToConsole({ message, metadata = {}, level }: LogMessage): void {
    switch (level) {
        case LogLevel.DEBUG:
            console.log(message, metadata);
            break;
        case LogLevel.INFO:
            console.info(message, metadata);
            break;
        case LogLevel.WARN:
            console.warn(message, metadata);
            break;
        case LogLevel.ERROR:
            console.error(message, metadata);
            break;
    }
}

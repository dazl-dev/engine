import { Worker } from '@dazl/isomorphic-worker/worker';
import { parentPort } from 'node:worker_threads';

const prefix = 'rpcCall';
let nextMessageId = 0;
export function getNextMessageId() {
    return prefix + nextMessageId++;
}
export function rpcCall<T>(worker: Worker, type: string, timeout = 10000): Promise<T> {
    const outgoingMessage = { type, id: getNextMessageId() };
    const result = new Promise<T>((resolve, reject) => {
        const tm = setTimeout(() => {
            worker.removeEventListener('message', handler);
            reject(
                new Error(
                    `Timeout after ${timeout / 1000} sec, waiting for ${JSON.stringify(outgoingMessage)} message.`,
                ),
            );
        }, timeout);
        const handler = (event: any) => {
            if (isValidRpcResponse(event.data, outgoingMessage.id)) {
                worker.removeEventListener('message', handler);
                clearTimeout(tm);
                resolve(event.data.value);
            }
        };
        worker.addEventListener('message', handler);
    });
    worker.postMessage(outgoingMessage);
    return result;
}

export function bindRpcListener<T>(type: string, customFetcher: () => Promise<T> | T) {
    const handler = async (message: unknown) => {
        if (isValidRpcMessage(message) && message.type === type) {
            const outgoingMessage = {
                id: message.id,
                value: await customFetcher(),
            };
            if (parentPort) {
                parentPort.postMessage(outgoingMessage);
            } else if (process.send) {
                process.send(outgoingMessage);
            } else {
                throw new Error('No parentPort or process.send');
            }
        }
    };
    const wrapped = (message: unknown) => {
        handler(message).catch(console.error);
    };
    (parentPort ?? process).on('message', wrapped);
    return () => {
        (parentPort ?? process).off('message', wrapped);
    };
}

export function isValidRpcMessage(message: unknown): message is { type: string; id: string } {
    return !!(
        message &&
        typeof message === 'object' &&
        'type' in message &&
        'id' in message &&
        typeof message.id === 'string' &&
        message.id.startsWith(prefix)
    );
}
export function isValidRpcResponse(
    responseMessage: unknown,
    id: string | number,
): responseMessage is { id: string | number; value: unknown } {
    return !!(
        responseMessage &&
        typeof responseMessage === 'object' &&
        'id' in responseMessage &&
        id === responseMessage.id &&
        'value' in responseMessage
    );
}

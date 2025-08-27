import type { ChildProcess } from 'node:child_process';
import type { Worker } from '@dazl/isomorphic-worker/worker';
import { isValidRpcResponse, rpcCall, getNextMessageId, bindRpcListener } from './micro-rpc.js';

export type PerformanceMetrics = {
    marks: PerformanceEntry[];
    measures: PerformanceEntry[];
};

export function bindMetricsListener(
    customFetcher: () => Promise<PerformanceMetrics> | PerformanceMetrics = localPerformanceFetcher,
) {
    return bindRpcListener('getMetrics', customFetcher);
}
export function localPerformanceFetcher() {
    return {
        marks: performance.getEntriesByType('mark').map((_) => _.toJSON()),
        measures: performance.getEntriesByType('measure').map((_) => _.toJSON()),
    };
}

//TODO: generalize
export async function getMetricsFromProcess(
    managerProcess: ChildProcess,
    timeout = 10000,
): Promise<PerformanceMetrics> {
    return await new Promise((resolve, reject) => {
        const outgoingMessage = { type: 'getMetrics', id: getNextMessageId() };
        const tm = setTimeout(() => {
            managerProcess.off('message', handler);
            reject(new Error(`Timeout after ${timeout / 1000} sec, waiting for getMetrics message.`));
        }, timeout);
        const handler = (responseMessage: unknown) => {
            if (isValidRpcResponse(responseMessage, outgoingMessage.id)) {
                clearTimeout(tm);
                resolve(responseMessage.value as PerformanceMetrics);
            }
        };
        managerProcess.on('message', handler);
        if (!managerProcess.send) {
            throw new Error('managerProcess.send is not defined');
        }
        managerProcess.send(outgoingMessage);
    });
}

export function getMetricsFromWorker(worker: Worker) {
    return rpcCall<PerformanceMetrics>(worker, 'getMetrics', 5000);
}

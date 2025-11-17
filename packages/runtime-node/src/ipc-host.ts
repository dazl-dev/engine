import { BaseHost, type Message } from '@dazl/engine-core';
import type { ChildProcess } from 'node:child_process';
import { SafeDisposable, type IDisposable } from '@dazl/patterns';

const isParentProcess = (process: NodeJS.Process | ChildProcess): process is NodeJS.Process => {
    return (process as NodeJS.Process).constructor.name === 'process';
};

export class IPCHost extends BaseHost implements IDisposable {
    private disposables = new SafeDisposable(IPCHost.name);
    dispose = this.disposables.dispose;
    isDisposed = this.disposables.isDisposed;
    private envs = new Set<string>();

    constructor(private process: NodeJS.Process | ChildProcess) {
        super();
        process.on('message', this.onMessage);
        process.once('disconnect', () => {
            process.off('message', this.onMessage);
            for (const env of this.envs) {
                this.emitMessageHandlers({
                    from: env,
                    type: 'dispose',
                    to: '*',
                    origin: env,
                    forwardingChain: [],
                });
            }
        });
        this.disposables.add('process listeners', () => this.process.removeAllListeners());
        this.disposables.add('clear handlers', () => this.handlers.clear());
    }

    private onMessage: (...args: any[]) => void = (message) => {
        this.emitMessageHandlers(message);
    };

    public postMessage(data: Message) {
        this.envs.add(data.to);
        if (!this.process.send) {
            throw new Error('this process is not forked. There is not to send message to');
        }
        const disposeHandlers = (e: Error | null) => {
            if (e) {
                this.emitMessageHandlers({
                    from: data.to,
                    type: 'dispose',
                    to: '*',
                    origin: data.to,
                    forwardingChain: [],
                });
            }
        };

        if (isParentProcess(this.process)) {
            this.process.send(data, undefined, undefined, disposeHandlers);
        } else {
            this.process.send(data, disposeHandlers);
        }
    }
}

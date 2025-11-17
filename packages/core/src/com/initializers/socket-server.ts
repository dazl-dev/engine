import type { SocketOptions } from 'socket.io-client';
import { WsClientHost } from '../hosts/ws-client-host.js';
import { Communication } from '../communication.js';

export interface SocketClientInitializerOptions extends Partial<SocketOptions> {
    communication: Communication;
    env: { env: string };
    envUrl?: string;
}

export const socketClientInitializer = async ({
    communication,
    env: { env },
    envUrl: serverUrl,
    ...socketClientOptions
}: SocketClientInitializerOptions) => {
    const url = serverUrl || communication.topology[env] || location.origin;
    const instanceId = env;
    const host = new WsClientHost(url, socketClientOptions);
    if (communication.getEnvironmentHost(instanceId)) {
        communication.clearEnvironment(instanceId, undefined, false);
    }
    communication.registerMessageHandler(host);
    communication.registerEnv(instanceId, host);
    try {
        await host.connected;
    } catch (e) {
        communication.clearEnvironment(instanceId, undefined, false);
        void host.dispose();
        throw e;
    }

    communication.handleReady({ from: instanceId });

    return {
        id: instanceId,
        dispose: () => {
            communication.clearEnvironment(instanceId, undefined, false);
            return host.dispose();
        },
        getMetrics: () => {
            return Promise.resolve({
                marks: [],
                measures: [],
            });
        },
    };
};

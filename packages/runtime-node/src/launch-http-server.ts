import express from 'express';
import cors from 'cors';
import { safeListeningHttpServer } from 'create-listening-server';
import * as io from 'socket.io';

export const DEFAULT_PORT = 3000;

const noContentHandler: express.RequestHandler = (_req, res) => {
    res.status(204); // No Content
    res.end();
};

export interface RouteMiddleware {
    path: string;
    handlers: express.RequestHandler | express.RequestHandler[];
}

export interface ILaunchHttpServerOptions {
    staticDirPath?: string;
    httpServerPort?: number;
    socketServerOptions?: Partial<io.ServerOptions>;
    routeMiddlewares?: Array<RouteMiddleware>;
    hostname?: string;
}

export async function launchEngineHttpServer({
    staticDirPath,
    httpServerPort = DEFAULT_PORT,
    socketServerOptions,
    routeMiddlewares = [],
    hostname,
}: ILaunchHttpServerOptions = {}): Promise<{
    close: () => Promise<void>;
    port: number;
    app: express.Express;
    socketServer: io.Server;
}> {
    const app = express();
    for (const { path, handlers } of routeMiddlewares) {
        app.use(path, handlers);
    }
    app.use(cors());
    const { port, httpServer } = await safeListeningHttpServer(
        httpServerPort,
        app as import('http').RequestListener,
        100,
        hostname,
    );

    if (staticDirPath) {
        app.use('/', express.static(staticDirPath));
    }

    app.use('/favicon.ico', noContentHandler);

    const socketServer = new io.Server(httpServer, {
        cors: {},
        pingTimeout: 30 * 1000 * 60, // 30 minutes. our sockets does not run over network.
        pingInterval: 10 * 1000 * 60, // 10 minutes. our sockets does not run over network.
        httpCompression: false,
        serveClient: false,
        maxHttpBufferSize: 1e8, // 100 MB
        ...socketServerOptions,
        transports: ['websocket'],
    });

    return {
        close: () => {
            httpServer.closeAllConnections();
            return socketServer.close();
        },
        port,
        app,
        socketServer,
    };
}

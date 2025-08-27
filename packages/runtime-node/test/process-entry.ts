import { Communication } from '@dazl/engine-core';
import { IPCHost } from '@dazl/engine-runtime-node';

const ipcHost = new IPCHost(process);
const com = new Communication(ipcHost, 'process');
com.registerAPI(
    { id: 'myApi' },
    {
        echo: () => 'yo',
    },
);

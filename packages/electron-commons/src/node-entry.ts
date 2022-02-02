import { BaseHost, COM, Communication } from '@wixc3/engine-core';
import { LOCAL_ENVIRONMENT_INITIALIZER_ENV_ID } from '@wixc3/engine-core-node';
import { runIPCEnvironment } from '@wixc3/engine-runtime-node';
import { importModules } from './import-modules';
import { isNodeEnvStartupMessage, metadataApiToken, MetadataCollectionAPI } from './types';

const onMessageListener: NodeJS.MessageListener = async (message) => {
    if (isNodeEnvStartupMessage(message)) {
        const {
            requiredModules,
            basePath,
            externalFeatures,
            environmentName,
            config,
            environmentContextName,
            featureName,
            features,
            outputPath,
            runtimeOptions,
            parentEnvName,
        } = message.runOptions;
        if (requiredModules) {
            await importModules(basePath, requiredModules);
        }

        // if current node environment wishes to launch a new one, it needs to pass on the runtime arguments it received.
        // creating an access point at runtime application, so it could use the ENGINE_PARENT_ENV_ID to be able to retrieve all getRuntimeArguments and externalFeatures values into the app while launching a new environment using the initializer provided from '@wixc3/engine-electron-node'
        const parentHost = new BaseHost();
        const com = new Communication(parentHost, LOCAL_ENVIRONMENT_INITIALIZER_ENV_ID);
        com.registerAPI<MetadataCollectionAPI>(metadataApiToken, {
            getRuntimeArguments: () => message.runOptions,
            getExternalFeatures: () => externalFeatures ?? [],
        });
        const comHost = parentHost.open();
        com.registerEnv(environmentName, comHost);

        config.push(
            COM.use({
                config: {
                    connectedEnvironments: {
                        [LOCAL_ENVIRONMENT_INITIALIZER_ENV_ID]: {
                            id: LOCAL_ENVIRONMENT_INITIALIZER_ENV_ID,
                            host: comHost,
                        },
                    },
                },
            })
        );

        await runIPCEnvironment({
            type: 'node',
            name: environmentName,
            outputPath,
            childEnvName: environmentContextName,
            featureName,
            config,
            features,
            options: runtimeOptions,
            externalFeatures,
            context: basePath,
            parentEnvName,
        });
    }
};

process.once('message', onMessageListener);

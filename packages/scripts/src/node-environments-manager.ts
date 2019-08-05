import { Router } from 'express';

export interface IClosable {
    close: () => Promise<void>;
}

export interface RunEnvironmentOptions {
    featureName: string;
    configName?: string;
}

export class NodeEnvironmentsManager {
    private runningEnvironments = new Map<string, IClosable>();

    constructor(
        private runNodeEnvironmentFunction: (target: {
            featureName: string;
            configName?: string | undefined;
            projectPath?: string | undefined;
        }) => Promise<IClosable>
    ) {}

    public async runEnvironment({ featureName, configName }: RunEnvironmentOptions) {
        if (this.runningEnvironments.has(featureName)) {
            throw new Error(`node environment for ${featureName} already running`);
        }
        this.runningEnvironments.set(featureName, await this.runNodeEnvironmentFunction({ featureName, configName }));
    }

    public async closeEnvironment({ featureName }: RunEnvironmentOptions) {
        const runningEnvironment = this.runningEnvironments.get(featureName);
        if (!runningEnvironment) {
            throw new Error(`there are no node environments running for ${featureName}`);
        }
        this.runningEnvironments.delete(featureName);
        await runningEnvironment.close();
    }

    public getRunningEnvironments() {
        return Array.from(this.runningEnvironments.keys());
    }

    public async closeAll() {
        for (const runningEnvironment of this.runningEnvironments.values()) {
            await runningEnvironment.close();
        }
        this.runningEnvironments.clear();
    }

    public middleware() {
        const router = Router();

        router.put('/node-env', async (req, res) => {
            const { configName, featureName }: RunEnvironmentOptions = req.query;
            try {
                await this.runEnvironment({ configName, featureName });
                res.json({
                    result: 'success'
                });
            } catch (error) {
                res.status(404).json({
                    result: 'error',
                    error: error && error.message
                });
            }
        });

        router.delete('/node-env', async (req, res) => {
            const { featureName }: RunEnvironmentOptions = req.query;
            try {
                await this.closeEnvironment({ featureName });
                res.json({
                    result: 'success'
                });
            } catch (error) {
                res.status(404).json({
                    result: 'error',
                    error: error && error.message
                });
            }
        });

        router.get('/node-env', (_req, res) => {
            try {
                const data = this.getRunningEnvironments();
                res.json({
                    result: 'success',
                    data
                });
            } catch (error) {
                res.status(404).json({
                    result: 'error',
                    error: error && error.message
                });
            }
        });

        return router;
    }
}

export type EchoService = {
    echo: () => string;
    echoChained: () => Promise<string>;
    getActivateValue: () => unknown;
};

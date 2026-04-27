export type EchoService = {
    echo: () => string;
    echoChained: () => Promise<string>;
    getActivateValue: () => unknown;
};

export type IdentityService = {
    whoAmI: () => unknown;
};

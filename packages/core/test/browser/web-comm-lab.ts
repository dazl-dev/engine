import { Communication, type Message, type Target } from '@dazl/engine-core';

/**
 * WebCommLab is a temporary test-kit facade for writing communication tests
 * over real browser transports:
 *
 * - real same-origin iframes, where messages travel via genuine cross-document
 *   `window.postMessage` (structured clone, async delivery, real `event.source`)
 * - real `MessageChannel` ports (the transport used by worker-style peers)
 *
 * It hides the current engine wiring (hosts, env registration) behind a small,
 * clear vocabulary. The implementation may later be folded into the engine itself.
 */

/** A thin Target adapter over a real Window (no `.parent` so listeners attach to the window itself). */
class WindowTarget implements Target {
    constructor(
        private win: Window,
        public name: string,
    ) {}

    addEventListener(type: 'message', handler: (event: { data: any; source: Target }) => void) {
        this.win.addEventListener(type, handler as unknown as EventListener);
    }

    removeEventListener(type: 'message', handler: (event: { data: any }) => void) {
        this.win.removeEventListener(type, handler as unknown as EventListener);
    }

    postMessage(data: any) {
        this.win.postMessage(data, '*');
    }
}

/** A thin Target adapter over a real MessagePort. */
class PortTarget implements Target {
    constructor(
        private port: MessagePort,
        public name: string,
    ) {
        this.port.start();
    }

    addEventListener(type: 'message', handler: (event: { data: any; source: Target }) => void) {
        this.port.addEventListener(type, handler as unknown as EventListener);
    }

    removeEventListener(type: 'message', handler: (event: { data: any }) => void) {
        this.port.removeEventListener(type, handler as unknown as EventListener);
    }

    postMessage(data: any) {
        this.port.postMessage(data);
    }

    close() {
        this.port.close();
    }
}

export class WebEnv {
    constructor(
        public readonly name: string,
        public readonly com: Communication,
        private target: Target,
    ) {}

    /** Register an API implementation that remote environments can call. */
    exposeApi<T extends object>(apiId: string, implementation: T): T {
        return this.com.registerAPI({ id: apiId }, implementation);
    }

    /** Get a typed async proxy to an API exposed by a remote environment. */
    remoteApi<T extends object>(
        targetEnv: string,
        apiId: string,
        serviceComConfig?: Parameters<Communication['apiProxy']>[2],
    ) {
        return this.com.apiProxy<T>({ id: targetEnv }, { id: apiId }, serviceComConfig);
    }

    /** @internal */
    getTarget() {
        return this.target;
    }
}

export class WebCommLab {
    private iframes: HTMLIFrameElement[] = [];
    private envIframes = new Map<WebEnv, HTMLIFrameElement>();
    private envs: WebEnv[] = [];

    /** An environment whose communication runs on the top-level window (real `window.postMessage`). */
    addWindowEnv(name: string): WebEnv {
        const target = new WindowTarget(window, name);
        const env = new WebEnv(name, new Communication(target, name), target);
        this.envs.push(env);
        return env;
    }

    /**
     * An environment living in a real same-origin iframe. Its communication
     * listens on the iframe's content window, so every message crosses a real
     * document boundary via `postMessage` (structured clone, async delivery).
     */
    addIframeEnv(name: string): WebEnv {
        const iframe = document.createElement('iframe');
        iframe.src = 'about:blank';
        document.body.appendChild(iframe);
        this.iframes.push(iframe);
        const contentWindow = iframe.contentWindow;
        if (!contentWindow) {
            throw new Error('iframe has no content window');
        }
        const target = new WindowTarget(contentWindow, name);
        const env = new WebEnv(name, new Communication(target, name), target);
        this.envs.push(env);
        this.envIframes.set(env, iframe);
        return env;
    }

    /** Two environments connected by a real `MessageChannel` port pair (worker-style transport). */
    addPortLinkedEnvs(nameA: string, nameB: string): [WebEnv, WebEnv] {
        const channel = new MessageChannel();
        const targetA = new PortTarget(channel.port1, nameA);
        const targetB = new PortTarget(channel.port2, nameB);
        const envA = new WebEnv(nameA, new Communication(targetA, nameA), targetA);
        const envB = new WebEnv(nameB, new Communication(targetB, nameB), targetB);
        // over a port pair, posting to your own port delivers to the peer,
        // so each env's own host already routes to the other side
        envA.com.registerEnv(nameB, targetA);
        envB.com.registerEnv(nameA, targetB);
        this.envs.push(envA, envB);
        return [envA, envB];
    }

    /** Make two window/iframe environments reachable from one another. */
    linkEnvs(a: WebEnv, b: WebEnv) {
        a.com.registerEnv(b.name, b.getTarget());
        b.com.registerEnv(a.name, a.getTarget());
    }

    /** Remove an iframe from the document — its window (and transport) dies with it. */
    killIframe(env: WebEnv) {
        const iframe = this.envIframes.get(env);
        if (!iframe) {
            throw new Error(`env "${env.name}" is not an iframe env`);
        }
        iframe.remove();
    }

    /**
     * Spawn a real iframe running an attacker script that posts an
     * engine-shaped message to the parent window — a hostile embedded page.
     */
    spawnHostileIframe(message: Message) {
        const iframe = document.createElement('iframe');
        iframe.srcdoc = `<script>parent.postMessage(${JSON.stringify(message)}, '*')</script>`;
        document.body.appendChild(iframe);
        this.iframes.push(iframe);
    }

    async dispose() {
        for (const env of this.envs) {
            await env.com.dispose().catch(() => undefined);
        }
        this.envs.length = 0;
        for (const iframe of this.iframes) {
            iframe.remove();
        }
        this.iframes.length = 0;
    }
}

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * Dynamically imports required modules using the specified base path.
 * @param basePath The base path to use for resolving module paths.
 * @param requiredModules An array of module names to import.
 * @throws An error if any of the required modules fail to import.
 */
export async function importModules(basePath: string, requiredModules: string[]): Promise<void> {
    const require = createRequire(import.meta.url);
    for (const requiredModule of requiredModules) {
        try {
            await import(pathToFileURL(require.resolve(requiredModule, { paths: [basePath] })).href);
        } catch (ex) {
            throw new Error(`failed importing: ${requiredModule}`, { cause: ex });
        }
    }
}

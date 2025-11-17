import type { IFileSystemSync } from '@file-services/types';
import type { INpmPackage } from '@dazl/resolve-directory-context';
import type { PackageJson } from 'type-fest';

const featurePackagePostfix = '-feature';

export function scopeToPackage(packageName: string, entityName: string) {
    return packageName === entityName ? entityName : `${packageName}/${entityName}`;
}

/**
 * Removes package scope (e.g `@scope`) and posfix `-feature`.
 */
export function simplifyPackageName(name: string) {
    const indexOfSlash = name.indexOf('/');
    if (name.startsWith('@') && indexOfSlash !== -1) {
        name = name.slice(indexOfSlash + 1);
    }
    if (name.endsWith(featurePackagePostfix)) {
        name = name.slice(0, -featurePackagePostfix.length);
    }
    return name;
}

export interface IPackageDescriptor {
    simplifiedName: string;
    directoryPath: string;
    name: string;
}

export function findPackageOfDirs(featureDirs: Iterable<string>, fs: IFileSystemSync, npmPackages: INpmPackage[]) {
    const pkgs = new Map(npmPackages.map((pkg) => [pkg.directoryPath, pkg]));
    const directoryToPackage = new Map<string, IPackageDescriptor>();
    for (const featureDirectoryPath of featureDirs) {
        let name: string | undefined, directoryPath: string, packageJsonPath: string;
        if (pkgs.has(featureDirectoryPath)) {
            const pkg = pkgs.get(featureDirectoryPath)!;
            name = pkg.displayName;
            directoryPath = pkg.directoryPath;
            packageJsonPath = pkg.packageJsonPath;
        } else {
            packageJsonPath = findPackageJson(fs, featureDirectoryPath);
            directoryPath = fs.dirname(packageJsonPath);
            if (!pkgs.has(directoryPath)) {
                const pkg = fs.readJsonFileSync(packageJsonPath) as PackageJson;
                pkgs.set(directoryPath, {
                    directoryPath,
                    packageJsonPath,
                    displayName: pkg.name!,
                    packageJson: pkg,
                    packageJsonContent: '',
                });
            }
            name = pkgs.get(directoryPath)?.displayName;
        }
        if (!name) {
            throw new Error(`Invalid package.json: ${packageJsonPath} does not contain a name`);
        }
        directoryToPackage.set(featureDirectoryPath, {
            simplifiedName: simplifyPackageName(name),
            directoryPath,
            name,
        });
    }
    return directoryToPackage;
}

export function findPackageJson(fs: IFileSystemSync, featureDirectoryPath: string) {
    const packageJsonPath = fs.findClosestFileSync(featureDirectoryPath, 'package.json');
    if (!packageJsonPath) {
        throw new Error(`cannot find package.json ${featureDirectoryPath}`);
    }
    return packageJsonPath;
}

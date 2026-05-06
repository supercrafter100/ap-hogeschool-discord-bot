import * as FS from 'fs';
import * as SysPath from 'path';
import { fullPath } from './utils.js';

/**
 * Scans a directory and finds the commands
 * @param dir
 * @param recursive
 * @param extension The file extension to check for
 * @returns All paths that match the command
 */
export function directoryScanner(
    dir: string,
    recursive: boolean,
    extension = 'command'
): string[] {
    if (!/^\w+$/.test(extension))
        throw new Error('Extension must match /$\\w+^/');

    const root = fullPath(dir);
    const files = new Array<string>();

    FS.readdirSync(root).forEach((file) => {
        const path = SysPath.join(root, file);

        if (FS.lstatSync(path).isDirectory()) {
            if (!recursive) return;
            files.push(...directoryScanner(path, recursive, extension));
            return;
        }

        if (!new RegExp(`\\.${extension}\\.(mjs|ts|js)$`).test(file)) return;

        files.push(path);
    });

    return files;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Command } from '@crystaldevelopment/command-handler';
import { type Constructor } from './types.js';
import { isConstructorOf } from './utils.js';
import { pathToFileURL } from 'url';

/**
 * Gets all the command constructors
 * @param files Directories
 * @returns The files parsed as Commands
 */
export async function getCommands(
    files: string[]
): Promise<Constructor<Command>[]> {
    const commands = new Array<Constructor<Command>>();

    for (const file of files) {
        const data = await getCommand(file);

        if (!isConstructorOf(data, Command))
            throw new Error(
                `File ${file} does not defaulty export a Command type`
            );

        commands.push(data);
    }

    return commands;
}

/**
 * Gets the default export, or the export of a file
 * @param file File path of this command
 * @returns The command constructor
 */
export async function getCommand(file: string): Promise<any> {
    const mod = await import(pathToFileURL(file).href);
    return (mod as any).default ?? mod; // default export or CJS export
}

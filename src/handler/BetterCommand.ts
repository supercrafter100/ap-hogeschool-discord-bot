/* eslint-disable @typescript-eslint/no-explicit-any */
import { Command } from '@crystaldevelopment/command-handler';
import type { BaseCommand } from '@crystaldevelopment/command-handler/dist/classes/commands/BaseCommand';
import type { Client } from 'discord.js';
import { pathToFileURL } from 'url';

export abstract class BetterCommand<
    T extends Client = Client
> extends Command<T> {
    public override loadSubcommandFromPath(path: string): void {
        //	@ts-expect-error the command property is there just not visible
        const cmd = this instanceof Command ? this : this.command;

        import(pathToFileURL(path).href).then((mod) => {
            const Constructor = (mod as any).default ?? mod;
            const command = new Constructor(cmd) as BaseCommand;
            command.onStart();
            this.loadSubcommand(command);
        });
    }
}

import { CommandHandler } from '@crystaldevelopment/command-handler';
import { directoryScanner } from '../util/directoryScanner.js';
import { getCommands } from '../util/getCommands.js';
import type { Client } from 'discord.js';

export default class BetterCommandHandler<
    T extends Client<true>
> extends CommandHandler<T> {
    public override loadFromDirectory(dir: string, recursive?: boolean): this {
        const files = directoryScanner(dir, recursive ?? false);
        getCommands(files).then((cmds) => {
            const commands = cmds.map((c) => {
                const cmd = this._startCommand(c);
                this.emit('started', cmd);
                return cmd;
            });

            this.commands.push(...commands);
        });

        return this;
    }
}

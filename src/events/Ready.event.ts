import chalk from 'chalk';
import { Event } from '../handler/EventHandler.js';

export default class ReadyEvent extends Event<'clientReady'> {
    public event = 'clientReady';
    public async run() {
        this.logger.info('Bot is now ready!');
        await this.client.commands.loadCommands();

        this.logger.info(
            `Bot logged in as ${chalk.green.bold(this.client.user.tag)}`
        );
    }
}

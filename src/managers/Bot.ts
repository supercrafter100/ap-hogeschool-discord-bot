import { Client, type ClientOptions } from 'discord.js';
import EventHandler from '../handler/EventHandler.js';
import Logger from '../util/Logger.js';
import chalk from 'chalk';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import BetterCommandHandler from '../handler/BetterCommandHandler.js';

export default class Bot extends Client<true> {
    public readonly commands = new BetterCommandHandler<Client<true>>(this, {
        guildId: process.env.GUILDID!,
        createCommands: true,
        updateCommands: true,
        deleteCommands: true,
    });
    public readonly events = new EventHandler(this);

    //      Util

    public readonly logger = new Logger(this);

    //      Misc

    public readonly extension: string;
    public readonly devmode: boolean;
    public debug = false;

    constructor(options: ClientOptions) {
        super(options);

        this.logger.prefix = chalk.green('BOT');
        this.devmode = process.env.npm_lifecycle_event == 'dev';
        this.extension = this.devmode ? '.ts' : '.js';
        this.logger.info('Starting bot...');
        this.start();
    }

    private async start() {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);

        await this.initAI();

        await this.events.start();
        this.events.load(join(__dirname, '../events'));
        // this.commands.loadFromDirectory(join(__dirname, '../commands'));
    }

    private async initAI() {
        try {
            this.logger.info('OER laden...');
            const { loadOerText } = await import('../ai/oerLoader.js');
            const { initAgent } = await import('../ai/agent.js');
            const oerText = await loadOerText();
            initAgent(oerText);
            this.logger.info('AI-agent klaar.');
        } catch (err) {
            this.logger.error('Kon AI-agent niet initialiseren:', err);
        }
    }
}

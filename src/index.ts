import { config } from 'dotenv';
config();

import Logger from './util/Logger.js';
import chalk from 'chalk';
import Bot from './managers/Bot.js';
import { ActivityType, GatewayIntentBits } from 'discord.js';

// Setting up

const logger = new Logger();
logger.prefix = chalk.bold.redBright('MASTER');
const devmode = process.env.npm_lifecylce_event == 'dev';

const logtype = devmode ? 'warn' : 'info';

logger.blank();
logger[logtype]('=================================');
logger[logtype](
    'Running bot in',
    devmode ? chalk.red('DEV') : chalk.green('PROD'),
    'mode'
);
logger[logtype]('=================================');
logger.blank();

const client = new Bot({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    presence: {
        activities: [
            {
                name: 'AP Hogeschool',
                type: ActivityType.Watching,
            },
        ],
    },
});

if (client.devmode) {
    client.login(process.env.DEV_TOKEN ?? process.env.TOKEN);
} else {
    client.login(process.env.TOKEN);
}

export default client;

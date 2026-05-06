import chalk from 'chalk';
import Logger from '../util/Logger.js';

const aiLogger = new Logger(undefined);
aiLogger.prefix = chalk.magenta('AI');

export default aiLogger;

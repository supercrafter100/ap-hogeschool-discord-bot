import { readFileSync, watch } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Logger from '../util/Logger.js';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, 'data/system-prompt.txt');

const logger = new Logger();
logger.prefix = chalk.magenta('AI:prompt');

export function loadPromptTemplate(): string {
    return readFileSync(PROMPT_PATH, 'utf8');
}

export function getPromptPath(): string {
    return PROMPT_PATH;
}

/**
 * Watch the system prompt file and call `onChange` when it's modified.
 * Debounced because editors often emit multiple `change` events on save.
 */
export function watchPrompt(onChange: () => void): void {
    let timer: NodeJS.Timeout | null = null;
    try {
        watch(PROMPT_PATH, (event) => {
            if (event !== 'change') return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                logger.info('system-prompt.txt gewijzigd — agent herladen.');
                try {
                    onChange();
                } catch (err) {
                    logger.error('Fout bij herladen agent:', err);
                }
            }, 250);
        });
        logger.info(`Watch actief op ${PROMPT_PATH}`);
    } catch (err) {
        logger.error('Kon prompt-bestand niet bewaken:', err);
    }
}

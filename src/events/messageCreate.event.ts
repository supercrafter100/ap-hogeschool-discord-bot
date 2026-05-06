import { Message } from 'discord.js';
import { Event } from '../handler/EventHandler.js';

export default class InteractionCreate extends Event<'messageCreate'> {
    public event = 'messageCreate';

    public async run(msg: Message<true>) {
        if (!msg.guild || !msg.guild.id) return;
    }
}

import { CommandInteraction, type Interaction } from 'discord.js';
import { Event } from '../handler/EventHandler.js';

export default class InteractionCreate extends Event<'interactionCreate'> {
    public event = 'interactionCreate';

    public run(interaction: Interaction) {
        if (interaction.isCommand())
            return this.client.commands.runCommand(
                interaction as CommandInteraction
            );
    }
}

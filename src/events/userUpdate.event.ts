import { GuildMember, type PartialGuildMember, Role } from 'discord.js';
import { Event } from '../handler/EventHandler.js';

const yearRoles = ['J1', 'J2', 'J3'];
const specifications = ['SOF', 'BUS', 'IoT', 'CSC', 'AI'];
const minors = ['Mixed Reality', 'Maker', 'Startup', 'Robotics'];

export default class GuildMemberUpdateHandler extends Event<'guildMemberUpdate'> {
    public event = 'guildMemberUpdate';

    public async run(
        _oldMember: GuildMember | PartialGuildMember,
        member: GuildMember | PartialGuildMember
    ) {
        if (member.partial) {
            try {
                await member.fetch();
            } catch (error) {
                console.error('Error fetching partial user:', error);
                return;
            }
        }

        this.client.logger.info(
            `User updated: ${member.user.tag} (${member.user.id})`
        );
        if (member.user.bot) return;

        // Ensure caches are hydrated
        await member.guild.roles.fetch();

        const memberRoles = member.roles.cache; // what the user actually has
        const guildRoles = member.guild.roles.cache; // all roles in the guild

        const rolesAdd = new Map<string, Role>();
        const rolesRemove = new Map<string, Role>();

        for (const role of yearRoles) {
            const yearNumber = role.charAt(1); // '1' | '2' | '3'

            // Does the member have this year role (e.g. 'J1')?
            const hasYearRole = memberRoles.some((r) => r.name === role);

            if (!hasYearRole) {
                // Remove ONLY the member's roles that start with "<yearNumber> "
                memberRoles
                    .filter((r) =>
                        r.name.toLowerCase().startsWith(`${yearNumber} `)
                    )
                    .forEach((r) => rolesRemove.set(r.id, r));
                continue; // no need to process specs/minors for this year
            }

            // Member is in this year -> process specifications
            for (const spec of specifications) {
                const hasBaseSpec = memberRoles.some((r) => r.name === spec);

                if (!hasBaseSpec) {
                    // Remove year-specific spec roles the MEMBER has (not from the whole guild)
                    memberRoles
                        .filter((r) =>
                            r.name
                                .toLowerCase()
                                .startsWith(
                                    `${yearNumber} ${spec.toLowerCase()}`
                                )
                        )
                        .forEach((r) => rolesRemove.set(r.id, r));
                    continue;
                }

                // Add "<yearNumber> <spec>" if it exists in guild and member doesn't have it
                const desired = guildRoles.find(
                    (r) =>
                        r.name.toLowerCase() ===
                        `${yearNumber} ${spec}`.toLowerCase()
                );
                if (desired && !memberRoles.has(desired.id)) {
                    rolesAdd.set(desired.id, desired);
                }
            }

            // Minors
            for (const minor of minors) {
                const hasBaseMinor = memberRoles.some((r) => r.name === minor);

                if (!hasBaseMinor) {
                    memberRoles
                        .filter((r) =>
                            r.name
                                .toLowerCase()
                                .startsWith(
                                    `${yearNumber} ${minor.toLowerCase()}`
                                )
                        )
                        .forEach((r) => rolesRemove.set(r.id, r));
                    continue;
                }

                const desired = guildRoles.find(
                    (r) =>
                        r.name.toLowerCase() ===
                        `${yearNumber} ${minor}`.toLowerCase()
                );
                if (desired && !memberRoles.has(desired.id)) {
                    rolesAdd.set(desired.id, desired);
                    this.client.logger.info(
                        `Queued add: ${desired.name} → ${member.user.tag}`
                    );
                }
            }
        }

        // Apply role changes
        const addList = Array.from(rolesAdd.values());
        const removeList = Array.from(rolesRemove.values());

        if (addList.length > 0) {
            await member.roles.add(addList);
            this.client.logger.info(
                `Added roles ${addList.map((r) => r.name).join(', ')} to ${
                    member.user.tag
                }`
            );
        }
        if (removeList.length > 0) {
            await member.roles.remove(removeList);
            this.client.logger.info(
                `Removed roles ${removeList
                    .map((r) => r.name)
                    .join(', ')} from ${member.user.tag}`
            );
        }
    }
}

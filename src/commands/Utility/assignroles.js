import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed, infoEmbed } from '../../utils/embeds.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

// ============================================
// ADD OR REMOVE ROLE IDs HERE AS NEEDED
// ============================================
const ROLES_TO_ASSIGN = [
    '1519349693883355349',
    '1519349689877663907',
    '1519349669069852672',
    '1519349992970522866',
];
// ============================================

export default {
    data: new SlashCommandBuilder()
        .setName('assignroles')
        .setDescription('Assign the default roles to all members in the server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .setDMPermission(false),

    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction, { ephemeral: true });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [infoEmbed('In Progress', 'Assigning roles to all members, this may take a moment...')]
            });

            const members = await interaction.guild.members.fetch();
            const humanMembers = members.filter(m => !m.user.bot);

            let assigned = 0;
            let skipped = 0;
            let failed = 0;

            for (const [, member] of humanMembers) {
                const rolesToAdd = ROLES_TO_ASSIGN.filter(id => !member.roles.cache.has(id));

                if (rolesToAdd.length === 0) {
                    skipped++;
                    continue;
                }

                try {
                    await member.roles.add(rolesToAdd, `Bulk role assignment by ${interaction.user.tag}`);
                    assigned++;
                } catch (err) {
                    failed++;
                    logger.warn(`Failed to assign roles to ${member.user.tag}`, {
                        userId: member.id,
                        error: err.message
                    });
                }
            }

            logger.info('Bulk role assignment completed', {
                guildId: interaction.guildId,
                assignedBy: interaction.user.id,
                assigned,
                skipped,
                failed
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(
                    'Roles Assigned',
                    `Bulk assignment complete!\n\n` +
                    `**Assigned:** ${assigned} member(s)\n` +
                    `**Skipped:** ${skipped} member(s) (already had all roles)\n` +
                    `**Failed:** ${failed} member(s)`
                )]
            });

        } catch (error) {
            logger.error('Assignroles command error:', error);
            await handleInteractionError(interaction, error, {
                commandName: 'assignroles',
                source: 'assignroles_command'
            });
        }
    }
};

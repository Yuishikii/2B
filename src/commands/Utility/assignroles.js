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
        .setDescription('Assign the default roles to a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .setDMPermission(false)
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to assign roles to')
                .setRequired(true)
        ),

    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction, { ephemeral: true });

            const targetUser = interaction.options.getUser('user');
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

            if (!member) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [infoEmbed('Not Found', 'That user is not in this server.')]
                });
            }

            // Filter out roles the user already has
            const rolesToAdd = ROLES_TO_ASSIGN.filter(id => !member.roles.cache.has(id));

            if (rolesToAdd.length === 0) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [infoEmbed('Already Assigned', `**${targetUser.username}** already has all the roles.`)]
                });
            }

            await member.roles.add(rolesToAdd, `Roles assigned by ${interaction.user.tag}`);

            logger.info('Roles assigned via assignroles command', {
                guildId: interaction.guildId,
                targetUserId: targetUser.id,
                assignedBy: interaction.user.id,
                rolesAdded: rolesToAdd
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(
                    'Roles Assigned',
                    `Added **${rolesToAdd.length}** role(s) to **${targetUser.username}**.${
                        rolesToAdd.length < ROLES_TO_ASSIGN.length
                            ? `\n*(${ROLES_TO_ASSIGN.length - rolesToAdd.length} role(s) were already assigned and skipped)*`
                            : ''
                    }`
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

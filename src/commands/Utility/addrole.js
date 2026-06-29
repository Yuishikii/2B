import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed, infoEmbed } from '../../utils/embeds.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('addrole')
        .setDescription('Add a role to a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .setDMPermission(false)
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to add the role to')
                .setRequired(true)
        )
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('The role to add')
                .setRequired(true)
        ),
    category: 'Utility',

    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction, { ephemeral: true });

            const targetUser = interaction.options.getUser('user');
            const role = interaction.options.getRole('role');

            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!member) {
                throw new TitanBotError(
                    'Member not found',
                    ErrorTypes.USER_INPUT,
                    'That user is not in this server.'
                );
            }

            if (member.roles.cache.has(role.id)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [infoEmbed('Already Has Role', `**${targetUser.username}** already has the ${role} role.`)]
                });
            }

            const botMember = interaction.guild.members.me;
            if (role.position >= botMember.roles.highest.position) {
                throw new TitanBotError(
                    'Role hierarchy error',
                    ErrorTypes.PERMISSION,
                    'I cannot assign that role as it is higher than or equal to my highest role.'
                );
            }

            await member.roles.add(role.id, `Role added by ${interaction.user.tag}`);

            logger.info('Role added via addrole command', {
                guildId: interaction.guildId,
                targetUserId: targetUser.id,
                roleId: role.id,
                addedBy: interaction.user.id
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed('Role Added', `Added ${role} to **${targetUser.username}**.`)]
            });

        } catch (error) {
            logger.error('Addrole command error:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'addrole'
            });
        }
    }
};

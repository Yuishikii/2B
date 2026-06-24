import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, infoEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('banner')
        .setDescription("Display a user's banner image")
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('The user whose banner you want to see (defaults to you)')
        ),

    async execute(interaction) {
        try {
            const user = interaction.options.getUser('target') || interaction.user;

            // Must fetch the user to get banner data as it's not in cache
            const fetchedUser = await user.fetch();
            const bannerUrl = fetchedUser.bannerURL({ size: 2048, dynamic: true });

            if (!bannerUrl) {
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [infoEmbed('No Banner', `**${user.username}** does not have a banner set.`)]
                });
            }

            const embed = createEmbed({
                title: `${user.username}'s Banner`,
                description: `[Download Link](${bannerUrl})`
            }).setImage(bannerUrl);

            await InteractionHelper.safeReply(interaction, { embeds: [embed] });

            logger.info('Banner command executed', {
                userId: interaction.user.id,
                targetUserId: user.id,
                guildId: interaction.guildId
            });

        } catch (error) {
            logger.error('Banner command execution failed', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'banner'
            });
            await handleInteractionError(interaction, error, {
                commandName: 'banner',
                source: 'banner_command'
            });
        }
    }
};

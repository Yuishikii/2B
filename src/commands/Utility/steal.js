import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { successEmbed, infoEmbed } from '../../utils/embeds.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('steal')
        .setDescription('Add an emoji to this server')
        .setDMPermission(false)
        .addStringOption((option) =>
            option
                .setName('emoji')
                .setDescription('The emoji to steal (paste a custom emoji or provide an image URL)')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('name')
                .setDescription('Name for the emoji (optional, defaults to original name)')
                .setMaxLength(32)
                .setRequired(false)
        ),
    category: 'Utility',

    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

            if (!interaction.memberPermissions?.has('ManageGuildExpressions') &&
                !interaction.memberPermissions?.has('ManageEmojisAndStickers')) {
                throw new TitanBotError(
                    'Missing permission to manage emojis',
                    ErrorTypes.PERMISSION,
                    'You need the **Manage Expressions** permission to use this command.'
                );
            }

            const botMember = interaction.guild.members.me;
            if (!botMember?.permissions.has('ManageGuildExpressions') &&
                !botMember?.permissions.has('ManageEmojisAndStickers')) {
                throw new TitanBotError(
                    'Bot missing permission to manage emojis',
                    ErrorTypes.PERMISSION,
                    'I need the **Manage Expressions** permission to add emojis.'
                );
            }

            const input = interaction.options.getString('emoji');
            const customName = interaction.options.getString('name');

            let emojiUrl, emojiName;

            // Check if it's a custom Discord emoji: <:name:id> or <a:name:id>
            const customEmojiMatch = input.match(/^<a?:(\w+):(\d+)>$/);
            if (customEmojiMatch) {
                emojiName = customName || customEmojiMatch[1];
                const emojiId = customEmojiMatch[2];
                const isAnimated = input.startsWith('<a:');
                emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${isAnimated ? 'gif' : 'png'}`;
            }
            // Check if it's a direct image URL
            else if (input.match(/^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i)) {
                emojiUrl = input;
                emojiName = customName || 'stolen_emoji';
            }
            else {
                throw new TitanBotError(
                    'Invalid emoji input',
                    ErrorTypes.VALIDATION,
                    'Please provide a valid custom emoji (e.g. :myemoji:) or a direct image URL ending in `.png`, `.jpg`, `.gif`, or `.webp`.'
                );
            }

            // Sanitize name: only alphanumeric and underscores, min 2 chars
            emojiName = emojiName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
            if (emojiName.length < 2) emojiName = `emoji_${emojiName}`;

            const emoji = await interaction.guild.emojis.create({
                attachment: emojiUrl,
                name: emojiName,
                reason: `Stolen by ${interaction.user.tag}`
            });

            logger.info('Emoji stolen and added to guild', {
                guildId: interaction.guild.id,
                emojiId: emoji.id,
                emojiName: emoji.name,
                addedBy: interaction.user.id
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(
                    'Emoji Added',
                    `${emoji} **:${emoji.name}:** has been added to the server!`
                )]
            });

        } catch (error) {
            if (error instanceof TitanBotError) throw error;

            // Discord API error for no emoji slots
            if (error.code === 30008) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [infoEmbed(
                        'No Emoji Slots',
                        'This server has no available emoji slots. Boost the server to unlock more.'
                    )]
                });
                return;
            }

            logger.error('Steal command error:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'steal'
            });
        }
    }
};

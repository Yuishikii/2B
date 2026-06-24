import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const TRELLO_BOARD_ID = 'K9SI8aXq';
const TRELLO_API_BASE = 'https://api.trello.com/1';

// Cache board data to avoid hammering Trello API
let boardCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchBoardData() {
    const now = Date.now();
    if (boardCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
        return boardCache;
    }

    const [listsRes, cardsRes] = await Promise.all([
        fetch(`${TRELLO_API_BASE}/boards/${TRELLO_BOARD_ID}/lists`),
        fetch(`${TRELLO_API_BASE}/boards/${TRELLO_BOARD_ID}/cards?attachments=true`)
    ]);

    if (!listsRes.ok || !cardsRes.ok) {
        throw new TitanBotError(
            'Failed to fetch Trello board data',
            ErrorTypes.UNKNOWN,
            'Could not reach the builds board. Please try again in a moment.'
        );
    }

    const lists = await listsRes.json();
    const cards = await cardsRes.json();

    boardCache = { lists, cards };
    cacheTimestamp = now;
    return boardCache;
}

function buildChoices(lists, cards) {
    const families = {};

    for (const list of lists) {
        const listCards = cards.filter(c => c.idList === list.id && !c.closed);
        if (listCards.length === 0) continue;
        families[list.name] = listCards.map(c => c.name);
    }

    return families;
}

export default {
    data: new SlashCommandBuilder()
        .setName('build')
        .setDescription('Look up a character build')
        .setDMPermission(false)
        .addStringOption(option =>
            option
                .setName('family')
                .setDescription('The character family (e.g. Helos, Fritz)')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('The build type (e.g. TS, ODM, ATTACK)')
                .setRequired(true)
                .setAutocomplete(true)
        ),
    category: 'Utility',

    async autocomplete(interaction) {
        try {
            const { lists, cards } = await fetchBoardData();
            const focused = interaction.options.getFocused(true);
            const familyInput = interaction.options.getString('family') || '';

            if (focused.name === 'family') {
                const families = [...new Set(lists
                    .filter(l => cards.some(c => c.idList === l.id && !c.closed))
                    .map(l => l.name)
                )];

                const filtered = families
                    .filter(f => f.toLowerCase().includes(focused.value.toLowerCase()))
                    .slice(0, 25);

                await interaction.respond(filtered.map(f => ({ name: f, value: f })));

            } else if (focused.name === 'type') {
                const matchedList = lists.find(
                    l => l.name.toLowerCase() === familyInput.toLowerCase()
                );

                if (!matchedList) {
                    return await interaction.respond([]);
                }

                const buildTypes = cards
                    .filter(c => c.idList === matchedList.id && !c.closed)
                    .map(c => c.name)
                    .filter(n => n.toLowerCase().includes(focused.value.toLowerCase()))
                    .slice(0, 25);

                await interaction.respond(buildTypes.map(t => ({ name: t, value: t })));
            }
        } catch (error) {
            logger.error('Build autocomplete error:', error);
            await interaction.respond([]);
        }
    },

    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction);

            const familyInput = interaction.options.getString('family');
            const typeInput = interaction.options.getString('type');

            const { lists, cards } = await fetchBoardData();

            const matchedList = lists.find(
                l => l.name.toLowerCase() === familyInput.toLowerCase()
            );

            if (!matchedList) {
                throw new TitanBotError(
                    `Family "${familyInput}" not found`,
                    ErrorTypes.USER_INPUT,
                    `No family named **${familyInput}** found. Use the autocomplete suggestions.`
                );
            }

            const matchedCard = cards.find(
                c => c.idList === matchedList.id &&
                     c.name.toLowerCase() === typeInput.toLowerCase() &&
                     !c.closed
            );

            if (!matchedCard) {
                throw new TitanBotError(
                    `Build type "${typeInput}" not found in "${familyInput}"`,
                    ErrorTypes.USER_INPUT,
                    `No build named **${typeInput}** found under **${familyInput}**. Use the autocomplete suggestions.`
                );
            }

            // Get the first image attachment
            const imageAttachment = matchedCard.attachments?.find(a =>
                a.mimeType?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(a.name)
            );

            const embed = new EmbedBuilder()
                .setTitle(`${matchedList.name} — ${matchedCard.name}`)
                .setColor('#2ecc71')
                .setTimestamp()
                .setFooter({ text: 'Zuma\'s Builds • Trello' });

            if (imageAttachment) {
                embed.setImage(imageAttachment.url);
            }

            if (matchedCard.desc) {
                embed.setDescription(matchedCard.desc);
            }

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

            logger.debug(`Build fetched: ${matchedList.name} ${matchedCard.name}`, {
                guildId: interaction.guildId,
                userId: interaction.user.id
            });

        } catch (error) {
            logger.error('Build command error:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'build'
            });
        }
    }
};

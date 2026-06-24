import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const TRELLO_BOARD_ID = 'K9SI8aXq';
const TRELLO_API_BASE = 'https://api.trello.com/1';

const FAMILY_BUILDS = {
    'Helos':         ['ODM', 'TS', 'BURN ODM'],
    'Fritz':         ['ATTACK', 'ARMORED', 'FEMALE', 'COLOSSAL', 'X2 NUKE', 'SHIGANSHINA BREACH'],
    'Shiki':         ['ODM', 'TS', 'COLOSSAL'],
    'Ackerman':      ['ODM', 'TS'],
    'Yeager':        ['ATTACK'],
    'Reiss':         ['BUFFER'],
    'Epic Families': ['ARLERT COLOSSAL', 'LEONHART FEMALE'],
};

let boardCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchBoardData() {
    const now = Date.now();
    if (boardCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
        return boardCache;
    }

    // Force fresh fetch
    boardCache = null;

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
            const focused = interaction.options.getFocused(true);

            if (focused.name === 'family') {
                const filtered = Object.keys(FAMILY_BUILDS)
                    .filter(f => f.toLowerCase().includes(focused.value.toLowerCase()));

                await interaction.respond(filtered.map(f => ({ name: f, value: f })));

            } else if (focused.name === 'type') {
                const familyKey = Object.keys(FAMILY_BUILDS).find(
                    f => f.toLowerCase() === (interaction.options.getString('family') || '').toLowerCase()
                );

                if (!familyKey) {
                    return await interaction.respond([]);
                }

                const types = FAMILY_BUILDS[familyKey]
                    .filter(t => t.toLowerCase().includes(focused.value.toLowerCase()));

                await interaction.respond(types.map(t => ({ name: t, value: t })));
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

            const familyKey = Object.keys(FAMILY_BUILDS).find(
                f => f.toLowerCase() === familyInput.toLowerCase()
            );

            if (!familyKey) {
                throw new TitanBotError(
                    `Family "${familyInput}" not found`,
                    ErrorTypes.USER_INPUT,
                    `No family named **${familyInput}** found. Use the autocomplete suggestions.`
                );
            }

            const validTypes = FAMILY_BUILDS[familyKey];
            const typeKey = validTypes.find(
                t => t.toLowerCase() === typeInput.toLowerCase()
            );

            if (!typeKey) {
                throw new TitanBotError(
                    `Build type "${typeInput}" not found in "${familyKey}"`,
                    ErrorTypes.USER_INPUT,
                    `No build named **${typeInput}** found under **${familyKey}**. Use the autocomplete suggestions.`
                );
            }

            const { lists, cards } = await fetchBoardData();
            const matchedList = lists.find(
                l => l.name.toLowerCase() === familyKey.toLowerCase()
            );

            if (!matchedList) {
                throw new TitanBotError(
                    `List for family "${familyKey}" not found on Trello`,
                    ErrorTypes.UNKNOWN,
                    'Could not find this family on the builds board. Please try again in a moment.'
                );
            }

            const matchedCard = cards.find(
                c => c.idList === matchedList.id &&
                     c.name.toUpperCase().includes(typeKey.toUpperCase()) &&
                     !c.closed
            );

            if (!matchedCard) {
                throw new TitanBotError(
                    `Card for "${typeKey}" not found in "${familyKey}"`,
                    ErrorTypes.UNKNOWN,
                    `Could not find **${familyKey} — ${typeKey}** on the board. Please try again in a moment.`
                );
            }

            const imageAttachment = matchedCard.attachments?.find(a =>
                a.mimeType?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(a.name)
            );

            if (!imageAttachment) {
                throw new TitanBotError(
                    `No image found for ${familyKey} ${typeKey}`,
                    ErrorTypes.UNKNOWN,
                    `No build image found for **${familyKey} — ${typeKey}** yet.`
                );
            }

            const imageRes = await fetch(imageAttachment.url);
            if (!imageRes.ok) {
                throw new TitanBotError(
                    'Failed to fetch build image',
                    ErrorTypes.UNKNOWN,
                    'Could not download the build image. Please try again in a moment.'
                );
            }

            const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
            const ext = imageAttachment.name.split('.').pop() || 'jpg';
            const safeName = `${familyKey.toLowerCase()}_${typeKey.toLowerCase()}`.replace(/\s+/g, '_');

            const file = new AttachmentBuilder(imageBuffer, {
                name: `${safeName}.${ext}`
            });

            const embed = new EmbedBuilder()
                .setTitle(`${familyKey} — ${typeKey}`)
                .setColor('#ffffff')
                .setImage(`attachment://${safeName}.${ext}`)
                .setTimestamp()
                .setFooter({ text: "Zuma's Builds • Trello" });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed],
                files: [file]
            });

            logger.debug(`Build fetched: ${familyKey} ${typeKey}`, {
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

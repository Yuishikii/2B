import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const BASE_URL = 'https://raw.githubusercontent.com/Yuishikii/2B/main/values';

const EMOJI_KEY = '<:EmperorKey:1519633729226670176>';
const EMOJI_SCROLL = '<:Scroll:1519633661354573865>';

// ============================================
// ADD OR REMOVE CSV FILES HERE AS NEEDED
// ============================================
const CSV_FILES = [
    'ALLCOSMETICS.csv',
    'ARTIFACTS - Sheet1.csv',
    'FAMILY - Sheet1.csv',
    'PERKS - Sheet1.csv',
    'RAIDSMISSIONS - Sheet1.csv',
    'ROBUX - Sheet1.csv',
    'SHOP - Sheet1.csv',
];
// ============================================

let sheetCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') {
            inQuotes = !inQuotes;
        } else if (line[i] === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += line[i];
        }
    }
    result.push(current);
    return result;
}

function parseCSV(text, filename) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const items = [];

    let dataStart = -1;
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
        if (lines[i].includes('Item Name')) {
            dataStart = i + 1;
            break;
        }
    }

    if (dataStart === -1) return [];

    for (let i = dataStart; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const itemName = (values[1] || '').trim();
        const rarity = (values[2] || '').trim();

        if (!itemName || !rarity || rarity === '\u200B' || rarity === '') continue;

        const validRarities = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common', 'events', 'event'];
        if (!validRarities.some(r => rarity.toLowerCase().includes(r))) continue;

        items.push({
            'Item Name': itemName,
            'Rarity': rarity,
            'Demand': (values[3] || '').trim(),
            'Value': (values[4] || '').trim(),
            'Rate Of Change': (values[5] || '').trim(),
            'Tax (Gems)': (values[6] || '').trim(),
            'Tax (Gold)': (values[7] || '').trim(),
            'Source': filename,
        });
    }

    return items;
}

async function fetchSheetData() {
    const now = Date.now();
    if (sheetCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
        return sheetCache;
    }

    try {
        const results = await Promise.all(
            CSV_FILES.map(async (file) => {
                const url = `${BASE_URL}/${encodeURIComponent(file)}`;
                const res = await fetch(url);
                if (!res.ok) {
                    logger.warn(`Failed to fetch ${file}: HTTP ${res.status}`);
                    return [];
                }
                const text = await res.text();
                return parseCSV(text, file);
            })
        );

        const allItems = results.flat();
        logger.info(`Value list loaded: ${allItems.length} items across ${CSV_FILES.length} files`);

        sheetCache = allItems;
        cacheTimestamp = now;
        return allItems;
    } catch (err) {
        logger.error('fetchSheetData error:', err.message);
        throw new TitanBotError(
            'Failed to fetch value list',
            ErrorTypes.UNKNOWN,
            'Could not reach the value list. Please try again in a moment.'
        );
    }
}

// Format value string replacing emoji placeholders with server emojis
// Input: "🔑270/0.3viz" or "🔑900/📜300" or "🔑1.3M-1.37M/1450viz"
function formatValue(valueStr) {
    if (!valueStr || valueStr === 'N/A') return 'N/A';

    return valueStr
        .replace(/🔑/g, EMOJI_KEY)
        .replace(/📜/g, EMOJI_SCROLL);
}

function getRarityColor(rarity) {
    const r = (rarity || '').toLowerCase();
    if (r.includes('mythic')) return '#ff69b4';
    if (r.includes('legendary')) return '#ffa500';
    if (r.includes('epic')) return '#9b59b6';
    if (r.includes('rare')) return '#3498db';
    if (r.includes('uncommon')) return '#2ecc71';
    if (r.includes('common')) return '#95a5a6';
    if (r.includes('event')) return '#e74c3c';
    return '#2ecc71';
}

function getRateEmoji(rate) {
    const r = (rate || '').toLowerCase();
    if (r.includes('rising')) return '📈';
    if (r.includes('dropping')) return '📉';
    if (r.includes('stable')) return '➡️';
    if (r.includes('overpriced')) return '⚠️';
    if (r.includes('unstable')) return '🔀';
    return '';
}

function getSourceLabel(filename) {
    return filename.replace('.csv', '').replace(' - Sheet1', '').replace('RAIDSMISSIONS', 'Raids & Missions');
}

export default {
    data: new SlashCommandBuilder()
        .setName('value')
        .setDescription('Look up the trade value of an item')
        .setDMPermission(false)
        .addStringOption(option =>
            option
                .setName('item')
                .setDescription('The item name to look up')
                .setRequired(true)
                .setAutocomplete(true)
        ),
    category: 'Utility',

    async autocomplete(interaction) {
        try {
            const focused = interaction.options.getFocused().toLowerCase();
            const items = await fetchSheetData();

            const matches = items
                .filter(item => item['Item Name'].toLowerCase().includes(focused))
                .map(item => item['Item Name'])
                .filter((name, index, self) => self.indexOf(name) === index)
                .slice(0, 25);

            await interaction.respond(matches.map(name => ({ name, value: name })));
        } catch (error) {
            logger.error('Value autocomplete error:', error.message);
            await interaction.respond([]);
        }
    },

    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction);

            const itemInput = interaction.options.getString('item');
            const items = await fetchSheetData();

            const exactMatches = items.filter(
                item => item['Item Name'].toLowerCase() === itemInput.toLowerCase()
            );
            const partialMatches = exactMatches.length === 0
                ? items.filter(item => item['Item Name'].toLowerCase().includes(itemInput.toLowerCase()))
                : [];

            const allMatches = exactMatches.length > 0 ? exactMatches : partialMatches;

            if (allMatches.length === 0) {
                throw new TitanBotError(
                    `Item "${itemInput}" not found`,
                    ErrorTypes.USER_INPUT,
                    `No item named **${itemInput}** found in the value list. Use the autocomplete suggestions.`
                );
            }

            const embed = new EmbedBuilder()
                .setTitle(allMatches[0]['Item Name'])
                .setColor(getRarityColor(allMatches[0]['Rarity']))
                .setFooter({ text: 'AOT:R Value List • Updates every 10 minutes' })
                .setTimestamp();

            for (const matched of allMatches) {
                const source = getSourceLabel(matched['Source']);
                const rateEmoji = getRateEmoji(matched['Rate Of Change']);
                embed.addFields(
                    { name: `📂 ${source}`, value: '\u200B', inline: false },
                    { name: 'Rarity', value: matched['Rarity'] || 'N/A', inline: true },
                    { name: 'Demand', value: matched['Demand'] || 'N/A', inline: true },
                    { name: 'Value', value: formatValue(matched['Value']), inline: true },
                    { name: 'Rate of Change', value: `${rateEmoji} ${matched['Rate Of Change'] || 'N/A'}`.trim(), inline: true },
                    { name: 'Tax (Gems)', value: matched['Tax (Gems)'] || 'N/A', inline: true },
                    { name: 'Tax (Gold)', value: matched['Tax (Gold)'] || 'N/A', inline: true },
                );
            }

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

            logger.debug(`Value lookup: ${allMatches[0]['Item Name']}`, {
                guildId: interaction.guildId,
                userId: interaction.user.id
            });

        } catch (error) {
            logger.error('Value command error:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'value'
            });
        }
    }
};

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const SHEET_CSV_URL = 'https://raw.githubusercontent.com/Yuishikii/2B/main/ALLCOSMETICS.csv';

let sheetCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

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

function parseCSV(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Row 0 is empty/junk, row 1 is headers (,Item Name,Rarity,Demand,Value,...)
    const headerLine = lines[1];
    if (!headerLine) return [];
    const headers = parseCSVLine(headerLine);
    // headers[0] = row number, headers[1] = Item Name, etc.

    const items = [];

    for (let i = 2; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        // values[0] = row number, values[1] = item name, values[2] = rarity...
        const itemName = (values[1] || '').trim();
        const rarity = (values[2] || '').trim();

        // Skip empty rows and crate header rows (no rarity or invisible char rarity)
        if (!itemName || !rarity || rarity === '\u200B' || rarity === '') continue;

        items.push({
            'Item Name': itemName,
            'Rarity': rarity,
            'Demand': (values[3] || '').trim(),
            'Value': (values[4] || '').trim(),
            'Rate Of Change': (values[5] || '').trim(),
            'Tax (Gems)': (values[6] || '').trim(),
            'Tax (Gold)': (values[7] || '').trim(),
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
        const res = await fetch(SHEET_CSV_URL);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const text = await res.text();
        const items = parseCSV(text);
        logger.info(`Value list loaded: ${items.length} items`);

        sheetCache = items;
        cacheTimestamp = now;
        return items;
    } catch (err) {
        logger.error('fetchSheetData error:', err.message);
        throw new TitanBotError(
            'Failed to fetch value list',
            ErrorTypes.UNKNOWN,
            'Could not reach the value list. Please try again in a moment.'
        );
    }
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

            const matched = items.find(
                item => item['Item Name'].toLowerCase() === itemInput.toLowerCase()
            ) || items.find(
                item => item['Item Name'].toLowerCase().includes(itemInput.toLowerCase())
            );

            if (!matched) {
                throw new TitanBotError(
                    `Item "${itemInput}" not found`,
                    ErrorTypes.USER_INPUT,
                    `No item named **${itemInput}** found in the value list. Use the autocomplete suggestions.`
                );
            }

            const embed = new EmbedBuilder()
                .setTitle(matched['Item Name'])
                .setColor(getRarityColor(matched['Rarity']))
                .addFields(
                    { name: 'Rarity', value: matched['Rarity'] || 'N/A', inline: true },
                    { name: 'Demand', value: matched['Demand'] || 'N/A', inline: true },
                    { name: 'Value', value: matched['Value'] || 'N/A', inline: true },
                    { name: 'Rate of Change', value: matched['Rate Of Change'] || 'N/A', inline: true },
                    { name: 'Tax (Gems)', value: matched['Tax (Gems)'] || 'N/A', inline: true },
                    { name: 'Tax (Gold)', value: matched['Tax (Gold)'] || 'N/A', inline: true },
                )
                .setFooter({ text: 'AOT:R Value List • Updates every 10 minutes' })
                .setTimestamp();

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

            logger.debug(`Value lookup: ${matched['Item Name']}`, {
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

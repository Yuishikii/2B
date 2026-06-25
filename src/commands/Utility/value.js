import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR7naBmry1w8WlHFrtpxJ0n3XdgDj5cehW6XxTdJVDPMDivrnOefz83uuFCoYEGd028tjFQ6tcfPyBA/pub?gid=1531566225&output=csv';

// Cache sheet data
let sheetCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function parseCSV(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]);
    const items = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (!values[0] || values[0].trim() === '') continue;

        const item = {};
        headers.forEach((header, index) => {
            item[header.trim()] = (values[index] || '').trim();
        });
        items.push(item);
    }

    return items;
}

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

async function fetchSheetData() {
    const now = Date.now();
    if (sheetCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
        return sheetCache;
    }

   const https = await import('https');
logger.info('Attempting to fetch sheet data...');
const res = await fetch(SHEET_CSV_URL, { redirect: 'follow' });
logger.info('Sheet fetch status:', res.status);
const text = await res.text();
logger.info('Sheet CSV preview:', text.slice(0, 200));
const items = parseCSV(text);
sheetCache = items;
cacheTimestamp = now;
return items;
}

function getRarityColor(rarity) {
    const r = (rarity || '').toLowerCase();
    if (r.includes('mythic')) return '#ff69b4';
    if (r.includes('legendary')) return '#ffa500';
    if (r.includes('epic')) return '#9b59b6';
    if (r.includes('rare')) return '#3498db';
    if (r.includes('uncommon')) return '#2ecc71';
    if (r.includes('common')) return '#95a5a6';
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
            logger.info('Sample item keys:', items.slice(0, 2));

            const matches = items
                .filter(item => item['Item Name'] && item['Item Name'].toLowerCase().includes(focused))
                .map(item => item['Item Name'])
                .slice(0, 25);

            await interaction.respond(matches.map(name => ({ name, value: name })));
        } catch (error) {
            logger.error('Value autocomplete error:', error);
            await interaction.respond([]);
        }
    },

    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction);

            const itemInput = interaction.options.getString('item');
            const items = await fetchSheetData();

            const matched = items.find(
                item => item['Item Name']?.toLowerCase() === itemInput.toLowerCase()
            ) || items.find(
                item => item['Item Name']?.toLowerCase().includes(itemInput.toLowerCase())
            );

            if (!matched) {
                throw new TitanBotError(
                    `Item "${itemInput}" not found`,
                    ErrorTypes.USER_INPUT,
                    `No item named **${itemInput}** found in the value list. Use the autocomplete suggestions.`
                );
            }

            const name = matched['Item Name'] || 'Unknown';
            const rarity = matched['Rarity'] || 'N/A';
            const demand = matched['Demand'] || 'N/A';
            const value = matched['Value'] || 'N/A';
            const rateOfChange = matched['Rate Of Change'] || 'N/A';
            const taxGems = matched['Tax (Gems)'] || 'N/A';
            const taxGold = matched['Tax (Gold)'] || 'N/A';

            const embed = new EmbedBuilder()
                .setTitle(name)
                .setColor(getRarityColor(rarity))
                .addFields(
                    { name: 'Rarity', value: rarity, inline: true },
                    { name: 'Demand', value: demand, inline: true },
                    { name: 'Value', value: value, inline: true },
                    { name: 'Rate of Change', value: rateOfChange, inline: true },
                    { name: 'Tax (Gems)', value: taxGems, inline: true },
                    { name: 'Tax (Gold)', value: taxGold, inline: true },
                )
                .setFooter({ text: 'AOT:R Value List • Updates every 10 minutes' })
                .setTimestamp();

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

            logger.debug(`Value lookup: ${name}`, {
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

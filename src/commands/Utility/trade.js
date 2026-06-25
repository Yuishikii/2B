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

function parseKeyValue(valueStr) {
    if (!valueStr || valueStr === 'N/A' || valueStr.includes('O/C') || valueStr.includes('Pre Order')) return null;

    let str = valueStr.replace(/[🔑💎🪙📜]/g, '').trim();

    const slashIndex = str.indexOf('/');
    if (slashIndex !== -1) {
        str = str.substring(0, slashIndex).trim();
    }

    if (str.includes('-')) {
        const parts = str.split('-');
        const low = parseNumber(parts[0].trim());
        const high = parseNumber(parts[1].trim());
        if (low !== null && high !== null) return (low + high) / 2;
        if (low !== null) return low;
        if (high !== null) return high;
        return null;
    }

    return parseNumber(str);
}

function parseNumber(str) {
    if (!str) return null;
    str = str.trim().toUpperCase();

    if (str.endsWith('M')) {
        const num = parseFloat(str.slice(0, -1));
        return isNaN(num) ? null : num * 1_000_000;
    }
    if (str.endsWith('K')) {
        const num = parseFloat(str.slice(0, -1));
        return isNaN(num) ? null : num * 1_000;
    }

    const num = parseFloat(str);
    return isNaN(num) ? null : num;
}

function formatKeys(num) {
    if (num === null) return 'Unknown';
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toFixed(1);
}

function formatValue(valueStr) {
    if (!valueStr || valueStr === 'N/A') return 'N/A';
    return valueStr
        .replace(/🔑/g, EMOJI_KEY)
        .replace(/📜/g, EMOJI_SCROLL);
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

function findItem(items, name) {
    const exact = items.find(i => i['Item Name'].toLowerCase() === name.toLowerCase());
    if (exact) return exact;
    return items.find(i => i['Item Name'].toLowerCase().includes(name.toLowerCase()));
}

function getRarityEmoji(rarity) {
    const r = (rarity || '').toLowerCase();
    if (r.includes('mythic')) return '🩷';
    if (r.includes('legendary')) return '🟠';
    if (r.includes('epic')) return '🟣';
    if (r.includes('rare')) return '🔵';
    if (r.includes('uncommon')) return '🟢';
    if (r.includes('common')) return '⚪';
    if (r.includes('event')) return '🔴';
    return '⚪';
}

export default {
    data: new SlashCommandBuilder()
        .setName('trade')
        .setDescription('Evaluate a trade between two sides')
        .setDMPermission(false)
        .addStringOption(o => o.setName('a1').setDescription('Your side - Item 1').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('b1').setDescription('Their side - Item 1').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('a2').setDescription('Your side - Item 2').setRequired(false).setAutocomplete(true))
        .addStringOption(o => o.setName('a3').setDescription('Your side - Item 3').setRequired(false).setAutocomplete(true))
        .addStringOption(o => o.setName('a4').setDescription('Your side - Item 4').setRequired(false).setAutocomplete(true))
        .addStringOption(o => o.setName('a5').setDescription('Your side - Item 5').setRequired(false).setAutocomplete(true))
        .addStringOption(o => o.setName('b2').setDescription('Their side - Item 2').setRequired(false).setAutocomplete(true))
        .addStringOption(o => o.setName('b3').setDescription('Their side - Item 3').setRequired(false).setAutocomplete(true))
        .addStringOption(o => o.setName('b4').setDescription('Their side - Item 4').setRequired(false).setAutocomplete(true))
        .addStringOption(o => o.setName('b5').setDescription('Their side - Item 5').setRequired(false).setAutocomplete(true)),
    category: 'Utility',

    async autocomplete(interaction) {
        try {
            const focused = interaction.options.getFocused(true);
            const value = focused.value.toLowerCase();
            const items = await fetchSheetData();

            const matches = items
                .filter(item => item['Item Name'].toLowerCase().includes(value))
                .map(item => item['Item Name'])
                .filter((name, index, self) => self.indexOf(name) === index)
                .slice(0, 25);

            await interaction.respond(matches.map(name => ({ name, value: name })));
        } catch (error) {
            logger.error('Trade autocomplete error:', error.message);
            await interaction.respond([]);
        }
    },

    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction);

            const items = await fetchSheetData();

            const sideAInputs = ['a1', 'a2', 'a3', 'a4', 'a5']
                .map(k => interaction.options.getString(k))
                .filter(Boolean);

            const sideBInputs = ['b1', 'b2', 'b3', 'b4', 'b5']
                .map(k => interaction.options.getString(k))
                .filter(Boolean);

            const resolveItems = (inputs) => inputs.map(input => {
                const found = findItem(items, input);
                return {
                    input,
                    found,
                    value: found ? parseKeyValue(found['Value']) : null
                };
            });

            const sideA = resolveItems(sideAInputs);
            const sideB = resolveItems(sideBInputs);

            const totalA = sideA.reduce((sum, i) => sum + (i.value || 0), 0);
            const totalB = sideB.reduce((sum, i) => sum + (i.value || 0), 0);

            const hasUnknownA = sideA.some(i => i.value === null);
            const hasUnknownB = sideB.some(i => i.value === null);

            const diff = Math.abs(totalA - totalB);
            const diffPct = totalA > 0 && totalB > 0
                ? ((diff / Math.max(totalA, totalB)) * 100).toFixed(1)
                : null;

            let verdict = '';
            let verdictColor = '#95a5a6';

            if (hasUnknownA || hasUnknownB) {
                verdict = '⚠️ Cannot fully evaluate — some items have unknown or O/C values.';
                verdictColor = '#f39c12';
            } else if (totalA === totalB) {
                verdict = '⚖️ **Even trade!**';
                verdictColor = '#2ecc71';
            } else if (totalA > totalB) {
                verdict = `📉 **You are overpaying** by ${EMOJI_KEY}${formatKeys(diff)} (${diffPct}%)`;
                verdictColor = '#e74c3c';
            } else {
                verdict = `📈 **You are winning** by ${EMOJI_KEY}${formatKeys(diff)} (${diffPct}%)`;
                verdictColor = '#2ecc71';
            }

            const buildSideText = (side) => side.map(i => {
                if (!i.found) return `❓ *${i.input}* — not found`;
                const val = i.value !== null
                    ? `${EMOJI_KEY}${formatKeys(i.value)}`
                    : 'O/C or Unknown';
                const rate = i.found['Rate Of Change'];
                const rateStr = rate ? ` · ${getRateEmoji(rate)} ${rate}` : '';
                return `${getRarityEmoji(i.found['Rarity'])} **${i.found['Item Name']}** — ${val}${rateStr}`;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setTitle('Trade Evaluation')
                .setColor(verdictColor)
                .addFields(
                    {
                        name: `Your Side (${sideA.length} item${sideA.length > 1 ? 's' : ''}) — ${EMOJI_KEY}${formatKeys(totalA)}`,
                        value: buildSideText(sideA),
                        inline: false
                    },
                    {
                        name: `Their Side (${sideB.length} item${sideB.length > 1 ? 's' : ''}) — ${EMOJI_KEY}${formatKeys(totalB)}`,
                        value: buildSideText(sideB),
                        inline: false
                    },
                    {
                        name: 'Verdict',
                        value: verdict,
                        inline: false
                    }
                )
                .setFooter({ text: 'AOT:R Value List • Values are estimates based on listed key prices' })
                .setTimestamp();

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

            logger.debug('Trade evaluated', {
                guildId: interaction.guildId,
                userId: interaction.user.id,
                sideA: sideAInputs,
                sideB: sideBInputs
            });

        } catch (error) {
            logger.error('Trade command error:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'trade'
            });
        }
    }
};

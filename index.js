const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, Events, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const CRASH_LOG_FILE = './crash_log.json';
const MAX_CRASH_LOGS = 100;

function logCrash(type, error, context = {}) {
    try {
        const entry = {
            timestamp: new Date().toISOString(),
            type,
            message: error?.message || String(error),
            stack: error?.stack || null,
            context,
            memory: process.memoryUsage(),
            uptime: process.uptime()
        };
        let logs = [];
        if (fs.existsSync(CRASH_LOG_FILE)) {
            try {
                logs = JSON.parse(fs.readFileSync(CRASH_LOG_FILE, 'utf8'));
                if (!Array.isArray(logs)) logs = [];
            } catch { logs = []; }
        }
        logs.push(entry);
        if (logs.length > MAX_CRASH_LOGS) logs = logs.slice(-MAX_CRASH_LOGS);
        fs.writeFileSync(CRASH_LOG_FILE, JSON.stringify(logs, null, 2));
        console.error(`[CRASH ${type}]`, entry.message);
        if (entry.stack) console.error(entry.stack.split('\n').slice(0, 5).join('\n'));
    } catch (e) {
        console.error('[CRASH LOGGER FAILED]', e.message);
    }
}

process.on('unhandledRejection', (reason) => logCrash('UNHANDLED_REJECTION', reason));
process.on('uncaughtException', (error) => logCrash('UNCAUGHT_EXCEPTION', error));

setInterval(() => {
    const mem = process.memoryUsage();
    const heapMB = mem.heapUsed / 1024 / 1024;
    if (heapMB > 1500) {
        logCrash('HIGH_MEMORY', new Error(`Heap usage: ${heapMB.toFixed(2)} MB`));
    }
}, 60000);

function safeWriteJSON(filePath, data) {
    try {
        const tmp = `${filePath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, filePath);
        return true;
    } catch (error) {
        logCrash('JSON_WRITE_ERROR', error, { filePath });
        return false;
    }
}

function safeReadJSON(filePath, fallback = {}) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return data ?? fallback;
    } catch (error) {
        logCrash('JSON_READ_ERROR', error, { filePath });
        return fallback;
    }
}

console.log('[ANTI-CRASH] Sistema di protezione attivato');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages
    ]
});

const SERVER_CONFIG_FILE = './server_config.json';
const MODLOGS_FILE = './modlogs.json';
const TRANSCRIPTS_DIR = './transcripts/';
const WARNINGS_FILE = './warnings.json';
const CUSTOM_COMMANDS_FILE = './custom_commands.json';

let serverConfigs = {};
let userModLogs = new Map();
let warnings = new Map();

if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
}

function loadCustomCommands() {
    return safeReadJSON(CUSTOM_COMMANDS_FILE, {});
}

function saveCustomCommands(data) {
    return safeWriteJSON(CUSTOM_COMMANDS_FILE, data);
}

const THUMBNAIL_URL = "https://media.discordapp.net/attachments/1365770639398408303/1494756290935656498/image.png";
const FOOTER_IMAGE_URL = "https://cdn.discordapp.com/attachments/1400266716763918519/1511055836448034958/CB02C8D3-57C6-4DDC-B1DC-F1ECD3844516.png";

const COLORS = {
    SUCCESS: 0xE67E22,
    ERROR: 0xE67E22,
    WARNING: 0xE67E22,
    INFO: 0xE67E22,
    MODERATION: 0xE67E22,
    TICKET: 0xE67E22,
    REPORT: 0xE67E22
};

const SOCIAL_LINKS = {
    twitch: "https://www.twitch.tv/predagefn",
    youtube: "https://www.youtube.com/@predagefn",
    tiktok: "https://www.tiktok.com/@predagefn",
    twitter: "https://x.com/Predage1",
    instagram: "https://www.instagram.com/predagefn/",
    discord: "https://discord.gg/UW7SsywQp6"
};

const EMOJIS = {
    twitch:    '<:twitch:1549474965793935571>',
    discord:   '<:discord:1549474921816531045>',
    twitter:   '<:twitter:1549474838219849798>',
    tiktok:    '<:tiktok:1549468832194887772>',
    youtube:   '<:youtube:1549468804214562907>',
    instagram: '<:insta:1549468767916916806>'
};

function getGuildConfig(guildId) {
    if (!serverConfigs[guildId]) {
        serverConfigs[guildId] = {
            joinLeaveLogChannelId: null,
            modLogChannelId: null,
            messageLogChannelId: null,
            transcriptsChannelId: null,
            staffRoleId: null,
            modRoleId: null,
            adminRoleId: null,
            supportCategoryId: null,
            reportCategoryId: null
        };
    }
    if (serverConfigs[guildId].supportRoleId && !serverConfigs[guildId].staffRoleId) {
        serverConfigs[guildId].staffRoleId = serverConfigs[guildId].supportRoleId;
        delete serverConfigs[guildId].supportRoleId;
    }
    if (!Object.prototype.hasOwnProperty.call(serverConfigs[guildId], 'staffRoleId')) serverConfigs[guildId].staffRoleId = null;
    if (!Object.prototype.hasOwnProperty.call(serverConfigs[guildId], 'modRoleId')) serverConfigs[guildId].modRoleId = null;
    if (!Object.prototype.hasOwnProperty.call(serverConfigs[guildId], 'adminRoleId')) serverConfigs[guildId].adminRoleId = null;
    return serverConfigs[guildId];
}

function saveConfig(guildId, key, value) {
    const config = getGuildConfig(guildId);
    config[key] = value;
    serverConfigs[guildId] = config;
    saveServerConfigs();
}

function loadServerConfigs() {
    serverConfigs = safeReadJSON(SERVER_CONFIG_FILE, {});
    console.log(`Loaded configurations for ${Object.keys(serverConfigs).length} servers`);
}

function saveServerConfigs() {
    safeWriteJSON(SERVER_CONFIG_FILE, serverConfigs);
}

function isAdminSafe(member) {
    try {
        if (!member) return false;
        if (member.permissions?.has(PermissionsBitField.Flags.Administrator)) return true;
        const guildId = member.guild?.id;
        if (!guildId) return false;
        const config = getGuildConfig(guildId);
        if (config.adminRoleId && member.roles?.cache?.has(config.adminRoleId)) return true;
        return false;
    } catch { return false; }
}

function isModeratorSafe(member) {
    try {
        if (!member) return false;
        if (isAdminSafe(member)) return true;
        const guildId = member.guild?.id;
        if (!guildId) return false;
        const config = getGuildConfig(guildId);
        if (config.modRoleId && member.roles?.cache?.has(config.modRoleId)) return true;
        return false;
    } catch { return false; }
}

function isStaffSafe(member) {
    try {
        if (!member) return false;
        if (isModeratorSafe(member)) return true;
        const guildId = member.guild?.id;
        if (!guildId) return false;
        const config = getGuildConfig(guildId);
        if (config.staffRoleId && member.roles?.cache?.has(config.staffRoleId)) return true;
        return false;
    } catch { return false; }
}

function isAdmin(member) { return isAdminSafe(member); }
function isModerator(member) { return isModeratorSafe(member); }
function isStaff(member) { return isStaffSafe(member); }

function hasModPerms(member) {
    return isAdminSafe(member) || isModeratorSafe(member);
}

function hasStaffPermission(member) {
    return isAdminSafe(member) || isModeratorSafe(member) || isStaffSafe(member);
}

function canUseSetupCommand(member) {
    return isAdminSafe(member);
}

function canUseBaseCommands(member) {
    return isAdminSafe(member) || isModeratorSafe(member);
}

async function getUserFromInput(guild, input) {
    if (!input) return null;
    let userId = null;
    const mentionMatch = input.match(/^<@!?(\d+)>$/);
    if (mentionMatch) {
        userId = mentionMatch[1];
    } else if (/^\d+$/.test(input)) {
        userId = input;
    }
    if (!userId) return null;
    try {
        const member = await guild.members.fetch(userId);
        return { user: member.user, member: member };
    } catch {
        return { user: { id: userId, tag: `Unknown User (${userId})` }, member: null };
    }
}

async function sendActionDM(user, action, reason, moderator, duration = null) {
    try {
        const moderatorTag = moderator?.tag || moderator?.user?.tag || 'Auto-Mod';
        const guildName = moderator?.guild?.name || 'Server';
        const actionText = { 'warned': 'avvertito', 'banned': 'bannato', 'kicked': 'kickato', 'muted': 'mutato' };
        let description = `Sei stato ${actionText[action] || action} nel server ${guildName}.`;
        if (duration) description = `Sei stato mutato per ${duration} nel server ${guildName}.`;
        const embed = new EmbedBuilder()
            .setTitle('Azione eseguita su di te')
            .setDescription(description)
            .setColor(COLORS.WARNING)
            .setThumbnail(THUMBNAIL_URL)
            .addFields(
                { name: 'Motivo', value: reason || 'Non specificato', inline: false },
                { name: 'Moderatore', value: moderatorTag, inline: true },
                { name: 'Server', value: guildName, inline: true }
            );
        await user.send({ embeds: [embed] }).catch(() => console.log(`DM failed: ${user?.tag || user?.id}`));
    } catch (error) {
        logCrash('DM_ERROR', error, { userId: user?.id, action });
    }
}

function loadWarnings() {
    const saved = safeReadJSON(WARNINGS_FILE, {});
    warnings.clear();
    for (const [userId, userWarnings] of Object.entries(saved)) {
        warnings.set(userId, userWarnings);
    }
    console.log(`Loaded ${warnings.size} warning records`);
}

function saveWarnings() {
    const obj = {};
    for (const [userId, userWarnings] of warnings.entries()) {
        obj[userId] = userWarnings;
    }
    safeWriteJSON(WARNINGS_FILE, obj);
}

async function addWarning(guild, user, moderator, reason) {
    const userId = user.id;
    if (!warnings.has(userId)) warnings.set(userId, []);
    const userWarnings = warnings.get(userId);
    const warningId = userWarnings.length + 1;
    userWarnings.push({
        id: warningId,
        moderatorId: moderator.id,
        moderatorTag: moderator.tag,
        reason: reason || 'No reason provided',
        date: new Date().toISOString(),
        dateFormatted: formatFullDate(new Date())
    });
    warnings.set(userId, userWarnings);
    saveWarnings();
    const member = guild.members.cache.get(userId);
    if (member) {
        if (userWarnings.length >= 10) {
            await member.ban({ reason: 'Auto-ban: 10 warnings' }).catch(() => {});
            await sendActionDM(user, 'banned', '10 warnings accumulati', { tag: 'Auto-Mod', guild: guild });
            await saveModLog(guild, 'User banned (auto)', user, client.user, '10 warnings accumulated', null);
        } else if (userWarnings.length >= 5) {
            await member.kick('Auto-kick: 5 warnings').catch(() => {});
            await sendActionDM(user, 'kicked', '5 warnings accumulati', { tag: 'Auto-Mod', guild: guild });
            await saveModLog(guild, 'User kicked (auto)', user, client.user, '5 warnings accumulated', null);
        } else if (userWarnings.length >= 3) {
            await member.timeout(30 * 60 * 1000, 'Auto-mute: 3 warnings').catch(() => {});
            await sendActionDM(user, 'muted', '3 warnings accumulati', { tag: 'Auto-Mod', guild: guild }, '30 minutes');
            await saveModLog(guild, 'User muted (auto)', user, client.user, '3 warnings accumulated', '30 minutes');
        }
    }
    return warningId;
}

async function removeWarning(guild, user, moderator, warningId) {
    const userId = user.id;
    if (!warnings.has(userId)) return false;
    const userWarnings = warnings.get(userId);
    const warningIndex = userWarnings.findIndex(w => w.id === parseInt(warningId));
    if (warningIndex === -1) return false;
    userWarnings.splice(warningIndex, 1);
    userWarnings.forEach((w, idx) => { w.id = idx + 1; });
    if (userWarnings.length === 0) {
        warnings.delete(userId);
    } else {
        warnings.set(userId, userWarnings);
    }
    saveWarnings();
    return true;
}

async function clearWarnings(guild, user, moderator) {
    const userId = user.id;
    if (!warnings.has(userId)) return false;
    warnings.delete(userId);
    saveWarnings();
    return true;
}

async function getUserWarnings(userId) {
    return warnings.get(userId) || [];
}

async function saveModLog(guild, action, target, moderator, reason, duration = null) {
    try {
        let userLogs;
        if (target.id === 'channel') {
            if (!userModLogs.has('channel')) userModLogs.set('channel', []);
            userLogs = userModLogs.get('channel');
        } else {
            if (!userModLogs.has(target.id)) userModLogs.set(target.id, []);
            userLogs = userModLogs.get(target.id);
        }
        const logId = userLogs.length + 1;
        userLogs.push({
            id: logId,
            action: action,
            targetId: target.id,
            targetTag: target.tag,
            moderatorId: moderator.id,
            moderatorTag: moderator.tag,
            reason: reason || 'No reason provided',
            duration,
            guildId: guild.id,
            guildName: guild.name,
            date: new Date().toISOString(),
            dateFormatted: formatFullDate(new Date()),
            hammerTime: formatHammerTime(new Date())
        });
        if (target.id === 'channel') {
            userModLogs.set('channel', userLogs);
        } else {
            userModLogs.set(target.id, userLogs);
        }
        saveData();
        const config = getGuildConfig(guild.id);
        const logChannel = client.channels.cache.get(config.modLogChannelId);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle(action)
                .setColor(COLORS.MODERATION)
                .setThumbnail(THUMBNAIL_URL);
            if (action === 'Messages purged') {
                logEmbed.addFields(
                    { name: 'Moderator', value: `${moderator.toString()}`, inline: true },
                    { name: 'Channel', value: `<#${target.id}>`, inline: true },
                    { name: 'Messages deleted', value: reason || 'Unknown', inline: true },
                    { name: 'Date', value: formatFullDate(new Date()), inline: true }
                );
            } else {
                logEmbed.addFields(
                    { name: 'User', value: `${target.toString()}`, inline: true },
                    { name: 'Moderator', value: `${moderator.toString()}`, inline: true },
                    { name: 'Reason', value: reason || 'No reason provided', inline: false },
                    { name: 'Date', value: formatFullDate(new Date()), inline: true },
                    { name: 'Log ID', value: `#${logId}`, inline: true }
                );
            }
            if (duration) logEmbed.addFields({ name: 'Duration', value: duration, inline: true });
            await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
        }
    } catch (error) {
        logCrash('MODLOG_ERROR', error, { action });
    }
}

function formatModerationHistory(userId, guildId, username) {
    const logs = [];

    if (userModLogs && typeof userModLogs.forEach === 'function') {
        userModLogs.forEach((userLogs) => {
            if (Array.isArray(userLogs)) {
                for (const log of userLogs) {
                    if (log.guildId === guildId && log.targetId === userId) {
                        logs.push(log);
                    }
                }
            }
        });
    }

    if (logs.length === 0) {
        return `✅ Nessuna sanzione registrata per **${username}**.`;
    }

    logs.sort((a, b) => new Date(b.date) - new Date(a.date));

    const typeEmoji = {
        'User banned': '🔨',
        'User kicked': '👢',
        'User muted': '🔇',
        'User warned': '⚠️',
        'User unbanned': '✅',
        'User unmuted': '🔊',
        'Messages purged': '🧹',
        'User banned (auto)': '🤖🔨',
        'User kicked (auto)': '🤖👢',
        'User muted (auto)': '🤖🔇'
    };

    const typeLabel = (action) => {
        const a = (action || '').toLowerCase();
        if (a.includes('unban')) return 'Unban';
        if (a.includes('ban')) return 'Ban';
        if (a.includes('kick')) return 'Kick';
        if (a.includes('unmute')) return 'Unmute';
        if (a.includes('mute')) return 'Mute';
        if (a.includes('warn')) return 'Warn';
        if (a.includes('purge')) return 'Purge';
        return action;
    };

    const formatDateIT = (iso) => {
        const d = new Date(iso);
        const giorno = String(d.getDate()).padStart(2, '0');
        const mesi = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
        const mese = mesi[d.getMonth()];
        const anno = d.getFullYear();
        const ore = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `${giorno} ${mese} ${anno} ${ore}:${min}`;
    };

    let output = `**Modlogs for ${username}**\n`;

    for (const log of logs.slice(0, 10)) {
        const emoji = typeEmoji[log.action] || '📌';
        const tipo = typeLabel(log.action);
        const durata = log.duration ? ` (${log.duration})` : '';

        output += `\n**Case ${log.id}**\n`;
        output += `${emoji} Type: ${tipo}${durata}\n`;
        output += `Moderator: ${log.moderatorTag} (${log.moderatorId})\n`;
        output += `Reason: ${log.reason} - ${formatDateIT(log.date)}\n`;
    }

    if (logs.length > 10) {
        output += `\n*...e altre ${logs.length - 10} sanzioni*`;
    }

    output += `\n**Totale: ${logs.length} sanzioni**`;

    return output;
}

function formatFullDate(date) {
    const timestamp = Math.floor(date.getTime() / 1000);
    return `<t:${timestamp}:F>`;
}

function formatHammerTime(date) {
    const timestamp = Math.floor(date.getTime() / 1000);
    return `<t:${timestamp}:R>`;
}

function isValidUrl(string) {
    if (!string || typeof string !== 'string') return false;
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

async function sendJoinLog(member) {
    try {
        const config = getGuildConfig(member.guild.id);
        const channel = client.channels.cache.get(config.joinLeaveLogChannelId);
        if (!channel) return;
        const embed = new EmbedBuilder()
            .setTitle(`${member.user.username} just joined the server.`)
            .setColor(COLORS.SUCCESS)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'Member', value: member.user.toString(), inline: true },
                { name: 'User ID', value: member.user.id, inline: true },
                { name: 'User Tag', value: member.user.tag, inline: true },
                { name: 'Account Created', value: formatFullDate(member.user.createdAt), inline: false },
                { name: 'Joined Server', value: formatFullDate(member.joinedAt), inline: false },
                { name: 'Member Count', value: `${member.guild.memberCount} members`, inline: true }
            );
        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (error) {
        logCrash('JOIN_LOG_ERROR', error, { userId: member?.user?.id });
    }
}

async function sendLeaveLog(member) {
    try {
        const config = getGuildConfig(member.guild.id);
        const channel = client.channels.cache.get(config.joinLeaveLogChannelId);
        if (!channel) return;
        const embed = new EmbedBuilder()
            .setTitle(`${member.user.username} has left the server.`)
            .setColor(COLORS.ERROR)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'Member', value: member.user.toString(), inline: true },
                { name: 'User ID', value: member.user.id, inline: true },
                { name: 'User Tag', value: member.user.tag, inline: true },
                { name: 'Account Created', value: formatFullDate(member.user.createdAt), inline: false },
                { name: 'Joined Server', value: formatFullDate(member.joinedAt), inline: false },
                { name: 'Member Count', value: `${member.guild.memberCount} members`, inline: true }
            );
        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (error) {
        logCrash('LEAVE_LOG_ERROR', error, { userId: member?.user?.id });
    }
}

async function sendWelcomeDM(member) {
    try {
        const welcomeEmbed = new EmbedBuilder()
            .setTitle('BENVENUTO NELLE PRED CORD')
            .setDescription(`Ciao ${member.user.toString()}! Benvenuto nel server ufficiale del Predcord!`)
            .setColor(COLORS.SUCCESS)
            .setThumbnail(THUMBNAIL_URL)
            .setImage(FOOTER_IMAGE_URL)
            .addFields(
                { name: 'REGOLE', value: 'Leggi le regole nel canale regole per evitare sanzioni.', inline: false },
                { name: 'TICKET', value: 'Hai bisogno di aiuto? Apri un ticket nella sezione supporto.', inline: false },
                { name: 'SEGUICI SUI SOCIAL', value: `${EMOJIS.twitch} [Twitch](${SOCIAL_LINKS.twitch})\n${EMOJIS.youtube} [YouTube](${SOCIAL_LINKS.youtube})\n${EMOJIS.tiktok} [TikTok](${SOCIAL_LINKS.tiktok})\n${EMOJIS.twitter} [Twitter/X](${SOCIAL_LINKS.twitter})\n${EMOJIS.instagram} [Instagram](${SOCIAL_LINKS.instagram})\n${EMOJIS.discord} [Discord Community](${SOCIAL_LINKS.discord})`, inline: false }
            );
        await member.send({ embeds: [welcomeEmbed] }).catch(() => console.log(`DM failed: ${member.user.tag}`));
    } catch (error) {
        logCrash('WELCOME_DM_ERROR', error, { userId: member?.user?.id });
    }
}

async function sendSocialEmbed(channel) {
    try {
        const socialEmbed = new EmbedBuilder()
            .setTitle('SEGUICI SUI SOCIAL')
            .setDescription('Unisciti alla community e seguici su tutti i canali ufficiali per non perderti nulla!')
            .setColor(COLORS.INFO)
            .setThumbnail(THUMBNAIL_URL)
            .addFields(
                { name: `${EMOJIS.twitch} Twitch`, value: `[PredageFN](${SOCIAL_LINKS.twitch})`, inline: true },
                { name: `${EMOJIS.youtube} YouTube`, value: `[PredageFN](${SOCIAL_LINKS.youtube})`, inline: true },
                { name: `${EMOJIS.tiktok} TikTok`, value: `[PredageFN](${SOCIAL_LINKS.tiktok})`, inline: true },
                { name: `${EMOJIS.twitter} Twitter/X`, value: `[Predage1](${SOCIAL_LINKS.twitter})`, inline: true },
                { name: `${EMOJIS.instagram} Instagram`, value: `[PredageFN](${SOCIAL_LINKS.instagram})`, inline: true },
                { name: `${EMOJIS.discord} Discord Community`, value: `[Predage Community](${SOCIAL_LINKS.discord})`, inline: true }
            );
        await channel.send({ embeds: [socialEmbed] });
    } catch (error) {
        logCrash('SOCIAL_EMBED_ERROR', error);
    }
}

async function showTicketTypeMenu(interaction) {
    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('ticket_type_menu')
            .setPlaceholder('Seleziona il tipo di ticket')
            .addOptions([
                { label: 'Support', description: 'Per assistenza generale o problemi con il server', value: 'support' },
                { label: 'Report Player', description: 'Per segnalare un giocatore che viola le regole', value: 'report' }
            ])
    );
    const embed = new EmbedBuilder()
        .setTitle('Crea un nuovo ticket')
        .setDescription('Seleziona il tipo di ticket dal menu a tendina qui sotto.')
        .setColor(COLORS.TICKET)
        .setThumbnail(THUMBNAIL_URL);
    await interaction.reply({ embeds: [embed], components: [row], flags: 64 });
}

async function showTicketDescriptionModal(interaction, ticketType) {
    if (ticketType === 'support') {
        const modal = new ModalBuilder().setCustomId('ticket_modal_support').setTitle('Support Ticket');
        const descriptionInput = new TextInputBuilder()
            .setCustomId('ticket_description')
            .setLabel('Descrizione')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Descrivi il tuo problema in dettaglio...')
            .setRequired(true)
            .setMaxLength(1000);
        modal.addComponents(new ActionRowBuilder().addComponents(descriptionInput));
        await interaction.showModal(modal);
    } else if (ticketType === 'report') {
        const modal = new ModalBuilder().setCustomId('ticket_modal_report').setTitle('Report Player');
        const playerIdInput = new TextInputBuilder()
            .setCustomId('player_id')
            .setLabel('ID / Epic Name del giocatore')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Es: PlayerName123 o EpicName')
            .setRequired(true)
            .setMaxLength(100);
        const clipLinkInput = new TextInputBuilder()
            .setCustomId('clip_link')
            .setLabel('Link della clip')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://streamable.com/...')
            .setRequired(true)
            .setMaxLength(200);
        const descriptionInput = new TextInputBuilder()
            .setCustomId('report_description')
            .setLabel('Descrizione')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Descrivi cosa e successo...')
            .setRequired(true)
            .setMaxLength(1000);
        modal.addComponents(
            new ActionRowBuilder().addComponents(playerIdInput),
            new ActionRowBuilder().addComponents(clipLinkInput),
            new ActionRowBuilder().addComponents(descriptionInput)
        );
        await interaction.showModal(modal);
    }
}

async function createTicket(interaction, ticketType, data) {
    const typeConfig = {
        'support': { name: 'Support', categoryKey: 'supportCategoryId', title: 'Support Ticket', color: COLORS.SUCCESS },
        'report': { name: 'Report', categoryKey: 'reportCategoryId', title: 'Report Player', color: COLORS.REPORT }
    };
    const config = typeConfig[ticketType];
    if (!config) return interaction.reply({ content: 'Tipo di ticket non valido.', flags: 64 });
    const guildConfig = getGuildConfig(interaction.guild.id);
    const staffRoleId = guildConfig.staffRoleId;
    const categoryId = guildConfig[config.categoryKey];
    if (!staffRoleId) return interaction.reply({ content: 'Staff role not configured. Please run `*setup` first.', flags: 64 });
    if (!categoryId) return interaction.reply({ content: `Category for ${config.name} tickets is not configured. Please run \`*setup\` first.`, flags: 64 });
    const category = interaction.guild.channels.cache.get(categoryId);
    if (!category) return interaction.reply({ content: 'Category not found. Please contact an administrator.', flags: 64 });
    let descriptionText = '';
    if (ticketType === 'support') {
        descriptionText = data.description || 'Nessuna descrizione fornita';
    } else {
        const playerId = data.playerId || 'Non fornito';
        const clipLink = data.clipLink || 'Non fornito';
        const reportDesc = data.description || 'Nessuna descrizione';
        let clipMessage = clipLink;
        if (!isValidUrl(clipLink) && clipLink !== 'Non fornito') {
            clipMessage = `${clipLink}\n\nLink non valido. Per favore usa Streamable (https://streamable.com) per caricare la clip e incolla il link qui.`;
        } else if (clipLink === 'Non fornito') {
            clipMessage = `${clipLink}\n\nPer favore carica la clip su Streamable (https://streamable.com) e fornisci il link.`;
        }
        descriptionText = `**ID / Epic Name:** ${playerId}\n\n**Link Clip:** ${clipMessage}\n\n**Descrizione:** ${reportDesc}`;
    }
    const sanitizedUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
    const ticketName = `${ticketType}-${sanitizedUsername}`;
    const permissionOverwrites = [
        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: staffRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
    ];
    let ticketChannel;
    try {
        ticketChannel = await interaction.guild.channels.create({
            name: ticketName,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: permissionOverwrites
        });
    } catch (error) {
        try {
            ticketChannel = await interaction.guild.channels.create({
                name: `${ticketName}-${Math.floor(Math.random() * 9999)}`,
                type: ChannelType.GuildText,
                parent: category.id,
                permissionOverwrites: permissionOverwrites
            });
        } catch (err) {
            logCrash('TICKET_CREATE_ERROR', err);
            return interaction.reply({ content: 'Errore durante la creazione del ticket. Contatta un admin.', flags: 64 });
        }
    }
    await ticketChannel.setTopic(interaction.user.id).catch(() => {});
    let embedDescription = '';
    if (ticketType === 'support') {
        embedDescription = `Ticket Type: ${config.name}\n\n**Descrizione:**\n${descriptionText}\n\nCiao ${interaction.user.username}!\n\nUn membro dello staff ti assisterà a breve.\nAttendi pazientemente una risposta.`;
    } else {
        embedDescription = `Ticket Type: ${config.name}\n\n${descriptionText}\n\nCiao ${interaction.user.username}!\n\nUn membro dello staff esaminerà la tua segnalazione.\nGrazie per il tuo contributo nel mantenere il server sicuro.`;
    }
    const embed = new EmbedBuilder()
        .setTitle(config.title)
        .setDescription(embedDescription)
        .setColor(config.color)
        .setThumbnail(THUMBNAIL_URL);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim Ticket').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
    );
    await ticketChannel.send({ content: `<@&${staffRoleId}> - Nuovo ticket ${config.name} da <@${interaction.user.id}>`, embeds: [embed], components: [row] });
    await interaction.reply({ content: `Ticket creato: ${ticketChannel}\nTipo: ${config.name}`, flags: 64 });
}

async function generateTicketTranscript(channel, closer) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        let transcript = `TICKET TRANSCRIPT\nChannel: ${channel.name}\nClosed by: ${closer.tag} (${closer.id})\nDate: ${new Date().toLocaleString()}\n${'='.repeat(50)}\n\n`;
        for (const msg of Array.from(messages.values()).reverse()) {
            transcript += `[${msg.createdAt.toLocaleString()}] ${msg.author.tag}: ${msg.content}\n`;
            if (msg.attachments.size > 0) {
                transcript += `  Attachments: ${msg.attachments.map(a => a.url).join(', ')}\n`;
            }
        }
        const fileName = `transcript-${channel.name}-${Date.now()}.txt`;
        const filePath = path.join(TRANSCRIPTS_DIR, fileName);
        fs.writeFileSync(filePath, transcript);
        const config = getGuildConfig(channel.guild.id);
        const transcriptChannel = client.channels.cache.get(config.transcriptsChannelId);
        if (transcriptChannel) {
            await transcriptChannel.send({
                content: `Transcript for ticket ${channel.name} - Closed by ${closer.tag}`,
                files: [{ attachment: filePath, name: fileName }]
            }).catch(() => {});
        }
        console.log(`[TRANSCRIPT] Saved transcript for ${channel.name}`);
        return filePath;
    } catch (error) {
        logCrash('TRANSCRIPT_ERROR', error, { channel: channel?.name });
        return null;
    }
}

function loadData() {
    const saved = safeReadJSON(MODLOGS_FILE, {});
    userModLogs.clear();
    for (const [userId, logs] of Object.entries(saved)) userModLogs.set(userId, logs);
    loadServerConfigs();
    loadWarnings();
}

function saveData() {
    const modLogsObject = {};
    for (const [userId, logs] of userModLogs.entries()) modLogsObject[userId] = logs;
    safeWriteJSON(MODLOGS_FILE, modLogsObject);
    saveWarnings();
}

client.once('ready', async () => {
    console.log(`Bot PredCord connesso come ${client.user.tag}`);
    loadServerConfigs();
    loadWarnings();
    loadData();
    const customCmds = loadCustomCommands();
    const totalCmds = Object.values(customCmds).reduce((acc, g) => acc + Object.keys(g).length, 0);
    console.log(`[CUSTOM] Comandi custom caricati: ${totalCmds} in ${Object.keys(customCmds).length} server`);

    global.PredCord = {
        client,
        getGuildConfig,
        loadCustomCommands,
        saveCustomCommands,
        isAdminSafe,
        isModeratorSafe,
        isStaffSafe,
        hasModPerms,
        COLORS,
        THUMBNAIL_URL,
        EmbedBuilder,
        userModLogs,
        warnings,
        getUserWarnings,
        addWarning,
        removeWarning,
        clearWarnings,
        saveModLog,
        saveData,
        formatModerationHistory
    };
    console.log('[DASHBOARD] API global.PredCord esposte');
});

client.on('guildMemberAdd', async (member) => {
    try {
        await sendWelcomeDM(member);
        await sendJoinLog(member);
    } catch (error) {
        logCrash('GUILD_MEMBER_ADD', error, { userId: member?.user?.id });
    }
});

client.on('guildMemberRemove', async (member) => {
    try {
        await sendLeaveLog(member);
    } catch (error) {
        logCrash('GUILD_MEMBER_REMOVE', error, { userId: member?.user?.id });
    }
});

client.on(Events.MessageDelete, async (message) => {
    try {
        if (!message.guild) return;
        if (message.author?.bot) return;
        const config = getGuildConfig(message.guild.id);
        const logChannel = client.channels.cache.get(config.messageLogChannelId);
        if (!logChannel) return;
        const embed = new EmbedBuilder()
            .setTitle('Message Deleted')
            .setColor(COLORS.ERROR)
            .setThumbnail(THUMBNAIL_URL)
            .addFields(
                { name: 'Channel', value: message.channel.toString(), inline: true },
                { name: 'Author', value: message.author?.toString() || 'Unknown', inline: true },
                { name: 'Content', value: (message.content || 'No content').substring(0, 1000), inline: false }
            );
        await logChannel.send({ embeds: [embed] });
    } catch (error) {
        logCrash('MESSAGE_DELETE_LOG', error);
    }
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    try {
        if (!newMessage.guild) return;
        if (oldMessage.content === newMessage.content) return;
        if (newMessage.author?.bot) return;
        const config = getGuildConfig(newMessage.guild.id);
        const logChannel = client.channels.cache.get(config.messageLogChannelId);
        if (!logChannel) return;
        const embed = new EmbedBuilder()
            .setTitle('Message Edited')
            .setColor(COLORS.WARNING)
            .setThumbnail(THUMBNAIL_URL)
            .addFields(
                { name: 'Channel', value: newMessage.channel.toString(), inline: true },
                { name: 'Author', value: newMessage.author?.toString() || 'Unknown', inline: true },
                { name: 'Before', value: (oldMessage.content || 'No content').substring(0, 1000), inline: false },
                { name: 'After', value: (newMessage.content || 'No content').substring(0, 1000), inline: false }
            );
        await logChannel.send({ embeds: [embed] });
    } catch (error) {
        logCrash('MESSAGE_UPDATE_LOG', error);
    }
});

client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;
        if (!message.guild) return;
        if (!message.content.startsWith('*')) return;
        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const hasModPermsCheck = hasModPerms(message.member);

        if (command === 'help') {
            if (!canUseBaseCommands(message.member)) {
                await message.delete().catch(() => {});
                return;
            }
            const embed = new EmbedBuilder()
                .setTitle('PredCord Commands')
                .setDescription('Comandi disponibili in base al tuo ruolo:')
                .setColor(COLORS.INFO)
                .setThumbnail(THUMBNAIL_URL)
                .addFields(
                    { name: 'Admin Only', value: '`*setup` - Configure bot\n`*sendticket` - Send ticket message', inline: false },
                    { name: 'Mod & Admin', value: '`*av [user]` - Show avatar\n`*w [user]` - User info\n`*server` - Server info\n`*social` - Social links\n`*help` - This message', inline: false },
                    { name: 'Warnings (Mod+)', value: '`*warn @user/ID [reason]`\n`*warnings @user/ID`\n`*delwarn @user/ID [id]`\n`*clearwarns @user/ID`', inline: false },
                    { name: 'Moderation (Mod+)', value: '`*ban @user/ID [reason]`\n`*unban ID`\n`*kick @user/ID [reason]`\n`*mute @user/ID [minutes] [reason]`\n`*unmute @user/ID`\n`*purge [1-100]`', inline: false },
                    { name: 'Tickets', value: 'Staff/Mod/Admin: `*tickets`', inline: false }
                );
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        if (command === 'av') {
            if (!canUseBaseCommands(message.member)) {
                await message.delete().catch(() => {});
                return;
            }
            const user = message.mentions.users.first() || message.author;
            const embed = new EmbedBuilder()
                .setTitle(`${user.tag}'s Avatar`)
                .setImage(user.displayAvatarURL({ dynamic: true, size: 4096 }))
                .setColor(COLORS.INFO)
                .setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        if (command === 'w') {
            if (!canUseBaseCommands(message.member)) {
                await message.delete().catch(() => {});
                return;
            }
            let targetUser = message.mentions.users.first();
            const userId = args[0];
            if (!targetUser && userId && /^\d+$/.test(userId)) {
                try {
                    const fetched = await message.guild.members.fetch(userId);
                    targetUser = fetched.user;
                } catch { targetUser = null; }
            }
            const user = targetUser || message.author;
            let member = message.guild.members.cache.get(user.id);
            if (!member) member = await message.guild.members.fetch(user.id).catch(() => null);
            if (!member) {
                const embed = new EmbedBuilder().setDescription('User not found on this server.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const roles = member.roles.cache.filter(r => r.id !== message.guild.id).map(r => r.toString()).join(', ') || 'No roles';
            const embed = new EmbedBuilder()
                .setTitle(`Information about ${user.tag}`)
                .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 1024 }))
                .setColor(COLORS.INFO)
                .addFields(
                    { name: 'Member since', value: formatFullDate(member.joinedAt), inline: true },
                    { name: 'Account created', value: formatFullDate(user.createdAt), inline: true },
                    { name: 'ID', value: user.id, inline: true },
                    { name: 'Roles', value: roles.substring(0, 1024), inline: false }
                );
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        if (command === 'server') {
            if (!canUseBaseCommands(message.member)) {
                await message.delete().catch(() => {});
                return;
            }
            const guild = message.guild;
            const embed = new EmbedBuilder()
                .setTitle(`Information about ${guild.name}`)
                .setThumbnail(guild.iconURL({ dynamic: true, size: 1024 }))
                .setColor(COLORS.INFO)
                .addFields(
                    { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
                    { name: 'Members', value: `${guild.memberCount}`, inline: true },
                    { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
                    { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
                    { name: 'Created on', value: formatFullDate(guild.createdAt), inline: true },
                    { name: 'ID', value: guild.id, inline: true }
                );
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        if (command === 'social') {
            if (!canUseBaseCommands(message.member)) {
                await message.delete().catch(() => {});
                return;
            }
            await sendSocialEmbed(message.channel);
            await message.delete().catch(() => {});
            return;
        }

        if (command === 'warn') {
            if (!hasModPermsCheck) { await message.delete().catch(() => {}); return; }
            const input = args[0];
            if (!input) {
                const embed = new EmbedBuilder().setDescription('You need to mention a user or provide an ID.\nExample: `*warn @user reason`').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const result = await getUserFromInput(message.guild, input);
            if (!result || !result.user) {
                const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const user = result.user;
            const reason = args.slice(1).join(' ') || 'No reason provided';
            const warningId = await addWarning(message.guild, user, message.author, reason);
            await sendActionDM(user, 'warned', reason, { tag: message.author.tag, guild: message.guild });
            const embed = new EmbedBuilder()
                .setTitle('User warned')
                .setDescription(`${user.toString()} has been warned`)
                .setColor(COLORS.WARNING)
                .setThumbnail(THUMBNAIL_URL)
                .addFields(
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Warning ID', value: `#${warningId}`, inline: true }
                );
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User warned', user, message.author, reason);
            await message.delete().catch(() => {});
            return;
        }

        if (command === 'warnings') {
            if (!hasModPermsCheck) { await message.delete().catch(() => {}); return; }
            const input = args[0];
            if (!input) {
                const embed = new EmbedBuilder().setDescription('You need to mention a user or provide an ID.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const result = await getUserFromInput(message.guild, input);
            if (!result || !result.user) {
                const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const user = result.user;
            const userWarnings = await getUserWarnings(user.id);
            if (userWarnings.length === 0) {
                const embed = new EmbedBuilder().setDescription(`${user.toString()} has no warnings.`).setColor(COLORS.SUCCESS).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
            } else {
                let warningsList = '';
                for (const warn of userWarnings) {
                    warningsList += `**#${warn.id}** - ${warn.reason}\n*By ${warn.moderatorTag} on ${warn.dateFormatted}*\n\n`;
                }
                const embed = new EmbedBuilder().setTitle(`Warnings for ${user.tag}`).setDescription(warningsList).setColor(COLORS.WARNING).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
            }
            await message.delete().catch(() => {});
            return;
        }

        if (command === 'delwarn') {
            if (!hasModPermsCheck) { await message.delete().catch(() => {}); return; }
            const input = args[0];
            const warningId = args[1];
            if (!input || !warningId) {
                const embed = new EmbedBuilder().setDescription('You need to mention a user and specify warning ID.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const result = await getUserFromInput(message.guild, input);
            if (!result || !result.user) {
                const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const user = result.user;
            const success = await removeWarning(message.guild, user, message.author, warningId);
            if (success) {
                const embed = new EmbedBuilder().setDescription(`Warning #${warningId} removed from ${user.toString()}`).setColor(COLORS.SUCCESS).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
            } else {
                const embed = new EmbedBuilder().setDescription(`Warning #${warningId} not found for ${user.toString()}`).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
            }
            await message.delete().catch(() => {});
            return;
        }

        if (command === 'clearwarns') {
            if (!hasModPermsCheck) { await message.delete().catch(() => {}); return; }
            const input = args[0];
            if (!input) {
                const embed = new EmbedBuilder().setDescription('You need to mention a user or provide an ID.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const result = await getUserFromInput(message.guild, input);
            if (!result || !result.user) {
                const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const user = result.user;
            await clearWarnings(message.guild, user, message.author);
            const embed = new EmbedBuilder().setDescription(`All warnings cleared for ${user.toString()}`).setColor(COLORS.SUCCESS).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        if (message.content === '*setup') {
            if (!canUseSetupCommand(message.member)) return;
            const config = getGuildConfig(message.guild.id);
            const embed = new EmbedBuilder()
                .setTitle('Setup Panel - PredCord')
                .setDescription('Configure your server settings by typing `*setup <number>`\n\nExample: `*setup 1 #channel`')
                .setColor(COLORS.INFO)
                .setThumbnail(THUMBNAIL_URL)
                .addFields(
                    { name: '01. Join/Leave Log', value: config.joinLeaveLogChannelId ? `<#${config.joinLeaveLogChannelId}>` : 'Not set', inline: true },
                    { name: '02. Mod Log', value: config.modLogChannelId ? `<#${config.modLogChannelId}>` : 'Not set', inline: true },
                    { name: '03. Message Log', value: config.messageLogChannelId ? `<#${config.messageLogChannelId}>` : 'Not set', inline: true },
                    { name: '04. Transcripts', value: config.transcriptsChannelId ? `<#${config.transcriptsChannelId}>` : 'Not set', inline: true },
                    { name: '05. Staff Role', value: config.staffRoleId ? `<@&${config.staffRoleId}>` : 'Not set', inline: true },
                    { name: '06. Mod Role', value: config.modRoleId ? `<@&${config.modRoleId}>` : 'Not set', inline: true },
                    { name: '07. Admin Role', value: config.adminRoleId ? `<@&${config.adminRoleId}>` : 'Not set', inline: true },
                    { name: '08. Support Category', value: config.supportCategoryId ? `<#${config.supportCategoryId}>` : 'Not set', inline: true },
                    { name: '09. Report Category', value: config.reportCategoryId ? `<#${config.reportCategoryId}>` : 'Not set', inline: true }
                );
            await message.reply({ embeds: [embed] });
            return;
        }

        if (message.content.startsWith('*setup ')) {
            if (!canUseSetupCommand(message.member)) return;
            const num = parseInt(message.content.split(' ')[1]);
            if (isNaN(num)) return;
            const settingNames = {
                1: 'joinLeaveLogChannelId', 2: 'modLogChannelId', 3: 'messageLogChannelId',
                4: 'transcriptsChannelId', 5: 'staffRoleId', 6: 'modRoleId', 7: 'adminRoleId',
                8: 'supportCategoryId', 9: 'reportCategoryId'
            };
            if (!settingNames[num]) return;
            const isRoleConfig = (num === 5 || num === 6 || num === 7);
            const typeText = isRoleConfig ? 'Role' : 'Channel';
            const embed = new EmbedBuilder()
                .setTitle('Configuration')
                .setDescription(`Please send the ${isRoleConfig ? 'role ID or mention the role' : 'channel ID or mention the channel'}.\n\nType \`cancel\` to abort.`)
                .setColor(COLORS.INFO)
                .setThumbnail(THUMBNAIL_URL);
            await message.reply({ embeds: [embed] });
            const filter = (m) => m.author.id === message.author.id;
            const collector = message.channel.createMessageCollector({ filter, time: 60000, max: 1 });
            collector.on('collect', async (msg) => {
                try {
                    if (msg.content.toLowerCase() === 'cancel') {
                        const cancelEmbed = new EmbedBuilder().setDescription('Configuration cancelled.').setColor(COLORS.WARNING).setThumbnail(THUMBNAIL_URL);
                        await msg.reply({ embeds: [cancelEmbed] });
                        return;
                    }
                    let value = null;
                    const content = msg.content.trim();
                    const channelMentionMatch = content.match(/<#(\d+)>/);
                    const roleMentionMatch = content.match(/<@&(\d+)>/);
                    const idMatch = content.match(/^(\d+)$/);
                    if (channelMentionMatch) value = channelMentionMatch[1];
                    else if (roleMentionMatch) value = roleMentionMatch[1];
                    else if (idMatch) value = idMatch[1];
                    if (!value) {
                        const errorEmbed = new EmbedBuilder().setDescription('Invalid format. Please send an ID or a valid mention.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                        await msg.reply({ embeds: [errorEmbed] });
                        return;
                    }
                    if (!isRoleConfig) {
                        const channelExists = message.guild.channels.cache.get(value);
                        if (!channelExists) {
                            const errorEmbed = new EmbedBuilder().setDescription(`${typeText} not found.`).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                            await msg.reply({ embeds: [errorEmbed] });
                            return;
                        }
                    } else {
                        const roleExists = message.guild.roles.cache.get(value);
                        if (!roleExists) {
                            const errorEmbed = new EmbedBuilder().setDescription('Role not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                            await msg.reply({ embeds: [errorEmbed] });
                            return;
                        }
                    }
                    saveConfig(message.guild.id, settingNames[num], value);
                    const successEmbed = new EmbedBuilder()
                        .setTitle('Configuration Saved')
                        .setDescription(`${settingNames[num]} has been successfully configured!`)
                        .addFields({ name: 'Value', value: isRoleConfig ? `<@&${value}>` : `<#${value}>`, inline: true })
                        .setColor(COLORS.SUCCESS)
                        .setThumbnail(THUMBNAIL_URL);
                    await msg.reply({ embeds: [successEmbed] });
                } catch (error) {
                    logCrash('SETUP_COLLECTOR', error);
                }
            });
            collector.on('end', (collected, reason) => {
                if (collected.size === 0 && reason === 'time') {
                    const timeoutEmbed = new EmbedBuilder().setDescription('Time expired. Run `*setup` again.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    message.channel.send({ embeds: [timeoutEmbed] }).catch(() => {});
                }
            });
            return;
        }

        if (command === 'sendticket') {
            if (!canUseSetupCommand(message.member)) return;
            const config = getGuildConfig(message.guild.id);
            if (!config.staffRoleId) {
                const embed = new EmbedBuilder().setDescription('Staff role not configured. Run `*setup` option 05.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                return message.reply({ embeds: [embed] });
            }
            if (!config.supportCategoryId) {
                const embed = new EmbedBuilder().setDescription('Support category not configured. Run `*setup` option 08.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                return message.reply({ embeds: [embed] });
            }
            if (!config.reportCategoryId) {
                const embed = new EmbedBuilder().setDescription('Report category not configured. Run `*setup` option 09.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                return message.reply({ embeds: [embed] });
            }
            const ticketEmbed = new EmbedBuilder()
                .setTitle('Support and Report')
                .setDescription('Click the button below to open a ticket.\n\nTicket types available:\n- Support\n- Report Player')
                .setColor(COLORS.TICKET)
                .setThumbnail(THUMBNAIL_URL);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('create_ticket').setLabel('Create Ticket').setStyle(ButtonStyle.Primary)
            );
            await message.channel.send({ embeds: [ticketEmbed], components: [row] });
            await message.delete().catch(() => {});
            return;
        }

        if (command === 'tickets') {
            if (!hasStaffPermission(message.member)) return;
            const embed = new EmbedBuilder().setTitle('Ticket Statistics').setDescription('Feature coming soon!').setColor(COLORS.INFO).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        if (command === 'ban') {
            if (!hasModPermsCheck) { await message.delete().catch(() => {}); return; }
            const input = args[0];
            if (!input) {
                const embed = new EmbedBuilder().setDescription('You need to mention a user or provide an ID.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const result = await getUserFromInput(message.guild, input);
            if (!result || !result.user) {
                const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const user = result.user;
            const member = result.member;
            const reason = args.slice(1).join(' ') || 'No reason provided';
            if (!member || !member.bannable) {
                const embed = new EmbedBuilder().setDescription('I cannot ban this user.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            try {
                await member.ban({ reason });
                await sendActionDM(user, 'banned', reason, { tag: message.author.tag, guild: message.guild });
                const embed = new EmbedBuilder().setTitle('User banned').setDescription(`${user.toString()} has been banned`).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL).addFields({ name: 'Reason', value: reason });
                await message.channel.send({ embeds: [embed] });
                await saveModLog(message.guild, 'User banned', user, message.author, reason);
            } catch (error) {
                const embed = new EmbedBuilder().setDescription('Error during ban.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
            }
            await message.delete().catch(() => {});
            return;
        }

        if (command === 'unban') {
            if (!hasModPermsCheck) { await message.delete().catch(() => {}); return; }
            const userId = args[0];
            if (!userId) {
                const embed = new EmbedBuilder().setDescription('You need to specify the user ID to unban.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            try {
                const bans = await message.guild.bans.fetch();
                const bannedUser = bans.find(ban => ban.user.id === userId);
                if (!bannedUser) {
                    const embed = new EmbedBuilder().setDescription('User not found in bans.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                await message.guild.members.unban(userId);
                const embed = new EmbedBuilder().setTitle('User unbanned').setDescription(`${bannedUser.user.tag} has been unbanned`).setColor(COLORS.SUCCESS).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await saveModLog(message.guild, 'User unbanned', { id: userId, tag: bannedUser.user.tag }, message.author, 'Unbanned');
            } catch (error) {
                const embed = new EmbedBuilder().setDescription('Error during unban.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
            }
            await message.delete().catch(() => {});
            return;
        }

        if (command === 'kick') {
            if (!hasModPermsCheck) { await message.delete().catch(() => {}); return; }
            const input = args[0];
            if (!input) {
                const embed = new EmbedBuilder().setDescription('You need to mention a user or provide an ID.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const result = await getUserFromInput(message.guild, input);
            if (!result || !result.user) {
                const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const user = result.user;
            const member = result.member;
            const reason = args.slice(1).join(' ') || 'No reason provided';
            if (!member || !member.kickable) {
                const embed = new EmbedBuilder().setDescription('I cannot kick this user.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            try {
                await member.kick(reason);
                await sendActionDM(user, 'kicked', reason, { tag: message.author.tag, guild: message.guild });
                const embed = new EmbedBuilder().setTitle('User kicked').setDescription(`${user.toString()} has been kicked`).setColor(COLORS.WARNING).setThumbnail(THUMBNAIL_URL).addFields({ name: 'Reason', value: reason });
                await message.channel.send({ embeds: [embed] });
                await saveModLog(message.guild, 'User kicked', user, message.author, reason);
            } catch (error) {
                const embed = new EmbedBuilder().setDescription('Error during kick.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
            }
            await message.delete().catch(() => {});
            return;
        }

        if (command === 'mute') {
            if (!hasModPermsCheck) { await message.delete().catch(() => {}); return; }
            const input = args[0];
            if (!input) {
                const embed = new EmbedBuilder().setDescription('You need to mention a user or provide an ID.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const result = await getUserFromInput(message.guild, input);
            if (!result || !result.user) {
                const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const user = result.user;
            const member = result.member;
            const duration = parseInt(args[1]);
            if (isNaN(duration)) {
                const embed = new EmbedBuilder().setDescription('You need to specify the duration in minutes.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            if (duration < 1 || duration > 40320) {
                const embed = new EmbedBuilder().setDescription('Duration must be between 1 and 40320 minutes.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const reason = args.slice(2).join(' ') || 'No reason provided';
            if (!member || !member.moderatable) {
                const embed = new EmbedBuilder().setDescription('I cannot mute this user.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            try {
                await member.timeout(duration * 60 * 1000, reason);
                const durationText = `${duration} minute${duration !== 1 ? 's' : ''}`;
                await sendActionDM(user, 'muted', reason, { tag: message.author.tag, guild: message.guild }, durationText);
                const embed = new EmbedBuilder()
                    .setTitle('User muted')
                    .setDescription(`${user.toString()} has been muted for ${durationText}`)
                    .setColor(COLORS.WARNING)
                    .setThumbnail(THUMBNAIL_URL)
                    .addFields(
                        { name: 'Reason', value: reason, inline: false },
                        { name: 'Duration', value: durationText, inline: true }
                    );
                await message.channel.send({ embeds: [embed] });
                await saveModLog(message.guild, 'User muted', user, message.author, reason, `${duration} minutes`);
            } catch (error) {
                const embed = new EmbedBuilder().setDescription('Error during mute.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
            }
            await message.delete().catch(() => {});
            return;
        }

        if (command === 'unmute') {
            if (!hasModPermsCheck) { await message.delete().catch(() => {}); return; }
            const input = args[0];
            if (!input) {
                const embed = new EmbedBuilder().setDescription('You need to mention a user or provide an ID.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const result = await getUserFromInput(message.guild, input);
            if (!result || !result.user) {
                const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            const user = result.user;
            const member = result.member;
            const reason = args.slice(1).join(' ') || 'No reason provided';
            if (!member || !member.moderatable) {
                const embed = new EmbedBuilder().setDescription('I cannot unmute this user.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            try {
                await member.timeout(null, reason);
                const embed = new EmbedBuilder().setTitle('User unmuted').setDescription(`${user.toString()} has been unmuted`).setColor(COLORS.SUCCESS).setThumbnail(THUMBNAIL_URL).addFields({ name: 'Reason', value: reason });
                await message.channel.send({ embeds: [embed] });
                await saveModLog(message.guild, 'User unmuted', user, message.author, reason);
            } catch (error) {
                const embed = new EmbedBuilder().setDescription('Error during unmute.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
            }
            await message.delete().catch(() => {});
            return;
        }

        if (command === 'purge') {
            if (!hasModPermsCheck) { await message.delete().catch(() => {}); return; }
            const amount = parseInt(args[0]);
            if (isNaN(amount) || amount < 1 || amount > 100) {
                const embed = new EmbedBuilder().setDescription('You need to specify a number between 1 and 100.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            try {
                await message.delete().catch(() => {});
                const messages = await message.channel.messages.fetch({ limit: amount });
                const filtered = messages.filter(msg => Date.now() - msg.createdTimestamp < 1209600000);
                const deleted = await message.channel.bulkDelete(filtered, true);
                const embed = new EmbedBuilder().setTitle('Messages purged').setDescription(`Deleted ${deleted.size} messages.`).setColor(COLORS.SUCCESS).setThumbnail(THUMBNAIL_URL);
                const reply = await message.channel.send({ embeds: [embed] });
                setTimeout(() => reply.delete().catch(() => {}), 3000);
                await saveModLog(message.guild, 'Messages purged', { id: 'channel', tag: `#${message.channel.name}` }, message.author, `${deleted.size} messages deleted`);
            } catch (error) {
                const embed = new EmbedBuilder().setDescription('Error during purge. Cannot delete messages older than 14 days.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                const errorMsg = await message.channel.send({ embeds: [embed] });
                setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
            }
            return;
        }

        const customCmds = loadCustomCommands();
        const guildCustoms = customCmds[message.guild.id] || {};
        if (guildCustoms[command]) {
            const cmdData = guildCustoms[command];

            if (cmdData.permission === 'admin' && !isAdminSafe(message.member)) {
                await message.delete().catch(() => {});
                return;
            }
            if (cmdData.permission === 'mod' && !hasModPerms(message.member)) {
                await message.delete().catch(() => {});
                return;
            }
            if (cmdData.permission === 'staff' && !isStaffSafe(message.member)) {
                await message.delete().catch(() => {});
                return;
            }

            const cmdType = cmdData.type || 'text';

            if (cmdType === 'ban') {
                if (!hasModPerms(message.member)) { await message.delete().catch(() => {}); return; }
                const input = args[0];
                if (!input) {
                    const embed = new EmbedBuilder().setDescription(`Uso: \`*${command} @utente motivo\``).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                const result = await getUserFromInput(message.guild, input);
                if (!result || !result.user) {
                    const embed = new EmbedBuilder().setDescription('Utente non trovato.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                const user = result.user;
                const member = result.member;
                let reason = args.slice(1).join(' ');
                if (!reason) {
                    reason = (cmdData.response || 'Nessun motivo')
                        .replace(/{user}/g, user.toString())
                        .replace(/{username}/g, user.username)
                        .replace(/{server}/g, message.guild.name)
                        .replace(/{membercount}/g, message.guild.memberCount)
                        .replace(/{md}/g, formatModerationHistory(user.id, message.guild.id, user.username));
                } else {
                    reason = reason
                        .replace(/{md}/g, formatModerationHistory(user.id, message.guild.id, user.username));
                }
                if (!member || !member.bannable) {
                    const embed = new EmbedBuilder().setDescription('Non posso bannare questo utente.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                try {
                    await member.ban({ reason });
                    await sendActionDM(user, 'banned', reason, { tag: message.author.tag, guild: message.guild });
                    const embed = new EmbedBuilder().setTitle('User banned').setDescription(`${user.toString()} è stato bannato`).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL).addFields({ name: 'Motivo', value: reason });
                    await message.channel.send({ embeds: [embed] });
                    await saveModLog(message.guild, 'User banned', user, message.author, reason);
                } catch (err) {
                    await message.channel.send({ embeds: [new EmbedBuilder().setDescription('Errore durante il ban.').setColor(COLORS.ERROR)] });
                }
                await message.delete().catch(() => {});
                return;
            }

            if (cmdType === 'kick') {
                if (!hasModPerms(message.member)) { await message.delete().catch(() => {}); return; }
                const input = args[0];
                if (!input) {
                    const embed = new EmbedBuilder().setDescription(`Uso: \`*${command} @utente motivo\``).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                const result = await getUserFromInput(message.guild, input);
                if (!result || !result.user) {
                    const embed = new EmbedBuilder().setDescription('Utente non trovato.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                const user = result.user;
                const member = result.member;
                let reason = args.slice(1).join(' ');
                if (!reason) {
                    reason = (cmdData.response || 'Nessun motivo')
                        .replace(/{user}/g, user.toString())
                        .replace(/{username}/g, user.username)
                        .replace(/{server}/g, message.guild.name)
                        .replace(/{membercount}/g, message.guild.memberCount)
                        .replace(/{md}/g, formatModerationHistory(user.id, message.guild.id, user.username));
                } else {
                    reason = reason
                        .replace(/{md}/g, formatModerationHistory(user.id, message.guild.id, user.username));
                }
                if (!member || !member.kickable) {
                    const embed = new EmbedBuilder().setDescription('Non posso kickare questo utente.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                try {
                    await member.kick(reason);
                    await sendActionDM(user, 'kicked', reason, { tag: message.author.tag, guild: message.guild });
                    const embed = new EmbedBuilder().setTitle('User kicked').setDescription(`${user.toString()} è stato kickato`).setColor(COLORS.WARNING).setThumbnail(THUMBNAIL_URL).addFields({ name: 'Motivo', value: reason });
                    await message.channel.send({ embeds: [embed] });
                    await saveModLog(message.guild, 'User kicked', user, message.author, reason);
                } catch (err) {
                    await message.channel.send({ embeds: [new EmbedBuilder().setDescription('Errore durante il kick.').setColor(COLORS.ERROR)] });
                }
                await message.delete().catch(() => {});
                return;
            }

            if (cmdType === 'mute') {
                if (!hasModPerms(message.member)) { await message.delete().catch(() => {}); return; }
                const input = args[0];
                if (!input) {
                    const embed = new EmbedBuilder().setDescription(`Uso: \`*${command} @utente minuti motivo\``).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                const result = await getUserFromInput(message.guild, input);
                if (!result || !result.user) {
                    const embed = new EmbedBuilder().setDescription('Utente non trovato.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                const user = result.user;
                const member = result.member;
                const duration = parseInt(args[1]);
                if (isNaN(duration) || duration < 1 || duration > 40320) {
                    const embed = new EmbedBuilder().setDescription(`Uso: \`*${command} @utente minuti motivo\`\nDurata: 1-40320 minuti`).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                let reason = args.slice(2).join(' ');
                if (!reason) {
                    reason = (cmdData.response || 'Nessun motivo')
                        .replace(/{user}/g, user.toString())
                        .replace(/{username}/g, user.username)
                        .replace(/{server}/g, message.guild.name)
                        .replace(/{membercount}/g, message.guild.memberCount)
                        .replace(/{md}/g, formatModerationHistory(user.id, message.guild.id, user.username));
                } else {
                    reason = reason
                        .replace(/{md}/g, formatModerationHistory(user.id, message.guild.id, user.username));
                }
                if (!member || !member.moderatable) {
                    const embed = new EmbedBuilder().setDescription('Non posso mutare questo utente.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                try {
                    await member.timeout(duration * 60 * 1000, reason);
                    const durationText = `${duration} minut${duration !== 1 ? 'i' : 'o'}`;
                    await sendActionDM(user, 'muted', reason, { tag: message.author.tag, guild: message.guild }, durationText);
                    const embed = new EmbedBuilder().setTitle('User muted').setDescription(`${user.toString()} è stato mutato per ${durationText}`).setColor(COLORS.WARNING).setThumbnail(THUMBNAIL_URL).addFields({ name: 'Motivo', value: reason });
                    await message.channel.send({ embeds: [embed] });
                    await saveModLog(message.guild, 'User muted', user, message.author, reason, durationText);
                } catch (err) {
                    await message.channel.send({ embeds: [new EmbedBuilder().setDescription('Errore durante il mute.').setColor(COLORS.ERROR)] });
                }
                await message.delete().catch(() => {});
                return;
            }

            if (cmdType === 'warn') {
                if (!hasModPerms(message.member)) { await message.delete().catch(() => {}); return; }
                const input = args[0];
                if (!input) {
                    const embed = new EmbedBuilder().setDescription(`Uso: \`*${command} @utente motivo\``).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                const result = await getUserFromInput(message.guild, input);
                if (!result || !result.user) {
                    const embed = new EmbedBuilder().setDescription('Utente non trovato.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                const user = result.user;
                let reason = args.slice(1).join(' ');
                if (!reason) {
                    reason = (cmdData.response || 'Nessun motivo')
                        .replace(/{user}/g, user.toString())
                        .replace(/{username}/g, user.username)
                        .replace(/{server}/g, message.guild.name)
                        .replace(/{membercount}/g, message.guild.memberCount)
                        .replace(/{md}/g, formatModerationHistory(user.id, message.guild.id, user.username));
                } else {
                    reason = reason
                        .replace(/{md}/g, formatModerationHistory(user.id, message.guild.id, user.username));
                }
                try {
                    const warningId = await addWarning(message.guild, user, message.author, reason);
                    await sendActionDM(user, 'warned', reason, { tag: message.author.tag, guild: message.guild });
                    const embed = new EmbedBuilder().setTitle('User warned').setDescription(`${user.toString()} ha ricevuto un warn`).setColor(COLORS.WARNING).setThumbnail(THUMBNAIL_URL).addFields(
                        { name: 'Motivo', value: reason, inline: false },
                        { name: 'Warning ID', value: `#${warningId}`, inline: true }
                    );
                    await message.channel.send({ embeds: [embed] });
                    await saveModLog(message.guild, 'User warned', user, message.author, reason);
                } catch (err) {
                    await message.channel.send({ embeds: [new EmbedBuilder().setDescription('Errore durante il warn.').setColor(COLORS.ERROR)] });
                }
                await message.delete().catch(() => {});
                return;
            }

            if (cmdType === 'purge') {
                if (!hasModPerms(message.member)) { await message.delete().catch(() => {}); return; }
                const amount = parseInt(args[0]);
                if (isNaN(amount) || amount < 1 || amount > 100) {
                    const embed = new EmbedBuilder().setDescription(`Uso: \`*${command} numero\` (1-100)`).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                try {
                    await message.delete().catch(() => {});
                    const messages = await message.channel.messages.fetch({ limit: amount });
                    const filtered = messages.filter(msg => Date.now() - msg.createdTimestamp < 1209600000);
                    const deleted = await message.channel.bulkDelete(filtered, true);
                    const embed = new EmbedBuilder().setTitle('Messages purged').setDescription(`Eliminati ${deleted.size} messaggi.`).setColor(COLORS.SUCCESS).setThumbnail(THUMBNAIL_URL);
                    const reply = await message.channel.send({ embeds: [embed] });
                    setTimeout(() => reply.delete().catch(() => {}), 3000);
                    await saveModLog(message.guild, 'Messages purged', { id: 'channel', tag: `#${message.channel.name}` }, message.author, `${deleted.size} messages deleted`);
                } catch (err) {
                    const embed = new EmbedBuilder().setDescription('Errore durante il purge.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                }
                return;
            }

            const targetInput = args[0];
            let mdTarget = message.mentions.users.first();
            if (!mdTarget && targetInput && /^\d+$/.test(targetInput)) {
                try {
                    const fetched = await message.guild.members.fetch(targetInput);
                    mdTarget = fetched.user;
                } catch { mdTarget = null; }
            }
            if (!mdTarget) mdTarget = message.author;

            let replyText = cmdData.response || '';
            replyText = replyText.replace(/{user}/g, message.author.toString());
            replyText = replyText.replace(/{username}/g, message.author.username);
            replyText = replyText.replace(/{server}/g, message.guild.name);
            replyText = replyText.replace(/{membercount}/g, message.guild.memberCount);
            replyText = replyText.replace(/{args}/g, args.join(' '));
            replyText = replyText.replace(/{md}/g, formatModerationHistory(mdTarget.id, message.guild.id, mdTarget.username));

            if (cmdType === 'embed') {
                const embed = new EmbedBuilder()
                    .setDescription(replyText)
                    .setColor(cmdData.color || COLORS.INFO)
                    .setThumbnail(THUMBNAIL_URL);
                if (cmdData.title) embed.setTitle(cmdData.title);
                await message.channel.send({ embeds: [embed] }).catch(() => {});
            } else {
                await message.channel.send(replyText).catch(() => {});
            }

            if (cmdData.deleteCommand) await message.delete().catch(() => {});
            return;
        }
    } catch (error) {
        logCrash('MESSAGE_CREATE_HANDLER', error, { command: message?.content?.slice(0, 50) });
    }
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_type_menu') {
            await showTicketDescriptionModal(interaction, interaction.values[0]);
            return;
        }
        if (interaction.isModalSubmit() && interaction.customId === 'ticket_modal_support') {
            const description = interaction.fields.getTextInputValue('ticket_description');
            await createTicket(interaction, 'support', { description });
            return;
        }
        if (interaction.isModalSubmit() && interaction.customId === 'ticket_modal_report') {
            const playerId = interaction.fields.getTextInputValue('player_id');
            const clipLink = interaction.fields.getTextInputValue('clip_link');
            const description = interaction.fields.getTextInputValue('report_description');
            await createTicket(interaction, 'report', { playerId, clipLink, description });
            return;
        }
        if (interaction.isButton() && interaction.customId === 'create_ticket') {
            await showTicketTypeMenu(interaction);
            return;
        }
        if (interaction.isButton() && interaction.customId === 'claim_ticket') {
            const config = getGuildConfig(interaction.guild.id);
            const staffRoleId = config.staffRoleId;
            const isStaffMember = staffRoleId && interaction.member.roles.cache.has(staffRoleId);
            if (!isStaffMember && !isAdmin(interaction.member) && !isModerator(interaction.member)) {
                return interaction.reply({ content: 'Only staff team members can claim tickets.', flags: 64 });
            }
            const ticketOwnerId = interaction.channel.topic;
            if (!ticketOwnerId) return interaction.reply({ content: 'Could not find ticket owner.', flags: 64 });
            const newOverwrites = [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: ticketOwnerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
            ];
            if (staffRoleId) newOverwrites.push({ id: staffRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
            await interaction.channel.permissionOverwrites.set(newOverwrites);
            const embed = new EmbedBuilder()
                .setTitle('Ticket Claimed')
                .setDescription(`${interaction.user} has claimed this ticket and will now assist you.`)
                .setColor(COLORS.SUCCESS)
                .setThumbnail(THUMBNAIL_URL);
            await interaction.channel.send({ content: `<@${ticketOwnerId}>`, embeds: [embed] });
            try {
                const newRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
                );
                await interaction.message.edit({ components: [newRow] });
            } catch (error) {}
            try {
                await interaction.reply({ content: 'You have claimed this ticket!', flags: 64 });
            } catch (error) {
                await interaction.followUp({ content: 'You have claimed this ticket!', flags: 64 }).catch(() => {});
            }
            return;
        }
        if (interaction.isButton() && interaction.customId === 'close_ticket') {
            const config = getGuildConfig(interaction.guild.id);
            const staffRoleId = config.staffRoleId;
            const isStaffMember = staffRoleId && interaction.member.roles.cache.has(staffRoleId);
            if (!isStaffMember && !isAdmin(interaction.member) && !isModerator(interaction.member)) {
                return interaction.reply({ content: 'Only staff team members can close tickets.', flags: 64 });
            }
            await generateTicketTranscript(interaction.channel, interaction.user);
            await interaction.channel.send({ content: 'This ticket will be closed in 5 seconds...' });
            try { await interaction.reply({ content: 'Closing ticket...', flags: 64 }); } catch (error) {}
            setTimeout(async () => {
                try {
                    const channel = interaction.channel;
                    if (channel && channel.deletable) await channel.delete();
                } catch (error) {}
            }, 5000);
            return;
        }
    } catch (error) {
        logCrash('INTERACTION_HANDLER', error, { customId: interaction?.customId });
        try {
            if (interaction?.isRepliable && interaction.isRepliable()) {
                const payload = { content: 'Si e verificato un errore. Riprova.', flags: 64 };
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(payload).catch(() => {});
                } else {
                    await interaction.reply(payload).catch(() => {});
                }
            }
        } catch {}
    }
});

setInterval(() => {
    try { saveData(); } catch (e) { logCrash('AUTO_SAVE', e); }
}, 300000);

process.on('SIGINT', () => { try { saveData(); } catch {} process.exit(); });
process.on('SIGTERM', () => { try { saveData(); } catch {} process.exit(); });

loadData();

if (!process.env.DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN mancante nel file .env!');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch((error) => {
    logCrash('LOGIN_ERROR', error);
    console.error('Login fallito. Controlla il token nel file .env');
    process.exit(1);
});

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, Events, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, RadioGroupBuilder, RadioGroupOptionBuilder, UserSelectMenuBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./db');
require('dotenv').config();

const CRASH_LOG_FILE = './crash_log.json';
const MAX_CRASH_LOGS = 100;
const LOGS_PER_PAGE = 5;
const NATIVE_PREFIX = '*';
const ticketClaims = new Map();
const COMMAND_COOLDOWN_SECONDS = 5;

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

console.log('[ANTI-CRASH] Protection system activated');

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

client.on('error', (error) => logCrash('CLIENT_ERROR', error));
client.on('shardError', (error) => logCrash('SHARD_ERROR', error));

const TRANSCRIPTS_DIR = './transcripts/';

if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
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

const BLACK = 0x000000;
const PROJECTED_ERROR = 0xED4245;
const RED = 0xED4245;
const GOLD = 0xFFD700;

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

function applyPositionalArgs(text, args) {
    if (!text) return '';
    return text.replace(/\$(\d+)/g, (match, num) => {
        const idx = parseInt(num, 10) - 1;
        if (idx >= 0 && idx < args.length) {
            return args[idx];
        }
        return match;
    });
}

function applyHammertime(text) {
    if (!text) return '';
    return text.replace(/{hammertime([+-]\d+)}/g, (match, offset) => {
        const minutes = parseInt(offset, 10);
        const target = Math.floor((Date.now() + minutes * 60 * 1000) / 1000);
        return `<t:${target}:t>`;
    });
}

async function substituteAll(text, message, mdTarget, args) {
    if (!text) return '';
    let result = text;
    result = result.replace(/{user}/g, message.author.toString());
    result = result.replace(/{username}/g, message.author.username);
    result = result.replace(/{server}/g, message.guild.name);
    result = result.replace(/{membercount}/g, message.guild.memberCount);
    result = result.replace(/{args}/g, args.join(' '));
    result = result.replace(/{md}/g, await formatModerationHistory(mdTarget.id, message.guild.id, mdTarget.username, 1));
    result = applyPositionalArgs(result, args);
    result = applyHammertime(result);
    return result;
}

async function getGuildConfig(guildId) {
    const config = await db.getGuildConfigDB(guildId);
    return {
        joinLeaveLogChannelId: config.joinLeaveLogChannelId,
        modLogChannelId: config.modLogChannelId,
        transcriptsChannelId: config.transcriptsChannelId,
        staffRoleId: config.staffRoleId,
        modRoleId: config.modRoleId,
        adminRoleId: config.adminRoleId,
        supportCategoryId: config.supportCategoryId,
        reportCategoryId: config.reportCategoryId
    };
}

async function isAdminSafe(member) {
    try {
        if (!member) return false;
        if (member.permissions?.has(PermissionsBitField.Flags.Administrator)) return true;
        const guildId = member.guild?.id;
        if (!guildId) return false;
        const config = await getGuildConfig(guildId);
        if (config.adminRoleId && member.roles?.cache?.has(config.adminRoleId)) return true;
        return false;
    } catch { return false; }
}

async function isModeratorSafe(member) {
    try {
        if (!member) return false;
        if (await isAdminSafe(member)) return true;
        const guildId = member.guild?.id;
        if (!guildId) return false;
        const config = await getGuildConfig(guildId);
        if (config.modRoleId && member.roles?.cache?.has(config.modRoleId)) return true;
        return false;
    } catch { return false; }
}

async function isStaffSafe(member) {
    try {
        if (!member) return false;
        if (await isModeratorSafe(member)) return true;
        const guildId = member.guild?.id;
        if (!guildId) return false;
        const config = await getGuildConfig(guildId);
        if (config.staffRoleId && member.roles?.cache?.has(config.staffRoleId)) return true;
        return false;
    } catch { return false; }
}

async function hasModPerms(member) {
    return (await isAdminSafe(member)) || (await isModeratorSafe(member));
}

async function hasStaffPermission(member) {
    return (await isAdminSafe(member)) || (await isModeratorSafe(member)) || (await isStaffSafe(member));
}

async function canUseBaseCommands(member) {
    return (await isAdminSafe(member)) || (await isModeratorSafe(member));
}

async function hasProjectedRole(member, guildId) {
    if (!member) return false;
    try {
        const projected = await db.getProjectedRolesDB(guildId);
        if (!projected || projected.length === 0) return false;
        return projected.some(roleId => member.roles?.cache?.has(roleId));
    } catch {
        return false;
    }
}

async function projectedRoleBlock(message, targetMember) {
    if (!targetMember) return false;
    if (await hasProjectedRole(targetMember, message.guild.id)) {
        const embed = new EmbedBuilder()
            .setDescription(`I cannot moderate **${targetMember.user.username}** (${targetMember.user.id}) because they have a **Projected Role**.`)
            .setColor(PROJECTED_ERROR);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return true;
    }
    return false;
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
        try {
            const user = await client.users.fetch(userId);
            return { user: user, member: null };
        } catch {
            return { user: { id: userId, tag: `Unknown User (${userId})` }, member: null };
        }
    }
}

function checkCustomCommandPermission(cmdData, member) {
    if (Array.isArray(cmdData.allowedRoles)) {
        if (cmdData.allowedRoles.length === 0) return false;
        return cmdData.allowedRoles.some(roleId => member.roles?.cache?.has(roleId));
    }
    return true;
}

async function sendActionDM(user, action, reason, moderator, duration = null) {
    try {
        const actionText = {
            'warned': 'warned',
            'banned': 'banned',
            'kicked': 'kicked',
            'muted': 'muted'
        };
        const label = actionText[action] || action;
        const description = `**You have been ${label} for ${reason || 'no reason provided'}**`;

        const embed = new EmbedBuilder()
            .setDescription(description)
            .setColor(COLORS.WARNING);

        const payload = { embeds: [embed] };

        if (action === 'banned') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Appeal your ban')
                    .setStyle(ButtonStyle.Link)
                    .setURL('https://dyno.gg/account')
            );
            payload.components = [row];
        }

        await user.send(payload).catch(() => console.log(`DM failed: ${user?.tag || user?.id}`));
    } catch (error) {
        logCrash('DM_ERROR', error, { userId: user?.id, action });
    }
}

async function addWarning(guild, user, moderator, reason) {
    const warning = await db.addWarningDB({
        guildId: guild.id,
        userId: user.id,
        userTag: user.tag,
        moderatorId: moderator.id,
        moderatorTag: moderator.tag,
        reason: reason || 'No reason provided',
        date: new Date(),
        active: true
    });

    const allWarnings = await db.getUserWarningsDB(guild.id, user.id);
    const warningCount = allWarnings.length;

    const member = guild.members.cache.get(user.id);
    if (member) {
        if (warningCount >= 10) {
            if (await hasProjectedRole(member, guild.id)) {
                console.log(`[PROJECTED] Skipped auto-ban for ${user.tag} (projected role)`);
            } else {
                await member.ban({ reason: 'Auto-ban: 10 warnings' }).catch(() => {});
                await sendActionDM(user, 'banned', '10 warnings accumulated', { tag: 'Auto-Mod', guild: guild });
                await saveModLog(guild, 'User banned (auto)', user, client.user, '10 warnings accumulated', null);
                await db.saveDashboardLogDB(guild.id, {
                    type: 'auto_mod',
                    action: 'user_banned_auto',
                    userId: client.user.id,
                    userTag: client.user.tag,
                    targetId: user.id,
                    targetTag: user.tag,
                    reason: '10 warnings accumulated',
                    details: 'Auto-ban triggered after 10 warnings'
                });
            }
        } else if (warningCount >= 5) {
            if (await hasProjectedRole(member, guild.id)) {
                console.log(`[PROJECTED] Skipped auto-kick for ${user.tag} (projected role)`);
            } else {
                await member.kick('Auto-kick: 5 warnings').catch(() => {});
                await sendActionDM(user, 'kicked', '5 warnings accumulated', { tag: 'Auto-Mod', guild: guild });
                await saveModLog(guild, 'User kicked (auto)', user, client.user, '5 warnings accumulated', null);
                await db.saveDashboardLogDB(guild.id, {
                    type: 'auto_mod',
                    action: 'user_kicked_auto',
                    userId: client.user.id,
                    userTag: client.user.tag,
                    targetId: user.id,
                    targetTag: user.tag,
                    reason: '5 warnings accumulated',
                    details: 'Auto-kick triggered after 5 warnings'
                });
            }
        } else if (warningCount >= 3) {
            if (await hasProjectedRole(member, guild.id)) {
                console.log(`[PROJECTED] Skipped auto-mute for ${user.tag} (projected role)`);
            } else {
                await member.timeout(28 * 24 * 60 * 60 * 1000, 'Auto-mute: 3 warnings').catch(() => {});
                await sendActionDM(user, 'muted', '3 warnings accumulated', { tag: 'Auto-Mod', guild: guild }, '28 days');
                await saveModLog(guild, 'User muted (auto)', user, client.user, '3 warnings accumulated', '28 days');
                await db.saveDashboardLogDB(guild.id, {
                    type: 'auto_mod',
                    action: 'user_muted_auto',
                    userId: client.user.id,
                    userTag: client.user.tag,
                    targetId: user.id,
                    targetTag: user.tag,
                    reason: '3 warnings accumulated',
                    details: 'Auto-mute triggered after 3 warnings (28 days)'
                });
            }
        }
    }
    return warning.warningId;
}

async function removeWarning(guild, user, moderator, warningId) {
    return await db.removeWarningDB(guild.id, user.id, warningId);
}

async function clearWarnings(guild, user, moderator) {
    return await db.clearWarningsDB(guild.id, user.id);
}

async function getUserWarnings(userId, guildId) {
    if (!guildId) return [];
    return await db.getUserWarningsDB(guildId, userId);
}

async function saveModLog(guild, action, target, moderator, reason, duration = null) {
    try {
        const log = await db.createModLog({
            guildId: guild.id,
            guildName: guild.name,
            action: action,
            targetId: target.id,
            targetTag: target.tag,
            moderatorId: moderator.id,
            moderatorTag: moderator.tag,
            reason: reason || 'No reason provided',
            duration,
            date: new Date(),
            active: true
        });

        const config = await getGuildConfig(guild.id);
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
                    { name: 'User', value: `<@${target.id}>`, inline: true },
                    { name: 'Moderator', value: `${moderator.toString()}`, inline: true },
                    { name: 'Reason', value: reason || 'No reason provided', inline: false },
                    { name: 'Date', value: formatFullDate(new Date()), inline: true },
                    { name: 'Case ID', value: `#${log.caseId}`, inline: true }
                );
            }
            if (duration) logEmbed.addFields({ name: 'Duration', value: duration, inline: true });
            await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
        }
        return log;
    } catch (error) {
        logCrash('MODLOG_ERROR', error, { action });
        return null;
    }
}

async function formatModerationHistory(userId, guildId, username, page = 1) {
    const totalLogs = await db.ModLog.countDocuments({ guildId, targetId: userId });

    if (totalLogs === 0) {
        return `**${username}** has no modlogs.`;
    }

    const totalPages = Math.max(1, Math.ceil(totalLogs / LOGS_PER_PAGE));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const skip = (safePage - 1) * LOGS_PER_PAGE;

    const logs = await db.ModLog
        .find({ guildId, targetId: userId })
        .sort({ date: -1 })
        .skip(skip)
        .limit(LOGS_PER_PAGE)
        .lean();

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

    let output = `**Modlogs for ${username}**\n`;

    for (const log of logs) {
        const tipo = typeLabel(log.action);
        const durata = log.duration ? ` (${log.duration})` : '';
        const timestamp = Math.floor(new Date(log.date).getTime() / 1000);

        output += `\n**Case ${log.caseId}**\n`;
        output += `**Type**: ${tipo}${durata}\n`;
        output += `**Moderator**: ${log.moderatorTag} (${log.moderatorId})\n`;
        output += `**Reason**: ${log.reason} - <t:${timestamp}:f>\n`;
    }

    output += `\nPage ${safePage}/${totalPages} | Total Logs: ${totalLogs} | ${userId}`;

    return output;
}

function formatFullDate(date) {
    const timestamp = Math.floor(date.getTime() / 1000);
    return `<t:${timestamp}:F>`;
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
        const config = await getGuildConfig(member.guild.id);
        const channel = client.channels.cache.get(config.joinLeaveLogChannelId);
        if (!channel) return;
        const createdTs = Math.floor(member.user.createdAt.getTime() / 1000);
        const embed = new EmbedBuilder()
            .setTitle('New Member Joined')
            .setColor(COLORS.SUCCESS)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'User', value: member.user.toString(), inline: true },
                { name: 'User ID', value: member.user.id, inline: true },
                { name: 'Username', value: member.user.username, inline: true },
                { name: 'Account Created', value: `<t:${createdTs}:F> (<t:${createdTs}:R>)`, inline: false },
                { name: 'Member Count', value: `${member.guild.memberCount}`, inline: false }
            );
        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (error) {
        logCrash('JOIN_LOG_ERROR', error, { userId: member?.user?.id });
    }
}

async function sendLeaveLog(member) {
    try {
        const config = await getGuildConfig(member.guild.id);
        const channel = client.channels.cache.get(config.joinLeaveLogChannelId);
        if (!channel) return;

        let banned = false;
        try {
            await member.guild.bans.fetch(member.id);
            banned = true;
        } catch (e) {}

        const createdTs = Math.floor(member.user.createdAt.getTime() / 1000);
        const roles = member.roles?.cache
            ? member.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.toString()).join(' ') || 'None'
            : 'None';

        const embed = new EmbedBuilder()
            .setTitle(banned ? 'New Member Left (Banned)' : 'New Member Left')
            .setColor(COLORS.ERROR)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'User', value: member.user.toString(), inline: true },
                { name: 'User ID', value: member.user.id, inline: true },
                { name: 'Username', value: member.user.username, inline: true },
                { name: 'Account Created', value: `<t:${createdTs}:F> (<t:${createdTs}:R>)`, inline: false },
                { name: 'Member Count', value: `${member.guild.memberCount}`, inline: false },
                { name: 'Users Roles', value: roles, inline: false }
            );
        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (error) {
        logCrash('LEAVE_LOG_ERROR', error, { userId: member?.user?.id });
    }
}

async function sendWelcomeDM(member) {
    try {
        const welcomeEmbed = new EmbedBuilder()
            .setTitle('WELCOME TO PRED CORD')
            .setDescription(`Hi ${member.user.toString()}! Welcome to the official Predcord server!`)
            .setColor(COLORS.SUCCESS)
            .setThumbnail(THUMBNAIL_URL)
            .setImage(FOOTER_IMAGE_URL)
            .addFields(
                { name: 'RULES', value: 'Read the rules in the rules channel to avoid sanctions.', inline: false },
                { name: 'TICKETS', value: 'Need help? Open a ticket in the support section.', inline: false },
                { name: 'FOLLOW US ON SOCIAL', value: `${EMOJIS.twitch} [Twitch](${SOCIAL_LINKS.twitch})\n${EMOJIS.youtube} [YouTube](${SOCIAL_LINKS.youtube})\n${EMOJIS.tiktok} [TikTok](${SOCIAL_LINKS.tiktok})\n${EMOJIS.twitter} [Twitter/X](${SOCIAL_LINKS.twitter})\n${EMOJIS.instagram} [Instagram](${SOCIAL_LINKS.instagram})\n${EMOJIS.discord} [Discord Community](${SOCIAL_LINKS.discord})`, inline: false }
            );
        await member.send({ embeds: [welcomeEmbed] }).catch(() => console.log(`DM failed: ${member.user.tag}`));
    } catch (error) {
        logCrash('WELCOME_DM_ERROR', error, { userId: member?.user?.id });
    }
}

async function sendSocialEmbed(channel) {
    try {
        const socialEmbed = new EmbedBuilder()
            .setTitle('FOLLOW US ON SOCIAL')
            .setDescription('Join the community and follow us on all official channels to never miss anything!')
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

async function generateTicketTranscript(channel, closer, ticketMeta = {}) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const sorted = Array.from(messages.values()).reverse();

        const messagesData = sorted.map(msg => ({
            authorId: msg.author.id,
            authorTag: msg.author.tag,
            authorUsername: msg.author.username,
            authorAvatar: msg.author.displayAvatarURL({ dynamic: true, size: 64 }),
            bot: msg.author.bot,
            content: msg.content || '',
            attachments: msg.attachments.map(a => ({
                url: a.url,
                name: a.name,
                contentType: a.contentType
            })),
            embeds: msg.embeds.map(e => ({
                title: e.title || null,
                description: e.description || null,
                color: e.color || null,
                image: e.image?.url || null,
                thumbnail: e.thumbnail?.url || null,
                fields: (e.fields || []).map(f => ({ name: f.name, value: f.value, inline: f.inline }))
            })),
            timestamp: msg.createdAt
        }));

        const transcriptDoc = await db.saveTranscriptDB({
            guildId: channel.guild.id,
            channelId: channel.id,
            channelName: channel.name,
            ticketType: ticketMeta.ticketType || 'support',
            ticketOwnerId: ticketMeta.ticketOwnerId || null,
            ticketOwnerTag: ticketMeta.ticketOwnerTag || null,
            createdBy: ticketMeta.createdBy || null,
            createdByTag: ticketMeta.createdByTag || null,
            claimedBy: ticketMeta.claimedBy || null,
            claimedByTag: ticketMeta.claimedByTag || null,
            closedBy: closer.id,
            closedByTag: closer.tag,
            messages: messagesData,
            createdAt: channel.createdAt || new Date(),
            closedAt: new Date()
        });

        if (!transcriptDoc) {
            console.error('[TRANSCRIPT] Failed to save transcript to DB');
            return null;
        }

        const config = await getGuildConfig(channel.guild.id);
        const logChannelId = config.transcriptsChannelId;
        const logChannel = logChannelId ? client.channels.cache.get(logChannelId) : null;

        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('Ticket Log')
                .setColor(BLACK)
                .setThumbnail(THUMBNAIL_URL)
                .addFields(
                    { name: 'Created By', value: transcriptDoc.createdBy ? `<@${transcriptDoc.createdBy}>` : 'Unknown', inline: true },
                    { name: 'Claimed By', value: transcriptDoc.claimedBy ? `<@${transcriptDoc.claimedBy}>` : 'Not claimed', inline: true },
                    { name: 'Closed By', value: closer ? `<@${closer.id}>` : 'Unknown', inline: true },
                    { name: 'Ticket', value: `#${channel.name}`, inline: true },
                    { name: 'Date', value: formatFullDate(new Date()), inline: true }
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Transcript')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`${process.env.DASHBOARD_URL || 'https://predcord-dashboard.onrender.com'}/transcript/${transcriptDoc._id}`)
            );

            await logChannel.send({ embeds: [embed], components: [row] }).catch(err => {
                console.error('[TICKET-LOG] send error:', err.message);
            });
        } else {
            console.warn('[TICKET-LOG] No transcript channel configured for guild', channel.guild.id);
        }

        console.log(`[TRANSCRIPT] Saved transcript ${transcriptDoc._id} for ${channel.name}`);
        return transcriptDoc._id.toString();
    } catch (error) {
        logCrash('TRANSCRIPT_ERROR', error, { channel: channel?.name });
        return null;
    }
}

async function canUsePageCommand(member, guildId) {
    try {
        const mdCmd = await db.CustomCommand.findOne({ guildId, name: 'md' }).lean();
        if (!mdCmd) {
            return (await isAdminSafe(member)) || (await isModeratorSafe(member));
        }
        if (Array.isArray(mdCmd.allowedRoles)) {
            if (mdCmd.allowedRoles.length === 0) return false;
            return mdCmd.allowedRoles.some(roleId => member.roles?.cache?.has(roleId));
        }
        const perm = mdCmd.permission || 'everyone';
        if (perm === 'admin') return await isAdminSafe(member);
        if (perm === 'mod') return await hasModPerms(member);
        if (perm === 'staff') return await isStaffSafe(member);
        return true;
    } catch {
        return (await isAdminSafe(member)) || (await isModeratorSafe(member));
    }
}

async function sendSupportPanel(channel) {
    const embed = new EmbedBuilder()
        .setTitle('Support Tickets')
        .setDescription(
            'Need help or want to report a player? Our support team is here to assist you. ' +
            'Click one of the buttons below to create a ticket.'
        )
        .setColor('#5865F2');

    const buttons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('support_ticket')
                .setLabel('Support')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('report_player')
                .setLabel('Report Player')
                .setStyle(ButtonStyle.Primary)
        );

    await channel.send({
        embeds: [embed],
        components: [buttons]
    });
}

client.once('clientReady', async () => {

    console.log(`Bot PredCord connected as ${client.user.tag}`);

    const connected = await db.connectDB();
    if (!connected) {
        console.error('[DB] Cannot connect to MongoDB. Check MONGODB_URI in .env');
        process.exit(1);
    }

    console.log('[DB] Database ready');

    global.PredCord = {
        client,
        getGuildConfig,
        loadCustomCommands: async (guildId) => await db.loadCustomCommandsDB(guildId),
        saveCustomCommands: async (guildId, name, data) => await db.saveCustomCommandDB(guildId, name, data),
        deleteCustomCommand: async (guildId, name) => await db.deleteCustomCommandDB(guildId, name),
        isAdminSafe,
        isModeratorSafe,
        isStaffSafe,
        hasModPerms,
        COLORS,
        THUMBNAIL_URL,
        EmbedBuilder,
        getUserWarnings,
        addWarning,
        removeWarning,
        clearWarnings,
        saveModLog,
        formatModerationHistory,
        getProjectedRolesDB: async (guildId) => await db.getProjectedRolesDB(guildId),
        saveDashboardLogDB: async (guildId, data) => await db.saveDashboardLogDB(guildId, data),
        db
    };
    console.log('[DASHBOARD] global.PredCord API exposed');

    try {
        const commands = [
            new SlashCommandBuilder()
                .setName('panel')
                .setDescription('Send the ticket panel in this channel')
                .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
                .toJSON()
        ];

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

        const GUILD_ID = process.env.MAIN_GUILD_ID;

        if (GUILD_ID) {
            console.log('[SLASH] Registering commands on guild', GUILD_ID);
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, GUILD_ID),
                { body: commands }
            );
            console.log('[SLASH] ✅ Commands registered on guild (immediate)');
        } else {
            console.log('[SLASH] MAIN_GUILD_ID not configured, registering globally...');
            await rest.put(
                Routes.applicationCommands(client.user.id),
                { body: commands }
            );
            console.log('[SLASH] ✅ Commands registered globally (may take up to 1 hour)');
        }
    } catch (err) {
        console.error('[SLASH] ❌ Registration error:', err);
    }
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

client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;
        if (!message.guild) return;
        if (!message.content) return;

        const firstChar = message.content.charAt(0);

        if (/^[a-zA-Z0-9]/.test(firstChar)) return;

        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        const customCmds = await db.loadCustomCommandsDB(message.guild.id);

        if (customCmds && customCmds[command]) {
            const cmdData = customCmds[command];
            const cmdPrefix = cmdData.prefix || '*';

            if (cmdPrefix === firstChar) {
                const hasPermission = checkCustomCommandPermission(cmdData, message.member);
                if (hasPermission) {
                    const cooldown = await db.getCommandCooldownDB(message.author.id, message.guild.id, `custom_${command}`);
                    if (cooldown) {
                        const remaining = Math.ceil((new Date(cooldown.expiresAt).getTime() - Date.now()) / 1000);
                        const embed = new EmbedBuilder()
                            .setDescription(`Wait **${remaining}s** before using this command again.`)
                            .setColor(COLORS.WARNING);
                        const msg = await message.channel.send({ embeds: [embed] });
                        setTimeout(() => msg.delete().catch(() => {}), 3000);
                        await message.delete().catch(() => {});
                        return;
                    }
                    await db.setCommandCooldownDB(message.author.id, message.guild.id, `custom_${command}`, COMMAND_COOLDOWN_SECONDS);

                    await db.saveDashboardLogDB(message.guild.id, {
                        type: 'command',
                        action: 'custom_command_used',
                        userId: message.author.id,
                        userTag: message.author.tag,
                        details: `Command: ${cmdPrefix}${command}`,
                        channelId: message.channel.id
                    });

                    await handleCustomCommand(message, command, args, cmdData);
                    return;
                } else {
                    const embed = new EmbedBuilder()
                        .setDescription('You don\'t have permission to use this command.')
                        .setColor(COLORS.ERROR);
                    const msg = await message.channel.send({ embeds: [embed] });
                    setTimeout(() => msg.delete().catch(() => {}), 4000);
                    await message.delete().catch(() => {});
                    return;
                }
            }
        }

        if (firstChar === NATIVE_PREFIX) {
            const cooldown = await db.getCommandCooldownDB(message.author.id, message.guild.id, `native_${command}`);
            if (cooldown) {
                const remaining = Math.ceil((new Date(cooldown.expiresAt).getTime() - Date.now()) / 1000);
                const embed = new EmbedBuilder()
                    .setDescription(`Wait **${remaining}s** before using this command again.`)
                    .setColor(COLORS.WARNING);
                const msg = await message.channel.send({ embeds: [embed] });
                setTimeout(() => msg.delete().catch(() => {}), 3000);
                await message.delete().catch(() => {});
                return;
            }
            await db.setCommandCooldownDB(message.author.id, message.guild.id, `native_${command}`, COMMAND_COOLDOWN_SECONDS);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'command',
                action: 'native_command_used',
                userId: message.author.id,
                userTag: message.author.tag,
                details: `Command: ${NATIVE_PREFIX}${command}`,
                channelId: message.channel.id
            });

            await handleNativeCommand(message, command, args);
            return;
        }

    } catch (error) {
        logCrash('MESSAGE_CREATE_HANDLER', error, { content: message?.content?.slice(0, 50) });
    }
});

async function handleNativeCommand(message, command, args) {
    if (command === 'page') {
        const canUse = await canUsePageCommand(message.member, message.guild.id);
        if (!canUse) { await message.delete().catch(() => {}); return; }

        const input = args[0];
        const pageArg = parseInt(args[1]);

        if (!input) {
            const embed = new EmbedBuilder().setDescription('Usage: `*page {userid} {page}`').setColor(COLORS.ERROR);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        if (isNaN(pageArg) || pageArg < 1) {
            const embed = new EmbedBuilder().setDescription('Specify a valid page number (>= 1).').setColor(COLORS.ERROR);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        let userId = null;
        const mentionMatch = input.match(/^<@!?(\d+)>$/);
        if (mentionMatch) userId = mentionMatch[1];
        else if (/^\d+$/.test(input)) userId = input;

        if (!userId) {
            const embed = new EmbedBuilder().setDescription('Invalid user ID. Use a mention or an ID.').setColor(COLORS.ERROR);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        let username = `Unknown (${userId})`;
        try {
            const user = await client.users.fetch(userId);
            username = user.username;
        } catch {}

        const totalLogs = await db.ModLog.countDocuments({ guildId: message.guild.id, targetId: userId });
        if (totalLogs === 0) {
            const embed = new EmbedBuilder().setDescription(`**${username}** has no modlogs.`).setColor(COLORS.INFO);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        const totalPages = Math.max(1, Math.ceil(totalLogs / LOGS_PER_PAGE));
        if (pageArg > totalPages) {
            const embed = new EmbedBuilder().setDescription(`Invalid page. This user only has ${totalPages} pages.`).setColor(COLORS.ERROR);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        const text = await formatModerationHistory(userId, message.guild.id, username, pageArg);
        const embed = new EmbedBuilder().setDescription(text).setColor(COLORS.INFO);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'help') {
        if (!(await canUseBaseCommands(message.member))) {
            await message.delete().catch(() => {});
            return;
        }
        const embed = new EmbedBuilder()
            .setTitle('PredCord Commands')
            .setDescription('Commands available based on your role:')
            .setColor(COLORS.INFO)
            .setThumbnail(THUMBNAIL_URL)
            .addFields(
                { name: 'Admin Only', value: '`/panel` - Send ticket panel', inline: false },
                { name: 'Mod & Admin', value: '`*av [user]` - Show avatar\n`*w [user]` - User info\n`*server` - Server info\n`*social` - Social links\n`*page {userid} {page}` - Paginate modlogs\n`*help` - This message', inline: false },
                { name: 'Warnings (Mod+)', value: '`*warnings @user/ID`\n`*clearwarns @user/ID`', inline: false },
                { name: 'Bans (Mod+)', value: '`*ban @user/ID [reason]`\n`*unban ID`\n`*kick @user/ID [reason]`\n`*mute @user/ID [minutes] [reason]`\n`*unmute @user/ID`', inline: false }
            );
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'av') {
        if (!(await canUseBaseCommands(message.member))) {
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
        if (!(await canUseBaseCommands(message.member))) {
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
        if (!(await canUseBaseCommands(message.member))) {
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
        if (!(await canUseBaseCommands(message.member))) {
            await message.delete().catch(() => {});
            return;
        }
        await sendSocialEmbed(message.channel);
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'warnings') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
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
        const userWarnings = await getUserWarnings(user.id, message.guild.id);
        if (userWarnings.length === 0) {
            const embed = new EmbedBuilder().setDescription(`${user.toString()} has no warnings.`).setColor(COLORS.SUCCESS).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
        } else {
            let warningsList = '';
            for (const warn of userWarnings) {
                const ts = Math.floor(new Date(warn.date).getTime() / 1000);
                warningsList += `**#${warn.warningId}** - ${warn.reason}\n*By ${warn.moderatorTag} - <t:${ts}:R>*\n\n`;
            }
            const embed = new EmbedBuilder().setTitle(`Warnings for ${user.tag}`).setDescription(warningsList).setColor(COLORS.WARNING).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'clearwarns') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
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

    if (command === 'tickets') {
        if (!(await hasStaffPermission(message.member))) return;
        const embed = new EmbedBuilder().setTitle('Ticket Statistics').setDescription('Feature coming soon!').setColor(COLORS.INFO).setThumbnail(THUMBNAIL_URL);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'ban') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
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
        if (await projectedRoleBlock(message, member)) return;
        const reason = args.slice(1).join(' ') || 'No reason provided';

        try {
            if (member) {
                if (!member.bannable) {
                    const embed = new EmbedBuilder().setDescription('I cant moderate this user.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                await member.ban({ reason });
            } else {
                await message.guild.bans.create(user.id, { reason });
            }

            await sendActionDM(user, 'banned', reason, { tag: message.author.tag, guild: message.guild });
            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been banned for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User banned', { id: user.id, tag: user.tag }, message.author, reason);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_banned',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                channelId: message.channel.id
            });
        } catch (error) {
            const embed = new EmbedBuilder().setDescription('Error during ban: ' + error.message).setColor(COLORS.ERROR);
            await message.channel.send({ embeds: [embed] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'unban') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
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
                const embed = new EmbedBuilder().setDescription('This user is not banned.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            await message.guild.members.unban(userId);
            await db.removePendingBan(message.guild.id, userId);
            const embed = new EmbedBuilder()
                .setDescription(`**${bannedUser.user.username}** (${bannedUser.user.id}) has been unbanned for the reason **Unbanned**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User unbanned', { id: userId, tag: bannedUser.user.tag }, message.author, 'Unbanned');

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_unbanned',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: userId,
                targetTag: bannedUser.user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: 'Unbanned',
                channelId: message.channel.id
            });
        } catch (error) {
            const embed = new EmbedBuilder().setDescription('Error during unban.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'kick') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
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
        if (await projectedRoleBlock(message, member)) return;
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
            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been kicked for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User kicked', user, message.author, reason);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_kicked',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                channelId: message.channel.id
            });
        } catch (error) {
            const embed = new EmbedBuilder().setDescription('Error during kick.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'mute') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
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
        if (await projectedRoleBlock(message, member)) return;
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
                .setDescription(`**${user.username}** (${user.id}) has been muted for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User muted', user, message.author, reason, `${duration} minutes`);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_muted',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                details: `${duration} minutes`,
                channelId: message.channel.id
            });
        } catch (error) {
            const embed = new EmbedBuilder().setDescription('Error during mute.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'unmute') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
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
            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been unmuted for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User unmuted', user, message.author, reason);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_unmuted',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                channelId: message.channel.id
            });
        } catch (error) {
            const embed = new EmbedBuilder().setDescription('Error during unmute.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'purge') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
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

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'messages_purged',
                userId: message.author.id,
                userTag: message.author.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: `${deleted.size} messages deleted`,
                channelId: message.channel.id
            });
        } catch (error) {
            const embed = new EmbedBuilder().setDescription('Error during purge. Cannot delete messages older than 14 days.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            const errorMsg = await message.channel.send({ embeds: [embed] });
            setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
        }
        return;
    }
}

async function handleCustomCommand(message, command, args, cmdData) {
    const cmdType = cmdData.type || 'text';
    const cmdThumbnail = cmdData.thumbnail && isValidUrl(cmdData.thumbnail) ? cmdData.thumbnail : null;

    if (cmdType === 'ban') {
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription(`Usage: \`${cmdData.prefix || '*'}${command} @user reason\``).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
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
        if (await projectedRoleBlock(message, member)) return;
        let reason = args.slice(1).join(' ');
        if (!reason) {
            reason = (cmdData.response || 'No reason provided')
                .replace(/{user}/g, user.toString())
                .replace(/{username}/g, user.username)
                .replace(/{server}/g, message.guild.name)
                .replace(/{membercount}/g, message.guild.memberCount)
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
            reason = applyPositionalArgs(reason, args);
        } else {
            reason = reason
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
        }
        reason = applyHammertime(reason);

        const durationDays = cmdData.duration ? parseInt(cmdData.duration) : null;
        const isTemporary = durationDays && durationDays > 0;

        try {
            if (member) {
                if (!member.bannable) {
                    const embed = new EmbedBuilder().setDescription('I cannot ban this user.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                await member.ban({ reason });
            } else {
                await message.guild.bans.create(user.id, { reason });
            }

            if (isTemporary) {
                const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
                await db.addPendingBan({
                    guildId: message.guild.id,
                    userId: user.id,
                    userTag: user.tag,
                    moderatorId: message.author.id,
                    moderatorTag: message.author.tag,
                    reason: reason,
                    banDate: new Date(),
                    expiresAt: expiresAt
                });
            }

            await sendActionDM(user, 'banned', reason, { tag: message.author.tag, guild: message.guild });
            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been banned for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User banned', { id: user.id, tag: user.tag }, message.author, reason, isTemporary ? `${durationDays} days` : null);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_banned',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                details: `Custom command: ${cmdData.prefix || '*'}${command}${isTemporary ? ` (${durationDays} days)` : ''}`,
                channelId: message.channel.id
            });
        } catch (err) {
            await message.channel.send({ embeds: [new EmbedBuilder().setDescription('Error during ban: ' + err.message).setColor(COLORS.ERROR)] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (cmdType === 'kick') {
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription(`Usage: \`${cmdData.prefix || '*'}${command} @user reason\``).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
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
        if (await projectedRoleBlock(message, member)) return;
        let reason = args.slice(1).join(' ');
        if (!reason) {
            reason = (cmdData.response || 'No reason provided')
                .replace(/{user}/g, user.toString())
                .replace(/{username}/g, user.username)
                .replace(/{server}/g, message.guild.name)
                .replace(/{membercount}/g, message.guild.memberCount)
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
            reason = applyPositionalArgs(reason, args);
        } else {
            reason = reason
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
        }
        reason = applyHammertime(reason);
        if (!member || !member.kickable) {
            const embed = new EmbedBuilder().setDescription('I cannot kick this user.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        try {
            await member.kick(reason);
            await sendActionDM(user, 'kicked', reason, { tag: message.author.tag, guild: message.guild });
            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been kicked for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User kicked', user, message.author, reason);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_kicked',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                details: `Custom command: ${cmdData.prefix || '*'}${command}`,
                channelId: message.channel.id
            });
        } catch (err) {
            await message.channel.send({ embeds: [new EmbedBuilder().setDescription('Error during kick.').setColor(COLORS.ERROR)] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (cmdType === 'mute') {
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription(`Usage: \`${cmdData.prefix || '*'}${command} @user reason\``).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
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
        if (await projectedRoleBlock(message, member)) return;

        let durationDays = cmdData.duration ? parseInt(cmdData.duration) : 28;
        if (isNaN(durationDays) || durationDays < 1) durationDays = 28;
        if (durationDays > 28) durationDays = 28;

        const durationMs = durationDays * 24 * 60 * 60 * 1000;

        let reason = args.slice(1).join(' ');
        if (!reason) {
            reason = (cmdData.response || 'No reason provided')
                .replace(/{user}/g, user.toString())
                .replace(/{username}/g, user.username)
                .replace(/{server}/g, message.guild.name)
                .replace(/{membercount}/g, message.guild.memberCount)
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
            reason = applyPositionalArgs(reason, args);
        } else {
            reason = reason
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
        }
        reason = applyHammertime(reason);

        if (!member || !member.moderatable) {
            const embed = new EmbedBuilder().setDescription('I cannot mute this user.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        try {
            await member.timeout(durationMs, reason);
            const durationText = `${durationDays} day${durationDays === 1 ? '' : 's'}`;
            await sendActionDM(user, 'muted', reason, { tag: message.author.tag, guild: message.guild }, durationText);
            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been muted for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User muted', user, message.author, reason, durationText);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_muted',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                details: `Custom command: ${cmdData.prefix || '*'}${command} (${durationText})`,
                channelId: message.channel.id
            });
        } catch (err) {
            await message.channel.send({ embeds: [new EmbedBuilder().setDescription('Error during mute.').setColor(COLORS.ERROR)] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (cmdType === 'warn') {
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription(`Usage: \`${cmdData.prefix || '*'}${command} @user reason\``).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
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
        if (await projectedRoleBlock(message, member)) return;
        let reason = args.slice(1).join(' ');
        if (!reason) {
            reason = (cmdData.response || 'No reason provided')
                .replace(/{user}/g, user.toString())
                .replace(/{username}/g, user.username)
                .replace(/{server}/g, message.guild.name)
                .replace(/{membercount}/g, message.guild.memberCount)
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
            reason = applyPositionalArgs(reason, args);
        } else {
            reason = reason
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
        }
        reason = applyHammertime(reason);
        try {
            await addWarning(message.guild, user, message.author, reason);
            await sendActionDM(user, 'warned', reason, { tag: message.author.tag, guild: message.guild });
            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been warned for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User warned', user, message.author, reason);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_warned',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                details: `Custom command: ${cmdData.prefix || '*'}${command}`,
                channelId: message.channel.id
            });
        } catch (err) {
            await message.channel.send({ embeds: [new EmbedBuilder().setDescription('Error during warn.').setColor(COLORS.ERROR)] });
        }
        await message.delete().catch(() => {});
        return;
    }

    const targetInput = args[0];
    let mdTarget = message.mentions.users.first();
    if (!mdTarget && targetInput && /^\d+$/.test(targetInput)) {
        try {
            const fetched = await message.guild.members.fetch(targetInput);
            mdTarget = fetched.user;
        } catch {
            try {
                mdTarget = await client.users.fetch(targetInput);
            } catch { mdTarget = null; }
        }
    }
    if (!mdTarget) mdTarget = message.author;

    const replyText = await substituteAll(cmdData.response || '', message, mdTarget, args);

    const cmdImage = cmdData.image && isValidUrl(cmdData.image) ? cmdData.image : null;

    if (cmdType === 'embed') {
        const cmdTitle = await substituteAll(cmdData.title || '', message, mdTarget, args);
        const embed = new EmbedBuilder()
            .setColor(typeof cmdData.color === 'number' ? cmdData.color : COLORS.INFO);
        if (replyText.trim()) embed.setDescription(replyText);
        if (cmdTitle) embed.setTitle(cmdTitle);
        if (cmdThumbnail) embed.setThumbnail(cmdThumbnail);
        if (cmdImage) embed.setImage(cmdImage);

        const embeds = [embed];

        if (Array.isArray(cmdData.extraEmbeds)) {
            for (const extra of cmdData.extraEmbeds.slice(0, 9)) {
                const extraText = await substituteAll(extra.response || '', message, mdTarget, args);
                const extraTitle = await substituteAll(extra.title || '', message, mdTarget, args);

                const extraEmbed = new EmbedBuilder()
                    .setColor(typeof extra.color === 'number' ? extra.color : COLORS.INFO);
                if (extraText.trim()) extraEmbed.setDescription(extraText);
                if (extraTitle) extraEmbed.setTitle(extraTitle);
                if (extra.thumbnail && isValidUrl(extra.thumbnail)) extraEmbed.setThumbnail(extra.thumbnail);
                if (extra.image && isValidUrl(extra.image)) extraEmbed.setImage(extra.image);
                embeds.push(extraEmbed);
            }
        }

        await message.channel.send({ embeds }).catch(err => console.error('[CUSTOM-CMD] send failed:', err.message));
    } else if (cmdImage) {
        const embed = new EmbedBuilder().setImage(cmdImage);
        if (replyText.trim()) embed.setDescription(replyText);
        await message.channel.send({ embeds: [embed] }).catch(err => console.error('[CUSTOM-CMD] send failed:', err.message));
    } else {
        await message.channel.send(replyText.trim() ? replyText : '​').catch(err => console.error('[CUSTOM-CMD] send failed:', err.message));
    }

    if (cmdData.deleteCommand) await message.delete().catch(() => {});
}

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'panel') {
                if (!(await isAdminSafe(interaction.member))) {
                    return interaction.reply({ content: 'You do not have permission to use this command.', flags: 64 });
                }

                await sendSupportPanel(interaction.channel);

                await interaction.reply({ content: 'Ticket Panel Sent', flags: 64 });
                return;
            }
            return;
        }

        if (interaction.isButton() && interaction.customId === 'open_ticket_panel') {
            await sendSupportPanel(interaction.channel);
            await interaction.reply({ content: 'Ticket Panel Sent', flags: 64 });
            return;
        }

        if (interaction.isButton() && interaction.customId === 'support_ticket') {
            const modal = new ModalBuilder()
                .setCustomId('support_modal')
                .setTitle('Support');

            const supportType = new RadioGroupBuilder()
                .setCustomId('support_type')
                .setRequired(true)
                .addOptions(
                    new RadioGroupOptionBuilder()
                        .setLabel('Modmail')
                        .setDescription('Contact Our staff')
                        .setValue('modmail'),
                    new RadioGroupOptionBuilder()
                        .setLabel('Application Issue')
                        .setDescription('Having an issue with your application')
                        .setValue('application_issue')
                );

            const supportMessage = new TextInputBuilder()
                .setCustomId('support_message')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Tell us how we can help...')
                .setRequired(true)
                .setMaxLength(1000);

            modal.addLabelComponents(
                new LabelBuilder()
                    .setLabel('What type of support do you need?')
                    .setRadioGroupComponent(supportType),
                new LabelBuilder()
                    .setLabel('How can we help you?')
                    .setTextInputComponent(supportMessage)
            );

            await interaction.showModal(modal);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'report_player') {
            const modal = new ModalBuilder()
                .setCustomId('report_player_modal')
                .setTitle('Report Player');

            const userSelect = new UserSelectMenuBuilder()
                .setCustomId('reported_user')
                .setPlaceholder('Choose a player...')
                .setMinValues(1)
                .setMaxValues(1)
                .setRequired(true);

            const evidenceProof = new TextInputBuilder()
                .setCustomId('evidence_proof')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Paste a link to your evidence...')
                .setRequired(false)
                .setMaxLength(500);

            const moreInformation = new TextInputBuilder()
                .setCustomId('more_information')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Provide any additional information...')
                .setRequired(false)
                .setMaxLength(1000);

            modal.addLabelComponents(
                new LabelBuilder()
                    .setLabel('Choose Player')
                    .setDescription('Select the player you want to report.')
                    .setUserSelectMenuComponent(userSelect),
                new LabelBuilder()
                    .setLabel('Evidence Proof')
                    .setTextInputComponent(evidenceProof),
                new LabelBuilder()
                    .setLabel('Do you want add more information?')
                    .setTextInputComponent(moreInformation)
            );

            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'support_modal') {
            const supportType = interaction.fields.getRadioGroup('support_type', true);
            const message = interaction.fields.getTextInputValue('support_message');

            const config = await getGuildConfig(interaction.guild.id);

            if (!config.supportCategoryId || !config.staffRoleId) {
                return interaction.reply({
                    content: 'Ticket System is currently off, please contact an administrator.',
                    flags: 64
                });
            }

            const category = interaction.guild.channels.cache.get(config.supportCategoryId);
            if (!category) {
                return interaction.reply({
                    content: 'Ticket Category issue. Please contact an administrator.',
                    flags: 64
                });
            }

            const typeName = supportType === 'modmail' ? 'Modmail' : 'Application Issue';

            const sanitizedUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
            const ticketName = `ticket-${sanitizedUsername}`;

            const staffRole = interaction.guild.roles.cache.get(config.staffRoleId);
            const adminRole = config.adminRoleId ? interaction.guild.roles.cache.get(config.adminRoleId) : null;

            const permissionOverwrites = [
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]
                }
            ];

            if (staffRole) {
                permissionOverwrites.push({
                    id: staffRole.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.UseExternalEmojis,
                        PermissionsBitField.Flags.AddReactions,
                        PermissionsBitField.Flags.UseApplicationCommands,
                        PermissionsBitField.Flags.UseExternalStickers
                    ]
                });
            }

            if (adminRole) {
                permissionOverwrites.push({
                    id: adminRole.id,
                    allow: [
                        PermissionsBitField.Flags.ManageChannels,
                        PermissionsBitField.Flags.ManageRoles,
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ManageMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.UseExternalEmojis,
                        PermissionsBitField.Flags.AddReactions,
                        PermissionsBitField.Flags.UseApplicationCommands,
                        PermissionsBitField.Flags.UseExternalStickers
                    ]
                });
            }

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
                    return interaction.reply({
                        content: 'Error while creating your ticket, please contact an administrator.',
                        flags: 64
                    });
                }
            }

            await ticketChannel.setTopic(interaction.user.id).catch(() => {});

            const embed = new EmbedBuilder()
                .setTitle(`${interaction.user.username} support ticket`)
                .setDescription(`Hey ${interaction.user.toString()}! Thank you for creating a ticket. A staff member will assist you shortly.`)
                .addFields(
                    { name: 'Ticket Category', value: typeName, inline: false },
                    { name: 'Additional Information', value: message, inline: false }
                )
                .setColor(BLACK);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('Claim Ticket')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({
                content: `${interaction.user.toString()}${staffRole ? ` <@&${staffRole.id}>` : ''}`,
                embeds: [embed],
                components: [row]
            });

            await interaction.reply({
                content: `Your ticket has been created - Ticket Channel: ${ticketChannel}`,
                flags: 64
            });

            await db.saveDashboardLogDB(interaction.guild.id, {
                type: 'ticket',
                action: 'ticket_created',
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                details: `Support ticket (${typeName}) created in ${ticketChannel.name}`,
                channelId: ticketChannel.id,
                extra: { channelName: ticketChannel.name, ticketType: typeName }
            });
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'report_player_modal') {
            const selectedUsers = interaction.fields.getSelectedUsers('reported_user', true);
            const reportedUser = selectedUsers.first();

            if (!reportedUser || reportedUser.bot) {
                await interaction.reply({
                    content: 'Invalid user selected. You cant report a bot.',
                    flags: 64
                });
                return;
            }

            const evidence = interaction.fields.getTextInputValue('evidence_proof');
            const moreInformation = interaction.fields.getTextInputValue('more_information');

            const config = await getGuildConfig(interaction.guild.id);

            if (!config.supportCategoryId || !config.staffRoleId) {
                return interaction.reply({
                    content: 'Ticket System is currently off, please contact an administrator.',
                    flags: 64
                });
            }

            const category = interaction.guild.channels.cache.get(config.supportCategoryId);
            if (!category) {
                return interaction.reply({
                    content: 'Ticket Category issue. Please contact an administrator.',
                    flags: 64
                });
            }

            const sanitizedUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
            const ticketName = `report-${sanitizedUsername}`;

            const staffRole = interaction.guild.roles.cache.get(config.staffRoleId);
            const adminRole = config.adminRoleId ? interaction.guild.roles.cache.get(config.adminRoleId) : null;

            const permissionOverwrites = [
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]
                }
            ];

            if (staffRole) {
                permissionOverwrites.push({
                    id: staffRole.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.UseExternalEmojis,
                        PermissionsBitField.Flags.AddReactions,
                        PermissionsBitField.Flags.UseApplicationCommands,
                        PermissionsBitField.Flags.UseExternalStickers
                    ]
                });
            }

            if (adminRole) {
                permissionOverwrites.push({
                    id: adminRole.id,
                    allow: [
                        PermissionsBitField.Flags.ManageChannels,
                        PermissionsBitField.Flags.ManageRoles,
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ManageMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.UseExternalEmojis,
                        PermissionsBitField.Flags.AddReactions,
                        PermissionsBitField.Flags.UseApplicationCommands,
                        PermissionsBitField.Flags.UseExternalStickers
                    ]
                });
            }

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
                    return interaction.reply({
                        content: 'Error while creating your ticket, please contact an administrator.',
                        flags: 64
                    });
                }
            }

            await ticketChannel.setTopic(interaction.user.id).catch(() => {});

            const evidenceText = evidence ? evidence : 'No evidence provided';
            const moreInfoText = moreInformation ? moreInformation : 'None';

            const embed = new EmbedBuilder()
                .setTitle(`${interaction.user.username} report ticket`)
                .setDescription(`Hey ${interaction.user.toString()}! Thank you for creating a ticket. A staff member will assist you shortly.`)
                .addFields(
                    { name: 'Reported Player', value: `${reportedUser.tag} (${reportedUser.id})`, inline: false },
                    { name: 'Evidence Proof', value: evidenceText, inline: false },
                    { name: 'Additional Information', value: moreInfoText, inline: false }
                )
                .setColor(BLACK);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('Claim Ticket')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({
                content: `${interaction.user.toString()}${staffRole ? ` <@&${staffRole.id}>` : ''}`,
                embeds: [embed],
                components: [row]
            });

            await interaction.reply({
                content: `Your ticket has been created - Ticket Channel: ${ticketChannel}`,
                flags: 64
            });

            await db.saveDashboardLogDB(interaction.guild.id, {
                type: 'ticket',
                action: 'report_created',
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                targetId: reportedUser.id,
                targetTag: reportedUser.tag,
                details: `Report ticket created in ${ticketChannel.name}`,
                channelId: ticketChannel.id
            });
            return;
        }

        if (interaction.isButton() && interaction.customId === 'claim_ticket') {
            await interaction.deferUpdate();

            const config = await getGuildConfig(interaction.guild.id);
            const staffRole = config.staffRoleId ? interaction.guild.roles.cache.get(config.staffRoleId) : null;
            const adminRole = config.adminRoleId ? interaction.guild.roles.cache.get(config.adminRoleId) : null;

            const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);
            const isAdmin = adminRole && interaction.member.roles.cache.has(adminRole.id);

            if (!isStaff && !isAdmin) {
                return interaction.followUp({
                    content: 'Missing Permissions',
                    flags: 64
                });
            }

            const ticketOwnerId = interaction.channel.topic;
            if (!ticketOwnerId) {
                return interaction.followUp({ content: 'Error', flags: 64 });
            }

            const newOverwrites = [
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: ticketOwnerId,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.UseExternalEmojis,
                        PermissionsBitField.Flags.AddReactions,
                        PermissionsBitField.Flags.UseApplicationCommands,
                        PermissionsBitField.Flags.UseExternalStickers
                    ]
                }
            ];

            if (adminRole) {
                newOverwrites.push({
                    id: adminRole.id,
                    allow: [
                        PermissionsBitField.Flags.ManageChannels,
                        PermissionsBitField.Flags.ManageRoles,
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ManageMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.UseExternalEmojis,
                        PermissionsBitField.Flags.AddReactions,
                        PermissionsBitField.Flags.UseApplicationCommands,
                        PermissionsBitField.Flags.UseExternalStickers
                    ]
                });
            }

            await interaction.channel.permissionOverwrites.set(newOverwrites);

            try {
                const messages = await interaction.channel.messages.fetch({ limit: 20 });
                const botMessage = messages.find(m =>
                    m.author.id === client.user.id &&
                    m.components.length > 0 &&
                    m.embeds.length > 0
                );
                if (botMessage) {
                    await botMessage.edit({ components: [] });
                }
            } catch (error) {
                console.error('[CLAIM] Error removing buttons:', error);
            }

            const embed = new EmbedBuilder()
                .setTitle('Ticket Claimed')
                .setDescription(`This ticket has been claimed by ${interaction.user.toString()}, he will assist you with your request.`)
                .setColor(GOLD);

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.channel.send({ embeds: [embed], components: [closeRow] });

            ticketClaims.set(interaction.channel.id, {
                claimedBy: interaction.user.id,
                claimedByTag: interaction.user.tag
            });

            await db.saveDashboardLogDB(interaction.guild.id, {
                type: 'ticket',
                action: 'ticket_claimed',
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                details: `Ticket ${interaction.channel.name} claimed`,
                channelId: interaction.channel.id,
                extra: { channelName: interaction.channel.name }
            });
            return;
        }

            if (interaction.isButton() && interaction.customId === 'close_ticket') {
                await interaction.deferUpdate();
            
                const config = await getGuildConfig(interaction.guild.id);
                const staffRole = config.staffRoleId ? interaction.guild.roles.cache.get(config.staffRoleId) : null;
                const adminRole = config.adminRoleId ? interaction.guild.roles.cache.get(config.adminRoleId) : null;
            
                const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);
                const isAdmin = adminRole && interaction.member.roles.cache.has(adminRole.id);
            
                if (!isStaff && !isAdmin) {
                    return interaction.followUp({
                        content: '❌ Only staff members can close tickets.',
                        flags: 64
                    });
                }
            
                const embed = new EmbedBuilder()
                    .setTitle('Ticket Closed')
                    .setDescription('This ticket has been closed, the channel will be deleted in 5 seconds....')
                    .setColor(RED);
            
                try {
                    const noButtonsRow = new ActionRowBuilder();
                    await interaction.message.edit({ components: [noButtonsRow] });
                } catch (error) {}
            
                await interaction.channel.send({ embeds: [embed] });

                const ownerId = interaction.channel.topic || null;
                let ownerTag = null;
                if (ownerId) {
                    try {
                        const ownerUser = await client.users.fetch(ownerId);
                        ownerTag = ownerUser.tag;
                    } catch {}
                }
                const claimInfo = ticketClaims.get(interaction.channel.id) || {};

                const transcriptId = await generateTicketTranscript(interaction.channel, interaction.user, {
                    ticketType: interaction.channel.name.startsWith('report-') ? 'report' : 'support',
                    ticketOwnerId: ownerId,
                    ticketOwnerTag: ownerTag,
                    createdBy: ownerId,
                    createdByTag: ownerTag,
                    claimedBy: claimInfo.claimedBy || null,
                    claimedByTag: claimInfo.claimedByTag || null,
                    closedBy: interaction.user.id
                });
                ticketClaims.delete(interaction.channel.id);

                await db.saveDashboardLogDB(interaction.guild.id, {
                    type: 'ticket',
                    action: 'ticket_closed',
                    userId: interaction.user.id,
                    userTag: interaction.user.tag,
                    details: `Ticket ${interaction.channel.name} closed${transcriptId ? ` (transcript available)` : ''}`,
                    channelId: interaction.channel.id,
                    transcriptId: transcriptId || null,
                    extra: {
                        channelName: interaction.channel.name,
                        ticketOwnerTag: ownerTag,
                        claimedByTag: claimInfo.claimedByTag || null
                    }
                });
            
                setTimeout(async () => {
                    try {
                        if (interaction.channel && interaction.channel.deletable) {
                            await interaction.channel.delete();
                        }
                    } catch (error) {}
                }, 5000);
                return;
            }
    } catch (error) {
        logCrash('INTERACTION_HANDLER', error, { customId: interaction?.customId });
        try {
            if (interaction?.isRepliable && interaction.isRepliable()) {
                const payload = { content: 'An error occurred. Please try again.', flags: 64 };
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(payload).catch(() => {});
                } else {
                    await interaction.reply(payload).catch(() => {});
                }
            }
        } catch {}
    }
});

setInterval(async () => {
    try {
        const expired = await db.getExpiredBans();
        for (const ban of expired) {
            try {
                const guild = client.guilds.cache.get(ban.guildId);
                if (!guild) {
                    await db.removePendingBan(ban.guildId, ban.userId);
                    continue;
                }
                await guild.members.unban(ban.userId, 'Temporary ban expired');
                await db.removePendingBan(ban.guildId, ban.userId);
                await saveModLog(guild, 'User unbanned (auto)', { id: ban.userId, tag: ban.userTag }, client.user, 'Temporary ban expired');

                await db.saveDashboardLogDB(guild.id, {
                    type: 'auto_mod',
                    action: 'user_unbanned_auto',
                    userId: client.user.id,
                    userTag: client.user.tag,
                    targetId: ban.userId,
                    targetTag: ban.userTag,
                    reason: 'Temporary ban expired',
                    details: 'Auto-unban after temporary ban expired'
                });

                console.log(`[AUTO-UNBAN] Unbanned ${ban.userTag} (${ban.userId}) from ${guild.name}`);
            } catch (err) {
                console.error(`[AUTO-UNBAN] Error on ${ban.userId}:`, err.message);
                await db.removePendingBan(ban.guildId, ban.userId);
            }
        }
    } catch (error) {
        logCrash('AUTO_UNBAN_SCHEDULER', error);
    }
}, 60000);

process.on('SIGINT', () => { process.exit(); });
process.on('SIGTERM', () => { process.exit(); });

if (!process.env.DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN missing in .env file!');
    process.exit(1);
}

async function loginWithRetry(retries = 5, delay = 10000) {
    for (let i = 1; i <= retries; i++) {
        try {
            await client.login(process.env.DISCORD_TOKEN);
            return;
        } catch (error) {
            logCrash('LOGIN_ERROR', error, { attempt: i, retries });
            if (i === retries) {
                console.error('Login failed after all retries');
                process.exit(1);
            }
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}

loginWithRetry();

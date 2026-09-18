const mongoose = require('mongoose');

let connected = false;

async function connectDB() {
    if (connected) return true;
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('[DB] MONGODB_URI missing in .env!');
        return false;
    }
    try {
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 15000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 15000,
            heartbeatFrequencyMS: 10000,
            maxPoolSize: 10,
            retryWrites: true
        });
        connected = true;
        console.log('[DB] Connected to MongoDB');
        return true;
    } catch (err) {
        console.error('[DB] MongoDB connection error:', err.message);
        return false;
    }
}

mongoose.connection.on('disconnected', () => {
    connected = false;
    console.error('[DB] Disconnected');
});

mongoose.connection.on('reconnected', () => {
    connected = true;
    console.log('[DB] Reconnected');
});

mongoose.connection.on('error', (err) => {
    console.error('[DB] Connection error:', err.message);
});

const ModLogSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    guildName: String,
    caseId: { type: Number, required: true },
    action: { type: String, required: true, index: true },
    targetId: { type: String, required: true, index: true },
    targetTag: String,
    moderatorId: { type: String, required: true, index: true },
    moderatorTag: String,
    reason: String,
    duration: { type: String, default: null },
    date: { type: Date, default: Date.now, index: true },
    active: { type: Boolean, default: true }
}, { timestamps: true });

ModLogSchema.index({ guildId: 1, targetId: 1, date: -1 });
ModLogSchema.index({ guildId: 1, moderatorId: 1, date: -1 });
ModLogSchema.index({ guildId: 1, action: 1, date: -1 });

const WarningSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    userTag: String,
    warningId: { type: Number, required: true },
    moderatorId: { type: String, required: true },
    moderatorTag: String,
    reason: String,
    date: { type: Date, default: Date.now },
    active: { type: Boolean, default: true }
}, { timestamps: true });

WarningSchema.index({ guildId: 1, userId: 1, active: 1 });

const GuildConfigSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true, index: true },
    joinLeaveLogChannelId: { type: String, default: null },
    modLogChannelId: { type: String, default: null },
    messageLogChannelId: { type: String, default: null },
    transcriptsChannelId: { type: String, default: null },
    staffRoleId: { type: String, default: null },
    modRoleId: { type: String, default: null },
    adminRoleId: { type: String, default: null },
    supportCategoryId: { type: String, default: null },
    reportCategoryId: { type: String, default: null },
    dashboardPermissions: {
        createRoles: { type: [String], default: [] },
        editRoles: { type: [String], default: [] },
        deleteRoles: { type: [String], default: [] },
        viewLogsRoles: { type: [String], default: [] }
    },
    dashboardSpecialUsers: {
        adminUsers: { type: [String], default: [] },
        ownerUsers: { type: [String], default: [] }
    },
    projectedRoles: { type: [String], default: [] }
}, { timestamps: true });

const CustomCommandSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    name: { type: String, required: true, index: true },
    prefix: { type: String, default: '*' },
    type: { type: String, default: 'text' },
    title: { type: String, default: '' },
    response: { type: String, default: '' },
    color: { type: Number, default: 0xE67E22 },
    permission: { type: String, default: 'everyone' },
    deleteCommand: { type: Boolean, default: true },
    thumbnail: { type: String, default: null },
    image: { type: String, default: null },
    extraEmbeds: {
        type: [{
            title: { type: String, default: '' },
            response: { type: String, default: '' },
            color: { type: Number, default: 0x7289DA },
            thumbnail: { type: String, default: null },
            image: { type: String, default: null }
        }],
        default: []
    },
    allowedRoles: { type: [String], default: [] },
    duration: { type: Number, default: null },
    isBase: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

CustomCommandSchema.index({ guildId: 1, name: 1 }, { unique: true });

const PendingBanSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    userTag: String,
    moderatorId: String,
    moderatorTag: String,
    reason: String,
    banDate: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });

PendingBanSchema.index({ expiresAt: 1 });

const CommandCooldownSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    guildId: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });

CommandCooldownSchema.index({ userId: 1, guildId: 1, action: 1 }, { unique: true });
CommandCooldownSchema.index({ expiresAt: 1 });

const DashboardLogSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    userId: { type: String, default: null, index: true },
    userTag: { type: String, default: null },
    targetId: { type: String, default: null, index: true },
    targetTag: { type: String, default: null },
    moderatorId: { type: String, default: null, index: true },
    moderatorTag: { type: String, default: null },
    reason: { type: String, default: null },
    details: { type: String, default: null },
    channelId: { type: String, default: null },
    transcriptId: { type: String, default: null },
    extra: { type: mongoose.Schema.Types.Mixed, default: null },
    date: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

DashboardLogSchema.index({ guildId: 1, date: -1 });
DashboardLogSchema.index({ guildId: 1, type: 1, date: -1 });

const TranscriptSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, index: true },
    channelName: { type: String, required: true },
    ticketType: { type: String, default: 'support' },
    ticketOwnerId: { type: String, default: null },
    ticketOwnerTag: { type: String, default: null },
    createdBy: { type: String, default: null },
    createdByTag: { type: String, default: null },
    claimedBy: { type: String, default: null },
    claimedByTag: { type: String, default: null },
    closedBy: { type: String, default: null },
    closedByTag: { type: String, default: null },
    messages: { type: Array, default: [] },
    createdAt: { type: Date, default: Date.now, index: true },
    closedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

TranscriptSchema.index({ guildId: 1, closedAt: -1 });

const ModLog = mongoose.model('ModLog', ModLogSchema);
const Warning = mongoose.model('Warning', WarningSchema);
const GuildConfig = mongoose.model('GuildConfig', GuildConfigSchema);
const CustomCommand = mongoose.model('CustomCommand', CustomCommandSchema);
const PendingBan = mongoose.model('PendingBan', PendingBanSchema);
const CommandCooldown = mongoose.model('CommandCooldown', CommandCooldownSchema);
const DashboardLog = mongoose.model('DashboardLog', DashboardLogSchema);
const Transcript = mongoose.model('Transcript', TranscriptSchema);

async function getNextCaseId(guildId) {
    const last = await ModLog.findOne({ guildId }).sort({ caseId: -1 }).lean();
    return last ? last.caseId + 1 : 1;
}

async function createModLog(data) {
    const caseId = await getNextCaseId(data.guildId);
    const doc = await ModLog.create({ ...data, caseId });
    return doc.toObject();
}

async function getModLogsByTarget(guildId, targetId, limit = 10) {
    return ModLog.find({ guildId, targetId }).sort({ date: -1 }).limit(limit).lean();
}

async function getModLogsByGuild(guildId, limit = 50) {
    return ModLog.find({ guildId }).sort({ date: -1 }).limit(limit).lean();
}

async function getModLogsByModerator(guildId, moderatorId, limit = 50) {
    return ModLog.find({ guildId, moderatorId }).sort({ date: -1 }).limit(limit).lean();
}

async function addWarningDB(data) {
    const last = await Warning.findOne({ guildId: data.guildId, userId: data.userId }).sort({ warningId: -1 }).lean();
    const warningId = last ? last.warningId + 1 : 1;
    const doc = await Warning.create({ ...data, warningId });
    return doc.toObject();
}

async function getUserWarningsDB(guildId, userId) {
    return Warning.find({ guildId, userId, active: true }).sort({ warningId: 1 }).lean();
}

async function removeWarningDB(guildId, userId, warningId) {
    const result = await Warning.findOneAndDelete({ guildId, userId, warningId: parseInt(warningId) });
    return !!result;
}

async function clearWarningsDB(guildId, userId) {
    const result = await Warning.deleteMany({ guildId, userId });
    return result.deletedCount > 0;
}

async function getGuildConfigDB(guildId) {
    let config = await GuildConfig.findOne({ guildId }).lean();
    if (!config) {
        config = (await GuildConfig.create({ guildId })).toObject();
    }
    return config;
}

async function saveGuildConfigDB(guildId, key, value) {
    await GuildConfig.findOneAndUpdate(
        { guildId },
        { $set: { [key]: value } },
        { upsert: true, new: true }
    );
}

async function getDashboardPermissionsDB(guildId) {
    const config = await getGuildConfigDB(guildId);
    const perms = config.dashboardPermissions || {};
    return {
        createRoles: perms.createRoles || [],
        editRoles: perms.editRoles || [],
        deleteRoles: perms.deleteRoles || [],
        viewLogsRoles: perms.viewLogsRoles || []
    };
}

async function saveDashboardPermissionsDB(guildId, perms) {
    await GuildConfig.findOneAndUpdate(
        { guildId },
        {
            $set: {
                dashboardPermissions: {
                    createRoles: Array.isArray(perms.createRoles) ? perms.createRoles : [],
                    editRoles: Array.isArray(perms.editRoles) ? perms.editRoles : [],
                    deleteRoles: Array.isArray(perms.deleteRoles) ? perms.deleteRoles : [],
                    viewLogsRoles: Array.isArray(perms.viewLogsRoles) ? perms.viewLogsRoles : []
                }
            }
        },
        { upsert: true, new: true }
    );
}

async function getDashboardSpecialUsersDB(guildId) {
    const config = await getGuildConfigDB(guildId);
    const users = config.dashboardSpecialUsers || {};
    return {
        adminUsers: users.adminUsers || [],
        ownerUsers: users.ownerUsers || []
    };
}

async function saveDashboardSpecialUsersDB(guildId, users) {
    const filterIds = (arr) => Array.isArray(arr) ? arr.filter(r => typeof r === 'string' && /^\d+$/.test(r)) : [];

    await GuildConfig.findOneAndUpdate(
        { guildId },
        {
            $set: {
                dashboardSpecialUsers: {
                    adminUsers: filterIds(users.adminUsers),
                    ownerUsers: filterIds(users.ownerUsers)
                }
            }
        },
        { upsert: true, new: true }
    );
}

async function getProjectedRolesDB(guildId) {
    const config = await getGuildConfigDB(guildId);
    return config.projectedRoles || [];
}

async function saveProjectedRolesDB(guildId, roles) {
    const filterIds = (arr) => Array.isArray(arr) ? arr.filter(r => typeof r === 'string' && /^\d+$/.test(r)) : [];
    await GuildConfig.findOneAndUpdate(
        { guildId },
        { $set: { projectedRoles: filterIds(roles) } },
        { upsert: true, new: true }
    );
}

async function loadCustomCommandsDB(guildId) {
    const docs = await CustomCommand.find({ guildId }).lean();
    const obj = {};
    for (const doc of docs) {
        obj[doc.name.toLowerCase()] = {
            name: doc.name,
            prefix: doc.prefix || '*',
            type: doc.type,
            title: doc.title,
            response: doc.response,
            color: doc.color,
            permission: doc.permission,
            deleteCommand: doc.deleteCommand,
            thumbnail: doc.thumbnail,
            image: doc.image,
            extraEmbeds: doc.extraEmbeds || [],
            allowedRoles: doc.allowedRoles || [],
            duration: doc.duration || null,
            isBase: doc.isBase || false,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
        };
    }
    return obj;
}

async function saveCustomCommandDB(guildId, name, data) {
    await CustomCommand.findOneAndUpdate(
        { guildId, name: name.toLowerCase() },
        { $set: { ...data, name: name.toLowerCase(), guildId, updatedAt: new Date() } },
        { upsert: true, new: true }
    );
}

async function deleteCustomCommandDB(guildId, name) {
    const result = await CustomCommand.deleteOne({ guildId, name: name.toLowerCase() });
    return result.deletedCount > 0;
}

async function getBaseCommandsCount(guildId) {
    return await CustomCommand.countDocuments({ guildId, isBase: true });
}

async function setIsBaseDB(guildId, name, isBase) {
    const result = await CustomCommand.findOneAndUpdate(
        { guildId, name: name.toLowerCase() },
        { $set: { isBase: !!isBase, updatedAt: new Date() } },
        { new: true }
    );
    return result ? result.toObject() : null;
}

async function getCommandCooldownDB(userId, guildId, action) {
    const cd = await CommandCooldown.findOne({ userId, guildId, action }).lean();
    if (!cd) return null;
    if (new Date(cd.expiresAt).getTime() < Date.now()) {
        await CommandCooldown.deleteOne({ userId, guildId, action });
        return null;
    }
    return cd;
}

async function setCommandCooldownDB(userId, guildId, action, seconds) {
    const expiresAt = new Date(Date.now() + seconds * 1000);
    await CommandCooldown.findOneAndUpdate(
        { userId, guildId, action },
        { $set: { expiresAt } },
        { upsert: true, new: true }
    );
}

async function addPendingBan(data) {
    return await PendingBan.create(data);
}

async function getExpiredBans() {
    return await PendingBan.find({ expiresAt: { $lte: new Date() } }).lean();
}

async function removePendingBan(guildId, userId) {
    return await PendingBan.deleteOne({ guildId, userId });
}

async function getPendingBan(guildId, userId) {
    return await PendingBan.findOne({ guildId, userId }).lean();
}

async function saveDashboardLogDB(guildId, data) {
    try {
        const doc = await DashboardLog.create({
            guildId,
            type: data.type || 'generic',
            action: data.action || 'unknown',
            userId: data.userId || null,
            userTag: data.userTag || null,
            targetId: data.targetId || null,
            targetTag: data.targetTag || null,
            moderatorId: data.moderatorId || null,
            moderatorTag: data.moderatorTag || null,
            reason: data.reason || null,
            details: data.details || null,
            channelId: data.channelId || null,
            transcriptId: data.transcriptId || null,
            extra: data.extra || null,
            date: new Date()
        });
        return doc.toObject();
    } catch (err) {
        console.error('[DB] saveDashboardLogDB error:', err.message);
        return null;
    }
}

async function getDashboardLogsDB(guildId, limit = 200) {
    return DashboardLog.find({ guildId }).sort({ date: -1 }).limit(limit).lean();
}

async function getBanLogsDB(guildId, limit = 200) {
    return DashboardLog.find({ guildId, action: { $in: ['user_banned', 'user_banned_auto'] } }).sort({ date: -1 }).limit(limit).lean();
}

async function saveTranscriptDB(data) {
    try {
        const doc = await Transcript.create({
            guildId: data.guildId,
            channelId: data.channelId,
            channelName: data.channelName,
            ticketType: data.ticketType || 'support',
            ticketOwnerId: data.ticketOwnerId || null,
            ticketOwnerTag: data.ticketOwnerTag || null,
            createdBy: data.createdBy || null,
            createdByTag: data.createdByTag || null,
            claimedBy: data.claimedBy || null,
            claimedByTag: data.claimedByTag || null,
            closedBy: data.closedBy || null,
            closedByTag: data.closedByTag || null,
            messages: data.messages || [],
            createdAt: data.createdAt || new Date(),
            closedAt: data.closedAt || new Date()
        });
        return doc.toObject();
    } catch (err) {
        console.error('[DB] saveTranscriptDB error:', err.message);
        return null;
    }
}

async function getTranscriptDB(guildId, transcriptId) {
    return Transcript.findOne({ _id: transcriptId, guildId }).lean();
}

async function getTranscriptsByGuildDB(guildId, limit = 100) {
    return Transcript.find({ guildId }).sort({ closedAt: -1 }).limit(limit).lean();
}

async function deleteTranscriptDB(guildId, transcriptId) {
    const res = await Transcript.deleteOne({ _id: transcriptId, guildId });
    return res.deletedCount > 0;
}

module.exports = {
    connectDB,
    ModLog,
    Warning,
    GuildConfig,
    CustomCommand,
    PendingBan,
    CommandCooldown,
    DashboardLog,
    createModLog,
    getModLogsByTarget,
    getModLogsByGuild,
    getModLogsByModerator,
    addWarningDB,
    getUserWarningsDB,
    removeWarningDB,
    clearWarningsDB,
    getGuildConfigDB,
    saveGuildConfigDB,
    getDashboardPermissionsDB,
    saveDashboardPermissionsDB,
    getDashboardSpecialUsersDB,
    saveDashboardSpecialUsersDB,
    getProjectedRolesDB,
    saveProjectedRolesDB,
    loadCustomCommandsDB,
    saveCustomCommandDB,
    deleteCustomCommandDB,
    getBaseCommandsCount,
    setIsBaseDB,
    getCommandCooldownDB,
    setCommandCooldownDB,
    addPendingBan,
    getExpiredBans,
    removePendingBan,
    getPendingBan,
    saveDashboardLogDB,
    getDashboardLogsDB,
    getBanLogsDB,
    Transcript,
    saveTranscriptDB,
    getTranscriptDB,
    getTranscriptsByGuildDB,
    deleteTranscriptDB,
};

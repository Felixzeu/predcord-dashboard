const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const bcrypt = require('bcryptjs');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');
const fs = require('fs');
const { ChannelType } = require('discord.js');
require('dotenv').config();

require('./index.js');

function waitForBot(timeout = 60000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            if (global.PredCord && global.PredCord.client && global.PredCord.client.isReady()) {
                resolve();
            } else if (Date.now() - start > timeout) {
                reject(new Error('Timeout bot'));
            } else {
                setTimeout(check, 1000);
            }
        };
        check();
    });
}

const ADMIN_USERNAME = process.env.DASH_USER || 'admin';
const ADMIN_PASSWORD = process.env.DASH_PASS || 'predcord2024';
const ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:10000/auth/discord/callback';
const MAIN_GUILD_ID = process.env.MAIN_GUILD_ID;

const MAX_BASE_COMMANDS = 10;

const app = express();
const PORT = process.env.PORT || 10000;
const DASHBOARD_DIR = path.join(__dirname, 'dashboard');
const SESSIONS_DIR = path.join(__dirname, 'sessions');

if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    store: new FileStore({
        path: SESSIONS_DIR,
        ttl: 60 * 60 * 24 * 7,
        retries: 0,
        reapInterval: 3600,
        logFn: () => {}
    }),
    secret: process.env.SESSION_SECRET || 'predcord-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7,
        secure: false,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(new DiscordStrategy({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: DISCORD_REDIRECT_URI,
    scope: ['identify', 'guilds']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        if (!MAIN_GUILD_ID) {
            return done(null, false, { message: 'MAIN_GUILD_ID non configurato' });
        }

        const guild = global.PredCord.client.guilds.cache.get(MAIN_GUILD_ID);
        if (!guild) {
            return done(null, false, { message: 'Il bot non è nel server principale' });
        }

        let member;
        try {
            member = await guild.members.fetch(profile.id);
        } catch {
            return done(null, false, { message: 'Non sei membro del server principale' });
        }

        const specialUsers = await global.PredCord.db.getDashboardSpecialUsersDB(MAIN_GUILD_ID);

        let role = null;
        if (specialUsers.ownerUsers.includes(profile.id)) {
            role = 'owner';
        } else if (specialUsers.adminUsers.includes(profile.id)) {
            role = 'admin';
        }

        if (role) {
            return done(null, {
                id: profile.id,
                username: profile.username,
                discriminator: profile.discriminator,
                avatar: profile.avatar,
                guildId: MAIN_GUILD_ID,
                role: role,
                isDiscord: true
            });
        }

        const permissions = await global.PredCord.db.getDashboardPermissionsDB(MAIN_GUILD_ID);

        const userRoles = member.roles.cache.map(r => r.id);
        const allAllowed = [
            ...(permissions.createRoles || []),
            ...(permissions.editRoles || []),
            ...(permissions.deleteRoles || []),
            ...(permissions.viewLogsRoles || [])
        ];

        if (allAllowed.length === 0) {
            return done(null, false, { message: 'Nessun ruolo autorizzato configurato' });
        }

        const hasAnyRole = allAllowed.some(roleId => userRoles.includes(roleId));
        if (!hasAnyRole) {
            return done(null, false, { message: 'Non hai i ruoli autorizzati' });
        }

        return done(null, {
            id: profile.id,
            username: profile.username,
            discriminator: profile.discriminator,
            avatar: profile.avatar,
            guildId: MAIN_GUILD_ID,
            roles: userRoles,
            role: 'user',
            isDiscord: true
        });
    } catch (err) {
        return done(err, null);
    }
}));

app.use(passport.initialize());
app.use(passport.session());

app.use(express.static(DASHBOARD_DIR));

function requireAuth(req, res, next) {
    if (req.session.user || (req.user && req.user.isDiscord)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Non autenticato' });
    res.redirect('/login');
}

function isDashboardAdmin(req) {
    if (req.session.user && req.session.user.username === ADMIN_USERNAME && !req.session.user.isDiscord) return true;
    return false;
}

function getUserRole(req) {
    if (isDashboardAdmin(req)) return 'owner';
    if (req.session.user && req.session.user.isDiscord) {
        return req.session.user.role || 'user';
    }
    return null;
}

async function userHasPermission(req, permKey) {
    const role = getUserRole(req);

    if (role === 'owner' || role === 'admin') {
        return true;
    }

    if (role === 'user') {
        const permissions = await global.PredCord.db.getDashboardPermissionsDB(MAIN_GUILD_ID);
        const allowed = permissions[permKey] || [];
        if (allowed.length === 0) return false;
        const userRoles = req.user ? (req.user.roles || []) : [];
        return userRoles.some(roleId => allowed.includes(roleId));
    }

    return false;
}

function canManagePermissions(req) {
    const role = getUserRole(req);
    return role === 'owner';
}

function isOwner(req) {
    const role = getUserRole(req);
    return role === 'owner';
}

app.get('/login', (req, res) => {
    if (req.session.user || (req.user && req.user.isDiscord)) return res.redirect('/');
    res.sendFile(path.join(DASHBOARD_DIR, 'login.html'));
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/login?error=access_denied' }),
    (req, res) => {
        req.session.user = {
            id: req.user.id,
            username: req.user.username,
            avatar: req.user.avatar,
            role: req.user.role,
            isDiscord: true
        };
        req.session.save((err) => {
            if (err) console.error('[SESSION] save error:', err);
            res.redirect('/');
        });
    }
);

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (username !== ADMIN_USERNAME) return res.status(401).json({ error: 'Credenziali errate' });
    const ok = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!ok) return res.status(401).json({ error: 'Credenziali errate' });
    req.session.user = { username, isDiscord: false, role: 'owner' };
    req.session.save((err) => {
        if (err) return res.status(500).json({ error: 'Errore sessione' });
        res.json({ success: true, isAdmin: true });
    });
});

app.post('/api/logout', (req, res) => {
    req.logout(() => {
        req.session.destroy(() => res.json({ success: true }));
    });
});

app.get('/api/me', requireAuth, (req, res) => {
    const role = getUserRole(req);
    const isDiscordUser = req.session.user && req.session.user.isDiscord;

    res.json({
        user: req.session.user,
        isAdmin: role === 'owner' || role === 'admin',
        isDiscord: !!isDiscordUser,
        role: role || 'none',
        isOwner: role === 'owner',
        canManagePermissions: canManagePermissions(req)
    });
});

app.get('/api/me/full', requireAuth, async (req, res) => {
    try {
        const { client } = global.PredCord;

        if (!req.session.user || !req.session.user.isDiscord) {
            return res.json({
                id: req.session.user?.id || null,
                username: req.session.user?.username || 'Admin',
                displayName: req.session.user?.username || 'Admin',
                discriminator: '0000',
                tag: req.session.user?.username || 'Admin',
                avatar: null,
                roles: []
            });
        }

        const guild = client.guilds.cache.get(MAIN_GUILD_ID);
        if (!guild) return res.status(404).json({ error: 'Server non trovato' });

        let member;
        try {
            member = await guild.members.fetch(req.session.user.id);
        } catch {
            return res.json({
                id: req.session.user.id,
                username: req.session.user.username,
                displayName: req.session.user.username,
                discriminator: req.session.user.discriminator || '0000',
                tag: req.session.user.username,
                avatar: req.session.user.avatar,
                roles: []
            });
        }

        const roles = member.roles.cache
            .filter(r => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => ({
                id: r.id,
                name: r.name,
                color: r.hexColor
            }));

        const avatarUrl = member.user.displayAvatarURL({ dynamic: true, size: 128 });

        res.json({
            id: member.user.id,
            username: member.user.username,
            displayName: member.displayName,
            discriminator: member.user.discriminator || '0000',
            tag: member.user.tag,
            avatar: avatarUrl,
            roles: roles
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/my-permissions', requireAuth, async (req, res) => {
    try {
        const role = getUserRole(req);

        if (role === 'owner' || role === 'admin') {
            return res.json({
                createRoles: true,
                editRoles: true,
                deleteRoles: true,
                viewLogsRoles: true,
                managePermissions: role === 'owner',
                isOwner: role === 'owner'
            });
        }

        if (role === 'user') {
            const permissions = await global.PredCord.db.getDashboardPermissionsDB(MAIN_GUILD_ID);
            const userRoles = req.user ? (req.user.roles || []) : [];

            const check = (permKey) => {
                const allowed = permissions[permKey] || [];
                if (allowed.length === 0) return false;
                return userRoles.some(roleId => allowed.includes(roleId));
            };

            return res.json({
                createRoles: check('createRoles'),
                editRoles: check('editRoles'),
                deleteRoles: check('deleteRoles'),
                viewLogsRoles: check('viewLogsRoles'),
                managePermissions: false,
                isOwner: false
            });
        }

        res.json({
            createRoles: false,
            editRoles: false,
            deleteRoles: false,
            viewLogsRoles: false,
            managePermissions: false,
            isOwner: false
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/guilds', requireAuth, (req, res) => {
    try {
        const { client } = global.PredCord;
        const guilds = client.guilds.cache.map(g => ({
            id: g.id,
            name: g.name,
            icon: g.iconURL({ dynamic: true, size: 128 }),
            memberCount: g.memberCount
        }));
        res.json(guilds);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/roles/:guildId', requireAuth, (req, res) => {
    try {
        const { client } = global.PredCord;
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Server non trovato' });

        const roles = guild.roles.cache
            .filter(r => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => ({
                id: r.id,
                name: r.name,
                color: r.hexColor,
                position: r.position,
                managed: r.managed
            }));

        res.json(roles);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/channels/:guildId', requireAuth, (req, res) => {
    try {
        const { client } = global.PredCord;
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Server non trovato' });

        const channels = guild.channels.cache
            .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildCategory)
            .sort((a, b) => a.position - b.position)
            .map(c => ({
                id: c.id,
                name: c.name,
                type: c.type === ChannelType.GuildCategory ? 'category' : 'text',
                parentId: c.parentId || null
            }));

        res.json(channels);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/guildconfig/:guildId', requireAuth, async (req, res) => {
    try {
        const { db } = global.PredCord;
        const config = await db.getGuildConfigDB(req.params.guildId);
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/guildconfig/:guildId', requireAuth, async (req, res) => {
    try {
        if (!isOwner(req) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db } = global.PredCord;
        const { guildId } = req.params;
        const {
            joinLeaveLogChannelId,
            modLogChannelId,
            messageLogChannelId,
            transcriptsChannelId,
            staffRoleId,
            adminRoleId,
            supportCategoryId
        } = req.body;

        const updates = {};
        if (joinLeaveLogChannelId !== undefined) updates.joinLeaveLogChannelId = joinLeaveLogChannelId || null;
        if (modLogChannelId !== undefined) updates.modLogChannelId = modLogChannelId || null;
        if (messageLogChannelId !== undefined) updates.messageLogChannelId = messageLogChannelId || null;
        if (transcriptsChannelId !== undefined) updates.transcriptsChannelId = transcriptsChannelId || null;
        if (staffRoleId !== undefined) updates.staffRoleId = staffRoleId || null;
        if (adminRoleId !== undefined) updates.adminRoleId = adminRoleId || null;
        if (supportCategoryId !== undefined) updates.supportCategoryId = supportCategoryId || null;

        for (const [key, value] of Object.entries(updates)) {
            await db.saveGuildConfigDB(guildId, key, value);
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/permissions/:guildId', requireAuth, async (req, res) => {
    try {
        const { db } = global.PredCord;
        const perms = await db.getDashboardPermissionsDB(req.params.guildId);
        const specialUsers = await db.getDashboardSpecialUsersDB(req.params.guildId);
        const projectedRoles = await db.getProjectedRolesDB(req.params.guildId);
        res.json({
            ...perms,
            adminUsers: specialUsers.adminUsers,
            ownerUsers: specialUsers.ownerUsers,
            projectedRoles: projectedRoles
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/permissions/:guildId', requireAuth, async (req, res) => {
    try {
        const { db } = global.PredCord;
        if (!canManagePermissions(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { guildId } = req.params;
        const { createRoles, editRoles, deleteRoles, viewLogsRoles, adminUsers, ownerUsers, projectedRoles } = req.body;

        const filterIds = (arr) => Array.isArray(arr) ? arr.filter(r => typeof r === 'string' && /^\d+$/.test(r)) : [];

        await db.saveDashboardPermissionsDB(guildId, {
            createRoles: filterIds(createRoles),
            editRoles: filterIds(editRoles),
            deleteRoles: filterIds(deleteRoles),
            viewLogsRoles: filterIds(viewLogsRoles)
        });

        await db.saveDashboardSpecialUsersDB(guildId, {
            adminUsers: filterIds(adminUsers),
            ownerUsers: filterIds(ownerUsers)
        });

        await db.saveProjectedRolesDB(guildId, filterIds(projectedRoles));

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/user-info/:userId', requireAuth, async (req, res) => {
    try {
        const { client } = global.PredCord;
        const guild = client.guilds.cache.get(MAIN_GUILD_ID);
        if (!guild) return res.status(404).json({ error: 'Server non trovato' });

        try {
            const member = await guild.members.fetch(req.params.userId);
            res.json({
                id: member.user.id,
                username: member.user.username,
                tag: member.user.tag,
                displayName: member.displayName,
                avatar: member.user.displayAvatarURL({ dynamic: true, size: 64 })
            });
        } catch {
            try {
                const user = await client.users.fetch(req.params.userId);
                res.json({
                    id: user.id,
                    username: user.username,
                    tag: user.tag,
                    displayName: user.username,
                    avatar: user.displayAvatarURL({ dynamic: true, size: 64 })
                });
            } catch {
                res.status(404).json({ error: 'Utente non trovato' });
            }
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/commands/:guildId', requireAuth, async (req, res) => {
    try {
        const { db } = global.PredCord;
        const cmds = await db.loadCustomCommandsDB(req.params.guildId);
        res.json(cmds || {});
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/commands/:guildId', requireAuth, async (req, res) => {
    try {
        const { db } = global.PredCord;

        const isEdit = !!req.body.isEdit;
        const permKey = isEdit ? 'editRoles' : 'createRoles';

        const hasPerm = await userHasPermission(req, permKey);
        if (!hasPerm) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { guildId } = req.params;
        const { name, data } = req.body;

        if (!name || !/^[a-z0-9_-]{1,32}$/i.test(name)) {
            return res.status(400).json({ error: 'Nome comando non valido' });
        }

        let prefix = typeof data.prefix === 'string' ? data.prefix.trim() : '*';
        if (prefix.length !== 1) prefix = '*';

        const lowerName = name.toLowerCase();
        const existing = await db.CustomCommand.findOne({ guildId, name: lowerName }).lean();

        if (existing && existing.isBase) {
            return res.status(403).json({ error: 'Questo comando è Base e non può essere modificato' });
        }

        let allowedRoles = [];
        if (Array.isArray(data.allowedRoles)) {
            allowedRoles = data.allowedRoles.filter(r => typeof r === 'string' && /^\d+$/.test(r));
        }

        let duration = null;
        if (data.duration !== null && data.duration !== undefined && data.duration !== '') {
            const d = parseInt(data.duration);
            if (!isNaN(d) && d > 0) duration = d;
        }

        await db.saveCustomCommandDB(guildId, lowerName, {
            prefix: prefix,
            type: data.type || 'text',
            title: data.title || '',
            response: data.response || '',
            color: typeof data.color === 'number' ? data.color : 0xE67E22,
            deleteCommand: data.deleteCommand !== false,
            thumbnail: data.thumbnail || null,
            image: data.image || null,
            allowedRoles: allowedRoles,
            duration: duration,
            isBase: existing?.isBase || false,
            createdAt: existing?.createdAt || new Date(),
            updatedAt: new Date()
        });

        const cmd = await db.CustomCommand.findOne({ guildId, name: lowerName }).lean();
        res.json({ success: true, command: cmd });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/commands/:guildId/:name/setbase', requireAuth, async (req, res) => {
    try {
        const { db } = global.PredCord;

        if (!isOwner(req)) {
            return res.status(403).json({ error: 'Solo l\'Owner può gestire i comandi Base' });
        }

        const { guildId, name } = req.params;
        const { isBase } = req.body;

        const command = await db.CustomCommand.findOne({ guildId, name: name.toLowerCase() }).lean();
        if (!command) {
            return res.status(404).json({ error: 'Comando non trovato' });
        }

        if (isBase) {
            const currentCount = await db.getBaseCommandsCount(guildId);
            if (!command.isBase && currentCount >= MAX_BASE_COMMANDS) {
                return res.status(400).json({ error: `Massimo ${MAX_BASE_COMMANDS} comandi Base raggiunti` });
            }
        }

        await db.setIsBaseDB(guildId, name, !!isBase);
        res.json({ success: true, isBase: !!isBase });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/commands/:guildId/:name', requireAuth, async (req, res) => {
    try {
        const { db } = global.PredCord;

        const hasPerm = await userHasPermission(req, 'deleteRoles');
        if (!hasPerm) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { guildId, name } = req.params;

        const command = await db.CustomCommand.findOne({ guildId, name: name.toLowerCase() }).lean();
        if (!command) {
            return res.status(404).json({ error: 'Comando non trovato' });
        }

        if (command.isBase) {
            return res.status(403).json({ error: 'Questo comando è Base: rimuovi prima il flag Base per eliminarlo' });
        }

        const deleted = await db.deleteCustomCommandDB(guildId, name);
        if (deleted) {
            return res.json({ success: true });
        }
        res.status(404).json({ error: 'Comando non trovato' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/members/:guildId', requireAuth, async (req, res) => {
    try {
        const { client } = global.PredCord;
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Server non trovato' });

        let members = guild.members.cache;
        if (members.size <= 1) {
            try {
                members = await guild.members.fetch();
            } catch (fetchErr) {
                console.error('Fetch members fallito:', fetchErr.message);
            }
        }

        const list = members
            .filter(m => !m.user.bot)
            .map(m => ({
                id: m.user.id,
                username: m.user.username,
                displayName: m.displayName,
                tag: m.user.tag,
                avatar: m.user.displayAvatarURL({ dynamic: true, size: 64 }),
                joinedAt: m.joinedAt,
                roles: m.roles.cache.filter(r => r.id !== guild.id).map(r => r.name)
            }))
            .slice(0, 200);

        res.json(list);
    } catch (e) {
        console.error('Members error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/modlogs/:guildId', requireAuth, async (req, res) => {
    try {
        const hasPerm = await userHasPermission(req, 'viewLogsRoles');
        if (!hasPerm) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db } = global.PredCord;
        const logs = await db.getModLogsByGuild(req.params.guildId, 50);
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/modlogs/:guildId/:userId', requireAuth, async (req, res) => {
    try {
        const { db } = global.PredCord;
        const logs = await db.getModLogsByTarget(req.params.guildId, req.params.userId, 50);
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/warnings/:guildId/:userId', requireAuth, async (req, res) => {
    try {
        const { db } = global.PredCord;
        const userWarnings = await db.getUserWarningsDB(req.params.guildId, req.params.userId);
        res.json(userWarnings);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/moderation/:guildId', requireAuth, async (req, res) => {
    try {
        const { client, saveModLog, addWarning, db } = global.PredCord;
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Server non trovato' });

        const { action, userId, reason, duration } = req.body;
        if (!action || !userId) return res.status(400).json({ error: 'Parametri mancanti' });

        let member;
        try {
            member = await guild.members.fetch(userId);
        } catch {
            if (action !== 'unban') {
                return res.status(404).json({ error: 'Utente non trovato nel server' });
            }
        }

        const moderator = client.user;
        const cleanReason = reason || 'Azione dalla dashboard';
        let actionLabel = '';
        let durationText = null;

        if (action === 'warn') {
            if (!member) return res.status(404).json({ error: 'Utente non trovato' });
            await addWarning(guild, member.user, moderator, cleanReason);
            actionLabel = 'User warned';
        } else if (action === 'mute') {
            if (!member) return res.status(404).json({ error: 'Utente non trovato' });
            let days = parseInt(duration);
            if (isNaN(days) || days < 1) days = 28;
            if (days > 28) days = 28;
            if (!member.moderatable) return res.status(400).json({ error: 'Non posso mutare questo utente' });
            await member.timeout(days * 24 * 60 * 60 * 1000, cleanReason);
            actionLabel = 'User muted';
            durationText = `${days} giorn${days === 1 ? 'o' : 'i'}`;
        } else if (action === 'kick') {
            if (!member) return res.status(404).json({ error: 'Utente non trovato' });
            if (!member.kickable) return res.status(400).json({ error: 'Non posso kickare questo utente' });
            await member.kick(cleanReason);
            actionLabel = 'User kicked';
        } else if (action === 'ban') {
            if (!member) return res.status(404).json({ error: 'Utente non trovato' });
            if (!member.bannable) return res.status(400).json({ error: 'Non posso bannare questo utente' });
            await member.ban({ reason: cleanReason });
            actionLabel = 'User banned';
        } else if (action === 'unban') {
            try {
                const bans = await guild.bans.fetch();
                const bannedUser = bans.find(b => b.user.id === userId);
                if (!bannedUser) return res.status(404).json({ error: 'Utente non trovato nei ban' });
                await guild.members.unban(userId, cleanReason);
                await db.removePendingBan(guild.id, userId);
                actionLabel = 'User unbanned';
                await saveModLog(guild, actionLabel, { id: userId, tag: bannedUser.user.tag }, moderator, cleanReason, null);
                return res.json({ success: true, username: bannedUser.user.tag });
            } catch (err) {
                return res.status(400).json({ error: 'Errore durante unban: ' + err.message });
            }
        } else if (action === 'unmute') {
            if (!member) return res.status(404).json({ error: 'Utente non trovato' });
            if (!member.moderatable) return res.status(400).json({ error: 'Non posso smutare questo utente' });
            await member.timeout(null, cleanReason);
            actionLabel = 'User unmuted';
        } else {
            return res.status(400).json({ error: 'Azione non valida' });
        }

        await saveModLog(guild, actionLabel, member.user, moderator, cleanReason, durationText);

        res.json({ success: true, username: member.user.tag });
    } catch (e) {
        console.error('Moderation error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(DASHBOARD_DIR, 'index.html'));
});

waitForBot().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Dashboard attiva su http://0.0.0.0:${PORT}`);
    });
}).catch((err) => {
    console.error('Errore avvio:', err.message);
    process.exit(1);
});

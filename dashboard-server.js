const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
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

const app = express();
const PORT = process.env.PORT || 10000;
const DASHBOARD_DIR = path.join(__dirname, 'dashboard');

app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'predcord-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 8,
        secure: false,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

app.use('/style.css', express.static(path.join(DASHBOARD_DIR, 'style.css')));
app.use('/app.js', express.static(path.join(DASHBOARD_DIR, 'app.js')));

function requireAuth(req, res, next) {
    if (req.session.user) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Non autenticato' });
    res.redirect('/login');
}

app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.sendFile(path.join(DASHBOARD_DIR, 'login.html'));
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (username !== ADMIN_USERNAME) return res.status(401).json({ error: 'Credenziali errate' });
    const ok = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!ok) return res.status(401).json({ error: 'Credenziali errate' });
    req.session.user = { username };
    res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
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

app.get('/api/commands/:guildId', requireAuth, (req, res) => {
    try {
        const { loadCustomCommands } = global.PredCord;
        const all = loadCustomCommands();
        res.json(all[req.params.guildId] || {});
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/commands/:guildId', requireAuth, (req, res) => {
    try {
        const { loadCustomCommands, saveCustomCommands } = global.PredCord;
        const { guildId } = req.params;
        const { name, data } = req.body;

        if (!name || !/^[a-z0-9_-]{1,32}$/i.test(name)) {
            return res.status(400).json({ error: 'Nome comando non valido' });
        }

        const all = loadCustomCommands();
        if (!all[guildId]) all[guildId] = {};

        const lowerName = name.toLowerCase();
        const existing = all[guildId][lowerName];

        all[guildId][lowerName] = {
            name: lowerName,
            type: data.type || 'text',
            title: data.title || '',
            response: data.response || '',
            color: typeof data.color === 'number' ? data.color : 0xE67E22,
            permission: data.permission || 'everyone',
            deleteCommand: data.deleteCommand !== false,
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        saveCustomCommands(all);
        res.json({ success: true, command: all[guildId][lowerName] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/commands/:guildId/:name', requireAuth, (req, res) => {
    try {
        const { loadCustomCommands, saveCustomCommands } = global.PredCord;
        const { guildId, name } = req.params;
        const all = loadCustomCommands();

        if (all[guildId] && all[guildId][name]) {
            delete all[guildId][name];
            saveCustomCommands(all);
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

app.get('/api/modlogs/:guildId', requireAuth, (req, res) => {
    try {
        const { userModLogs } = global.PredCord;
        const logs = [];

        if (userModLogs && typeof userModLogs.forEach === 'function') {
            userModLogs.forEach((userLogs) => {
                if (Array.isArray(userLogs)) {
                    for (const log of userLogs) {
                        if (log.guildId === req.params.guildId) {
                            logs.push(log);
                        }
                    }
                }
            });
        }

        logs.sort((a, b) => new Date(b.date) - new Date(a.date));
        res.json(logs.slice(0, 50));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/warnings/:guildId/:userId', requireAuth, async (req, res) => {
    try {
        const { getUserWarnings } = global.PredCord;
        const userWarnings = await getUserWarnings(req.params.userId);
        res.json(userWarnings);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/moderation/:guildId', requireAuth, async (req, res) => {
    try {
        const { client, saveModLog, addWarning } = global.PredCord;
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Server non trovato' });

        const { action, userId, reason, duration } = req.body;
        if (!action || !userId) return res.status(400).json({ error: 'Parametri mancanti' });

        let member;
        try {
            member = await guild.members.fetch(userId);
        } catch {
            return res.status(404).json({ error: 'Utente non trovato nel server' });
        }

        const moderator = client.user;
        const cleanReason = reason || 'Azione dalla dashboard';
        let actionLabel = '';
        let durationText = null;

        if (action === 'warn') {
            await addWarning(guild, member.user, moderator, cleanReason);
            actionLabel = 'User warned';
        } else if (action === 'mute') {
            const mins = Math.max(1, Math.min(40320, parseInt(duration) || 60));
            if (!member.moderatable) return res.status(400).json({ error: 'Non posso mutare questo utente' });
            await member.timeout(mins * 60 * 1000, cleanReason);
            actionLabel = 'User muted';
            durationText = `${mins} minutes`;
        } else if (action === 'kick') {
            if (!member.kickable) return res.status(400).json({ error: 'Non posso kickare questo utente' });
            await member.kick(cleanReason);
            actionLabel = 'User kicked';
        } else if (action === 'ban') {
            if (!member.bannable) return res.status(400).json({ error: 'Non posso bannare questo utente' });
            await member.ban({ reason: cleanReason });
            actionLabel = 'User banned';
        } else if (action === 'unban') {
            try {
                await guild.members.unban(userId, cleanReason);
                actionLabel = 'User unbanned';
            } catch (err) {
                return res.status(400).json({ error: 'Utente non bannato o ID non valido' });
            }
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
    app.listen(PORT, () => {
        console.log(`🌐 Dashboard attiva su porta ${PORT}`);
    });
}).catch((err) => {
    console.error('Errore avvio:', err.message);
    process.exit(1);
});

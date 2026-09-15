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

// ==================== GUILDS ====================
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

// ==================== COMANDI CUSTOM ====================
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

// ==================== MEMBRI ====================
app.get('/api/members/:guildId', requireAuth, async (req, res) => {
    try {
        const { client } = global.PredCord;
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Server non trovato' });

        await guild.members.fetch();
        const members = guild.members.cache
            .filter(m => !m.user.bot)
            .map(m => ({
                id: m.user.id,
                username: m.user.username,
                displayName: m.displayName,
                avatar: m.user.displayAvatarURL({ dynamic: true, size: 64 }),
                joinedAt: m.joinedAt
            }))
            .slice(0, 200);

        res.json(members);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==================== MODLOGS ====================
app.get('/api/modlogs/:guildId', requireAuth, (req, res) => {
    try {
        const modlogsFile = path.join(__dirname, 'modlogs.json');
        let logs = [];

        if (fs.existsSync(modlogsFile)) {
            try {
                const all = JSON.parse(fs.readFileSync(modlogsFile, 'utf8'));
                for (const userId in all) {
                    const userLogs = all[userId];
                    if (Array.isArray(userLogs)) {
                        logs.push(...userLogs.filter(l => l.guildId === req.params.guildId));
                    }
                }
            } catch {}
        }

        logs.sort((a, b) => new Date(b.date) - new Date(a.date));
        res.json(logs.slice(0, 50));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==================== AZIONI MODERAZIONE ====================
app.post('/api/moderation/:guildId', requireAuth, async (req, res) => {
    try {
        const { client } = global.PredCord;
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

        try {
            if (action === 'warn') {
                const warnFile = path.join(__dirname, 'warnings.json');
                let warnings = {};
                if (fs.existsSync(warnFile)) {
                    try { warnings = JSON.parse(fs.readFileSync(warnFile, 'utf8')); } catch {}
                }
                if (!warnings[userId]) warnings[userId] = [];
                warnings[userId].push({
                    id: warnings[userId].length + 1,
                    moderatorId: moderator.id,
                    moderatorTag: moderator.tag,
                    reason: cleanReason,
                    date: new Date().toISOString(),
                    dateFormatted: `<t:${Math.floor(Date.now() / 1000)}:F>`
                });
                fs.writeFileSync(warnFile, JSON.stringify(warnings, null, 2));
            } else if (action === 'mute') {
                const mins = Math.max(1, Math.min(40320, parseInt(duration) || 60));
                await member.timeout(mins * 60 * 1000, cleanReason);
            } else if (action === 'kick') {
                if (!member.kickable) return res.status(400).json({ error: 'Non posso kickare questo utente' });
                await member.kick(cleanReason);
            } else if (action === 'ban') {
                if (!member.bannable) return res.status(400).json({ error: 'Non posso bannare questo utente' });
                await member.ban({ reason: cleanReason });
            } else {
                return res.status(400).json({ error: 'Azione non valida' });
            }

            // Salva modlog
            const modlogsFile = path.join(__dirname, 'modlogs.json');
            let modlogs = {};
            if (fs.existsSync(modlogsFile)) {
                try { modlogs = JSON.parse(fs.readFileSync(modlogsFile, 'utf8')); } catch {}
            }
            if (!modlogs[userId]) modlogs[userId] = [];
            modlogs[userId].push({
                id: modlogs[userId].length + 1,
                action: action.charAt(0).toUpperCase() + action.slice(1),
                targetId: userId,
                targetTag: member.user.tag,
                moderatorId: moderator.id,
                moderatorTag: moderator.tag,
                reason: cleanReason,
                duration: action === 'mute' ? `${duration} minuti` : null,
                guildId: guild.id,
                guildName: guild.name,
                date: new Date().toISOString(),
                dateFormatted: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                type: action
            });
            fs.writeFileSync(modlogsFile, JSON.stringify(modlogs, null, 2));

            res.json({ success: true, username: member.user.tag });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==================== PAGINA PRINCIPALE ====================
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

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
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

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'predcord-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 8,
        secure: true,
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

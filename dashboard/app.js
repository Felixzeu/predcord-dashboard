let currentGuild = null;
let currentCommands = {};
let editingName = null;
let currentMembers = [];
let currentModlogs = [];

// ==================== TOAST ====================
function showToast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${type === 'success' ? '✅' : '❌'}</span> ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

// ==================== INIT ====================
async function init() {
    try {
        const me = await fetch('/api/me');
        if (!me.ok) { window.location.href = '/login'; return; }
        await loadGuilds();
        setupEvents();
    } catch (e) {
        console.error('Init error:', e);
        window.location.href = '/login';
    }
}

async function loadGuilds() {
    try {
        const res = await fetch('/api/guilds');
        const guilds = await res.json();
        const select = document.getElementById('guildSelect');
        select.innerHTML = '';

        if (!Array.isArray(guilds) || guilds.length === 0) {
            select.innerHTML = '<option value="">Nessun server</option>';
            document.getElementById('commandsList').innerHTML =
                '<div class="empty-state"><h3>Nessun server trovato</h3><p>Invita il bot in un server</p></div>';
            return;
        }

        guilds.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = `${g.name} • ${g.memberCount} membri`;
            select.appendChild(opt);
        });

        currentGuild = guilds[0].id;
        await loadCommands();
    } catch (e) {
        console.error('loadGuilds error:', e);
    }
}

// ==================== COMANDI CUSTOM ====================
async function loadCommands() {
    if (!currentGuild) return;
    const list = document.getElementById('commandsList');
    list.innerHTML = '<div class="loading">Caricamento</div>';
    try {
        const res = await fetch(`/api/commands/${currentGuild}`);
        currentCommands = await res.json();
        renderCommands();
    } catch (e) {
        currentCommands = {};
        renderCommands();
    }
}

function renderCommands() {
    const list = document.getElementById('commandsList');
    const entries = Object.entries(currentCommands);

    if (entries.length === 0) {
        list.innerHTML = `<div class="empty-state">
            <h3>Nessun comando custom</h3>
            <p>Clicca "+ Nuovo Comando" per crearne uno</p>
        </div>`;
        return;
    }

    list.innerHTML = entries.map(([name, cmd]) => `
        <div class="command-card">
            <div class="command-info">
                <h4>*${name}<span class="command-badge ${cmd.permission}">${cmd.permission}</span></h4>
                <p>${cmd.type === 'embed' ? '📦 Embed' : '💬 Testo'} • ${truncate(cmd.response || '', 70)}</p>
            </div>
            <div class="command-actions">
                <button class="btn-edit" data-name="${name}">✏️ Modifica</button>
                <button class="btn-delete" data-name="${name}">🗑️</button>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('.btn-edit').forEach(b => b.onclick = () => openModal(b.dataset.name));
    list.querySelectorAll('.btn-delete').forEach(b => b.onclick = () => deleteCommand(b.dataset.name));
}

function truncate(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n) + '...' : str;
}

function openModal(name = null) {
    editingName = name;
    const modal = document.getElementById('modal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('cmdForm');
    form.reset();

    if (name && currentCommands[name]) {
        const cmd = currentCommands[name];
        title.textContent = 'Modifica Comando';
        document.getElementById('cmdName').value = name;
        document.getElementById('cmdName').disabled = true;
        document.getElementById('cmdType').value = cmd.type || 'text';
        document.getElementById('cmdTitle').value = cmd.title || '';
        document.getElementById('cmdResponse').value = cmd.response || '';
        document.getElementById('cmdColor').value = '#' + (cmd.color || 0xE67E22).toString(16).padStart(6, '0');
        document.getElementById('cmdPermission').value = cmd.permission || 'everyone';
        document.getElementById('cmdDelete').checked = cmd.deleteCommand !== false;
    } else {
        title.textContent = 'Nuovo Comando';
        document.getElementById('cmdName').disabled = false;
        document.getElementById('cmdColor').value = '#E67E22';
    }
    updateTypeUI();
    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('cmdName').focus(), 100);
}

function updateTypeUI() {
    const typeEl = document.getElementById('cmdType');
    const hint = document.getElementById('responseHint');
    const label = document.getElementById('labelResponse');
    const response = document.getElementById('cmdResponse');
    const deleteCheck = document.getElementById('cmdDelete');

    if (!typeEl || !hint) return;
    const type = typeEl.value;

    const hints = {
        text: '💬 Il bot risponde con questo testo. Variabili: {user} {username} {server} {membercount} {args}',
        embed: '📦 Il bot risponde con un embed. Variabili: {user} {username} {server} {membercount} {args}',
        ban: '🔨 Uso: `*comando @utente motivo`. Il motivo in Risposta è opzionale (di default).',
        kick: '👢 Uso: `*comando @utente motivo`. Il motivo in Risposta è opzionale (di default).',
        mute: '🔇 Uso: `*comando @utente minuti motivo`. Il motivo in Risposta è opzionale (di default).',
        warn: '⚠️ Uso: `*comando @utente motivo`. Il motivo in Risposta è opzionale (di default).',
        purge: '🗑️ Uso: `*comando numero`. Elimina N messaggi (1-100). Il campo Risposta non serve.'
    };

    hint.textContent = hints[type] || '';

    if (['ban', 'kick', 'mute', 'warn', 'purge'].includes(type)) {
        label.textContent = 'Motivo (opzionale)';
        response.placeholder = 'Motivo di default (opzionale)';
        response.required = false;
        if (deleteCheck) deleteCheck.checked = true;
    } else {
        label.textContent = 'Risposta';
        response.placeholder = 'Variabili: {user} {username} {server} {membercount} {args}';
        response.required = true;
    }
}
function openModal(name = null) {
    editingName = name;
    const modal = document.getElementById('modal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('cmdForm');
    form.reset();

    if (name && currentCommands[name]) {
        const cmd = currentCommands[name];
        title.textContent = 'Modifica Comando';
        document.getElementById('cmdName').value = name;
        document.getElementById('cmdName').disabled = true;
        document.getElementById('cmdType').value = cmd.type || 'text';
        document.getElementById('cmdTitle').value = cmd.title || '';
        document.getElementById('cmdResponse').value = cmd.response || '';
        document.getElementById('cmdColor').value = '#' + (cmd.color || 0xE67E22).toString(16).padStart(6, '0');
        document.getElementById('cmdPermission').value = cmd.permission || 'everyone';
        document.getElementById('cmdDelete').checked = cmd.deleteCommand !== false;
    } else {
        title.textContent = 'Nuovo Comando';
        document.getElementById('cmdName').disabled = false;
        document.getElementById('cmdColor').value = '#E67E22';
    }
     updateTypeUI();
      modal.classList.remove('hidden');
     setTimeout(() => document.getElementById('cmdName').focus(), 100);
  }
  function updateTypeUI() {
    const typeEl = document.getElementById('cmdType');
    const hint = document.getElementById('responseHint');
    const label = document.getElementById('labelResponse');
    const response = document.getElementById('cmdResponse');
    const deleteCheck = document.getElementById('cmdDelete');

    if (!typeEl || !hint) return;
    const type = typeEl.value;

    const hints = {
        text: '💬 Il bot risponde con questo testo. Variabili: {user} {username} {server} {membercount} {args}',
        embed: '📦 Il bot risponde con un embed. Variabili: {user} {username} {server} {membercount} {args}',
        ban: '🔨 Uso: `*comando @utente motivo`. Il motivo in Risposta è opzionale (di default).',
        kick: '👢 Uso: `*comando @utente motivo`. Il motivo in Risposta è opzionale (di default).',
        mute: '🔇 Uso: `*comando @utente minuti motivo`. Il motivo in Risposta è opzionale (di default).',
        warn: '⚠️ Uso: `*comando @utente motivo`. Il motivo in Risposta è opzionale (di default).',
        purge: '🗑️ Uso: `*comando numero`. Elimina N messaggi (1-100). Il campo Risposta non serve.'
    };

    hint.textContent = hints[type] || '';

    if (['ban', 'kick', 'mute', 'warn', 'purge'].includes(type)) {
        label.textContent = 'Motivo (opzionale)';
        response.placeholder = 'Motivo di default (opzionale)';
        response.required = false;
        if (deleteCheck) deleteCheck.checked = true;
    } else {
        label.textContent = 'Risposta';
        response.placeholder = 'Variabili: {user} {username} {server} {membercount} {args}';
        response.required = true;
    }
}
}

function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    editingName = null;
}

async function saveCommand(e) {
    e.preventDefault();
    const name = document.getElementById('cmdName').value.trim().toLowerCase();
    const colorHex = document.getElementById('cmdColor').value;
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Salvataggio...';
    btn.disabled = true;

    const data = {
        type: document.getElementById('cmdType').value,
        title: document.getElementById('cmdTitle').value,
        response: document.getElementById('cmdResponse').value,
        color: parseInt(colorHex.replace('#', ''), 16),
        permission: document.getElementById('cmdPermission').value,
        deleteCommand: document.getElementById('cmdDelete').checked
    };

    try {
        const res = await fetch(`/api/commands/${currentGuild}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, data })
        });
        if (res.ok) {
            closeModal();
            await loadCommands();
            showToast(`Comando *${name} salvato`);
        } else {
            const err = await res.json();
            showToast(err.error || 'Errore', 'error');
        }
    } catch (err) {
        showToast('Errore di connessione', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function deleteCommand(name) {
    if (!confirm(`Eliminare il comando *${name}?`)) return;
    try {
        const res = await fetch(`/api/commands/${currentGuild}/${name}`, { method: 'DELETE' });
        if (res.ok) {
            await loadCommands();
            showToast(`Comando *${name} eliminato`);
        }
    } catch (e) {
        showToast('Errore: ' + e.message, 'error');
    }
}

// ==================== MODERAZIONE ====================
async function loadMembers() {
    if (!currentGuild) return;
    const list = document.getElementById('membersList');
    list.innerHTML = '<div class="loading">Caricamento</div>';
    try {
        const res = await fetch(`/api/members/${currentGuild}`);
        if (!res.ok) throw new Error('Errore caricamento');
        currentMembers = await res.json();
        renderMembers(currentMembers);
    } catch (e) {
        list.innerHTML = `<div class="empty-state"><h3>Errore</h3><p>${e.message}</p></div>`;
    }
}

function renderMembers(members) {
    const list = document.getElementById('membersList');
    if (!members || members.length === 0) {
        list.innerHTML = '<div class="empty-state"><h3>Nessun membro</h3></div>';
        return;
    }
    list.innerHTML = members.map(m => `
        <div class="member-card">
            <img class="member-avatar" src="${m.avatar}" alt="${m.username}" onerror="this.style.display='none'">
            <div class="member-info">
                <h5>${m.username}</h5>
                <p>${m.id}</p>
            </div>
            <div class="member-actions">
                <button class="mod-btn warn" data-action="warn" data-id="${m.id}" data-name="${m.username}" title="Warn">⚠️</button>
                <button class="mod-btn mute" data-action="mute" data-id="${m.id}" data-name="${m.username}" title="Mute">🔇</button>
                <button class="mod-btn kick" data-action="kick" data-id="${m.id}" data-name="${m.username}" title="Kick">👢</button>
                <button class="mod-btn ban" data-action="ban" data-id="${m.id}" data-name="${m.username}" title="Ban">🔨</button>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('.mod-btn').forEach(b => {
        b.onclick = () => openModModal(b.dataset.action, b.dataset.id, b.dataset.name);
    });
}

async function loadModlogs() {
    if (!currentGuild) return;
    const list = document.getElementById('modlogsList');
    list.innerHTML = '<div class="loading">Caricamento</div>';
    try {
        const res = await fetch(`/api/modlogs/${currentGuild}`);
        if (!res.ok) throw new Error('Errore caricamento');
        currentModlogs = await res.json();
        renderModlogs(currentModlogs);
    } catch (e) {
        list.innerHTML = `<div class="empty-state"><h3>Errore</h3><p>${e.message}</p></div>`;
    }
}

function renderModlogs(logs) {
    const list = document.getElementById('modlogsList');
    if (!logs || logs.length === 0) {
        list.innerHTML = '<div class="empty-state"><h3>Nessuna azione</h3><p>Nessuna moderazione registrata</p></div>';
        return;
    }
    list.innerHTML = logs.map(log => `
        <div class="modlog-card">
            <div class="modlog-header">
                <span class="modlog-badge ${(log.type || 'warn').toLowerCase()}">${log.type || log.action || 'N/A'}</span>
                <span class="modlog-target">${log.targetTag || log.targetId}</span>
            </div>
            <div class="modlog-reason">📝 ${log.reason || 'Nessun motivo'}</div>
            <div class="modlog-meta">
                👮 ${log.moderatorTag || 'Sistema'} • 🕐 ${log.dateFormatted || log.date || ''}
                ${log.duration ? ` • ⏱️ ${log.duration}` : ''}
            </div>
        </div>
    `).join('');
}

function openModModal(action, userId, username) {
    document.getElementById('modAction').value = action;
    document.getElementById('modUserId').value = userId;
    document.getElementById('modUserDisplay').value = `${username} (${userId})`;

    const titles = {
        warn: '⚠️ Warn Utente',
        mute: '🔇 Mute Utente',
        kick: '👢 Kick Utente',
        ban: '🔨 Ban Utente'
    };
    document.getElementById('modModalTitle').textContent = titles[action] || 'Azione';

    const durationLabel = document.getElementById('modDurationLabel');
    const durationInput = document.getElementById('modDuration');
    if (action === 'mute') {
        durationLabel.classList.remove('hidden');
        durationInput.classList.remove('hidden');
    } else {
        durationLabel.classList.add('hidden');
        durationInput.classList.add('hidden');
    }

    document.getElementById('modReason').value = '';
    document.getElementById('modModal').classList.remove('hidden');
}

function closeModModal() {
    document.getElementById('modModal').classList.add('hidden');
}

async function submitModAction(e) {
    e.preventDefault();
    const action = document.getElementById('modAction').value;
    const userId = document.getElementById('modUserId').value;
    const reason = document.getElementById('modReason').value || 'Nessun motivo';
    const duration = document.getElementById('modDuration').value;
    const btn = document.getElementById('modSubmitBtn');

    btn.disabled = true;
    btn.textContent = 'Esecuzione...';

    try {
        const res = await fetch(`/api/moderation/${currentGuild}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, userId, reason, duration })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showToast(`✅ ${action} eseguito su ${data.username || userId}`);
            closeModModal();
            await loadModlogs();
        } else {
            showToast(data.error || 'Errore', 'error');
        }
    } catch (err) {
        showToast('Errore di connessione', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Conferma';
    }
}

// ==================== EVENTS ====================
function setupEvents() {
    document.getElementById('guildSelect').onchange = (e) => {
        currentGuild = e.target.value;
        loadCommands();
        if (!document.getElementById('tab-moderation').classList.contains('hidden')) {
            loadMembers();
            loadModlogs();
        }
    };

    document.getElementById('refreshBtn').onclick = () => {
        loadCommands();
        if (!document.getElementById('tab-moderation').classList.contains('hidden')) {
            loadMembers();
            loadModlogs();
        }
        showToast('Aggiornato');
    };

    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
            document.getElementById(`tab-${target}`).classList.remove('hidden');
            if (target === 'moderation') {
                loadMembers();
                loadModlogs();
            } else {
                loadCommands();
            }
        };
    });

    document.getElementById('memberSearch').oninput = (e) => {
        const q = e.target.value.toLowerCase();
        const filtered = currentMembers.filter(m =>
            m.username.toLowerCase().includes(q) || m.id.includes(q)
        );
        renderMembers(filtered);
    };

    document.getElementById('newCmdBtn').onclick = () => openModal();
    document.getElementById('cancelBtn').onclick = closeModal;
    document.getElementById('cmdForm').onsubmit = saveCommand;

    document.getElementById('modCancelBtn').onclick = closeModModal;
    document.getElementById('modForm').onsubmit = submitModAction;

    document.getElementById('logoutBtn').onclick = async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login';
    };

    document.getElementById('modal').onclick = (e) => {
        if (e.target.id === 'modal') closeModal();
    };
    document.getElementById('modModal').onclick = (e) => {
        if (e.target.id === 'modModal') closeModModal();
    };
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeModal(); closeModModal(); }
    });
}

init();

let currentGuild = null;
let currentCommands = {};
let editingName = null;

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
        document.getElementById('commandsList').innerHTML =
            '<div class="empty-state"><h3>Errore caricamento</h3><p>' + e.message + '</p></div>';
    }
}

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

// ==================== MODAL ====================
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

    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('cmdName').focus(), 100);
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

function setupEvents() {
    document.getElementById('guildSelect').onchange = (e) => {
        currentGuild = e.target.value;
        loadCommands();
    };
    document.getElementById('refreshBtn').onclick = () => {
        loadCommands();
        showToast('Lista aggiornata');
    };
    document.getElementById('newCmdBtn').onclick = () => openModal();
    document.getElementById('cancelBtn').onclick = closeModal;
    document.getElementById('cmdForm').onsubmit = saveCommand;
    document.getElementById('logoutBtn').onclick = async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login';
    };
    document.getElementById('modal').onclick = (e) => {
        if (e.target.id === 'modal') closeModal();
    };
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
}

init();

let currentGuild = null;
let currentCommands = {};
let editingName = null;
let currentMembers = [];
let currentModlogs = [];
let currentRoles = [];
let currentChannels = [];
let rolesLoaded = false;
let configLoaded = false;
let dashboardPermissions = {
    createRoles: [],
    editRoles: [],
    deleteRoles: [],
    viewLogsRoles: [],
    adminUsers: [],
    ownerUsers: [],
    projectedRoles: []
};
let isAdmin = false;
let isDiscord = false;
let myRole = 'none';
let myPermissions = {
    createRoles: false,
    editRoles: false,
    deleteRoles: false,
    viewLogsRoles: false,
    managePermissions: false
};

function isOwner() {
    return isAdmin || myRole === 'owner';
}

function showToast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function showAccessDenied() {
    const el = document.getElementById('accessDeniedToast');
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('show');
    if (window._accessDeniedTimeout) clearTimeout(window._accessDeniedTimeout);
    window._accessDeniedTimeout = setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.classList.add('hidden'), 300);
    }, 2000);
}

function shakeModal() {
    const modalContent = document.querySelector('#modal .modal-content');
    if (!modalContent) return;
    modalContent.classList.remove('shake');
    void modalContent.offsetWidth;
    modalContent.classList.add('shake');
}

function showFormToast(message = 'Fill all fields') {
    const toast = document.getElementById('formToast');
    if (!toast) return;
    const textEl = toast.querySelector('.form-toast-text');
    if (textEl) textEl.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    if (window._formToastTimeout) clearTimeout(window._formToastTimeout);
    window._formToastTimeout = setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.classList.add('hidden'), 300);
    }, 3000);
}

function hideFormToast() {
    const toast = document.getElementById('formToast');
    if (!toast) return;
    if (window._formToastTimeout) clearTimeout(window._formToastTimeout);
    toast.classList.remove('show');
    toast.classList.add('hidden');
}

function clearInvalidFields() {
    document.querySelectorAll('.field-invalid').forEach(el => {
        el.classList.remove('field-invalid');
    });
}

function markFieldInvalid(el) {
    if (!el) return;
    el.classList.add('field-invalid');
    el.addEventListener('input', function handler() {
        el.classList.remove('field-invalid');
        el.removeEventListener('input', handler);
    });
    el.addEventListener('change', function handler2() {
        el.classList.remove('field-invalid');
        el.removeEventListener('change', handler2);
    });
}

function showConfirmDialog(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmModalTitle');
    const textEl = document.getElementById('confirmModalText');
    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');

    if (!modal || !titleEl || !textEl || !okBtn || !cancelBtn) return;

    titleEl.textContent = title;
    textEl.textContent = message;

    const closeDialog = () => {
        modal.classList.add('hidden');
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        modal.onclick = null;
    };

    okBtn.onclick = () => {
        closeDialog();
        if (typeof onConfirm === 'function') onConfirm();
    };

    cancelBtn.onclick = closeDialog;

    modal.onclick = (e) => {
        if (e.target.id === 'confirmModal') closeDialog();
    };

    modal.classList.remove('hidden');
}

function brightenColor(hex, percent = 45) {
    if (!hex || typeof hex !== 'string') return null;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    if (c.length !== 6) return null;

    let r = parseInt(c.substring(0, 2), 16);
    let g = parseInt(c.substring(2, 4), 16);
    let b = parseInt(c.substring(4, 6), 16);

    r = Math.min(255, Math.round(r + (255 - r) * (percent / 100)));
    g = Math.min(255, Math.round(g + (255 - g) * (percent / 100)));
    b = Math.min(255, Math.round(b + (255 - b) * (percent / 100)));

    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function init() {
    try {
        const me = await fetch('/api/me', { credentials: 'same-origin' });
        if (!me.ok) {
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
            return;
        }
        const meData = await me.json();
        isAdmin = !!meData.isAdmin;
        isDiscord = !!meData.isDiscord;
        myRole = meData.role || 'none';

        await loadMyPermissions();
        await loadGuilds();
        setupEvents();
        setupUserMenu();
        await loadUserMenu();
        updatePreview();
        updatePermissionsTabVisibility();
    } catch (e) {
        console.error('[INIT] Error:', e);
    }
}

function setupUserMenu() {
    const btn = document.getElementById('userAvatarBtn');
    const dropdown = document.getElementById('userDropdown');

    if (!btn || !dropdown) return;

    btn.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
    };

    document.addEventListener('click', (e) => {
        if (!dropdown.classList.contains('hidden') && !e.target.closest('#userMenu')) {
            dropdown.classList.add('hidden');
        }
    });
}

async function loadUserMenu() {
    const defaultAvatar = 'https://cdn.discordapp.com/embed/avatars/0.png';

    const avatarBtnImg = document.getElementById('userAvatarImg');
    const ddAvatar = document.getElementById('userDropdownAvatar');
    const ddDisplayName = document.getElementById('userDropdownDisplayName');
    const ddUsername = document.getElementById('userDropdownUsername');
    const ddRoles = document.getElementById('userDropdownRoles');

    try {
        const meRes = await fetch('/api/me', { credentials: 'same-origin' });
        if (!meRes.ok) throw new Error('Failed to load user');
        const meRaw = await meRes.json();
        const me = meRaw.user || meRaw;

        let avatarUrl = defaultAvatar;
        if (me.avatar) {
            if (typeof me.avatar === 'string' && me.avatar.startsWith('http')) {
                avatarUrl = me.avatar;
            } else if (me.id) {
                const ext = me.avatar.startsWith('a_') ? 'gif' : 'png';
                avatarUrl = `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.${ext}?size=128`;
            }
        } else if (me.id) {
            try {
                const index = Number(BigInt(me.id) >> 22n) % 6;
                avatarUrl = `https://cdn.discordapp.com/embed/avatars/${index}.png`;
            } catch {
                avatarUrl = defaultAvatar;
            }
        }

        if (avatarBtnImg) {
            avatarBtnImg.src = avatarUrl;
            avatarBtnImg.onerror = () => { avatarBtnImg.src = defaultAvatar; };
        }
        if (ddAvatar) {
            ddAvatar.src = avatarUrl;
            ddAvatar.onerror = () => { ddAvatar.src = defaultAvatar; };
        }

        let displayName = me.displayName || me.global_name || me.username || 'User';
        const username = me.username || '';

        if (ddDisplayName) ddDisplayName.textContent = displayName;
        if (ddUsername) {
            ddUsername.textContent = username || (me.id ? `ID: ${me.id}` : '—');
            ddUsername.title = me.id ? `ID: ${me.id}` : '';
            if (me.id) {
                ddUsername.style.cursor = 'pointer';
                ddUsername.onclick = () => {
                    navigator.clipboard.writeText(me.id).then(() => {
                        showToast('User ID copied');
                    }).catch(() => {});
                };
            }
        }

        if (ddRoles) {
            ddRoles.innerHTML = '<span class="loading-text">Loading...</span>';
        }

        try {
            const fullRes = await fetch('/api/me/full', { credentials: 'same-origin' });
            if (fullRes.ok) {
                const full = await fullRes.json();

                if (full.avatar) {
                    const fullAvatar = full.avatar;
                    if (avatarBtnImg) {
                        avatarBtnImg.src = fullAvatar;
                        avatarBtnImg.onerror = () => { avatarBtnImg.src = defaultAvatar; };
                    }
                    if (ddAvatar) {
                        ddAvatar.src = fullAvatar;
                        ddAvatar.onerror = () => { ddAvatar.src = defaultAvatar; };
                    }
                }

                if (full.displayName) {
                    displayName = full.displayName;
                    if (ddDisplayName) ddDisplayName.textContent = displayName;
                }

                if (ddRoles) {
                    const roles = Array.isArray(full.roles) ? full.roles : [];
                    if (roles.length === 0) {
                        ddRoles.innerHTML = '<span class="loading-text">No roles</span>';
                    } else {
                        ddRoles.innerHTML = roles.map(r => {
                            const rawColor = r.color;
                            const hasColor = typeof rawColor === 'string' && rawColor !== '#000000' && rawColor !== '#000';
                            const bright = hasColor ? brightenColor(rawColor, 50) : null;
                            const style = bright
                                ? `style="color:${bright}; border-color:${bright}66; background:${bright}22; box-shadow:0 0 8px ${bright}55, inset 0 0 8px ${bright}22;"`
                                : '';
                            return `<span class="user-role-badge" ${style}>${escapeHtml(r.name)}</span>`;
                        }).join('');
                    }
                }
            } else if (ddRoles) {
                ddRoles.innerHTML = '<span class="loading-text">No roles</span>';
            }
        } catch (err) {
            console.error('[ME-FULL]', err);
            if (ddRoles) ddRoles.innerHTML = '<span class="loading-text">Error</span>';
        }
    } catch (e) {
        console.error('[USER-MENU] Error:', e);
        if (ddDisplayName) ddDisplayName.textContent = 'User';
        if (ddUsername) ddUsername.textContent = '—';
        if (ddRoles) ddRoles.innerHTML = '<span class="loading-text">Error</span>';
    }
}

async function loadMyPermissions() {
    try {
        const res = await fetch('/api/my-permissions');
        if (!res.ok) throw new Error('Failed to load user permissions');
        myPermissions = await res.json();
    } catch (e) {
        console.error('[MY-PERMISSIONS] Error:', e);
        myPermissions = { createRoles: false, editRoles: false, deleteRoles: false, viewLogsRoles: false, managePermissions: false };
    }
}

function updatePermissionsTabVisibility() {
    const permTab = document.getElementById('navTabPermissions');
    const configTab = document.getElementById('navTabConfig');
    const ticketsTab = document.getElementById('navTabTickets');

    if (permTab) {
        if (myPermissions.managePermissions) permTab.classList.remove('hidden');
        else permTab.classList.add('hidden');
    }

    if (configTab) {
        if (isOwner()) configTab.classList.remove('hidden');
        else configTab.classList.add('hidden');
    }

    if (ticketsTab) {
        if (isOwner()) ticketsTab.classList.remove('hidden');
        else ticketsTab.classList.add('hidden');
    }
}

async function loadGuilds() {
    try {
        const res = await fetch('/api/guilds');
        if (!res.ok) throw new Error('GET /api/guilds → ' + res.status);
        const guilds = await res.json();

        if (!Array.isArray(guilds) || guilds.length === 0) {
            document.getElementById('commandsList').innerHTML =
                '<div class="empty-state"><h3>No server found</h3><p>Invite the bot to a server</p></div>';
            return;
        }

        currentGuild = guilds[0].id;
        await loadPermissions();
        await loadCommands();
    } catch (e) {
        console.error('[INIT] loadGuilds error:', e);
        document.getElementById('commandsList').innerHTML =
            `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
    }
}

async function loadPermissions() {
    if (!currentGuild) return;
    try {
        const res = await fetch(`/api/permissions/${currentGuild}`);
        if (!res.ok) throw new Error('Failed to load permissions');
        dashboardPermissions = await res.json();
    } catch (e) {
        console.error('[PERMISSIONS] loadPermissions error:', e);
        dashboardPermissions = { createRoles: [], editRoles: [], deleteRoles: [], viewLogsRoles: [], adminUsers: [], ownerUsers: [], projectedRoles: [] };
    }
}

function userHasDashboardPermission(permKey) {
    if (isAdmin) return true;
    return !!myPermissions[permKey];
}

async function loadCommands() {
    if (!currentGuild) {
        document.getElementById('commandsList').innerHTML =
            '<div class="empty-state"><h3>No server selected</h3></div>';
        return;
    }
    const list = document.getElementById('commandsList');
    list.innerHTML = '<div class="loading">Loading</div>';
    try {
        const res = await fetch(`/api/commands/${currentGuild}`);
        if (!res.ok) throw new Error(`GET /api/commands → status ${res.status}`);
        currentCommands = await res.json();
        renderCommands();
    } catch (e) {
        console.error('[INIT] loadCommands error:', e);
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
    }
}

function renderCommands() {
    const list = document.getElementById('commandsList');
    const entries = Object.entries(currentCommands);

    if (entries.length === 0) {
        list.innerHTML = `<div class="empty-state">
            <h3>No custom commands</h3>
            <p>Click "+ New Command" to create one</p>
        </div>`;
        return;
    }

    list.innerHTML = entries.map(([name, cmd]) => {
        let badge = '<span class="command-badge none">No roles</span>';
        if (Array.isArray(cmd.allowedRoles) && cmd.allowedRoles.length > 0) {
            badge = `<span class="command-badge roles">${cmd.allowedRoles.length} role${cmd.allowedRoles.length === 1 ? '' : 's'}</span>`;
        }

        const baseBadge = cmd.isBase
            ? '<span class="command-badge base">BASE</span>'
            : '';

        const cardClass = cmd.isBase ? 'command-card base-command' : 'command-card';

        return `
        <div class="${cardClass}">
            <div class="command-info">
                <h4>${escapeHtml(name)}</h4>
                <div class="command-badges">${badge}${baseBadge}</div>
            </div>
            <div class="command-actions">
                <button class="btn-edit" data-name="${escapeAttr(name)}">Edit</button>
                <button class="btn-delete" data-name="${escapeAttr(name)}">Delete</button>
            </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.btn-edit').forEach(b => b.onclick = () => {
        if (!userHasDashboardPermission('editRoles')) {
            showAccessDenied();
            return;
        }
        openModal(b.dataset.name);
    });

    list.querySelectorAll('.btn-delete').forEach(b => b.onclick = () => {
        if (!userHasDashboardPermission('deleteRoles')) {
            showAccessDenied();
            return;
        }
        deleteCommand(b.dataset.name);
    });
}

function truncate(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n) + '...' : str;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/"/g, '&quot;');
}

function openModal(name = null) {
    if (!userHasDashboardPermission('createRoles') && !userHasDashboardPermission('editRoles')) {
        showAccessDenied();
        return;
    }

    clearInvalidFields();
    hideFormToast();

    editingName = name;
    const modal = document.getElementById('modal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('cmdForm');
    form.reset();

    updatePurgeOptionVisibility();

    if (name && currentCommands[name]) {
        const cmd = currentCommands[name];
        title.textContent = 'Edit Command';
        document.getElementById('cmdName').value = name;
        document.getElementById('cmdName').disabled = true;
        document.getElementById('cmdPrefix').value = cmd.prefix || '*';
        document.getElementById('cmdType').value = cmd.type || 'text';
        document.getElementById('cmdTitle').value = cmd.title || '';
        document.getElementById('cmdResponse').value = cmd.response || '';
        document.getElementById('cmdColor').value = '#' + (typeof cmd.color === 'number' ? cmd.color : 0xE67E22).toString(16).padStart(6, '0');
        document.getElementById('cmdThumbnail').value = cmd.thumbnail || '';
        document.getElementById('cmdImage').value = cmd.image || '';
        document.getElementById('cmdDelete').checked = cmd.deleteCommand !== false;
        document.getElementById('cmdDuration').value = cmd.duration || '';

        clearExtraEmbeds();
        if (Array.isArray(cmd.extraEmbeds)) {
            cmd.extraEmbeds.forEach(e => addEmbedBlock(e, true));
        }

        const baseToggle = document.getElementById('cmdIsBase');
        if (baseToggle) {
            baseToggle.checked = !!cmd.isBase;
        }
    } else {
        title.textContent = 'New Command';
        document.getElementById('cmdName').disabled = false;
        document.getElementById('cmdPrefix').value = '*';
        document.getElementById('cmdColor').value = '#E67E22';
        document.getElementById('cmdThumbnail').value = '';
        document.getElementById('cmdImage').value = '';
        document.getElementById('cmdDelete').checked = true;
        document.getElementById('cmdDuration').value = '';

        clearExtraEmbeds();

        const baseToggle = document.getElementById('cmdIsBase');
        if (baseToggle) {
            baseToggle.checked = false;
        }
    }

    updateBaseToggleVisibility();

    rolesLoaded = false;
    currentRoles = [];
    document.getElementById('rolesList').innerHTML = '<p class="loading-text">Open to load roles...</p>';
    closePermissionsBox();
    closeMoreOptions();

    updateTypeUI();
    updatePreview();
    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('cmdName').focus(), 100);
}

function updatePurgeOptionVisibility() {
    const purgeOpt = document.getElementById('purgeOption');
    if (!purgeOpt) return;
    if (myRole === 'owner' || isAdmin) {
        purgeOpt.classList.remove('hidden');
        purgeOpt.disabled = false;
    } else {
        purgeOpt.classList.add('hidden');
        purgeOpt.disabled = true;
    }
}

function updateBaseToggleVisibility() {
    const wrap = document.getElementById('baseToggleWrap');
    if (!wrap) return;
    if (myRole === 'owner' || isAdmin) {
        wrap.classList.remove('hidden');
    } else {
        wrap.classList.add('hidden');
    }
}

function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('modal').classList.remove('open-with-permissions');
    closePermissionsBox();
    closeMoreOptions();
    editingName = null;
    rolesLoaded = false;
    currentRoles = [];

    clearInvalidFields();
    hideFormToast();
}

function updateTypeUI() {
    const type = document.getElementById('cmdType').value;
    const hint = document.getElementById('responseHint');
    const responseLabel = document.getElementById('responseLabelText');
    const response = document.getElementById('cmdResponse');
    const deleteCheck = document.getElementById('cmdDelete');

    const wrapTitle = document.getElementById('labelTitle');
    const wrapColor = document.getElementById('labelColor');
    const wrapThumb = document.getElementById('labelThumbnail');
    const wrapImage = document.getElementById('labelImage');
    const wrapExtraEmbeds = document.getElementById('extraEmbedsWrap');
    const wrapDuration = document.getElementById('labelDuration');
    const durationInput = document.getElementById('cmdDuration');
    const durationHint = document.getElementById('durationHint');
    const durationLabelText = document.getElementById('durationLabelText');
    const previewSection = document.getElementById('previewSection');
    const labelResponse = document.getElementById('labelResponse');

    const hints = {
        text: 'The bot replies with this text. Variables: {user} {username} {server} {membercount} {args} {md} {hammertime+N} | Positional args: $1 $2 $3 ...',
        embed: 'The bot replies with an embed. Variables: {user} {username} {server} {membercount} {args} {md} {hammertime+N} | Positional args: $1 $2 $3 ...',
        ban: 'Usage: {prefix}command @user reason. The reason in Response is optional (uses default). Supports $1 $2 $3 ...',
        kick: 'Usage: {prefix}command @user reason. The reason in Response is optional (uses default). Supports $1 $2 $3 ...',
        mute: 'Usage: {prefix}command @user reason. The reason in Response is optional (uses default). Supports $1 $2 $3 ...',
        warn: 'Usage: {prefix}command @user reason. The reason in Response is optional (uses default). Supports $1 $2 $3 ...',
        purge: 'Usage: {prefix}command [number] - Deletes N messages in the current channel (1-100).'
    };

    const currentPrefix = document.getElementById('cmdPrefix').value || '*';
    let hintText = hints[type] || '';
    hintText = hintText.replace(/{prefix}/g, currentPrefix);
    hint.textContent = hintText;

    const isEmbed = type === 'embed';
    const isText = type === 'text';
    const isPurge = type === 'purge';
    const isModAction = ['ban', 'kick', 'mute', 'warn'].includes(type);
    const isBan = type === 'ban';
    const isMute = type === 'mute';
    const showDuration = isBan || isMute;

    wrapTitle.style.display = isEmbed ? 'block' : 'none';
    wrapColor.style.display = isEmbed ? 'block' : 'none';
    wrapThumb.style.display = isEmbed ? 'block' : 'none';
    wrapImage.style.display = (isEmbed || isText) ? 'block' : 'none';
    wrapDuration.style.display = showDuration ? 'block' : 'none';
    if (wrapExtraEmbeds) wrapExtraEmbeds.style.display = isEmbed ? 'block' : 'none';

    if (labelResponse) {
        labelResponse.style.display = isPurge ? 'none' : 'block';
    }

    if (previewSection) {
        previewSection.style.display = (isEmbed || isText) ? 'block' : 'none';
    }

    if (isEmbed) {
        const colorInput = document.getElementById('cmdColor');
        if (colorInput && (!colorInput.value || colorInput.value === '#e67e22' || colorInput.value === '#E67E22')) {
            colorInput.value = '#7289da';
        }
    }

    if (isBan) {
        durationInput.removeAttribute('max');
        durationInput.placeholder = 'e.g. 7 (leave empty for permanent ban)';
        durationLabelText.textContent = 'Duration (days)';
        durationHint.textContent = 'Leave empty for permanent ban. If filled, the bot will auto-unban after N days.';
    } else if (isMute) {
        durationInput.max = 28;
        durationInput.placeholder = 'e.g. 7 (leave empty for 28 days, max)';
        durationLabelText.textContent = 'Duration (days)';
        durationHint.textContent = 'Maximum 28 days. If empty, mute will last 28 days.';
    }

    if (isPurge) {
        response.required = false;
        response.value = '';
    } else if (isModAction) {
        responseLabel.textContent = 'Reason (optional)';
        response.placeholder = 'Default reason (optional)';
        response.required = false;
        if (deleteCheck) deleteCheck.checked = true;
    } else {
        responseLabel.textContent = 'Response';
        response.placeholder = 'Variables: {user} {username} {server} {membercount} {args} {md} {hammertime+N}';
        response.required = false;
    }

    updatePreview();
}

let extraEmbedCounter = 0;

function addEmbedBlock(data = {}, silent = false) {
    const list = document.getElementById('extraEmbedsList');
    if (!list) return;
    const idx = extraEmbedCounter++;
    const colorHex = '#' + (typeof data.color === 'number' ? data.color : 0x7289DA).toString(16).padStart(6, '0');
    const block = document.createElement('div');
    block.className = 'extra-embed-block';
    block.dataset.idx = idx;
    block.innerHTML = `
        <div class="extra-embed-header">
            <span>Embed extra</span>
            <button type="button" class="extra-embed-remove">&times;</button>
        </div>
        <label>Titolo</label>
        <input type="text" class="ee-title" value="${escapeAttr(data.title || '')}">
        <label>Risposta</label>
        <textarea class="ee-response" rows="3">${escapeHtml(data.response || '')}</textarea>
        <label>Colore</label>
        <input type="color" class="ee-color" value="${colorHex}">
        <label>Thumbnail URL (opzionale)</label>
        <input type="url" class="ee-thumbnail" value="${escapeAttr(data.thumbnail || '')}">
        <label>Image URL (opzionale)</label>
        <input type="url" class="ee-image" value="${escapeAttr(data.image || '')}">
    `;
    block.querySelector('.extra-embed-remove').onclick = () => { block.remove(); updatePreview(); };
    block.querySelectorAll('input, textarea').forEach(el => el.addEventListener('input', updatePreview));
    list.appendChild(block);
    if (!silent) updatePreview();
}

function clearExtraEmbeds() {
    const list = document.getElementById('extraEmbedsList');
    if (list) list.innerHTML = '';
}

function collectExtraEmbeds() {
    return Array.from(document.querySelectorAll('#extraEmbedsList .extra-embed-block')).map(block => ({
        title: block.querySelector('.ee-title').value || '',
        response: block.querySelector('.ee-response').value || '',
        color: parseInt((block.querySelector('.ee-color').value || '#7289da').replace('#', ''), 16),
        thumbnail: block.querySelector('.ee-thumbnail').value || null,
        image: block.querySelector('.ee-image').value || null
    }));
}

function closeMoreOptions() {
    const panel = document.getElementById('moreOptions');
    const btn = document.getElementById('moreBtn');
    if (panel) panel.classList.add('hidden');
    if (btn) btn.classList.remove('open');
}

function toggleMoreOptions() {
    const panel = document.getElementById('moreOptions');
    const btn = document.getElementById('moreBtn');
    if (!panel || !btn) return;
    const isHidden = panel.classList.contains('hidden');
    if (isHidden) {
        panel.classList.remove('hidden');
        btn.classList.add('open');
    } else {
        panel.classList.add('hidden');
        btn.classList.remove('open');
    }
}

function renderPreviewEmbed(title, colorHex, thumbnail, responseRaw, text, image) {
    let html = `<div class="discord-embed" style="border-left-color: ${escapeAttr(colorHex)};">`;
    if (thumbnail) {
        html += `<img class="discord-embed-thumb" src="${escapeAttr(thumbnail)}" alt="" onerror="this.style.display='none'">`;
    }
    if (title) {
        html += `<div class="discord-embed-title">${escapeHtml(title)}</div>`;
    }
    if (responseRaw.trim()) {
        html += `<div class="discord-embed-desc">${escapeHtml(text)}</div>`;
    } else {
        html += `<div class="discord-embed-desc preview-empty">Fill in the Response field to see the text.</div>`;
    }
    if (image) {
        html += `<img class="discord-embed-image" src="${escapeAttr(image)}" alt="" onerror="this.style.display='none'">`;
    }
    html += `</div>`;
    return html;
}

function updatePreview() {
    const preview = document.getElementById('previewContent');
    const avatar = document.getElementById('previewAvatar');
    if (!preview) return;

    if (avatar) {
        avatar.src = 'https://images-ext-1.discordapp.net/external/Lir9nmM9QUd1ClFMcchk0JDU4CPNed97Iui2Sm_rfOk/%3Fsize%3D1024/https/cdn.discordapp.com/avatars/1510639493642850355/9774661e36e8458550112734ce78dc14.webp?format=webp&width=320&height=320';
    }

    const type = document.getElementById('cmdType').value;
    const response = document.getElementById('cmdResponse').value || '';
    const title = document.getElementById('cmdTitle').value || '';
    const colorHex = document.getElementById('cmdColor').value || '#E67E22';
    const thumbnail = document.getElementById('cmdThumbnail').value || '';
    const image = document.getElementById('cmdImage').value || '';

    const isEmbed = type === 'embed';
    const isText = type === 'text';

    const text = response
        .replace(/{user}/g, '@Mario')
        .replace(/{username}/g, 'Mario')
        .replace(/{server}/g, 'PredCord')
        .replace(/{membercount}/g, '42')
        .replace(/{args}/g, 'example args')
        .replace(/{md}/g, '[modlogs placeholder]')
        .replace(/{hammertime[+-]\d+}/g, '[orario]')
        .replace(/\$(\d+)/g, (match, num) => `[arg${num}]`);

    if (isEmbed) {
        let html = renderPreviewEmbed(title, colorHex, thumbnail, response, text, image);

        document.querySelectorAll('#extraEmbedsList .extra-embed-block').forEach(block => {
            const eTitle = block.querySelector('.ee-title').value || '';
            const eColor = block.querySelector('.ee-color').value || '#7289da';
            const eThumb = block.querySelector('.ee-thumbnail').value || '';
            const eImage = block.querySelector('.ee-image').value || '';
            const eResponse = block.querySelector('.ee-response').value || '';
            const eText = eResponse
                .replace(/{user}/g, '@Mario')
                .replace(/{username}/g, 'Mario')
                .replace(/{server}/g, 'PredCord')
                .replace(/{membercount}/g, '42')
                .replace(/{args}/g, 'example args')
                .replace(/{md}/g, '[modlogs placeholder]')
                .replace(/{hammertime[+-]\d+}/g, '[orario]')
                .replace(/\$(\d+)/g, (match, num) => `[arg${num}]`);
            html += renderPreviewEmbed(eTitle, eColor, eThumb, eResponse, eText, eImage);
        });

        preview.innerHTML = html;
        return;
    }

    if (!response.trim()) {
        preview.innerHTML = '<p class="preview-empty">Fill in the Response field to see the preview.</p>';
        return;
    }

    if (isText && image) {
        let html = `<div class="discord-embed" style="border-left-color: ${escapeAttr(colorHex)};">`;
        html += `<div class="discord-embed-desc">${escapeHtml(text)}</div>`;
        html += `<img class="discord-embed-image" src="${escapeAttr(image)}" alt="" onerror="this.style.display='none'">`;
        html += `</div>`;
        preview.innerHTML = html;
    } else {
        preview.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
    }
}

function openPermissionsBox() {
    const box = document.getElementById('permissionsBox');
    const modal = document.getElementById('modal');

    box.classList.remove('hidden');
    modal.classList.add('open-with-permissions');

    if (!rolesLoaded) loadRoles();
}

function closePermissionsBox() {
    document.getElementById('permissionsBox').classList.add('hidden');
    document.getElementById('modal').classList.remove('open-with-permissions');
}

function togglePermissions() {
    const box = document.getElementById('permissionsBox');
    if (box.classList.contains('hidden')) {
        openPermissionsBox();
    } else {
        closePermissionsBox();
    }
}

async function loadRoles() {
    if (!currentGuild) return;
    const list = document.getElementById('rolesList');
    list.innerHTML = '<p class="loading-text">Loading roles...</p>';

    try {
        const res = await fetch(`/api/roles/${currentGuild}`);
        if (!res.ok) throw new Error('Failed to load roles');
        currentRoles = await res.json();
        rolesLoaded = true;
        renderRoles();
    } catch (e) {
        list.innerHTML = `<p class="loading-text">Error: ${e.message}</p>`;
    }
}

function renderRoles() {
    const list = document.getElementById('rolesList');

    if (!currentRoles || currentRoles.length === 0) {
        list.innerHTML = '<p class="loading-text">No roles available.</p>';
        return;
    }

    let selected = [];
    if (editingName && currentCommands[editingName] && Array.isArray(currentCommands[editingName].allowedRoles)) {
        selected = currentCommands[editingName].allowedRoles;
    }

    list.innerHTML = currentRoles.map(role => {
        const checked = selected.includes(role.id) ? 'checked' : '';
        return `
        <div class="role-item" data-role-id="${escapeAttr(role.id)}">
            <span class="role-name">${escapeHtml(role.name)}</span>
            <label class="role-toggle">
                <input type="checkbox" class="role-toggle-input" value="${escapeAttr(role.id)}" ${checked}>
                <span class="role-toggle-switch"></span>
            </label>
        </div>`;
    }).join('');
}

async function saveCommand(e) {
    e.preventDefault();

    if (editingName) {
        if (!userHasDashboardPermission('editRoles')) {
            showAccessDenied();
            return;
        }
    } else {
        if (!userHasDashboardPermission('createRoles')) {
            showAccessDenied();
            return;
        }
    }

    const nameInput = document.getElementById('cmdName');
    const responseInput = document.getElementById('cmdResponse');
    const typeValue = document.getElementById('cmdType').value;

    const name = nameInput.value.trim().toLowerCase();
    const isPurge = typeValue === 'purge';

    let invalid = false;

    if (!name || !/^[a-z0-9_-]{1,32}$/i.test(name)) {
        markFieldInvalid(nameInput);
        invalid = true;
    }

    if (invalid) {
        showFormToast('Fill all fields');
        shakeModal();
        return;
    }

    const colorHex = document.getElementById('cmdColor').value;
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Saving...';
    btn.disabled = true;

    let prefix = document.getElementById('cmdPrefix').value.trim();
    if (prefix.length !== 1) prefix = '*';

    let allowedRoles;
    if (rolesLoaded) {
        allowedRoles = Array.from(document.querySelectorAll('#rolesList .role-toggle-input:checked'))
            .map(cb => cb.value);
    } else if (editingName && currentCommands[editingName] && Array.isArray(currentCommands[editingName].allowedRoles)) {
        allowedRoles = currentCommands[editingName].allowedRoles;
    } else {
        allowedRoles = [];
    }

    const durationRaw = document.getElementById('cmdDuration').value;
    const durationValue = parseInt(durationRaw);
    const duration = isNaN(durationValue) || durationValue < 1 ? null : durationValue;

    const data = {
        prefix: prefix,
        type: typeValue,
        title: document.getElementById('cmdTitle').value,
        response: isPurge ? '' : document.getElementById('cmdResponse').value,
        color: parseInt(colorHex.replace('#', ''), 16),
        thumbnail: document.getElementById('cmdThumbnail').value || null,
        image: document.getElementById('cmdImage').value || null,
        extraEmbeds: typeValue === 'embed' ? collectExtraEmbeds() : [],
        deleteCommand: document.getElementById('cmdDelete').checked,
        allowedRoles: allowedRoles,
        duration: duration
    };

    try {
        const res = await fetch(`/api/commands/${currentGuild}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, data, isEdit: !!editingName })
        });
        if (res.ok) {
            const baseToggle = document.getElementById('cmdIsBase');
            if (baseToggle && (myRole === 'owner' || isAdmin)) {
                const wantBase = baseToggle.checked;
                const currentBase = editingName && currentCommands[editingName] ? !!currentCommands[editingName].isBase : false;
                if (wantBase !== currentBase) {
                    await fetch(`/api/commands/${currentGuild}/${name}/setbase`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ isBase: wantBase })
                    });
                }
            }

            closeModal();
            await loadCommands();
            showToast(`Command ${prefix}${name} saved`);
        } else {
            const err = await res.json();
            if (res.status === 403) {
                showAccessDenied();
            } else {
                showToast(err.error || 'Error', 'error');
            }
        }
    } catch (err) {
        showToast('Connection error', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function deleteCommand(name) {
    if (!userHasDashboardPermission('deleteRoles')) {
        showAccessDenied();
        return;
    }

    const cmd = currentCommands[name];
    if (cmd && cmd.isBase) {
        showToast('This command is Base: remove the Base flag first to delete it', 'error');
        return;
    }

    showConfirmDialog(
        'Confirm deletion',
        `Do you want to delete the command *${name}? This action is irreversible.`,
        async () => {
            try {
                const res = await fetch(`/api/commands/${currentGuild}/${name}`, { method: 'DELETE' });
                if (res.ok) {
                    await loadCommands();
                    showToast(`Command deleted`);
                } else if (res.status === 403) {
                    showAccessDenied();
                } else {
                    const err = await res.json().catch(() => ({}));
                    showToast(err.error || 'Error while deleting', 'error');
                }
            } catch (e) {
                showToast('Error: ' + e.message, 'error');
            }
        }
    );
}

async function loadModlogs() {
    if (!currentGuild) return;
    const list = document.getElementById('modlogsList');
    list.innerHTML = '<div class="loading">Loading</div>';
    try {
        const res = await fetch(`/api/dashboard-logs/${currentGuild}`);
        if (!res.ok) throw new Error('Failed to load');
        currentModlogs = await res.json();
        renderModlogs(currentModlogs);
    } catch (e) {
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
    }
}

function logLine(log) {
    const user = `<span class="log-user">${escapeHtml(log.userTag || 'Unknown')}</span>`;
    const target = `<span class="log-user">${escapeHtml(log.targetTag || 'Unknown')}</span>`;
    switch (log.action) {
        case 'ticket_created': return `Ticket created by ${user}`;
        case 'ticket_claimed': return `Ticket claimed by ${user}`;
        case 'ticket_closed': return `Ticket closed by ${user}`;
        case 'report_created': return `Report created by ${user}`;
        case 'user_banned': case 'user_banned_auto': return `${target} has been banned`;
        case 'user_unbanned': case 'user_unbanned_auto': return `${target} has been unbanned`;
        case 'user_kicked': case 'user_kicked_auto': return `${target} has been kicked`;
        case 'user_muted': case 'user_muted_auto': return `${target} has been muted`;
        case 'user_unmuted': return `${target} has been unmuted`;
        case 'user_warned': return `${target} has been warned`;
        case 'messages_purged': return `${user} purged messages`;
        case 'custom_command_used': case 'native_command_used': return `${user} used a command`;
        default: return `${user} — ${escapeHtml(log.details || log.action || '')}`;
    }
}

function renderModlogs(logs) {
    const list = document.getElementById('modlogsList');
    if (!logs || logs.length === 0) {
        list.innerHTML = '<div class="empty-state"><h3>No actions</h3><p>No logs recorded</p></div>';
        return;
    }
    list.innerHTML = logs.map((log, i) => {
        const action = log.action || log.type || 'generic';
        const date = log.date ? new Date(log.date).toLocaleString('en-US') : '';
        const extra = log.extra || {};

        const rows = [];
        if (log.reason) rows.push(`<div><b>Reason:</b> ${escapeHtml(log.reason)}</div>`);
        if (log.details) rows.push(`<div><b>Details:</b> ${escapeHtml(log.details)}</div>`);
        if (extra.channelName) rows.push(`<div><b>Channel:</b> ${escapeHtml(extra.channelName)}</div>`);
        if (extra.ticketOwnerTag) rows.push(`<div><b>Ticket owner:</b> ${escapeHtml(extra.ticketOwnerTag)}</div>`);
        if (extra.claimedByTag) rows.push(`<div><b>Claimed by:</b> ${escapeHtml(extra.claimedByTag)}</div>`);
        rows.push(`<div><b>Date:</b> ${escapeHtml(date)}</div>`);

        const transcriptBtn = log.transcriptId
            ? `<a class="modlog-transcript-btn" href="/transcript/${escapeAttr(log.transcriptId)}" target="_blank" rel="noopener">Transcript</a>`
            : '';

        return `
        <div class="modlog-card" data-idx="${i}">
            <div class="modlog-row">
                <span class="modlog-badge ${escapeAttr(action)}">${escapeHtml(action.replace(/_/g, ' '))}</span>
                <span class="modlog-line">${logLine(log)}</span>
                <button class="modlog-arrow" type="button" aria-label="Details">&#9662;</button>
            </div>
            <div class="modlog-details">
                <div class="modlog-details-inner">
                    ${rows.join('')}
                    ${transcriptBtn}
                </div>
            </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.modlog-card').forEach(card => {
        card.querySelector('.modlog-row').addEventListener('click', () => {
            card.classList.toggle('open');
        });
    });
}

async function loadBans() {
    if (!currentGuild) return;
    const list = document.getElementById('bansList');
    list.innerHTML = '<div class="loading">Loading</div>';
    try {
        const res = await fetch(`/api/bans/${currentGuild}`);
        if (!res.ok) throw new Error('Failed to load');
        const bans = await res.json();
        renderBans(bans);
    } catch (e) {
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
    }
}

function renderBans(bans) {
    const list = document.getElementById('bansList');
    const count = document.getElementById('bansCount');
    if (count) count.textContent = `${bans ? bans.length : 0} ban`;
    if (!bans || bans.length === 0) {
        list.innerHTML = '<div class="empty-state"><h3>No bans</h3><p>No bans recorded</p></div>';
        return;
    }
    list.innerHTML = bans.map((ban, i) => {
        const date = ban.date ? new Date(ban.date).toLocaleString('en-US') : '';
        return `
        <div class="modlog-card" data-idx="${i}">
            <div class="modlog-row">
                <img class="ban-avatar" src="${escapeAttr(ban.avatarURL)}" alt="">
                <span class="modlog-line"><span class="log-user">${escapeHtml(ban.targetTag || 'Unknown')}</span> (${escapeHtml(ban.targetId || '')})</span>
                <button class="modlog-arrow" type="button" aria-label="Details">&#9662;</button>
            </div>
            <div class="modlog-details">
                <div class="modlog-details-inner">
                    <div><b>Reason:</b> ${escapeHtml(ban.reason || 'No reason provided')}</div>
                    <div><b>Banned by:</b> ${escapeHtml(ban.moderatorTag || 'Unknown')}</div>
                    <div><b>Date:</b> ${escapeHtml(date)}</div>
                </div>
            </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.modlog-card').forEach(card => {
        card.querySelector('.modlog-row').addEventListener('click', () => {
            card.classList.toggle('open');
        });
    });
}

async function loadPermissionsSection() {
    if (!currentGuild) return;

    if (!myPermissions.managePermissions) {
        showAccessDenied();
        return;
    }

    const createList = document.getElementById('createRolesList');
    const editList = document.getElementById('editRolesList');
    const deleteList = document.getElementById('deleteRolesList');
    const viewLogsList = document.getElementById('viewLogsRolesList');
    const projectedList = document.getElementById('projectedRolesList');

    if (createList) createList.innerHTML = '<p class="loading-text">Loading...</p>';
    if (editList) editList.innerHTML = '<p class="loading-text">Loading...</p>';
    if (deleteList) deleteList.innerHTML = '<p class="loading-text">Loading...</p>';
    if (viewLogsList) viewLogsList.innerHTML = '<p class="loading-text">Loading...</p>';
    if (projectedList) projectedList.innerHTML = '<p class="loading-text">Loading...</p>';

    try {
        const [rolesRes, permsRes] = await Promise.all([
            fetch(`/api/roles/${currentGuild}`),
            fetch(`/api/permissions/${currentGuild}`)
        ]);

        if (!rolesRes.ok || !permsRes.ok) throw new Error('Failed to load');

        const roles = await rolesRes.json();
        const perms = await permsRes.json();

        currentRoles = roles;
        dashboardPermissions = {
            createRoles: perms.createRoles || [],
            editRoles: perms.editRoles || [],
            deleteRoles: perms.deleteRoles || [],
            viewLogsRoles: perms.viewLogsRoles || [],
            adminUsers: perms.adminUsers || [],
            ownerUsers: perms.ownerUsers || [],
            projectedRoles: perms.projectedRoles || []
        };

        if (createList) renderPermissionsList('createRolesList', roles, dashboardPermissions.createRoles);
        if (editList) renderPermissionsList('editRolesList', roles, dashboardPermissions.editRoles);
        if (deleteList) renderPermissionsList('deleteRolesList', roles, dashboardPermissions.deleteRoles);
        if (viewLogsList) renderPermissionsList('viewLogsRolesList', roles, dashboardPermissions.viewLogsRoles);
        if (projectedList) renderPermissionsList('projectedRolesList', roles, dashboardPermissions.projectedRoles);

        renderSpecialUsers('adminUsersList', dashboardPermissions.adminUsers, 'admin');
        renderSpecialUsers('ownerUsersList', dashboardPermissions.ownerUsers, 'owner');

    } catch (e) {
        if (createList) createList.innerHTML = `<p class="loading-text">Error: ${e.message}</p>`;
    }
}

function renderPermissionsList(containerId, roles, selected) {
    const list = document.getElementById(containerId);
    if (!list) return;

    if (!roles || roles.length === 0) {
        list.innerHTML = '<p class="loading-text">No roles.</p>';
        return;
    }

    list.innerHTML = roles.map(role => {
        const checked = selected.includes(role.id) ? 'checked' : '';
        return `
        <div class="role-item" data-role-id="${escapeAttr(role.id)}">
            <span class="role-name">${escapeHtml(role.name)}</span>
            <label class="role-toggle">
                <input type="checkbox" class="role-toggle-input" value="${escapeAttr(role.id)}" ${checked}>
                <span class="role-toggle-switch"></span>
            </label>
        </div>`;
    }).join('');
}

async function renderSpecialUsers(containerId, userIds, type) {
    const list = document.getElementById(containerId);
    if (!list) return;

    if (!userIds || userIds.length === 0) {
        list.innerHTML = '<p class="loading-text">No users.</p>';
        return;
    }

    list.innerHTML = '';

    for (const userId of userIds) {
        const item = document.createElement('div');
        item.className = 'special-user-item';
        item.dataset.userId = userId;

        let username = `User ${userId}`;
        let avatar = 'https://cdn.discordapp.com/embed/avatars/0.png';

        try {
            const res = await fetch(`/api/user-info/${userId}`);
            if (res.ok) {
                const data = await res.json();
                username = data.displayName || data.username || username;
                avatar = data.avatar || avatar;
            }
        } catch {}

        item.innerHTML = `
            <img class="special-user-avatar" src="${escapeAttr(avatar)}" alt="" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <div class="special-user-info">
                <div class="special-user-name">${escapeHtml(username)}</div>
                <div class="special-user-id">${escapeHtml(userId)}</div>
            </div>
            <button type="button" class="special-user-remove" data-user-id="${escapeAttr(userId)}" data-type="${escapeAttr(type)}" title="Remove">&times;</button>
        `;

        list.appendChild(item);
    }

    list.querySelectorAll('.special-user-remove').forEach(btn => {
        btn.onclick = () => {
            removeSpecialUser(btn.dataset.userId, btn.dataset.type);
        };
    });
}

function removeSpecialUser(userId, type) {
    if (type === 'admin') {
        dashboardPermissions.adminUsers = dashboardPermissions.adminUsers.filter(id => id !== userId);
    } else if (type === 'owner') {
        dashboardPermissions.ownerUsers = dashboardPermissions.ownerUsers.filter(id => id !== userId);
    }

    const containerId = type === 'admin' ? 'adminUsersList' : 'ownerUsersList';
    renderSpecialUsers(containerId, type === 'admin' ? dashboardPermissions.adminUsers : dashboardPermissions.ownerUsers, type);
}

async function addSpecialUser(type) {
    const inputId = type === 'admin' ? 'adminUserInput' : 'ownerUserInput';
    const input = document.getElementById(inputId);
    if (!input) return;

    const userId = input.value.trim();

    if (!/^\d+$/.test(userId)) {
        showToast('Invalid Discord ID (numbers only)', 'error');
        return;
    }

    if (type === 'admin') {
        if (dashboardPermissions.adminUsers.includes(userId)) {
            showToast('User already in Admin list', 'error');
            return;
        }
        if (dashboardPermissions.ownerUsers.includes(userId)) {
            showToast('User already in Owner list', 'error');
            return;
        }
        dashboardPermissions.adminUsers.push(userId);
    } else if (type === 'owner') {
        if (dashboardPermissions.ownerUsers.includes(userId)) {
            showToast('User already in Owner list', 'error');
            return;
        }
        if (dashboardPermissions.adminUsers.includes(userId)) {
            showToast('User already in Admin list', 'error');
            return;
        }
        dashboardPermissions.ownerUsers.push(userId);
    }

    input.value = '';

    const containerId = type === 'admin' ? 'adminUsersList' : 'ownerUsersList';
    await renderSpecialUsers(containerId, type === 'admin' ? dashboardPermissions.adminUsers : dashboardPermissions.ownerUsers, type);

    showToast('User added (remember to save)');
}

async function savePermissions() {
    if (!myPermissions.managePermissions) {
        showAccessDenied();
        return;
    }

    const btn = document.getElementById('savePermissionsBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Saving...';
    btn.disabled = true;

    const getChecked = (containerId) => {
        const container = document.getElementById(containerId);
        if (!container) return [];
        return Array.from(container.querySelectorAll('.role-toggle-input:checked'))
            .map(cb => cb.value);
    };

    const payload = {
        createRoles: getChecked('createRolesList'),
        editRoles: getChecked('editRolesList'),
        deleteRoles: getChecked('deleteRolesList'),
        viewLogsRoles: getChecked('viewLogsRolesList'),
        adminUsers: dashboardPermissions.adminUsers || [],
        ownerUsers: dashboardPermissions.ownerUsers || [],
        projectedRoles: getChecked('projectedRolesList')
    };

    try {
        const res = await fetch(`/api/permissions/${currentGuild}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            dashboardPermissions = { ...dashboardPermissions, ...payload };
            showToast('Permissions saved');
        } else if (res.status === 403) {
            showAccessDenied();
        } else {
            const err = await res.json();
            showToast(err.error || 'Error', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function renderSingleSelectList(containerId, items, selectedId, configKey) {
    const list = document.getElementById(containerId);
    if (!list) return;

    if (!items || items.length === 0) {
        list.innerHTML = '<p class="loading-text">No items.</p>';
        return;
    }

    let html = `
        <div class="role-item">
            <span class="role-name">— None —</span>
            <label class="role-toggle">
                <input type="checkbox" class="role-toggle-input radio-toggle" data-config="${configKey}" value="" ${!selectedId ? 'checked' : ''}>
                <span class="role-toggle-switch"></span>
            </label>
        </div>
    `;

    html += items.map(item => {
        const checked = item.id === selectedId ? 'checked' : '';
        return `
        <div class="role-item">
            <span class="role-name">${escapeHtml(item.name)}</span>
            <label class="role-toggle">
                <input type="checkbox" class="role-toggle-input radio-toggle" data-config="${configKey}" value="${escapeAttr(item.id)}" ${checked}>
                <span class="role-toggle-switch"></span>
            </label>
        </div>`;
    }).join('');

    list.innerHTML = html;

    list.querySelectorAll('.role-toggle-input.radio-toggle').forEach(input => {
        input.addEventListener('change', () => {
            if (input.checked) {
                list.querySelectorAll('.role-toggle-input.radio-toggle').forEach(other => {
                    if (other !== input) other.checked = false;
                });
            }
        });
    });
}

async function loadConfigSection() {
    if (!currentGuild) return;

    if (!isOwner()) {
        showAccessDenied();
        return;
    }

    const containers = ['cfgJoinLeaveList', 'cfgModLogList', 'cfgMessageLogList', 'cfgTranscriptsList', 'cfgStaffRoleList', 'cfgAdminRoleList'];
    containers.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<p class="loading-text">Loading...</p>';
    });

    try {
        const [channelsRes, rolesRes, configRes] = await Promise.all([
            fetch(`/api/channels/${currentGuild}`),
            fetch(`/api/roles/${currentGuild}`),
            fetch(`/api/guildconfig/${currentGuild}`)
        ]);

        if (!channelsRes.ok || !rolesRes.ok || !configRes.ok) throw new Error('Failed to load');

        const channels = await channelsRes.json();
        const roles = await rolesRes.json();
        const config = await configRes.json();

        currentChannels = channels;
        currentRoles = roles;

        const textChannels = channels.filter(c => c.type === 'text');

        renderSingleSelectList('cfgJoinLeaveList', textChannels, config.joinLeaveLogChannelId, 'joinLeaveLogChannelId');
        renderSingleSelectList('cfgModLogList', textChannels, config.modLogChannelId, 'modLogChannelId');
        renderSingleSelectList('cfgMessageLogList', textChannels, config.messageLogChannelId, 'messageLogChannelId');
        renderSingleSelectList('cfgTranscriptsList', textChannels, config.transcriptsChannelId, 'transcriptsChannelId');
        renderSingleSelectList('cfgStaffRoleList', roles, config.staffRoleId, 'staffRoleId');
        renderSingleSelectList('cfgAdminRoleList', roles, config.adminRoleId, 'adminRoleId');

        configLoaded = true;
    } catch (e) {
        console.error('[CONFIG] loadConfigSection error:', e);
        containers.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = `<p class="loading-text">Error: ${e.message}</p>`;
        });
    }
}

async function loadTicketsSection() {
    if (!currentGuild) return;

    if (!isOwner()) {
        showAccessDenied();
        return;
    }

    const containers = ['ticketCategoryList', 'ticketLogsList', 'ticketStaffRoleList', 'ticketAdminRoleList'];
    containers.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<p class="loading-text">Loading...</p>';
    });

    try {
        const [channelsRes, rolesRes, configRes] = await Promise.all([
            fetch(`/api/channels/${currentGuild}`),
            fetch(`/api/roles/${currentGuild}`),
            fetch(`/api/guildconfig/${currentGuild}`)
        ]);

        if (!channelsRes.ok || !rolesRes.ok || !configRes.ok) throw new Error('Loading error');

        const channels = await channelsRes.json();
        const roles = await rolesRes.json();
        const config = await configRes.json();

        currentChannels = channels;
        currentRoles = roles;

        const textChannels = channels.filter(c => c.type === 'text');
        const categoryChannels = channels.filter(c => c.type === 'category');

        renderSingleSelectList('ticketCategoryList', categoryChannels, config.supportCategoryId, 'supportCategoryId');
        renderSingleSelectList('ticketLogsList', textChannels, config.transcriptsChannelId, 'transcriptsChannelId');
        renderSingleSelectList('ticketStaffRoleList', roles, config.staffRoleId, 'staffRoleId');
        renderSingleSelectList('ticketAdminRoleList', roles, config.adminRoleId, 'adminRoleId');
    } catch (e) {
        console.error('[TICKETS] loadTicketsSection error:', e);
        containers.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = `<p class="loading-text">Error: ${e.message}</p>`;
        });
    }
}

function getSelectedValue(containerId) {
    const list = document.getElementById(containerId);
    if (!list) return null;
    const checked = list.querySelector('.role-toggle-input.radio-toggle:checked');
    return checked ? (checked.value || null) : null;
}

async function saveConfig() {
    if (!isOwner()) {
        showAccessDenied();
        return;
    }

    const btn = document.getElementById('saveConfigBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Saving...';
    btn.disabled = true;

    const payload = {
        joinLeaveLogChannelId: getSelectedValue('cfgJoinLeaveList'),
        modLogChannelId: getSelectedValue('cfgModLogList'),
        messageLogChannelId: getSelectedValue('cfgMessageLogList'),
        transcriptsChannelId: getSelectedValue('cfgTranscriptsList'),
        staffRoleId: getSelectedValue('cfgStaffRoleList'),
        adminRoleId: getSelectedValue('cfgAdminRoleList')
    };

    try {
        const res = await fetch(`/api/guildconfig/${currentGuild}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showToast('Configuration saved');
        } else if (res.status === 403) {
            showAccessDenied();
        } else {
            const err = await res.json();
            showToast(err.error || 'Error', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function saveTicketsConfig() {
    if (!isOwner()) {
        showAccessDenied();
        return;
    }

    const btn = document.getElementById('saveTicketsBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Saving...';
    btn.disabled = true;

    const payload = {
        supportCategoryId: getSelectedValue('ticketCategoryList'),
        transcriptsChannelId: getSelectedValue('ticketLogsList'),
        staffRoleId: getSelectedValue('ticketStaffRoleList'),
        adminRoleId: getSelectedValue('ticketAdminRoleList')
    };

    try {
        const res = await fetch(`/api/guildconfig/${currentGuild}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showToast('Ticket configuration saved');
        } else if (res.status === 403) {
            showAccessDenied();
        } else {
            const err = await res.json();
            showToast(err.error || 'Error', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function setupEvents() {
    const newCmdBtn = document.getElementById('newCmdBtn');
    if (newCmdBtn) newCmdBtn.onclick = () => openModal();

    const cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn) cancelBtn.onclick = closeModal;

    const cmdForm = document.getElementById('cmdForm');
    if (cmdForm) cmdForm.onsubmit = saveCommand;

    const cmdType = document.getElementById('cmdType');
    if (cmdType) cmdType.onchange = updateTypeUI;

    const cmdPrefix = document.getElementById('cmdPrefix');
    if (cmdPrefix) cmdPrefix.oninput = () => {
        if (cmdPrefix.value.length > 1) {
            cmdPrefix.value = cmdPrefix.value.slice(0, 1);
        }
        updateTypeUI();
    };

    const cmdResponse = document.getElementById('cmdResponse');
    if (cmdResponse) cmdResponse.oninput = updatePreview;

    const cmdTitle = document.getElementById('cmdTitle');
    if (cmdTitle) cmdTitle.oninput = updatePreview;

    const cmdColor = document.getElementById('cmdColor');
    if (cmdColor) cmdColor.oninput = updatePreview;

    const cmdThumbnail = document.getElementById('cmdThumbnail');
    if (cmdThumbnail) cmdThumbnail.oninput = updatePreview;

    const cmdImage = document.getElementById('cmdImage');
    if (cmdImage) cmdImage.oninput = updatePreview;

    const moreBtn = document.getElementById('moreBtn');
    if (moreBtn) moreBtn.onclick = toggleMoreOptions;

    const addEmbedBtn = document.getElementById('addEmbedBtn');
    if (addEmbedBtn) addEmbedBtn.onclick = () => addEmbedBlock();

    const permissionsBtn = document.getElementById('permissionsBtn');
    if (permissionsBtn) permissionsBtn.onclick = togglePermissions;

    const permissionsClose = document.getElementById('permissionsClose');
    if (permissionsClose) permissionsClose.onclick = closePermissionsBox;

    const savePermissionsBtn = document.getElementById('savePermissionsBtn');
    if (savePermissionsBtn) savePermissionsBtn.onclick = savePermissions;

    const saveConfigBtn = document.getElementById('saveConfigBtn');
    if (saveConfigBtn) saveConfigBtn.onclick = saveConfig;

    const saveTicketsBtn = document.getElementById('saveTicketsBtn');
    if (saveTicketsBtn) saveTicketsBtn.onclick = saveTicketsConfig;

    const adminUserAdd = document.getElementById('adminUserAdd');
    if (adminUserAdd) adminUserAdd.onclick = () => addSpecialUser('admin');

    const ownerUserAdd = document.getElementById('ownerUserAdd');
    if (ownerUserAdd) ownerUserAdd.onclick = () => addSpecialUser('owner');

    const adminUserInput = document.getElementById('adminUserInput');
    if (adminUserInput) adminUserInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addSpecialUser('admin');
        }
    };

    const ownerUserInput = document.getElementById('ownerUserInput');
    if (ownerUserInput) ownerUserInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addSpecialUser('owner');
        }
    };

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.onclick = async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login';
    };

    let switchingTab = false;

    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.onclick = () => {
            const target = tab.dataset.tab;
            const targetContent = document.getElementById(`tab-${target}`);
            if (!targetContent) return;

            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const currentActive = document.querySelector('.tab-content:not(.hidden)');

            const loadTarget = () => {
                if (target === 'logs') {
                    if (!userHasDashboardPermission('viewLogsRoles')) {
                        showAccessDenied();
                        return;
                    }
                    loadModlogs();
                } else if (target === 'bans') {
                    if (!userHasDashboardPermission('viewLogsRoles')) {
                        showAccessDenied();
                        return;
                    }
                    loadBans();
                } else if (target === 'permissions') {
                    loadPermissionsSection();
                } else if (target === 'config') {
                    loadConfigSection();
                } else if (target === 'tickets') {
                    loadTicketsSection();
                } else if (target === 'commands') {
                    loadCommands();
                }
            };

            if (!currentActive || currentActive === targetContent) {
                loadTarget();
                return;
            }

            if (switchingTab) return;
            switchingTab = true;

            currentActive.classList.add('fade-out');

            setTimeout(() => {
                currentActive.classList.add('hidden');
                currentActive.classList.remove('fade-out');

                targetContent.classList.remove('hidden');
                targetContent.style.opacity = '0';

                requestAnimationFrame(() => {
                    targetContent.style.opacity = '1';
                    loadTarget();

                    setTimeout(() => {
                        targetContent.style.opacity = '';
                        switchingTab = false;
                    }, 350);
                });
            }, 180);
        };
    });

    const modalCloseBtn = document.getElementById('modalCloseBtn');
    if (modalCloseBtn) modalCloseBtn.onclick = closeModal;

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });
}

init();

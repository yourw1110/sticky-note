// 1. Export critical functions to window IMMEDIATELY
window.login = function() {
    if (typeof log === 'function') log("Login clicked");
    if (typeof auth === 'undefined' || !auth) {
        alert("認証システムが読み込まれていません。通信状況を確認してください。");
        return;
    }
    const provider = new firebase.auth.GoogleAuthProvider();
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
        log("Redirecting to Google for login...");
        // Explicitly set persistence before redirect
        auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).then(() => {
            auth.signInWithRedirect(provider);
        });
    } else {
        auth.signInWithPopup(provider).catch(err => {
            if (typeof log === 'function') log("Login Error: " + err.message);
            alert(`ログインに失敗しました: ${err.message}`);
        });
    }
};

window.logout = function() {
    if (typeof auth !== 'undefined' && auth && confirm("ログアウトしますか？")) {
        auth.signOut().then(() => {
            localStorage.removeItem('sticky_last_sync');
            location.reload();
        });
    }
};

// 2. Visual Logger
function log(msg) {
    console.log(msg);
    const debugEl = document.getElementById('debug-log');
    if (debugEl) {
        debugEl.innerText = msg + '\n' + debugEl.innerText;
        debugEl.style.display = 'block';
    }
}

// 3. State Management
let tabs = [];
try { tabs = JSON.parse(localStorage.getItem('sticky_tabs')) || []; } catch(e) { tabs = []; }
let activeTabId = localStorage.getItem('sticky_active_tab');
let currentType = 'memo';
let selectedColor = 'yellow';
let isSelectionMode = false;
let selectedNoteIds = new Set();
let sortOrder = 'desc';
let isEditing = false;

// Sync Logic
let currentUser = null;
let isRemoteUpdate = false;
let firebaseListener = null;
let saveTimeout;

// Firebase & DB references
let db, auth;

// Robust Icon Creation
function safeCreateIcons(parentElement) {
    if (typeof lucide !== 'undefined') {
        try { lucide.createIcons(parentElement ? { parentElement } : {}); }
        catch (e) { log("Lucide icons failed: " + e.message); }
    }
}

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBUEjOw7p8Uf7KlangC2-VlDSQaN5pgUq4",
    authDomain: "sticky-note-f123d.firebaseapp.com",
    databaseURL: "https://sticky-note-f123d-default-rtdb.firebaseio.com",
    projectId: "sticky-note-f123d",
    storageBucket: "sticky-note-f123d.firebasestorage.app",
    messagingSenderId: "21493131669",
    appId: "1:21493131669:web:653215b69ad82a8bc0ee9c"
};

// Interaction State
let draggedNote = null;
let resizedNote = null;
let dragOffsetX, dragOffsetY;
let resizeStartX, resizeStartY, resizeStartWidth, resizeStartHeight;

function getActiveTab() { return tabs.find(t => t.id == activeTabId); }
function getActiveNotes() { const tab = getActiveTab(); if (!tab) return []; if (!tab.notes) tab.notes = []; return tab.notes; }
function getSyncPath() { return currentUser ? `users/${currentUser.uid}` : null; }

function saveToFirebase() {
    if (isRemoteUpdate || !currentUser || !db) return;
    const syncIcon = document.querySelector('#auth-container i');
    if (syncIcon) syncIcon.classList.add('spinning');
    db.ref(getSyncPath()).set({
        tabs: tabs, activeTabId: activeTabId, lastUpdated: Date.now()
    }).then(() => {
        if (syncIcon) { syncIcon.classList.remove('spinning'); syncIcon.style.color = '#00b894'; setTimeout(() => syncIcon.style.color = '', 2000); }
    }).catch(err => {
        log("Firebase save error: " + err.message);
        if (syncIcon) { syncIcon.classList.remove('spinning'); syncIcon.style.color = '#ff7675'; }
    });
}

function saveToLocalStorage() {
    localStorage.setItem('sticky_tabs', JSON.stringify(tabs));
    localStorage.setItem('sticky_active_tab', activeTabId);
    localStorage.setItem('sticky_last_sync', Date.now());
}

function debouncedSave() {
    saveToLocalStorage();
    if (isRemoteUpdate) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => { if (currentUser) saveToFirebase(); }, 1500);
}

function handleAuth() {
    if (!auth) return;
    
    // Set persistence to LOCAL explicitly
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(e => log("Persistence error: " + e.message));

    // Register listener BEFORE handling redirect result
    auth.onAuthStateChanged((user) => {
        log("Auth State: " + (user ? user.displayName : "Logged out"));
        currentUser = user;
        updateUserUI(user);
        if (user) startSyncing();
        else { stopSyncing(); renderTabs(); renderNotes(); }
    });

    // Handle redirect result for mobile
    auth.getRedirectResult().then((result) => {
        if (result.user) {
            log("Redirect Success: " + result.user.displayName);
            updateUserUI(result.user);
        }
    }).catch((error) => {
        if (error.code !== 'auth/no-recent-attempt') {
            log("Redirect Result Error: " + error.message);
        }
    });
}

function updateUserUI(user) {
    const loginBtn = document.getElementById('login-btn');
    const userProfile = document.getElementById('user-profile');
    const userPhoto = document.getElementById('user-photo');
    const userName = document.getElementById('user-name');

    if (user) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (userProfile) userProfile.style.display = 'flex';
        if (userPhoto) {
            userPhoto.src = user.photoURL || '';
            userPhoto.title = user.displayName;
            userPhoto.onclick = () => {
                if (confirm("同期を再試行しますか？")) startSyncing();
                else if (confirm("ログアウトしますか？")) logout();
            };
        }
        if (userName) userName.innerText = user.displayName;
    } else {
        if (loginBtn) loginBtn.style.display = 'flex';
        if (userProfile) userProfile.style.display = 'none';
    }
}

function startSyncing() {
    if (!currentUser || !db) return;
    if (firebaseListener) firebaseListener.off();
    firebaseListener = db.ref(getSyncPath());
    firebaseListener.on('value', (snapshot) => {
        const data = snapshot.val();
        if (data && data.tabs) {
            const localLastSync = localStorage.getItem('sticky_last_sync') || 0;
            const serverLastUpdated = data.lastUpdated || 0;
            if (serverLastUpdated > localLastSync) {
                if (isEditing) return;
                clearTimeout(saveTimeout);
                isRemoteUpdate = true;
                tabs = data.tabs; activeTabId = data.activeTabId;
                localStorage.setItem('sticky_last_sync', serverLastUpdated);
                saveToLocalStorage(); renderTabs(); renderNotes();
                setTimeout(() => { isRemoteUpdate = false; }, 1000);
            } else if (serverLastUpdated < localLastSync) {
                saveToFirebase();
            }
        } else if (tabs.length > 0 && !data) {
            saveToFirebase();
        }
    });
}

function stopSyncing() { if (firebaseListener) { firebaseListener.off(); firebaseListener = null; } }

function renderNotes() {
    if (isEditing) return;
    const board = document.getElementById('board'); if (!board) return;
    board.innerHTML = '';
    const notes = getActiveNotes();
    notes.forEach(note => board.appendChild(createNoteElement(note)));
}

function createNoteElement(note) {
    const el = document.createElement('div');
    el.className = `sticky-note bg-${note.color}`;
    el.style.left = `${note.x}px`; el.style.top = `${note.y}px`;
    el.id = `note-${note.id}`; el.dataset.id = note.id;
    if (isSelectionMode) el.classList.add('selection-mode');
    if (selectedNoteIds.has(note.id)) el.classList.add('selected');

    let fDate = '';
    if (note.date) {
        const p = note.date.split(/[-/.]/);
        if (p.length >= 2) fDate = `${parseInt(p[p.length-2])}/${parseInt(p[p.length-1])}`;
        else fDate = note.date;
    }
    const dDisp = `<span class="note-date">${note.date ? fDate : ''}</span>`;
    const tDisp = `<span class="note-title-text">${note.title || 'タイトルなし'}</span>`;

    let cHtml = '';
    if (note.type === 'memo') {
        cHtml = `<div class="note-content"><textarea placeholder="メモを入力..." onfocus="isEditing=true" onblur="isEditing=false; updateNoteContent(${note.id}, this.value)">${note.content || ''}</textarea></div>`;
    } else {
        const aT = (note.todos || []).filter(t => !t.done); const cT = (note.todos || []).filter(t => t.done);
        cHtml = `<div class="note-content"><div id="todo-list-${note.id}">
            ${aT.map((t, i) => { const o = note.todos.indexOf(t); return `<div class="todo-item"><input type="checkbox" onchange="toggleTodo(${note.id}, ${o})"><span contenteditable="true" onfocus="isEditing=true" onblur="isEditing=false; updateTodoText(${note.id}, ${o}, this.innerText)" onkeydown="handleTodoKeydown(event, ${note.id})">${t.text}</span><button class="todo-delete-btn" onclick="deleteTodoItem(${note.id}, ${o})"><i data-lucide="x" style="width: 14px; height: 14px;"></i></button></div>` }).join('')}
            <button class="add-todo-btn" onclick="addTodoItem(${note.id})"><i data-lucide="plus" style="width: 16px; height: 16px;"></i></button>
            <div class="completed-todos" style="margin-top: 12px; opacity: 0.6;">
                ${cT.map((t, i) => { const o = note.todos.indexOf(t); return `<div class="todo-item checked"><input type="checkbox" checked onchange="toggleTodo(${note.id}, ${o})"><span contenteditable="true" onfocus="isEditing=true" onblur="isEditing=false; updateTodoText(${note.id}, ${o}, this.innerText)">${t.text}</span><button class="todo-delete-btn" onclick="deleteTodoItem(${note.id}, ${o})"><i data-lucide="x" style="width: 14px; height: 14px;"></i></button></div>` }).join('')}
            </div></div></div>`;
    }

    el.innerHTML = `<div class="note-header">${dDisp}${tDisp}</div>${cHtml}<div class="note-actions"><button class="action-btn menu-toggle"><i data-lucide="more-horizontal" style="width: 18px; height: 18px;"></i></button><div class="note-menu"><div class="color-swatches"><div class="swatch bg-yellow" data-color="yellow"></div><div class="swatch bg-pink" data-color="pink"></div><div class="swatch bg-blue" data-color="blue"></div><div class="swatch bg-green" data-color="green"></div><div class="swatch bg-purple" data-color="purple"></div></div><div class="menu-divider"></div><div class="delete-action-icon" title="削除"><i data-lucide="trash-2" style="width: 16px; height: 16px;"></i></div></div></div><div class="resizer"></div>`;
    el.querySelector('.note-title-text').addEventListener('dblclick', (e) => makeTitleEditable(note.id, e.target));
    el.querySelector('.note-date').addEventListener('dblclick', (e) => makeDateEditable(note.id, e.target));
    const toggle = el.querySelector('.menu-toggle'); const menu = el.querySelector('.note-menu');
    toggle.addEventListener('click', (e) => { e.stopPropagation(); document.querySelectorAll('.note-menu.show').forEach(m => { if (m !== menu) m.classList.remove('show'); }); menu.classList.toggle('show'); });
    el.querySelector('.delete-action-icon').addEventListener('click', (e) => { e.stopPropagation(); deleteNote(note.id); });
    el.querySelectorAll('.swatch').forEach(sw => sw.addEventListener('click', (e) => { e.stopPropagation(); changeNoteColor(note.id, sw.dataset.color); }));
    el.addEventListener('mousedown', (e) => handleStartInteraction(e, el, note)); el.addEventListener('touchstart', (e) => handleStartInteraction(e, el, note), { passive: false });
    const res = el.querySelector('.resizer'); res.addEventListener('mousedown', (e) => handleStartResize(e, el, note)); res.addEventListener('touchstart', (e) => handleStartResize(e, el, note), { passive: false });
    if (note.width) el.style.width = `${note.width}px`; if (note.height) el.style.height = `${note.height}px`;
    safeCreateIcons(el); return el;
}

function handleStartInteraction(e, el, note) {
    if (isSelectionMode) { e.preventDefault(); e.stopPropagation(); toggleNoteSelection(note.id); return; }
    const t = e.target; if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.getAttribute('contenteditable') === 'true' || t.tagName === 'BUTTON' || t.closest('button')) return;
    draggedNote = { el, note };
    const cX = e.clientX || (e.touches && e.touches[0].clientX); const cY = e.clientY || (e.touches && e.touches[0].clientY);
    const rect = el.getBoundingClientRect(); dragOffsetX = cX - rect.left; dragOffsetY = cY - rect.top;
    el.style.zIndex = 1000; el.classList.add('dragging');
}

function handleStartResize(e, el, note) {
    e.preventDefault(); e.stopPropagation(); resizedNote = { el, note };
    const cX = e.clientX || (e.touches && e.touches[0].clientX); const cY = e.clientY || (e.touches && e.touches[0].clientY);
    resizeStartX = cX; resizeStartY = cY; resizeStartWidth = el.offsetWidth; resizeStartHeight = el.offsetHeight;
    el.style.zIndex = 1000;
}

document.addEventListener('mousemove', (e) => doGlobalInteraction(e));
document.addEventListener('touchmove', (e) => doGlobalInteraction(e), { passive: false });
document.addEventListener('mouseup', () => stopGlobalInteraction());
document.addEventListener('touchend', () => stopGlobalInteraction());

function doGlobalInteraction(e) {
    const cX = e.clientX || (e.touches && e.touches[0].clientX); const cY = e.clientY || (e.touches && e.touches[0].clientY);
    if (draggedNote) {
        const x = cX - dragOffsetX; const y = cY - dragOffsetY;
        draggedNote.el.style.left = `${x}px`; draggedNote.el.style.top = `${y}px`;
        draggedNote.note.x = x; draggedNote.note.y = y;
        if (e.touches) e.preventDefault();
    } else if (resizedNote) {
        const w = resizeStartWidth + (cX - resizeStartX); const h = resizeStartHeight + (cY - resizeStartY);
        if (w > 150) { resizedNote.el.style.width = w + 'px'; resizedNote.note.width = w; }
        if (h > 150) { resizedNote.el.style.height = h + 'px'; resizedNote.note.height = h; }
        if (e.touches) e.preventDefault();
    }
}

function stopGlobalInteraction() {
    if (draggedNote) { draggedNote.el.classList.remove('dragging'); draggedNote.el.style.zIndex = ''; draggedNote = null; debouncedSave(); }
    if (resizedNote) { resizedNote.el.style.zIndex = ''; resizedNote = null; debouncedSave(); }
}

function updateNoteColor(id, color) {
    const notes = getActiveNotes(); const n = notes.find(n => n.id === id);
    if (n) { n.color = color; debouncedSave(); renderNotes(); }
}

function updateNoteContent(id, content) {
    const notes = getActiveNotes(); const n = notes.find(n => n.id === id);
    if (n) { n.content = content; debouncedSave(); }
}

function addNote() {
    const title = document.getElementById('note-title').value.trim();
    const dateFull = document.getElementById('note-date-full').value.trim();
    let fDate = ''; if (dateFull && dateFull.length === 8) fDate = `${dateFull.substring(0, 4)}-${dateFull.substring(4, 6)}-${dateFull.substring(6, 8)}`;
    const notes = getActiveNotes();
    const n = {
        id: Date.now(), type: currentType, title: title || (currentType === 'memo' ? 'MEMO' : 'TODO'),
        date: fDate, content: '', todos: currentType === 'todo' ? [{ text: '', done: false }] : [],
        color: selectedColor, x: 100 + notes.length * 20, y: 100 + notes.length * 20, width: 240, height: 240
    };
    notes.push(n); debouncedSave(); renderNotes(); closeModal();
}

function deleteNote(id) {
    const tab = getActiveTab(); if (tab && confirm('この付箋を削除しますか？')) {
        tab.notes = tab.notes.filter(n => n.id !== id);
        selectedNoteIds.delete(id); updateBatchUI(); debouncedSave(); renderNotes();
    }
}

function toggleNoteSelection(id) {
    if (selectedNoteIds.has(id)) selectedNoteIds.delete(id); else selectedNoteIds.add(id);
    const el = document.getElementById(`note-${id}`); if (el) el.classList.toggle('selected');
    updateBatchUI();
}

function updateBatchUI() {
    const btn = document.getElementById('delete-selected-btn'); const cnt = document.getElementById('delete-count');
    if (btn) { btn.style.display = selectedNoteIds.size > 0 ? 'flex' : 'none'; if (cnt) cnt.innerText = `${selectedNoteIds.size}件削除`; }
}

function deleteSelectedNotes() {
    const tab = getActiveTab(); if (tab && selectedNoteIds.size > 0 && confirm(`選択した ${selectedNoteIds.size} 件を削除しますか？`)) {
        tab.notes = tab.notes.filter(n => !selectedNoteIds.has(n.id));
        selectedNoteIds.clear(); updateBatchUI(); debouncedSave(); renderNotes();
    }
}

function toggleSelectionMode() {
    isSelectionMode = !isSelectionMode; const btn = document.getElementById('multi-select-btn'); if (btn) btn.classList.toggle('active', isSelectionMode);
    document.querySelectorAll('.sticky-note').forEach(el => { el.classList.toggle('selection-mode', isSelectionMode); if (!isSelectionMode) el.classList.remove('selected'); });
    if (!isSelectionMode) { selectedNoteIds.clear(); updateBatchUI(); }
}

function toggleTodo(noteId, todoIdx) {
    const notes = getActiveNotes(); const n = notes.find(n => n.id === noteId);
    if (n && n.todos[todoIdx]) { n.todos[todoIdx].done = !n.todos[todoIdx].done; debouncedSave(); renderNotes(); }
}

function updateTodoText(noteId, todoIdx, text) {
    const notes = getActiveNotes(); const n = notes.find(n => n.id === noteId);
    if (n && n.todos[todoIdx]) { n.todos[todoIdx].text = text; debouncedSave(); }
}

function deleteTodoItem(noteId, todoIdx) {
    const notes = getActiveNotes(); const n = notes.find(n => n.id === noteId);
    if (n && n.todos) { n.todos.splice(todoIdx, 1); debouncedSave(); renderNotes(); }
}

function addTodoItem(noteId) {
    const notes = getActiveNotes(); const n = notes.find(n => n.id === noteId);
    if (n) {
        n.todos.push({ text: '', done: false }); debouncedSave(); renderNotes();
        setTimeout(() => {
            const el = document.getElementById(`note-${noteId}`); if (el) {
                const spans = el.querySelectorAll('.todo-item span[contenteditable="true"]');
                const last = spans[spans.length - 1 - (n.todos.filter(t => t.done).length)]; if (last) last.focus();
            }
        }, 50);
    }
}

function handleTodoKeydown(e, noteId) { if (e.key === 'Enter') { e.preventDefault(); addTodoItem(noteId); } }

function makeTitleEditable(id, el) {
    isEditing = true; el.contentEditable = true; el.focus();
    el.onblur = () => { isEditing = false; el.contentEditable = false; const n = getActiveNotes().find(n => n.id === id); if (n) { n.title = el.innerText; debouncedSave(); } };
    el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } };
}

function makeDateEditable(id, el) {
    isEditing = true; const n = getActiveNotes().find(n => n.id === id); if (!n) { isEditing = false; return; }
    el.innerText = (n.date || '').replace(/-/g, '/') || 'yyyy/mm/dd';
    el.contentEditable = true; el.focus(); const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    el.onblur = () => {
        isEditing = false; el.contentEditable = false; let val = el.innerText.trim().replace(/[^0-9/-]/g, '');
        if (/^\d{8}$/.test(val)) val = `${val.substring(0,4)}/${val.substring(4,6)}/${val.substring(6,8)}`;
        const p = val.split(/[-/.]/);
        if (p.length >= 2) { const y = p.length === 3 ? p[0] : new Date().getFullYear(); const m = p.length === 3 ? p[1] : p[0]; const d = p.length === 3 ? p[2] : p[1]; n.date = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
        else n.date = ''; debouncedSave(); renderNotes();
    };
    el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } };
}

function sortNotesByDate() {
    const tab = getActiveTab(); if (!tab) return;
    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'; const icon = document.querySelector('#sort-btn i');
    if (icon) { icon.setAttribute('data-lucide', sortOrder === 'asc' ? 'arrow-up-az' : 'arrow-down-az'); safeCreateIcons(document.getElementById('sort-btn')); }
    const withDate = tab.notes.filter(n => n.date).sort((a, b) => sortOrder === 'asc' ? new Date(a.date) - new Date(b.date) : new Date(b.date) - new Date(a.date));
    const withoutDate = tab.notes.filter(n => !n.date); tab.notes = [...withDate, ...withoutDate];
    const margin = 30, startX = 40, startY = 40, boardWidth = window.innerWidth - 80;
    let currentX = startX, currentY = startY, maxH = 0;
    tab.notes.forEach((n) => {
        const w = n.width || 240, h = n.height || 240; if (currentX + w > boardWidth + startX && currentX > startX) { currentX = startX; currentY += maxH + margin; maxH = 0; }
        n.x = currentX; n.y = currentY; currentX += w + margin; maxH = Math.max(maxH, h);
    });
    debouncedSave(); renderNotes();
}

function renderTabs() {
    if (isEditing) return;
    const list = document.getElementById('tabs-list'); if (!list) return;
    list.innerHTML = '';
    tabs.forEach(tab => {
        const el = document.createElement('div'); el.className = `tab-item ${tab.id == activeTabId ? 'active' : ''}`;
        el.addEventListener('click', () => switchTab(tab.id)); el.addEventListener('dblclick', (e) => { e.stopPropagation(); makeTabNameEditable(el, tab.id); });
        el.addEventListener('contextmenu', (e) => e.preventDefault());
        let timer; el.addEventListener('touchstart', (e) => { timer = setTimeout(() => { makeTabNameEditable(el, tab.id); }, 600); }, { passive: true });
        el.addEventListener('touchend', () => clearTimeout(timer)); el.addEventListener('touchmove', () => clearTimeout(timer));
        el.innerHTML = `<span class="tab-name">${tab.name}</span>${tabs.length > 1 ? `<span class="tab-delete-btn" onclick="event.stopPropagation(); deleteTab('${tab.id}')"><i data-lucide="x" style="width: 14px; height: 14px;"></i></span>` : ''}`;
        list.appendChild(el);
    });
    safeCreateIcons(list);
}

function switchTab(id) { if (activeTabId == id) return; activeTabId = id; selectedNoteIds.clear(); updateBatchUI(); debouncedSave(); renderTabs(); renderNotes(); }

function addTab() {
    let count = 0; tabs.forEach(t => { if (t.name.startsWith('NOTE')) { const s = t.name.substring(4); if (/^\+*$/.test(s)) count = Math.max(count, s.length + 1); } });
    const n = { id: Date.now().toString(), name: count === 0 ? 'NOTE' : 'NOTE' + '+'.repeat(count), notes: [] };
    tabs.push(n); activeTabId = n.id; debouncedSave(); renderTabs(); renderNotes();
    const last = document.getElementById('tabs-list').lastElementChild; if (last) makeTabNameEditable(last, n.id);
}

function deleteTab(id) { if (tabs.length <= 1) return; if (confirm('このボードを削除しますか？')) { tabs = tabs.filter(t => t.id != id); if (activeTabId == id) activeTabId = tabs[0].id; debouncedSave(); renderTabs(); renderNotes(); } }

function makeTabNameEditable(el, id) {
    const tab = tabs.find(t => t.id == id); if (!tab) return;
    isEditing = true; const span = el.querySelector('.tab-name'); const name = tab.name;
    const input = document.createElement('input'); input.type = 'text'; input.className = 'tab-edit-input'; input.value = name;
    span.innerHTML = ''; span.appendChild(input); input.focus(); input.select();
    input.onblur = () => { isEditing = false; tab.name = input.value.trim() || name; debouncedSave(); renderTabs(); };
    input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = name; input.blur(); } };
}

function setupEventListeners() {
    const fab = document.getElementById('fab'); const menu = document.getElementById('fab-menu');
    const handleFabClick = (e) => { e.preventDefault(); e.stopPropagation(); fab.classList.toggle('active'); menu.classList.toggle('show'); };
    if (fab && menu) { fab.addEventListener('click', handleFabClick); }
    document.querySelectorAll('.menu-item').forEach(i => {
        i.addEventListener('click', () => {
            currentType = i.dataset.type; document.getElementById('modal-title').innerText = currentType === 'todo' ? '+TODO' : '+MEMO';
            const m = document.getElementById('note-modal'); if (m) m.classList.add('show');
            if (fab) fab.classList.remove('active'); if (menu) menu.classList.remove('show');
        });
    });
    document.querySelectorAll('.color-option').forEach(o => { o.addEventListener('click', () => { document.querySelectorAll('.color-option').forEach(x => x.classList.remove('active')); o.classList.add('active'); selectedColor = o.dataset.color; }); });
    const sBtn = document.getElementById('save-note'); if (sBtn) sBtn.addEventListener('click', addNote);
    const cBtn = document.getElementById('cancel-note'); if (cBtn) cBtn.addEventListener('click', closeModal);
    const sortBtn = document.getElementById('sort-btn'); if (sortBtn) sortBtn.addEventListener('click', sortNotesByDate);
    const tabBtn = document.getElementById('add-tab-btn'); if (tabBtn) tabBtn.addEventListener('click', addTab);
    const selectBtn = document.getElementById('multi-select-btn'); if (selectBtn) selectBtn.addEventListener('click', toggleSelectionMode);
    const delBtn = document.getElementById('delete-selected-btn'); if (delBtn) delBtn.addEventListener('click', deleteSelectedNotes);
    const dInp = document.getElementById('note-date-full');
    if (dInp) { dInp.addEventListener('input', (e) => { let val = e.target.value.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/[^0-9]/g, ''); if (e.target.value !== val) e.target.value = val; }); }
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.note-actions')) { document.querySelectorAll('.note-menu.show').forEach(m => m.classList.remove('show')); }
        const m = document.getElementById('note-modal'); if (e.target === m) closeModal();
        if (fab && menu && !e.target.closest('.fab-container')) { fab.classList.remove('active'); menu.classList.remove('show'); }
    });
}

function closeModal() {
    const m = document.getElementById('note-modal'); if (m) m.classList.remove('show');
    const tInp = document.getElementById('note-title'); const dInp = document.getElementById('note-date-full');
    if (tInp) tInp.value = ''; if (dInp) dInp.value = '';
}

function runInitialSetup() {
    log("Initial Setup Start");
    try {
        setupEventListeners();
        if (typeof firebase !== 'undefined') {
            firebase.initializeApp(firebaseConfig); db = firebase.database(); auth = firebase.auth();
            log("Firebase Initialized");
            handleAuth(); // Initialize auth listener
        } else {
            log("Firebase missing - retrying...");
            setTimeout(runInitialSetup, 2000); return;
        }
        if (tabs.length === 0) {
            const old = JSON.parse(localStorage.getItem('sticky_notes')) || [];
            const d = { id: Date.now().toString(), name: 'NOTE', notes: old };
            tabs = [d]; activeTabId = d.id; localStorage.removeItem('sticky_notes'); saveToLocalStorage();
        }
        if (!activeTabId && tabs.length > 0) { activeTabId = tabs[0].id; saveToLocalStorage(); }
        renderTabs(); renderNotes(); safeCreateIcons();
    } catch (e) { log("Setup Error: " + e.message); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runInitialSetup);
else runInitialSetup();

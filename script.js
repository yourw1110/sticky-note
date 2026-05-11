// 1. Sync Key Management
let syncKey = localStorage.getItem('sticky_sync_key') || '';

function log(msg) {
    console.log(msg);
    const debugEl = document.getElementById('debug-log');
    if (debugEl) {
        debugEl.innerText = msg + '\n' + debugEl.innerText;
        debugEl.style.display = 'block';
    }
}

// 2. State Management
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
let isRemoteUpdate = false;
let isSyncLoaded = false; // NEW: Critical flag to prevent overwriting server before first load
let firebaseListener = null;
let saveTimeout;

// Firebase references
let db;

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
function getSyncPath() { return syncKey ? `keys/${syncKey}` : null; }

function saveToFirebase() {
    // CRITICAL: Do not save if sync hasn't loaded from server yet, or if it's a remote update
    if (!isSyncLoaded || isRemoteUpdate || !syncKey || !db) return;
    
    const syncIndicator = document.getElementById('sync-indicator');
    if (syncIndicator) {
        syncIndicator.className = 'sync-indicator syncing';
    }
    
    db.ref(getSyncPath()).set({
        tabs: tabs, 
        activeTabId: activeTabId, 
        lastUpdated: Date.now()
    }).then(() => {
        if (syncIndicator) {
            syncIndicator.className = 'sync-indicator success';
            setTimeout(() => {
                if (syncIndicator.className === 'sync-indicator success') syncIndicator.className = 'sync-indicator';
            }, 2000);
        }
    }).catch(err => {
        log("Firebase Save Error: " + err.message);
        if (syncIndicator) {
            syncIndicator.className = 'sync-indicator error';
        }
    });
}

function saveToLocalStorage() {
    localStorage.setItem('sticky_tabs', JSON.stringify(tabs));
    localStorage.setItem('sticky_active_tab', activeTabId);
    localStorage.setItem('sticky_last_sync', Date.now());
}

function debouncedSave() {
    saveToLocalStorage();
    if (isRemoteUpdate || !isSyncLoaded) return; // Wait for sync load
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => { if (syncKey) saveToFirebase(); }, 1500);
}

function startSyncing() {
    if (!syncKey || !db) return;
    log("Connecting to sync key: " + syncKey);
    
    isSyncLoaded = false; // Reset loaded flag
    if (firebaseListener) firebaseListener.off();
    firebaseListener = db.ref(getSyncPath());
    
    firebaseListener.on('value', (snapshot) => {
        const data = snapshot.val();
        const localLastSync = localStorage.getItem('sticky_last_sync') || 0;
        
        if (data && data.tabs) {
            const serverLastUpdated = data.lastUpdated || 0;
            
            // If server data exists, we MUST consider it for the first load
            if (!isSyncLoaded || serverLastUpdated > localLastSync) {
                if (isEditing) {
                    log("User editing, pending update.");
                    isSyncLoaded = true;
                    return;
                }
                log("Updating from server...");
                clearTimeout(saveTimeout);
                isRemoteUpdate = true;
                tabs = data.tabs; 
                activeTabId = data.activeTabId;
                localStorage.setItem('sticky_last_sync', serverLastUpdated);
                saveToLocalStorage(); 
                renderTabs(); 
                renderNotes();
                isSyncLoaded = true;
                setTimeout(() => { isRemoteUpdate = false; }, 1000);
            } else if (serverLastUpdated < localLastSync) {
                log("Local is newer, will sync to server.");
                isSyncLoaded = true;
                saveToFirebase();
            } else {
                isSyncLoaded = true;
            }
        } else {
            // Server is empty - this is the ONLY case where local data can be uploaded safely
            log("Server is empty. Local data is now the source of truth.");
            isSyncLoaded = true;
            if (tabs.length > 0) saveToFirebase();
        }
    }, (error) => {
        log("Sync Error: " + error.message);
        if (error.code === 'PERMISSION_DENIED') {
            alert("同期エラー: Firebaseのルールを確認してください。");
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
    // Force icon creation for the whole board to ensure all new elements are covered
    safeCreateIcons(board);
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
    el.querySelectorAll('.swatch').forEach(sw => sw.addEventListener('click', (e) => { e.stopPropagation(); updateNoteColor(note.id, sw.dataset.color); }));
    el.addEventListener('mousedown', (e) => handleStartInteraction(e, el, note)); el.addEventListener('touchstart', (e) => handleStartInteraction(e, el, note), { passive: false });
    const res = el.querySelector('.resizer'); res.addEventListener('mousedown', (e) => handleStartResize(e, el, note)); res.addEventListener('touchstart', (e) => handleStartResize(e, el, note), { passive: false });
    if (note.width) el.style.width = `${note.width}px`; if (note.height) el.style.height = `${note.height}px`;
    return el;
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
    if (btn) { btn.style.display = selectedNoteIds.size > 0 ? 'flex' : 'none'; if (cnt) cnt.innerText = selectedNoteIds.size; }
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

function moveTab(id, direction) {
    const index = tabs.findIndex(t => t.id == id);
    if (index === -1) return;
    if (direction === 'left' && index > 0) {
        [tabs[index - 1], tabs[index]] = [tabs[index], tabs[index - 1]];
    } else if (direction === 'right' && index < tabs.length - 1) {
        [tabs[index], tabs[index + 1]] = [tabs[index + 1], tabs[index]];
    }
    debouncedSave();
    renderTabs();
}

function renderTabs() {
    if (isEditing) return;
    const list = document.getElementById('tabs-list'); if (!list) return;
    list.innerHTML = '';
    tabs.forEach((tab, index) => {
        const el = document.createElement('div'); el.className = `tab-item ${tab.id == activeTabId ? 'active' : ''}`;
        el.addEventListener('click', () => switchTab(tab.id)); el.addEventListener('dblclick', (e) => { e.stopPropagation(); makeTabNameEditable(el, tab.id); });
        el.addEventListener('contextmenu', (e) => e.preventDefault());
        let timer; el.addEventListener('touchstart', (e) => { timer = setTimeout(() => { makeTabNameEditable(el, tab.id); }, 600); }, { passive: true });
        el.addEventListener('touchend', () => clearTimeout(timer)); el.addEventListener('touchmove', () => clearTimeout(timer));
        el.innerHTML = `
            ${index > 0 ? `<span class="tab-move-btn" onclick="event.stopPropagation(); moveTab('${tab.id}', 'left')"><i data-lucide="chevron-left" style="width: 14px; height: 14px;"></i></span>` : '<span style="width:18px"></span>'}
            <span class="tab-name">${tab.name}</span>
            <div class="tab-actions">
                ${index < tabs.length - 1 ? `<span class="tab-move-btn" onclick="event.stopPropagation(); moveTab('${tab.id}', 'right')"><i data-lucide="chevron-right" style="width: 14px; height: 14px;"></i></span>` : '<span style="width:18px"></span>'}
                ${tabs.length > 1 ? `<span class="tab-delete-btn" onclick="event.stopPropagation(); deleteTab('${tab.id}')"><i data-lucide="x" style="width: 14px; height: 14px;"></i></span>` : ''}
            </div>
        `;
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
    
    // Sync Modal Listeners
    const syncBtn = document.getElementById('sync-btn');
    const syncModal = document.getElementById('sync-modal');
    if (syncBtn) syncBtn.addEventListener('click', () => {
        const input = document.getElementById('sync-key-input');
        if (input) input.value = syncKey;
        syncModal.classList.add('show');
    });
    const cancelSync = document.getElementById('cancel-sync');
    if (cancelSync) cancelSync.addEventListener('click', () => syncModal.classList.remove('show'));
    const saveSync = document.getElementById('save-sync');
    if (saveSync) saveSync.addEventListener('click', () => {
        const key = document.getElementById('sync-key-input').value.trim();
        if (key) {
            syncKey = key;
            localStorage.setItem('sticky_sync_key', syncKey);
            syncModal.classList.remove('show');
            log("Sync key updated: " + syncKey);
            // Reset state to force fresh load from server
            isSyncLoaded = false;
            localStorage.setItem('sticky_last_sync', 0);
            startSyncing();
        } else {
            alert("キーを入力してください");
        }
    });
    const clearSync = document.getElementById('clear-sync');
    if (clearSync) clearSync.addEventListener('click', () => {
        if (confirm("同期を解除し、キーを削除しますか？\n（付箋データ自体はクラウドに残ります）")) {
            syncKey = '';
            localStorage.removeItem('sticky_sync_key');
            localStorage.removeItem('sticky_last_sync');
            isSyncLoaded = false;
            stopSyncing();
            syncModal.classList.remove('show');
            location.reload();
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.note-actions')) { document.querySelectorAll('.note-menu.show').forEach(m => m.classList.remove('show')); }
        const m = document.getElementById('note-modal'); if (e.target === m) closeModal();
        if (e.target === syncModal) syncModal.classList.remove('show');
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
            firebase.initializeApp(firebaseConfig); db = firebase.database();
            log("Firebase Initialized");
            if (syncKey) startSyncing();
            else isSyncLoaded = true; // No sync key, local is truth
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

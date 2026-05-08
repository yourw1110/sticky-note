// Visual Logger for Debugging on Mobile
function log(msg) {
    console.log(msg);
    const debugEl = document.getElementById('debug-log');
    if (debugEl) {
        debugEl.innerText = msg + '\n' + debugEl.innerText;
        debugEl.style.display = 'block';
    }
}

// State Management
let tabs = JSON.parse(localStorage.getItem('sticky_tabs')) || [];
let activeTabId = localStorage.getItem('sticky_active_tab');
let currentType = 'memo';
let selectedColor = 'yellow';
let isSelectionMode = false;
let selectedNoteIds = new Set();
let sortOrder = 'desc';

// Sync Logic
let currentUser = null;
let isRemoteUpdate = false;
let isEditing = false; // Flag to prevent re-render during editing
let firebaseListener = null;
let saveTimeout;

// Firebase & DB references
let db, auth;

// Robust Icon Creation
function safeCreateIcons(parentElement) {
    if (typeof lucide !== 'undefined') {
        try {
            lucide.createIcons(parentElement ? { parentElement } : {});
        } catch (e) {
            log("Lucide icons failed: " + e.message);
        }
    }
}

// Global Drag/Resize State
let draggedNote = null;
let resizedNote = null;
let dragStartX, dragStartY, dragOffsetX, dragOffsetY;
let resizeStartX, resizeStartY, resizeStartWidth, resizeStartHeight;

function getActiveTab() {
    return tabs.find(t => t.id == activeTabId);
}

function getActiveNotes() {
    const tab = getActiveTab();
    if (!tab) return [];
    if (!tab.notes) tab.notes = [];
    return tab.notes;
}

function getSyncPath() {
    return currentUser ? `users/${currentUser.uid}` : null;
}

function saveToFirebase() {
    if (isRemoteUpdate || !currentUser || !db) return;
    
    const syncIcon = document.querySelector('#auth-container i');
    if (syncIcon) syncIcon.classList.add('spinning');

    db.ref(getSyncPath()).set({
        tabs: tabs,
        activeTabId: activeTabId,
        lastUpdated: Date.now()
    }).then(() => {
        if (syncIcon) {
            syncIcon.classList.remove('spinning');
            syncIcon.style.color = '#00b894';
            setTimeout(() => syncIcon.style.color = '', 2000);
        }
    }).catch(err => {
        log("Firebase save error: " + err.message);
        if (syncIcon) {
            syncIcon.classList.remove('spinning');
            syncIcon.style.color = '#ff7675';
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
    if (isRemoteUpdate) return;
    
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        if (currentUser) saveToFirebase();
    }, 1500);
}

function handleAuth() {
    if (!auth) return;
    auth.onAuthStateChanged((user) => {
        currentUser = user;
        const loginBtn = document.getElementById('login-btn');
        const userProfile = document.getElementById('user-profile');
        
        if (user) {
            if (loginBtn) loginBtn.style.display = 'none';
            if (userProfile) {
                userProfile.style.display = 'flex';
                const userPhoto = document.getElementById('user-photo');
                if (userPhoto) {
                    userPhoto.src = user.photoURL;
                    userPhoto.onclick = () => {
                        if (confirm("同期を再試行しますか？")) {
                            startSyncing();
                        } else if (confirm("ログアウトしますか？")) {
                            logout();
                        }
                    };
                }
                const userName = document.getElementById('user-name');
                if (userName) userName.innerText = user.displayName;
            }
            startSyncing();
        } else {
            if (loginBtn) loginBtn.style.display = 'flex';
            if (userProfile) userProfile.style.display = 'none';
            stopSyncing();
            renderTabs();
            renderNotes();
        }
    });
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
                // IMPORTANT: Prevent re-render if user is currently editing something
                if (isEditing) {
                    log("Sync: Remote data available, but skipping render while editing.");
                    return;
                }

                clearTimeout(saveTimeout);
                isRemoteUpdate = true;
                tabs = data.tabs;
                activeTabId = data.activeTabId;
                localStorage.setItem('sticky_last_sync', serverLastUpdated);
                saveToLocalStorage();
                renderTabs();
                renderNotes();
                setTimeout(() => { isRemoteUpdate = false; }, 1000);
            } else if (serverLastUpdated < localLastSync) {
                saveToFirebase();
            }
        } else if (tabs.length > 0 && !data) {
            saveToFirebase();
        }
    });
}

function stopSyncing() {
    if (firebaseListener) {
        firebaseListener.off();
        firebaseListener = null;
    }
}

window.login = function() {
    if (!auth) {
        alert("認証システムが読み込まれていません。通信状況を確認してください。");
        return;
    }
    const provider = new firebase.auth.GoogleAuthProvider();
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
        auth.signInWithRedirect(provider);
    } else {
        auth.signInWithPopup(provider).catch(err => {
            log("Login Error: " + err.message);
            alert(`ログインに失敗しました: ${err.message}`);
        });
    }
};

window.logout = function() {
    if (auth && confirm("ログアウトしますか？")) {
        auth.signOut();
    }
};

function renderNotes() {
    if (isEditing) return; // Never render while editing
    const board = document.getElementById('board');
    if (!board) return;
    board.innerHTML = '';
    const notes = getActiveNotes();
    notes.forEach(note => {
        const noteEl = createNoteElement(note);
        board.appendChild(noteEl);
    });
}

function createNoteElement(note) {
    const el = document.createElement('div');
    el.className = `sticky-note bg-${note.color}`;
    el.style.left = `${note.x}px`;
    el.style.top = `${note.y}px`;
    el.id = `note-${note.id}`;
    el.dataset.id = note.id;
    
    if (isSelectionMode) el.classList.add('selection-mode');
    if (selectedNoteIds.has(note.id)) el.classList.add('selected');

    let formattedDate = '';
    if (note.date) {
        const parts = note.date.split(/[-/.]/);
        if (parts.length >= 2) {
            formattedDate = `${parseInt(parts[parts.length-2])}/${parseInt(parts[parts.length-1])}`;
        } else {
            formattedDate = note.date;
        }
    }

    const dateDisplay = `<span class="note-date">${note.date ? formattedDate : ''}</span>`;
    const titleDisplay = `<span class="note-title-text">${note.title || 'タイトルなし'}</span>`;

    let contentHtml = '';
    if (note.type === 'memo') {
        contentHtml = `<div class="note-content"><textarea placeholder="メモを入力..." onfocus="isEditing=true" onblur="isEditing=false; updateNoteContent(${note.id}, this.value)">${note.content || ''}</textarea></div>`;
    } else {
        const activeTodos = (note.todos || []).filter(t => !t.done);
        const completedTodos = (note.todos || []).filter(t => t.done);
        
        contentHtml = `<div class="note-content">
            <div id="todo-list-${note.id}">
                ${activeTodos.map((todo, idx) => {
                    const originalIdx = note.todos.indexOf(todo);
                    return `
                    <div class="todo-item">
                        <input type="checkbox" onchange="toggleTodo(${note.id}, ${originalIdx})">
                        <span contenteditable="true" 
                               onfocus="isEditing=true"
                               onblur="isEditing=false; updateTodoText(${note.id}, ${originalIdx}, this.innerText)"
                               onkeydown="handleTodoKeydown(event, ${note.id})">${todo.text}</span>
                        <button class="todo-delete-btn" onclick="deleteTodoItem(${note.id}, ${originalIdx})">
                            <i data-lucide="x" style="width: 14px; height: 14px;"></i>
                        </button>
                    </div>
                `}).join('')}
                <button class="add-todo-btn" onclick="addTodoItem(${note.id})">
                    <i data-lucide="plus" style="width: 16px; height: 16px;"></i>
                </button>
                <div class="completed-todos" style="margin-top: 12px; opacity: 0.6;">
                    ${completedTodos.map((todo, idx) => {
                        const originalIdx = note.todos.indexOf(todo);
                        return `
                        <div class="todo-item checked">
                            <input type="checkbox" checked onchange="toggleTodo(${note.id}, ${originalIdx})">
                            <span contenteditable="true" onfocus="isEditing=true" onblur="isEditing=false; updateTodoText(${note.id}, ${originalIdx}, this.innerText)">${todo.text}</span>
                            <button class="todo-delete-btn" onclick="deleteTodoItem(${note.id}, ${originalIdx})">
                                <i data-lucide="x" style="width: 14px; height: 14px;"></i>
                            </button>
                        </div>
                    `}).join('')}
                </div>
            </div>
        </div>`;
    }

    el.innerHTML = `
        <div class="note-header">
            ${dateDisplay}
            ${titleDisplay}
        </div>
        ${contentHtml}
        <div class="note-actions">
            <button class="action-btn menu-toggle">
                <i data-lucide="more-horizontal" style="width: 18px; height: 18px;"></i>
            </button>
            <div class="note-menu">
                <div class="color-swatches">
                    <div class="swatch bg-yellow" data-color="yellow"></div>
                    <div class="swatch bg-pink" data-color="pink"></div>
                    <div class="swatch bg-blue" data-color="blue"></div>
                    <div class="swatch bg-green" data-color="green"></div>
                    <div class="swatch bg-purple" data-color="purple"></div>
                </div>
                <div class="menu-divider"></div>
                <div class="delete-action-icon" title="削除">
                    <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                </div>
            </div>
        </div>
        <div class="resizer"></div>
    `;

    // Internal Event Listeners
    el.querySelector('.note-title-text').addEventListener('dblclick', (e) => makeTitleEditable(note.id, e.target));
    el.querySelector('.note-date').addEventListener('dblclick', (e) => makeDateEditable(note.id, e.target));
    
    const menuToggle = el.querySelector('.menu-toggle');
    const noteMenu = el.querySelector('.note-menu');
    menuToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.note-menu.show').forEach(m => {
            if (m !== noteMenu) m.classList.remove('show');
        });
        noteMenu.classList.toggle('show');
    });

    el.querySelector('.delete-action-icon').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteNote(note.id);
    });

    el.querySelectorAll('.swatch').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            changeNoteColor(note.id, swatch.dataset.color);
        });
    });

    el.addEventListener('mousedown', (e) => handleStartInteraction(e, el, note));
    el.addEventListener('touchstart', (e) => handleStartInteraction(e, el, note), { passive: false });

    const resizer = el.querySelector('.resizer');
    resizer.addEventListener('mousedown', (e) => handleStartResize(e, el, note));
    resizer.addEventListener('touchstart', (e) => handleStartResize(e, el, note), { passive: false });

    if (note.width) el.style.width = `${note.width}px`;
    if (note.height) el.style.height = `${note.height}px`;

    safeCreateIcons(el);
    return el;
}

function handleStartInteraction(e, el, note) {
    if (isSelectionMode) { e.preventDefault(); e.stopPropagation(); toggleNoteSelection(note.id); return; }
    const target = e.target;
    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.getAttribute('contenteditable') === 'true' || target.tagName === 'BUTTON' || target.closest('button')) return;
    draggedNote = { el, note };
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    const rect = el.getBoundingClientRect();
    dragOffsetX = clientX - rect.left;
    dragOffsetY = clientY - rect.top;
    el.style.zIndex = 1000;
    el.classList.add('dragging');
}

function handleStartResize(e, el, note) {
    e.preventDefault(); e.stopPropagation();
    resizedNote = { el, note };
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    resizeStartX = clientX; resizeStartY = clientY;
    resizeStartWidth = el.offsetWidth; resizeStartHeight = el.offsetHeight;
    el.style.zIndex = 1000;
}

document.addEventListener('mousemove', (e) => doGlobalInteraction(e));
document.addEventListener('touchmove', (e) => doGlobalInteraction(e), { passive: false });
document.addEventListener('mouseup', () => stopGlobalInteraction());
document.addEventListener('touchend', () => stopGlobalInteraction());

function doGlobalInteraction(e) {
    if (draggedNote) {
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        const x = clientX - dragOffsetX;
        const y = clientY - dragOffsetY;
        draggedNote.el.style.left = `${x}px`;
        draggedNote.el.style.top = `${y}px`;
        draggedNote.note.x = x;
        draggedNote.note.y = y;
        if (e.touches) e.preventDefault();
    } else if (resizedNote) {
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        const width = resizeStartWidth + (clientX - resizeStartX);
        const height = resizeStartHeight + (clientY - resizeStartY);
        if (width > 150) { resizedNote.el.style.width = width + 'px'; resizedNote.note.width = width; }
        if (height > 150) { resizedNote.el.style.height = height + 'px'; resizedNote.note.height = height; }
        if (e.touches) e.preventDefault();
    }
}

function stopGlobalInteraction() {
    if (draggedNote) { draggedNote.el.classList.remove('dragging'); draggedNote.el.style.zIndex = ''; draggedNote = null; debouncedSave(); }
    if (resizedNote) { resizedNote.el.style.zIndex = ''; resizedNote = null; debouncedSave(); }
}

function updateNoteColor(id, color) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === id);
    if (note) { note.color = color; debouncedSave(); renderNotes(); }
}

function updateNoteContent(id, content) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === id);
    if (note) { note.content = content; debouncedSave(); }
}

function addNote() {
    const title = document.getElementById('note-title').value.trim();
    const dateFull = document.getElementById('note-date-full').value.trim();
    let formattedDate = '';
    if (dateFull && dateFull.length === 8) {
        formattedDate = `${dateFull.substring(0, 4)}-${dateFull.substring(4, 6)}-${dateFull.substring(6, 8)}`;
    }
    const notes = getActiveNotes();
    const newNote = {
        id: Date.now(), type: currentType, title: title || (currentType === 'memo' ? 'MEMO' : 'TODO'),
        date: formattedDate, content: '', todos: currentType === 'todo' ? [{ text: '', done: false }] : [],
        color: selectedColor, x: 100 + notes.length * 20, y: 100 + notes.length * 20, width: 240, height: 240
    };
    notes.push(newNote); debouncedSave(); renderNotes(); closeModal();
}

function deleteNote(id) {
    const tab = getActiveTab();
    if (tab && confirm('この付箋を削除しますか？')) {
        tab.notes = tab.notes.filter(n => n.id !== id);
        selectedNoteIds.delete(id); updateBatchUI(); debouncedSave(); renderNotes();
    }
}

function toggleNoteSelection(id) {
    if (selectedNoteIds.has(id)) selectedNoteIds.delete(id);
    else selectedNoteIds.add(id);
    const el = document.getElementById(`note-${id}`);
    if (el) el.classList.toggle('selected');
    updateBatchUI();
}

function updateBatchUI() {
    const deleteBtn = document.getElementById('delete-selected-btn');
    const deleteCount = document.getElementById('delete-count');
    if (deleteBtn) {
        deleteBtn.style.display = selectedNoteIds.size > 0 ? 'flex' : 'none';
        if (deleteCount) deleteCount.innerText = `${selectedNoteIds.size}件削除`;
    }
}

function deleteSelectedNotes() {
    const activeTab = getActiveTab();
    if (activeTab && selectedNoteIds.size > 0 && confirm(`選択した ${selectedNoteIds.size} 件を削除しますか？`)) {
        activeTab.notes = activeTab.notes.filter(n => !selectedNoteIds.has(n.id));
        selectedNoteIds.clear(); updateBatchUI(); debouncedSave(); renderNotes();
    }
}

function toggleSelectionMode() {
    isSelectionMode = !isSelectionMode;
    const btn = document.getElementById('multi-select-btn');
    if (btn) btn.classList.toggle('active', isSelectionMode);
    document.querySelectorAll('.sticky-note').forEach(el => {
        el.classList.toggle('selection-mode', isSelectionMode);
        if (!isSelectionMode) el.classList.remove('selected');
    });
    if (!isSelectionMode) { selectedNoteIds.clear(); updateBatchUI(); }
}

function toggleTodo(noteId, todoIdx) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === noteId);
    if (note && note.todos[todoIdx]) { note.todos[todoIdx].done = !note.todos[todoIdx].done; debouncedSave(); renderNotes(); }
}

function updateTodoText(noteId, todoIdx, text) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === noteId);
    if (note && note.todos[todoIdx]) { note.todos[todoIdx].text = text; debouncedSave(); }
}

function deleteTodoItem(noteId, todoIdx) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === noteId);
    if (note && note.todos) { note.todos.splice(todoIdx, 1); debouncedSave(); renderNotes(); }
}

function addTodoItem(noteId) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === noteId);
    if (note) {
        note.todos.push({ text: '', done: false }); debouncedSave(); renderNotes();
        setTimeout(() => {
            const noteEl = document.getElementById(`note-${noteId}`);
            if (noteEl) {
                const spans = noteEl.querySelectorAll('.todo-item span[contenteditable="true"]');
                const lastSpan = spans[spans.length - 1 - (note.todos.filter(t => t.done).length)];
                if (lastSpan) lastSpan.focus();
            }
        }, 50);
    }
}

function handleTodoKeydown(e, noteId) {
    if (e.key === 'Enter') { e.preventDefault(); addTodoItem(noteId); }
}

function makeTitleEditable(id, el) {
    isEditing = true; el.contentEditable = true; el.focus();
    el.onblur = () => {
        isEditing = false; el.contentEditable = false;
        const note = getActiveNotes().find(n => n.id === id);
        if (note) { note.title = el.innerText; debouncedSave(); }
    };
    el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } };
}

function makeDateEditable(id, el) {
    isEditing = true; const note = getActiveNotes().find(n => n.id === id);
    if (!note) { isEditing = false; return; }
    el.innerText = (note.date || '').replace(/-/g, '/') || 'yyyy/mm/dd';
    el.contentEditable = true; el.focus();
    const range = document.createRange(); range.selectNodeContents(el);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    el.onblur = () => {
        isEditing = false; el.contentEditable = false;
        let val = el.innerText.trim().replace(/[^0-9/-]/g, '');
        if (/^\d{8}$/.test(val)) val = `${val.substring(0,4)}/${val.substring(4,6)}/${val.substring(6,8)}`;
        const p = val.split(/[-/.]/);
        if (p.length >= 2) {
            const y = p.length === 3 ? p[0] : new Date().getFullYear();
            const m = p.length === 3 ? p[1] : p[0];
            const d = p.length === 3 ? p[2] : p[1];
            note.date = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        } else note.date = '';
        debouncedSave(); renderNotes();
    };
    el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } };
}

function sortNotesByDate() {
    const tab = getActiveTab(); if (!tab) return;
    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    const icon = document.querySelector('#sort-btn i');
    if (icon) {
        icon.setAttribute('data-lucide', sortOrder === 'asc' ? 'arrow-up-az' : 'arrow-down-az');
        safeCreateIcons(document.getElementById('sort-btn'));
    }
    const withDate = tab.notes.filter(n => n.date).sort((a, b) => sortOrder === 'asc' ? new Date(a.date) - new Date(b.date) : new Date(b.date) - new Date(a.date));
    const withoutDate = tab.notes.filter(n => !n.date);
    tab.notes = [...withDate, ...withoutDate];
    const margin = 30, startX = 40, startY = 40, boardWidth = window.innerWidth - 80;
    let currentX = startX, currentY = startY, maxRowHeight = 0;
    tab.notes.forEach((note) => {
        const w = note.width || 240, h = note.height || 240;
        if (currentX + w > boardWidth + startX && currentX > startX) { currentX = startX; currentY += maxRowHeight + margin; maxRowHeight = 0; }
        note.x = currentX; note.y = currentY;
        currentX += w + margin; maxRowHeight = Math.max(maxRowHeight, h);
    });
    debouncedSave(); renderNotes();
}

function renderTabs() {
    if (isEditing) return; // Prevent re-render while editing
    const list = document.getElementById('tabs-list'); if (!list) return;
    list.innerHTML = '';
    tabs.forEach(tab => {
        const el = document.createElement('div');
        el.className = `tab-item ${tab.id == activeTabId ? 'active' : ''}`;
        el.addEventListener('click', () => switchTab(tab.id));
        el.addEventListener('dblclick', (e) => { e.stopPropagation(); makeTabNameEditable(el, tab.id); });
        
        // Prevent default long-press menu on tabs
        el.addEventListener('contextmenu', (e) => e.preventDefault());

        let longPressTimer;
        el.addEventListener('touchstart', (e) => {
            longPressTimer = setTimeout(() => { makeTabNameEditable(el, tab.id); }, 600);
        }, { passive: true });
        el.addEventListener('touchend', () => clearTimeout(longPressTimer));
        el.addEventListener('touchmove', () => clearTimeout(longPressTimer));
        el.innerHTML = `<span class="tab-name">${tab.name}</span>${tabs.length > 1 ? `<span class="tab-delete-btn" onclick="event.stopPropagation(); deleteTab('${tab.id}')"><i data-lucide="x" style="width: 14px; height: 14px;"></i></span>` : ''}`;
        list.appendChild(el);
    });
    safeCreateIcons(list);
}

function switchTab(id) {
    if (activeTabId == id) return;
    activeTabId = id; selectedNoteIds.clear(); updateBatchUI();
    debouncedSave(); renderTabs(); renderNotes();
}

function addTab() {
    let count = 0;
    tabs.forEach(t => { if (t.name.startsWith('NOTE')) { const s = t.name.substring(4); if (/^\+*$/.test(s)) count = Math.max(count, s.length + 1); } });
    const newTab = { id: Date.now().toString(), name: count === 0 ? 'NOTE' : 'NOTE' + '+'.repeat(count), notes: [] };
    tabs.push(newTab); activeTabId = newTab.id;
    debouncedSave(); renderTabs(); renderNotes();
    const last = document.getElementById('tabs-list').lastElementChild;
    if (last) makeTabNameEditable(last, newTab.id);
}

function deleteTab(id) {
    if (tabs.length <= 1) return;
    if (confirm('このボードを削除しますか？')) {
        tabs = tabs.filter(t => t.id != id);
        if (activeTabId == id) activeTabId = tabs[0].id;
        debouncedSave(); renderTabs(); renderNotes();
    }
}

function makeTabNameEditable(el, id) {
    const tab = tabs.find(t => t.id == id); if (!tab) return;
    isEditing = true;
    const span = el.querySelector('.tab-name');
    const name = tab.name;
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'tab-edit-input'; input.value = name;
    span.innerHTML = ''; span.appendChild(input); input.focus(); input.select();
    input.onblur = () => { isEditing = false; tab.name = input.value.trim() || name; debouncedSave(); renderTabs(); };
    input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = name; input.blur(); } };
}

function setupEventListeners() {
    const fab = document.getElementById('fab');
    const fabMenu = document.getElementById('fab-menu');
    const handleFabClick = (e) => { e.preventDefault(); e.stopPropagation(); fab.classList.toggle('active'); fabMenu.classList.toggle('show'); };
    if (fab && fabMenu) { fab.addEventListener('click', handleFabClick); }
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
            currentType = item.dataset.type;
            document.getElementById('modal-title').innerText = currentType === 'todo' ? '+TODO' : '+MEMO';
            const modal = document.getElementById('note-modal');
            if (modal) modal.classList.add('show');
            if (fab) fab.classList.remove('active');
            if (fabMenu) fabMenu.classList.remove('show');
        });
    });
    document.querySelectorAll('.color-option').forEach(opt => {
        opt.addEventListener('click', () => {
            document.querySelectorAll('.color-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active'); selectedColor = opt.dataset.color;
        });
    });
    const saveBtn = document.getElementById('save-note');
    if (saveBtn) saveBtn.addEventListener('click', addNote);
    const cancelBtn = document.getElementById('cancel-note');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    const sortBtn = document.getElementById('sort-btn');
    if (sortBtn) sortBtn.addEventListener('click', sortNotesByDate);
    const addTabBtn = document.getElementById('add-tab-btn');
    if (addTabBtn) addTabBtn.addEventListener('click', addTab);
    const multiSelectBtn = document.getElementById('multi-select-btn');
    if (multiSelectBtn) multiSelectBtn.addEventListener('click', toggleSelectionMode);
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    if (deleteSelectedBtn) deleteSelectedBtn.addEventListener('click', deleteSelectedNotes);
    const dateInput = document.getElementById('note-date-full');
    if (dateInput) {
        const enforceNumeric = (e) => {
            let val = e.target.value.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/[^0-9]/g, '');
            if (e.target.value !== val) e.target.value = val;
        };
        dateInput.addEventListener('input', enforceNumeric);
    }
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.note-actions')) { document.querySelectorAll('.note-menu.show').forEach(m => m.classList.remove('show')); }
        const modal = document.getElementById('note-modal');
        if (e.target === modal) closeModal();
        if (fab && fabMenu && !e.target.closest('.fab-container')) { fab.classList.remove('active'); fabMenu.classList.remove('show'); }
    });
}

function closeModal() {
    const modal = document.getElementById('note-modal');
    if (modal) modal.classList.remove('show');
    const titleInput = document.getElementById('note-title');
    const dateInput = document.getElementById('note-date-full');
    if (titleInput) titleInput.value = '';
    if (dateInput) dateInput.value = '';
}

function runInitialSetup() {
    try {
        setupEventListeners();
        if (typeof firebase !== 'undefined') {
            firebase.initializeApp(firebaseConfig);
            db = firebase.database();
            auth = firebase.auth();
            firebase.database().enablePersistence().catch(err => console.warn("Persistence failed", err));
        }
        if (tabs.length === 0) {
            const oldNotes = JSON.parse(localStorage.getItem('sticky_notes')) || [];
            const defaultTab = { id: Date.now().toString(), name: 'NOTE', notes: oldNotes };
            tabs = [defaultTab]; activeTabId = defaultTab.id;
            localStorage.removeItem('sticky_notes'); saveToLocalStorage();
        }
        if (!activeTabId && tabs.length > 0) { activeTabId = tabs[0].id; saveToLocalStorage(); }
        renderTabs(); renderNotes(); handleAuth(); safeCreateIcons();
    } catch (e) {
        log("Setup Error: " + e.message);
    }
}

if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', runInitialSetup); }
else { runInitialSetup(); }

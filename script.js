// State Management
let tabs = JSON.parse(localStorage.getItem('sticky_tabs')) || [];
let activeTabId = localStorage.getItem('sticky_active_tab');

// Migration & Initialization
if (tabs.length === 0) {
    const oldNotes = JSON.parse(localStorage.getItem('sticky_notes')) || [];
    const defaultTab = {
        id: Date.now().toString(),
        name: 'General',
        notes: oldNotes
    };
    tabs = [defaultTab];
    activeTabId = defaultTab.id;
    localStorage.removeItem('sticky_notes');
    debouncedSave();
}

if (!activeTabId && tabs.length > 0) {
    activeTabId = tabs[0].id;
    debouncedSave();
}

function getActiveTab() {
    return tabs.find(t => t.id == activeTabId);
}

function getActiveNotes() {
    const tab = getActiveTab();
    return tab ? tab.notes : [];
}

let currentType = 'memo';
let selectedColor = 'yellow';
let isSelectionMode = false;
let selectedNoteIds = new Set();
let sortOrder = 'desc';

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

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

// Sync Logic
let currentUser = null;
let isRemoteUpdate = false;
let firebaseListener = null;

function getSyncPath() {
    return currentUser ? `users/${currentUser.uid}` : null;
}

function saveToFirebase() {
    if (isRemoteUpdate || !currentUser) return;
    db.ref(getSyncPath()).set({
        tabs: tabs,
        activeTabId: activeTabId,
        lastUpdated: Date.now()
    }).catch(err => console.error("Firebase save error:", err));
}

// Debounce save
let saveTimeout;
function debouncedSave() {
    saveToLocalStorage();
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveToFirebase, 1000);
}

// Auth Handlers
function handleAuth() {
    auth.onAuthStateChanged((user) => {
        currentUser = user;
        const loginBtn = document.getElementById('login-btn');
        const userProfile = document.getElementById('user-profile');
        
        if (user) {
            // Logged In
            loginBtn.style.display = 'none';
            userProfile.style.display = 'flex';
            const userPhoto = document.getElementById('user-photo');
            userPhoto.src = user.photoURL;
            userPhoto.onclick = logout; // Click photo to logout
            document.getElementById('user-name').innerText = user.displayName;
            
            // Start Syncing
            startSyncing();
        } else {
            // Logged Out
            loginBtn.style.display = 'flex';
            userProfile.style.display = 'none';
            stopSyncing();
            
            // On logout, keep local data but stop server sync
            renderTabs();
            renderNotes();
        }
    });
}

function startSyncing() {
    if (firebaseListener) firebaseListener.off();
    
    firebaseListener = db.ref(getSyncPath());
    firebaseListener.on('value', (snapshot) => {
        const data = snapshot.val();
        if (data && data.tabs) {
            // Sync from Server
            if (!tabs.length || data.lastUpdated > (parseInt(localStorage.getItem('sticky_last_sync')) || 0)) {
                isRemoteUpdate = true;
                tabs = data.tabs;
                activeTabId = data.activeTabId;
                localStorage.setItem('sticky_last_sync', data.lastUpdated);
                renderTabs();
                renderNotes();
                isRemoteUpdate = false;
            }
        } else if (tabs.length > 0) {
            // Initial upload to new account
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

// DOM Elements
const board = document.getElementById('board');
const fab = document.getElementById('fab');
const fabMenu = document.getElementById('fab-menu');
const noteModal = document.getElementById('note-modal');
const saveBtn = document.getElementById('save-note');
const cancelBtn = document.getElementById('cancel-note');
const sortBtn = document.getElementById('sort-btn');

function login() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(err => {
        console.error("Login failed:", err);
        if (err.code === 'auth/unauthorized-domain') {
            alert("ログインに失敗しました：このドメイン（URL）がFirebaseで許可されていません。Firebaseコンソールの Authentication > Settings > Authorized domains に現在のURLのドメインを追加してください。");
        } else {
            alert(`ログインに失敗しました: ${err.message}`);
        }
    });
}

function logout() {
    if (confirm("ログアウトしますか？")) {
        auth.signOut();
    }
}

// Initialize
function init() {
    renderTabs();
    renderNotes();
    setupEventListeners();
    handleAuth();
    
    // Auth Buttons
    document.getElementById('login-btn').onclick = login;
    document.getElementById('logout-btn').onclick = logout;
}

// Render Notes
function renderNotes() {
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
        if (parts.length === 3) {
            formattedDate = `${parseInt(parts[1])}/${parseInt(parts[2])}`;
        } else if (parts.length === 2) {
            formattedDate = `${parseInt(parts[0])}/${parseInt(parts[1])}`;
        } else {
            formattedDate = note.date; // fallback
        }
    }

    const dateDisplay = `<span class="note-date">${note.date ? formattedDate : ''}</span>`;
    const titleDisplay = `<span class="note-title-text">${note.title || 'タイトルなし'}</span>`;

    let contentHtml = '';
    if (note.type === 'memo') {
        contentHtml = `<div class="note-content"><textarea placeholder="メモを入力..." onchange="updateNoteContent(${note.id}, this.value)">${note.content || ''}</textarea></div>`;
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
                               onblur="updateTodoText(${note.id}, ${originalIdx}, this.innerText)"
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
                            <span contenteditable="true" onblur="updateTodoText(${note.id}, ${originalIdx}, this.innerText)">${todo.text}</span>
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

    // Event Listeners
    el.querySelector('.note-title-text').addEventListener('dblclick', (e) => makeTitleEditable(note.id, e.target));
    el.querySelector('.note-date').addEventListener('dblclick', (e) => makeDateEditable(note.id, e.target));
    
    // Menu Logic
    const menuToggle = el.querySelector('.menu-toggle');
    const noteMenu = el.querySelector('.note-menu');
    menuToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close other menus first
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
            // noteMenu.classList.remove('show'); // Keep open for preview
        });
    });

    // Make Draggable
    setupDraggable(el, note);
    
    // Make Resizable
    setupResizer(el, el.querySelector('.resizer'), note);

    // Lucide icons
    setTimeout(() => {
        lucide.createIcons({
            attrs: {
                'stroke-width': 2
            },
            nameAttr: 'data-lucide',
            parentElement: el
        });
    }, 0);

    return el;
}

// Draggable Logic
function setupDraggable(el, note) {
    let offsetX, offsetY;
    let isDragging = false;

    el.addEventListener('mousedown', (e) => {
        if (isSelectionMode) {
            e.preventDefault();
            e.stopPropagation();
            toggleNoteSelection(note.id);
            return;
        }

        if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.getAttribute('contenteditable') === 'true' || e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
        
        isDragging = true;
        el.classList.add('dragging');
        
        const rect = el.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        
        el.style.zIndex = 1000;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const x = e.clientX - offsetX;
        const y = e.clientY - offsetY;
        
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        
        note.x = x;
        note.y = y;
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        el.classList.remove('dragging');
        el.style.zIndex = '';
        debouncedSave();
    });

    // Set initial size if exists
    if (note.width) el.style.width = `${note.width}px`;
    if (note.height) el.style.height = `${note.height}px`;
}

// Resizer Logic
function setupResizer(el, resizer, note) {
    let startX, startY, startWidth, startHeight;

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        startX = e.clientX;
        startY = e.clientY;
        startWidth = el.offsetWidth;
        startHeight = el.offsetHeight;
        
        document.addEventListener('mousemove', doDrag);
        document.addEventListener('mouseup', stopDrag);
        
        el.style.zIndex = 1000;
    });

    function doDrag(e) {
        const width = startWidth + (e.clientX - startX);
        const height = startHeight + (e.clientY - startY);
        
        if (width > 150) {
            el.style.width = width + 'px';
            note.width = width;
        }
        if (height > 150) {
            el.style.height = height + 'px';
            note.height = height;
        }
    }

    function stopDrag() {
        document.removeEventListener('mousemove', doDrag);
        document.removeEventListener('mouseup', stopDrag);
        debouncedSave();
        el.style.zIndex = '';
    }
}

function updateNotePos(id, x, y) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === id);
    if (note) {
        note.x = x;
        note.y = y;
        debouncedSave();
    }
}

function updateNoteSize(id, w, h) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === id);
    if (note) {
        note.width = w;
        note.height = h;
        debouncedSave();
    }
}

function updateNoteColor(id, color) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === id);
    if (note) {
        note.color = color;
        debouncedSave();
        renderNotes();
    }
}

function updateNoteTitle(id, title) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === id);
    if (note) {
        note.title = title;
        debouncedSave();
    }
}

function updateNoteContent(id, content) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === id);
    if (note) {
        note.content = content;
        debouncedSave();
    }
}

// Note Operations
function addNote() {
    const title = document.getElementById('note-title').value;
    const dateFull = document.getElementById('note-date-full').value;
    
    let formattedDate = '';
    if (dateFull && dateFull.length === 8) {
        const y = parseInt(dateFull.substring(0, 4));
        const m = parseInt(dateFull.substring(4, 6));
        const d = parseInt(dateFull.substring(6, 8));
        
        if (y > 0 && m > 0 && d > 0) {
            formattedDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
    }

    const notes = getActiveNotes();
    const newNote = {
        id: Date.now(),
        type: currentType,
        title: title || (currentType === 'memo' ? 'MEMO' : 'TODO'),
        date: formattedDate,
        content: currentType === 'memo' ? '' : '',
        todos: currentType === 'todo' ? [] : [],
        color: selectedColor,
        x: 100 + notes.length * 20,
        y: 100 + notes.length * 20,
        width: 240,
        height: 240
    };

    notes.push(newNote);
    debouncedSave();
    renderNotes();
    closeModal();
}

function deleteNote(id) {
    const tab = getActiveTab();
    if (tab && confirm('この付箋を削除しますか？')) {
        tab.notes = tab.notes.filter(n => n.id !== id);
        selectedNoteIds.delete(id);
        updateBatchUI();
        debouncedSave();
        renderNotes();
    }
}

function toggleNoteSelection(id) {
    if (selectedNoteIds.has(id)) {
        selectedNoteIds.delete(id);
    } else {
        selectedNoteIds.add(id);
    }
    
    const el = document.getElementById(`note-${id}`);
    if (el) el.classList.toggle('selected');
    updateBatchUI();
}

function updateBatchUI() {
    const deleteBtn = document.getElementById('delete-selected-btn');
    const deleteCount = document.getElementById('delete-count');
    
    if (selectedNoteIds.size > 0) {
        deleteBtn.style.display = 'flex';
        deleteCount.innerText = `${selectedNoteIds.size}件削除`;
    } else {
        deleteBtn.style.display = 'none';
    }
}

function deleteSelectedNotes() {
    if (selectedNoteIds.size === 0) return;
    
    const activeTab = getActiveTab();
    if (activeTab && confirm(`選択した ${selectedNoteIds.size} 件の付箋を削除しますか？`)) {
        activeTab.notes = activeTab.notes.filter(n => !selectedNoteIds.has(n.id));
        selectedNoteIds.clear();
        updateBatchUI();
        debouncedSave();
        renderNotes();
    }
}

function toggleSelectionMode() {
    isSelectionMode = !isSelectionMode;
    const multiSelectBtn = document.getElementById('multi-select-btn');
    
    if (isSelectionMode) {
        multiSelectBtn.classList.add('active');
        document.querySelectorAll('.sticky-note').forEach(el => el.classList.add('selection-mode'));
    } else {
        multiSelectBtn.classList.remove('active');
        selectedNoteIds.clear();
        updateBatchUI();
        document.querySelectorAll('.sticky-note').forEach(el => {
            el.classList.remove('selection-mode');
            el.classList.remove('selected');
        });
    }
}

function changeNoteColor(id, color) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === id);
    if (note) {
        note.color = color;
        debouncedSave();
        renderNotes();
    }
}

function updateNoteContent(id, content) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === id);
    if (note) {
        note.content = content;
        debouncedSave();
    }
}

function toggleTodo(noteId, todoIdx) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === noteId);
    if (note && note.todos[todoIdx]) {
        note.todos[todoIdx].done = !note.todos[todoIdx].done;
        debouncedSave();
        renderNotes();
    }
}

function updateTodoText(noteId, todoIdx, text) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === noteId);
    if (note && note.todos[todoIdx]) {
        note.todos[todoIdx].text = text;
        debouncedSave();
    }
}

function deleteTodoItem(noteId, todoIdx) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === noteId);
    if (note && note.todos) {
        note.todos.splice(todoIdx, 1);
        debouncedSave();
        renderNotes();
    }
}

function addTodoItem(noteId) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === noteId);
    if (note) {
        note.todos.push({ text: '', done: false });
        debouncedSave();
        renderNotes();
        
        // Focus the new item
        setTimeout(() => {
            const noteEl = document.getElementById(`note-${noteId}`);
            const spans = noteEl.querySelectorAll('.todo-item span[contenteditable="true"]');
            const lastSpan = spans[spans.length - 1 - (note.todos.filter(t => t.done).length)];
            if (lastSpan) {
                lastSpan.focus();
            }
        }, 50);
    }
}

function handleTodoKeydown(e, noteId) {
    if (e.key === 'Enter') {
        e.preventDefault();
        addTodoItem(noteId);
    }
}

function makeTitleEditable(id, el) {
    el.contentEditable = true;
    el.focus();
    el.onblur = () => {
        el.contentEditable = false;
        const notes = getActiveNotes();
        const note = notes.find(n => n.id === id);
        if (note) {
            note.title = el.innerText;
            debouncedSave();
        }
    };
    el.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            el.blur();
        }
    };
}

function makeDateEditable(id, el) {
    const notes = getActiveNotes();
    const note = notes.find(n => n.id === id);
    if (!note) return;

    const originalDate = note.date || '';
    // Format to yyyy/mm/dd for display
    let displayText = originalDate.replace(/-/g, '/');
    if (displayText === '') displayText = 'yyyy/mm/dd';

    el.innerText = displayText;
    el.contentEditable = true;
    el.focus();

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    el.onblur = () => {
        el.contentEditable = false;
        let newText = el.innerText.trim().replace(/[^0-9/-]/g, '');
        
        // Auto-format 8 digits: 20260505 -> 2026/5/5
        if (/^\d{8}$/.test(newText)) {
            const y = newText.substring(0, 4);
            const m = parseInt(newText.substring(4, 6));
            const d = parseInt(newText.substring(6, 8));
            newText = `${y}/${m}/${d}`;
        }
        // Auto-format 4 digits: 0505 -> CurrentYear/5/5
        else if (/^\d{4}$/.test(newText)) {
            const m = parseInt(newText.substring(0, 2));
            const d = parseInt(newText.substring(2, 4));
            newText = `${new Date().getFullYear()}/${m}/${d}`;
        }

        // Handle yyyy/mm/dd or yyyy-mm-dd or mm/dd
        const parts = newText.split(/[-/.]/);
        if (parts.length >= 2) {
            let y, m, d;
            if (parts.length === 3) {
                y = parts[0];
                m = parts[1];
                d = parts[2];
            } else {
                y = new Date().getFullYear();
                m = parts[0];
                d = parts[1];
            }
            
            // Validate and pad
            const numY = parseInt(y);
            const numM = parseInt(m);
            const numD = parseInt(d);
            
            if (!isNaN(numY) && numY > 0 && !isNaN(numM) && numM > 0 && !isNaN(numD) && numD > 0) {
                note.date = `${numY}-${String(numM).padStart(2, '0')}-${String(numD).padStart(2, '0')}`;
            } else {
                note.date = '';
            }
        } else {
            note.date = '';
        }
        
        debouncedSave();
        renderNotes();
    };

    el.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            el.blur();
        }
    };
}

// Sorting Logic
function sortNotesByDate() {
    const tab = getActiveTab();
    if (!tab) return;
    
    // Toggle order
    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    
    // Update icon
    const sortBtnIcon = document.querySelector('#sort-btn i');
    if (sortBtnIcon) {
        sortBtnIcon.setAttribute('data-lucide', sortOrder === 'asc' ? 'arrow-up-az' : 'arrow-down-az');
        lucide.createIcons({ parentElement: document.getElementById('sort-btn') });
    }
    
    // Separate notes with and without dates
    const withDate = tab.notes.filter(n => n.date).sort((a, b) => {
        const dA = new Date(a.date);
        const dB = new Date(b.date);
        return sortOrder === 'asc' ? dA - dB : dB - dA;
    });
    const withoutDate = tab.notes.filter(n => !n.date);
    
    const sorted = [...withDate, ...withoutDate];
    
    const margin = 30;
    const startX = 40;
    const startY = 40;
    const boardWidth = window.innerWidth - 80;

    let currentX = startX;
    let currentY = startY;
    let maxRowHeight = 0;
    
    sorted.forEach((note) => {
        const noteWidth = note.width || 240;
        const noteHeight = note.height || 240;

        if (currentX + noteWidth > boardWidth + startX && currentX > startX) {
            // Move to next row
            currentX = startX;
            currentY += maxRowHeight + margin;
            maxRowHeight = 0;
        }

        note.x = currentX;
        note.y = currentY;

        currentX += noteWidth + margin;
        maxRowHeight = Math.max(maxRowHeight, noteHeight);
    });
    
    tab.notes = sorted;
    debouncedSave();
    renderNotes();
}

function saveToLocalStorage() {
    localStorage.setItem('sticky_tabs', JSON.stringify(tabs));
    localStorage.setItem('sticky_active_tab', activeTabId);
    localStorage.setItem('sticky_last_sync', Date.now());
}

// Tab Management
function renderTabs() {
    const tabsList = document.getElementById('tabs-list');
    tabsList.innerHTML = '';
    
    tabs.forEach(tab => {
        const tabEl = document.createElement('div');
        tabEl.className = `tab-item ${tab.id == activeTabId ? 'active' : ''}`;
        tabEl.onclick = () => switchTab(tab.id);
        tabEl.ondblclick = (e) => {
            e.stopPropagation();
            makeTabNameEditable(tabEl, tab.id);
        };
        
        tabEl.innerHTML = `
            <span class="tab-name">${tab.name}</span>
            ${tabs.length > 1 ? `
                <span class="tab-delete-btn" onclick="event.stopPropagation(); deleteTab('${tab.id}')">
                    <i data-lucide="x" style="width: 14px; height: 14px;"></i>
                </span>
            ` : ''}
        `;
        
        tabsList.appendChild(tabEl);
    });
    
    lucide.createIcons();
}

function switchTab(id) {
    if (activeTabId == id) return;
    activeTabId = id;
    selectedNoteIds.clear();
    updateBatchUI();
    debouncedSave();
    renderTabs();
    renderNotes();
}

function addTab() {
    const newTab = {
        id: Date.now().toString(),
        name: `ボード ${tabs.length + 1}`,
        notes: []
    };
    tabs.push(newTab);
    activeTabId = newTab.id;
    debouncedSave();
    renderTabs();
    renderNotes();
    
    // Auto edit new tab name
    const tabsList = document.getElementById('tabs-list');
    const newTabEl = tabsList.lastElementChild;
    if (newTabEl) makeTabNameEditable(newTabEl, newTab.id);
}

function deleteTab(id) {
    if (tabs.length <= 1) return;
    if (confirm('このボードを削除しますか？中の付箋もすべて削除されます。')) {
        tabs = tabs.filter(t => t.id != id);
        if (activeTabId == id) {
            activeTabId = tabs[0].id;
        }
        debouncedSave();
        renderTabs();
        renderNotes();
    }
}

function makeTabNameEditable(el, id) {
    const tab = tabs.find(t => t.id == id);
    if (!tab) return;
    
    const nameSpan = el.querySelector('.tab-name');
    const currentName = tab.name;
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-edit-input';
    input.value = currentName;
    
    nameSpan.innerHTML = '';
    nameSpan.appendChild(input);
    input.focus();
    input.select();
    
    input.onblur = () => {
        const newName = input.value.trim() || currentName;
        tab.name = newName;
        debouncedSave();
        renderTabs();
    };
    
    input.onkeydown = (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
            input.value = currentName;
            input.blur();
        }
    };
}

function setupEventListeners() {
    fab.addEventListener('click', () => {
        fab.classList.toggle('active');
        fabMenu.classList.toggle('show');
    });

    // Date input handling is now simplified to one field

    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
            currentType = item.dataset.type;
            document.getElementById('modal-title').innerText = currentType === 'todo' ? '新規TODO付箋' : '新規MEMO付箋';
            noteModal.classList.add('show');
            fab.classList.remove('active');
            fabMenu.classList.remove('show');
        });
    });

    document.querySelectorAll('.color-option').forEach(opt => {
        opt.addEventListener('click', () => {
            document.querySelectorAll('.color-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            selectedColor = opt.dataset.color;
        });
    });

    saveBtn.addEventListener('click', addNote);
    cancelBtn.addEventListener('click', closeModal);
    sortBtn.addEventListener('click', sortNotesByDate);
    
    document.getElementById('add-tab-btn').addEventListener('click', addTab);
    
    document.getElementById('multi-select-btn').addEventListener('click', toggleSelectionMode);
    document.getElementById('delete-selected-btn').addEventListener('click', deleteSelectedNotes);

    // Close modal or menu on click outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.note-actions')) {
            document.querySelectorAll('.note-menu.show').forEach(m => m.classList.remove('show'));
        }
        if (e.target === noteModal) closeModal();
    });
}

function closeModal() {
    noteModal.classList.remove('show');
    document.getElementById('note-title').value = '';
    document.getElementById('note-date-full').value = '';
}

init();

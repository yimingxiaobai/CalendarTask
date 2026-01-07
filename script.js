/**
 * Calendar Task Master Logic
 */

// --- STATE MANAGEMENT ---

const state = {
    currentDate: new Date(),
    selectedDate: null,
    view: 'calendar',
    tasks: [],
    listeners: [],
    fileHandle: null,
    theme: 'default' // Add theme to state
};

// ... Data Structures ...

// --- INITIALIZATION ---

async function init() {
    loadData(); // Load from LocalStorage first (instant)

    // Apply loaded theme immediately (or default)
    if (state.theme) {
        applyTheme(state.theme, false); // false = don't save yet, just apply
    }

    render();

    // Try to restore file handle
    try {
        const handle = await getHandle();
        if (handle) {
            // Check permissions
            const opts = { mode: 'readwrite' };
            if ((await handle.queryPermission(opts)) === 'granted') {
                state.fileHandle = handle;
                updateSaveStatus('已连接文件', 'success');
            } else {
                // Request permission (requires user gesture usually, but we can try or wait for user to click a 'Reconnect' button)
                // We'll leave it in state but not connected until user interaction?
                // Actually better to ask user: "Restore connection?" 
                // For now, let's just show it's available but needs interaction.
                updateSaveStatus('点击重连文件', 'warning', verifyPermission);
                state.fileHandle = handle; // Keep it to verify later
            }
        }
    } catch (e) {
        console.log("IDB Error", e);
    }
}

function loadData() {
    const data = localStorage.getItem('taskflow_data');
    if (data) {
        try {
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
                state.tasks = parsed;
            } else {
                state.tasks = parsed.tasks || [];
                if (parsed.theme) state.theme = parsed.theme;
            }
        } catch (e) { console.error('Load Error', e); }
    }
}

// Add locking flags to state initialization would be cleaner, but I can't edit that block easily without viewing top of file again. 
// I'll add them dynamically or just assume they exist on state since JS is loose.
// Actually, let's just use a module-level variable or attach to state inside this function if undefined.

// State variable for debouncing (attached to state object for persistence across calls)
// state.saveTimer = null; (will be initialized dynamically)

async function saveData() {
    const dataToSave = {
        tasks: state.tasks,
        theme: state.theme
    };

    // 1. Always save to LocalStorage immediately (SYNC & INSTANT)
    // This ensures that even if file write hits a debounce delay or error, data is safe in browser.
    try {
        localStorage.setItem('taskflow_data', JSON.stringify(dataToSave));
    } catch (e) { console.error("LS Error", e); }

    // 2. File Save Strategy: DEBOUNCE
    // If no file connected, we are done.
    if (!state.fileHandle) {
        updateSaveStatus('已保存 (缓存)', 'success');
        return;
    }

    // Update UI to show we have pending changes
    updateSaveStatus('正在同步...', 'pending');

    // Clear any pending write
    if (state.saveTimer) {
        clearTimeout(state.saveTimer);
    }

    // Schedule new write in 500ms
    // This allows rapid operations (typing, clicking) to bunch up into one file write.
    state.saveTimer = setTimeout(async () => {
        try {
            // Check permission
            const opts = { mode: 'readwrite' };
            if ((await state.fileHandle.queryPermission(opts)) === 'granted') {
                const writable = await state.fileHandle.createWritable();
                await writable.write(JSON.stringify(dataToSave, null, 2));
                await writable.close();
                updateSaveStatus('已保存到本地', 'success');
            } else {
                updateSaveStatus('需要文件权限', 'warning', verifyPermission);
            }
        } catch (err) {
            console.error('File save error:', err);
            updateSaveStatus('文件保存失败 (点击重试)', 'error', saveData);
        } finally {
            state.saveTimer = null;
        }
    }, 500); // 500ms buffer
}

// --- FILE SYSTEM & IDB ---

const DB_NAME = 'TaskFlowDB';
const DB_STORE = 'handles';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e);
    });
}

async function storeHandle(handle) {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(handle, 'taskFile');
}

async function getHandle() {
    const db = await openDB();
    return new Promise(resolve => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get('taskFile');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

async function verifyPermission() {
    if (!state.fileHandle) return;
    const opts = { mode: 'readwrite' };
    if ((await state.fileHandle.requestPermission(opts)) === 'granted') {
        updateSaveStatus('已连接文件', 'success');
        saveData(); // Sync immediately
    }
}

async function connectFile() {
    try {
        const pickerOpts = {
            types: [{
                description: 'JSON Files',
                accept: { 'application/json': ['.json'] }
            }],
            excludeAcceptAllOption: true,
            multiple: false
        };
        [state.fileHandle] = await window.showOpenFilePicker(pickerOpts);
        await storeHandle(state.fileHandle); // Persist

        const file = await state.fileHandle.getFile();
        const content = await file.text();
        if (content) {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
                state.tasks = parsed;
            } else {
                state.tasks = parsed.tasks || [];
                if (parsed.theme) {
                    state.theme = parsed.theme;
                    applyTheme(state.theme, false);
                }
            }
            saveData();
            render();
            // alert('连接成功'); // Removed alert implies smoother UX
        }
    } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
    }
}

async function newFile() {
    try {
        const opts = {
            types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
        };
        state.fileHandle = await window.showSaveFilePicker(opts);
        await storeHandle(state.fileHandle); // Persist
        await saveData();
    } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
    }
}

// UI Helper
function updateSaveStatus(text, type, clickHandler) {
    // We'll need a DOM element for this. Let's create one if missing.
    let el = document.getElementById('save-status');
    if (!el) {
        el = document.createElement('div');
        el.id = 'save-status';
        el.className = 'save-status';
        document.querySelector('header .actions').prepend(el);
    }
    el.textContent = text;
    el.className = `save-status ${type}`; // e.g. success, warning, pending
    el.onclick = clickHandler || null;
    el.style.cursor = clickHandler ? 'pointer' : 'default';
}

function seedData() {
    // User requested empty start
    state.tasks = [];
    saveData();
    render();
}

// --- LOGIC: PERCENTS & FLATTENING ---

function calculateProgress(task) {
    if (task.type === 'L3') return task.completed ? 100 : 0;

    if (!task.children || task.children.length === 0) return 0;

    // Recursive: get all L3 descendants
    const allL3s = getAllL3Descendants(task);
    if (allL3s.length === 0) return 0;

    const completedCount = allL3s.filter(t => t.completed).length;
    return Math.round((completedCount / allL3s.length) * 100);
}

function getAllL3Descendants(task) {
    if (task.type === 'L3') return [task];
    let l3s = [];
    if (task.children) {
        task.children.forEach(child => {
            l3s = l3s.concat(getAllL3Descendants(child));
        });
    }
    return l3s;
}

function getAllTasksFlat() {
    let flat = [];
    state.tasks.forEach(t => {
        flat.push(t);
        if (t.children) {
            t.children.forEach(c => {
                flat.push(c);
                if (c.children) {
                    flat.push(...c.children); // L3s
                }
            });
        }
    });
    return flat;
}

function findTask(id) {
    const flat = getAllTasksFlat();
    return flat.find(t => t.id === id);
}

// --- ACTIONS ---

function addNewL1Task() {
    const title = prompt("请输入一级任务标题:");
    if (title) {
        const newTask = {
            id: 'l1-' + Date.now(),
            title: title,
            type: 'L1',
            startDate: dateToIsoString(new Date()),
            endDate: dateToIsoString(new Date(new Date().setDate(new Date().getDate() + 7))),
            children: []
        };
        state.tasks.push(newTask);
        saveData();
        render();
    }
}

function addSubTask(parentId) {
    const parent = findTask(parentId);
    if (!parent) return;

    let type = '';
    if (parent.type === 'L1') type = 'L2';
    else if (parent.type === 'L2') type = 'L3';
    else return; // L3 cannot have children

    const title = prompt(`请输入 ${type === 'L2' ? '二级' : '三级'} 任务标题:`);
    if (title) {
        const newTask = {
            id: type.toLowerCase() + '-' + Date.now(),
            title: title,
            type: type,
            parentId: parentId
        };

        if (type === 'L2') {
            newTask.startDate = parent.startDate;
            newTask.endDate = parent.endDate;
            newTask.children = [];
        } else {
            newTask.completed = false;
            newTask.scheduledDate = null;
        }

        if (!parent.children) parent.children = [];
        parent.children.push(newTask);
        saveData();
        render();
    }
}

function deleteTask(taskId) {
    if (!confirm("确定要删除此任务吗？")) return;

    // Helper to remove from tree
    function removeRecursive(list, id) {
        const idx = list.findIndex(t => t.id === id);
        if (idx > -1) {
            list.splice(idx, 1);
            return true;
        }
        for (let t of list) {
            if (t.children && removeRecursive(t.children, id)) return true;
        }
        return false;
    }

    removeRecursive(state.tasks, taskId);
    saveData();
    render();
}

function toggleTaskCompletion(taskId) {
    const task = findTask(taskId);
    if (task && task.type === 'L3') {
        task.completed = !task.completed;
        saveData();
        render();
    }
}

function toggleCollapse(taskId) {
    const task = findTask(taskId);
    if (task) {
        task.collapsed = !task.collapsed;
        saveData();
        renderTaskList(); // Only need to re-render list
    }
}

function scheduleTasktToDate() {
    const select = document.getElementById('modal-task-select');
    const taskId = select.value;
    if (!taskId) return;

    const task = findTask(taskId);
    if (task && state.selectedDate) {
        const dateStr = dateToIsoString(state.selectedDate);

        // Validation: Check against Parent (L2) range
        if (task.parentId) {
            const parent = findTask(task.parentId);
            if (parent && parent.startDate && parent.endDate) {
                if (dateStr < parent.startDate || dateStr > parent.endDate) {
                    alert(`无法安排推此日期！\n\n当前选择日期: ${dateStr}\n所属父任务范围: ${parent.startDate} 至 ${parent.endDate}\n\n请选择父任务范围内的时间，或先修改父任务时间。`);
                    return;
                }
            }
        }

        task.scheduledDate = dateStr;
        saveData();
        renderDayModal();
        renderCalendar();
    }
}

// --- RENDERING: MAIN ---

function render() {
    if (state.view === 'calendar') {
        renderCalendar();
    } else {
        renderTaskList();
    }

    // If Day Modal is open, re-render it to reflect changes (e.g. completion status)
    const dayModal = document.getElementById('day-modal');
    if (dayModal && !dayModal.classList.contains('hidden')) {
        renderDayModal();
    }
}

function switchView(viewName) {
    state.view = viewName;
    document.querySelectorAll('.view-switcher .btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-view-${viewName}`).classList.add('active');

    document.querySelectorAll('.view-section').forEach(s => s.style.display = 'none');
    document.getElementById(`view-${viewName}`).style.display = 'block';

    render();
}

function changeMonth(delta) {
    state.currentDate.setMonth(state.currentDate.getMonth() + delta);
    renderCalendar();
}

// --- RENDERING: CALENDAR ---

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    const year = state.currentDate.getFullYear();
    const month = state.currentDate.getMonth();

    document.getElementById('calendar-month-title').textContent = `${year}年 ${month + 1}月`;

    const firstDayOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const startDayOfWeek = firstDayOfMonth.getDay();

    for (let i = 0; i < startDayOfWeek; i++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day other-month';
        grid.appendChild(cell);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day';
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        const num = document.createElement('div');
        num.className = 'day-number';
        num.textContent = day;
        cell.appendChild(num);

        const todayStr = dateToIsoString(new Date());
        if (dateStr === todayStr) cell.classList.add('today');

        renderDayTasks(cell, dateStr);

        cell.onclick = () => openDayModal(new Date(year, month, day));

        grid.appendChild(cell);
    }
}

function renderDayTasks(cell, dateStr) {
    const tasks = state.tasks;
    const date = new Date(dateStr);

    tasks.forEach(l1 => {
        // Skip L1 rendering in Calendar as requested
        // if (isDateInRange(dateStr, l1.startDate, l1.endDate)) { ... }

        if (l1.children) {
            l1.children.forEach(l2 => {
                if (isDateInRange(dateStr, l2.startDate, l2.endDate)) {
                    const bar = document.createElement('div');
                    bar.className = 'gantt-bar l2';
                    bar.title = l2.title;
                    if (dateStr === l2.startDate || date.getDate() === 1) {
                        bar.innerHTML = `<span class="gantt-label">${l2.title}</span>`;
                    }
                    cell.appendChild(bar);
                }
            });
        }
    });

    const flatL3 = getAllTasksFlat().filter(t => t.type === 'L3' && t.scheduledDate === dateStr);
    flatL3.forEach(l3 => {
        const bar = document.createElement('div');
        bar.className = `gantt-bar l3 ${l3.completed ? 'completed' : ''}`;
        bar.title = l3.title;
        // L3 is single day, so always show label
        bar.innerHTML = `<span class="gantt-label">${l3.title}</span>`;

        // Prevent clicking the bar from opening the modal? 
        // No, clicking bar should probably just open the day modal like the cell does.
        // Handled by cell.onclick bubbling.
        cell.appendChild(bar);
    });
}

function isDateInRange(target, start, end) {
    if (!start || !end) return false;
    return target >= start && target <= end;
}

// --- RENDERING: MODAL ---

function openDayModal(date) {
    state.selectedDate = date;
    const modal = document.getElementById('day-modal');
    document.getElementById('modal-date-title').textContent = `${date.getMonth() + 1}月${date.getDate()}日`;

    renderDayModal();
    modal.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('day-modal').classList.add('hidden');
    state.selectedDate = null;
}

// SVG Constants to avoid clutter
const ICONS = {
    check: '<svg class="icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    time: '<svg class="icon" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>',
    add: '<svg class="icon" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>',
    delete: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
    edit: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
    remove: '<svg class="icon" viewBox="0 0 24 24"><path d="M7 11v2h10v-2H7zm5-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>'
};

function openDateModal(taskId) {
    // Stop propagation is handled by onclick wrapper usually, but good to be safe
    // However, since this is called from inline onclick, we rely on the stopProp variable there
    const task = findTask(taskId);
    if (!task) return;

    document.getElementById('date-modal-task-id').value = taskId;
    document.getElementById('date-modal-start').value = task.startDate || '';
    document.getElementById('date-modal-end').value = task.endDate || '';

    document.getElementById('date-modal').classList.remove('hidden');
}

function closeDateModal() {
    document.getElementById('date-modal').classList.add('hidden');
}

function saveDateRange() {
    const taskId = document.getElementById('date-modal-task-id').value;
    const start = document.getElementById('date-modal-start').value;
    const end = document.getElementById('date-modal-end').value;

    const task = findTask(taskId);
    if (task) {
        if (start > end) {
            alert('开始日期不能晚于结束日期');
            return;
        }

        // Validation: Check against Parent Range (if exists)
        if (task.parentId) {
            const parent = findTask(task.parentId);
            if (parent && parent.startDate && parent.endDate) {
                if (start < parent.startDate || end > parent.endDate) {
                    alert(`设置失败！子任务时间必须在父任务范围内。\n\n父任务限制: ${parent.startDate} 至 ${parent.endDate}\n请先调整父任务时间。`);
                    return;
                }
            }
        }

        // Optional: Check against Children? (Prompt didn't explicitly ask to block shrinking L1, but it's good practice. 
        // But user specifically asked "L2 and L3 completion time cannot exceed L1". So primarily Child -> Parent check.)

        task.startDate = start;
        task.endDate = end;
        saveData();
        render();
        closeDateModal();
    }
}

function unscheduleTask(taskId) {
    // Keep internal logic strictly "unschedule" (remove from day), not delete from project
    const task = findTask(taskId);
    if (task) {
        task.scheduledDate = null;
        saveData();
        renderDayModal();
        renderCalendar();
    }
}

function renderDayModal() {
    const dateStr = dateToIsoString(state.selectedDate);
    const list = document.getElementById('modal-task-list');
    list.innerHTML = '';

    // Find scheduled L3s
    const allL3 = getAllTasksFlat().filter(t => t.type === 'L3');
    const todayTasks = allL3.filter(t => t.scheduledDate === dateStr);

    if (todayTasks.length === 0) {
        list.innerHTML = '<div style="color:var(--text-secondary);font-size:0.9rem;">暂无安排的任务</div>';
    } else {
        todayTasks.forEach(task => {
            const row = document.createElement('div');
            row.className = 'task-row l3';
            // Stop propagation for the button to avoid triggering checkbox
            const stopProp = 'event.stopPropagation();';
            row.innerHTML = `
                <div class="checkbox-container ${task.completed ? 'checked' : ''}" onclick="toggleTaskCompletion('${task.id}')" style="flex:1">
                    <div class="custom-checkbox">${ICONS.check}</div>
                    <span class="task-title ${task.completed ? 'completed' : ''}">${task.title}</span>
                </div>
                <button class="btn icon-btn small delete-btn" onclick="${stopProp} unscheduleTask('${task.id}')" title="从今日移除 (不删除任务)">${ICONS.remove}</button>
            `;
            list.appendChild(row);
        });
    }

    // Populate Select for Adding...
    const select = document.getElementById('modal-task-select');
    select.innerHTML = '<option value="">选择任务...</option>';

    const unscheduled = allL3.filter(t => t.scheduledDate !== dateStr);
    const simpleUnscheduled = allL3.filter(t => !t.scheduledDate);

    // Use simpleUnscheduled or unscheduled? The requirement implies "Add to today", usually meaning from "Unscheduled pool".
    // But allowing rescheduling from other days is also powerful.
    // Let's stick to strict "Unscheduled" tasks for simplicity in the dropdown to avoid clutter,
    // OR filter out tasks already on THIS day (which we did: t.scheduledDate !== dateStr).
    // Let's show ALL tasks that are NOT on this day, so you can move them here.
    const availableTasks = allL3.filter(t => t.scheduledDate !== dateStr);

    availableTasks.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.scheduledDate ? `${t.title} [${t.scheduledDate}]` : t.title;
        select.appendChild(opt);
    });
}


// --- RENDERING: TASK VIEW ---

function renderTaskList() {
    const container = document.getElementById('task-list-container');
    container.innerHTML = '';

    state.tasks.forEach(l1 => {
        container.appendChild(createTaskNode(l1));
    });
}

function createTaskNode(task) {
    const el = document.createElement('div');
    el.className = `task-row-container ${task.type.toLowerCase()}`;

    // Progress for L1/L2
    const progress = calculateProgress(task);
    const progressHtml = task.type !== 'L3' ? `
        <div class="progress-bar">
            <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
        <div style="font-size:0.7rem; color:var(--text-secondary); margin-left:8px;">${progress}%</div>
    ` : '';

    // Checkbox for L3 only
    const checkboxHtml = task.type === 'L3' ? `
        <div class="checkbox-container ${task.completed ? 'checked' : ''}" onclick="toggleTaskCompletion('${task.id}')">
            <div class="custom-checkbox">${ICONS.check}</div>
        </div>
    ` : '';

    // Collapse Button (L1/L2 only)
    let collapseBtn = '';
    if (task.type !== 'L3') {
        const rotation = task.collapsed ? '-90deg' : '0deg';
        const stopProp = 'event.stopPropagation();';
        // Using a larger, clearer chevron icon (Material Design 'expand_more')
        collapseBtn = `
            <button class="btn icon-btn small collapse-btn" onclick="${stopProp} toggleCollapse('${task.id}')" style="margin-right:0.5rem; transform: rotate(${rotation}); transition: transform 0.2s;">
                <svg class="icon" viewBox="0 0 24 24" style="width: 20px; height: 20px;"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>
            </button>
        `;
    }

    // Date Range (Simple display)
    const dateMeta = (task.startDate && task.endDate) ?
        `<span class="task-meta">${ICONS.time} ${task.startDate.slice(5)} - ${task.endDate.slice(5)}</span>` : '';

    // Action Buttons
    let actionButtons = '';
    // Prevent event bubbling just in case structure changes
    const stopProp = 'event.stopPropagation();';

    if (task.type !== 'L3') {
        actionButtons += `<button class="btn icon-btn small" onclick="${stopProp} openDateModal('${task.id}')" title="设置时间">${ICONS.edit} 时间</button>`;
        const btnText = task.type === 'L1' ? '添加二级' : '添加三级';
        actionButtons += `<button class="btn icon-btn small" onclick="${stopProp} addSubTask('${task.id}')" title="添加子任务">${ICONS.add} ${btnText}</button>`;
    }
    actionButtons += `<button class="btn icon-btn small delete-btn" onclick="${stopProp} deleteTask('${task.id}')" title="删除任务">${ICONS.delete} 删除</button>`;

    const content = `
        <div class="task-row ${task.type.toLowerCase()}">
            <div class="task-header">
                ${collapseBtn}
                ${checkboxHtml}
                <div class="task-info">
                    <div style="flex:1">
                        <div class="task-title ${task.completed ? 'completed' : ''}">${task.title}</div>
                        ${dateMeta}
                    </div>
                    ${progressHtml}
                </div>
                <div class="task-actions">
                    ${actionButtons}
                </div>
            </div>
        </div>
    `;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = content;

    // Render children ONLY if not collapsed
    if (!task.collapsed && task.children && task.children.length > 0) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'children-container';
        task.children.forEach(child => {
            childrenContainer.appendChild(createTaskNode(child));
        });
        wrapper.appendChild(childrenContainer);
    }

    return wrapper;
}
// --- HELPERS ---

function dateToIsoString(date) {
    const offset = date.getTimezoneOffset() * 60000;
    const local = new Date(date - offset);
    return local.toISOString().split('T')[0];
}

// --- THEME & SETTINGS ---

function openSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.classList.remove('hidden');
        updateThemeUI(state.theme);
    }
}

function closeSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('hidden');
}

function applyTheme(themeName, shouldSave = true) {
    // 1. Update State
    state.theme = themeName;

    // 2. Update DOM
    document.body.classList.remove('theme-warm', 'theme-pink', 'theme-fresh');
    if (themeName !== 'default') {
        document.body.classList.add(`theme-${themeName}`);
    }

    // 3. Update UI Active State (if modal open)
    updateThemeUI(themeName);

    // 4. Save
    if (shouldSave) saveData();
}

function updateThemeUI(activeTheme) {
    document.querySelectorAll('.theme-option').forEach(el => el.classList.remove('active'));
    const activeEl = document.getElementById(`theme-opt-${activeTheme}`);
    if (activeEl) activeEl.classList.add('active');
}

// Start
init();

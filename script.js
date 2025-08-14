
let tasks = [];
let archive = [];
let notes = [];
let points = 0;

// Load tasks and archive
fetch('tasks.json')
    .then(res => res.json())
    .then(data => {
        tasks = data;
        renderTasks();
        renderTopTasks();
        checkUrgentTasks();
    });

fetch('archive.json')
    .then(res => res.json())
    .then(data => {
        archive = data;
        renderArchive();
    });

// Notes from localStorage
if (localStorage.getItem('notes')) {
    notes = JSON.parse(localStorage.getItem('notes'));
    renderNotes();
}

// Section switcher
function showSection(section) {
    document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));
    if(section === 'dashboard') document.getElementById('dashboardSection').classList.remove('hidden');
    if(section === 'addTask') document.getElementById('addTaskSection').classList.remove('hidden');
    if(section === 'calendar') { document.getElementById('calendarSection').classList.remove('hidden'); renderCalendar(); }
    if(section === 'archive') document.getElementById('archiveSection').classList.remove('hidden');
    if(section === 'notes') document.getElementById('notesSection').classList.remove('hidden');
}

// Urgent tasks alert
function checkUrgentTasks() {
    const urgentTasks = tasks.filter(t => getUrgency(t.deadline) === 'urgent');
    const alertBox = document.getElementById('urgentAlert');
    if (urgentTasks.length > 0) {
        alertBox.classList.remove('hidden');
        alertBox.innerHTML = '<strong>Urgente taken:</strong><br>' + urgentTasks.map(t => t.name + ' (' + formatDate(t.deadline) + ')').join('<br>');
    } else {
        alertBox.classList.add('hidden');
    }
}

// Render top 3 tasks
function renderTopTasks() {
    const topTasks = document.getElementById('topTasks');
    topTasks.innerHTML = '';
    const sorted = [...tasks].sort((a,b) => new Date(a.deadline) - new Date(b.deadline));
    sorted.slice(0,3).forEach(task => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="${getUrgency(task.deadline)}">${task.name}</span><span>${formatDate(task.deadline)}</span>`;
        topTasks.appendChild(li);
    });
}

// Render all tasks
function renderTasks() {
    const list = document.getElementById('taskList');
    list.innerHTML = '';
    const category = document.getElementById('categoryFilter').value;
    const duration = document.getElementById('durationFilter').value;
    tasks.forEach(task => {
        if ((category && task.category !== category) || (duration && task.duration !== duration)) return;
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="${getUrgency(task.deadline)}">${task.name}</span>
            <span>${formatDate(task.deadline)}</span>
            <input type="checkbox" ${task.done ? 'checked' : ''} onclick="toggleTask('${task.id}')">
        `;
        list.appendChild(li);
    });
}

// Urgency calculation
function getUrgency(deadline) {
    const diff = (new Date(deadline) - new Date()) / (1000*60*60*24);
    if (diff <= 1) return 'urgent';
    if (diff <= 3) return 'warning';
    return 'safe';
}

// Toggle task completion
function toggleTask(id) {
    tasks = tasks.map(t => {
        if (t.id === id && !t.done) {
            t.done = true;
            points += getUrgency(t.deadline) === 'urgent' ? 3 : 1;
            archive.push(t);
        }
        return t;
    }).filter(t => !t.done);
    updateProgress();
    renderTasks();
    renderTopTasks();
    renderArchive();
    checkUrgentTasks();
}

// Progress bar update
function updateProgress() {
    document.getElementById('progressBar').style.width = ((points/20)*100) + '%';
    document.getElementById('pointsCount').innerText = points;
}

// Add new task
function addTask() {
    const name = document.getElementById('taskName').value;
    const deadline = document.getElementById('taskDeadline').value;
    const urgency = document.getElementById('taskUrgency').value;
    const category = document.getElementById('taskCategory').value;
    const duration = document.getElementById('taskDuration').value;
    const description = document.getElementById('taskDescription').value;

    if (!name || !deadline) return alert("Vul minimaal naam en deadline in.");

    const newTask = { 
        id: Date.now().toString(), 
        name, 
        deadline, 
        urgency: urgency || getUrgency(deadline),
        category, 
        duration, 
        description, 
        done: false 
    };
    tasks.push(newTask);
    renderTasks();
    renderTopTasks();
    checkUrgentTasks();
    showSection('dashboard');
}

// Render archive
function renderArchive() {
    const list = document.getElementById('archiveList');
    list.innerHTML = '';
    archive.forEach(task => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${task.name}</span><span>${formatDate(task.deadline)}</span>`;
        list.appendChild(li);
    });
}

// Notes
function addNote() {
    const text = document.getElementById('noteInput').value;
    if (!text) return;
    notes.push(text);
    localStorage.setItem('notes', JSON.stringify(notes));
    document.getElementById('noteInput').value = '';
    renderNotes();
}
function renderNotes() {
    const list = document.getElementById('notesList');
    list.innerHTML = '';
    notes.forEach((note, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${note}</span>
            <div>
                <button onclick="noteToTask(${idx})">Maak taak</button>
                <button onclick="deleteNote(${idx})">Verwijder</button>
            </div>`;
        list.appendChild(li);
    });
}
function deleteNote(idx) {
    notes.splice(idx, 1);
    localStorage.setItem('notes', JSON.stringify(notes));
    renderNotes();
}
function noteToTask(idx) {
    const note = notes[idx];
    showSection('addTask');
    document.getElementById('taskName').value = note;
}

// Calendar
function renderCalendar() {
    const calendarView = document.getElementById('calendarView');
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    let html = '<table class="calendar"><tr>';
    const daysOfWeek = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
    daysOfWeek.forEach(d => html += `<th>${d}</th>`);
    html += '</tr><tr>';

    for (let i = 0; i < (firstDay.getDay() + 6) % 7; i++) {
        html += '<td></td>';
    }
    for (let day = 1; day <= lastDay.getDate(); day++) {
        const currentDate = new Date(year, month, day);
        const dayTasks = tasks.filter(t => formatDate(t.deadline) === formatDate(currentDate));
        html += `<td><div>${day}</div>`;
        dayTasks.forEach(t => {
            html += `<div class="${getUrgency(t.deadline)} small-task">${t.name}</div>`;
        });
        html += '</td>';
        if ((currentDate.getDay() + 6) % 7 === 6) html += '</tr><tr>';
    }
    html += '</tr></table>';
    calendarView.innerHTML = html;
}

// Helpers
function formatDate(dateStr) {
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth()+1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}
function applyFilters() { renderTasks(); }

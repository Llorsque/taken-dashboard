
let tasks = [];
let archive = [];
let points = 0;

fetch('tasks.json')
    .then(res => res.json())
    .then(data => {
        tasks = data;
        renderTasks('all');
        renderTopTasks();
    });

fetch('archive.json')
    .then(res => res.json())
    .then(data => {
        archive = data;
        renderArchive();
    });

function showSection(section) {
    document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));
    if(section === 'dashboard') document.getElementById('dashboardSection').classList.remove('hidden');
    if(section === 'addTask') document.getElementById('addTaskSection').classList.remove('hidden');
    if(section === 'calendar') document.getElementById('calendarSection').classList.remove('hidden');
    if(section === 'archive') document.getElementById('archiveSection').classList.remove('hidden');
}

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

function renderTasks(filter) {
    const list = document.getElementById('taskList');
    list.innerHTML = '';
    const today = new Date();
    let filtered = tasks;
    if (filter === 'urgent') filtered = tasks.filter(t => (new Date(t.deadline) - today) / (1000*60*60*24) <= 1);
    if (filter === 'week') filtered = tasks.filter(t => (new Date(t.deadline) - today) / (1000*60*60*24) <= 7);
    if (filter === 'later') filtered = tasks.filter(t => (new Date(t.deadline) - today) / (1000*60*60*24) > 7);
    filtered.forEach(task => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="${getUrgency(task.deadline)}">${task.name}</span>
            <span>${formatDate(task.deadline)}</span>
            <input type="checkbox" ${task.done ? 'checked' : ''} onclick="toggleTask('${task.id}')">
        `;
        list.appendChild(li);
    });
}

function getUrgency(deadline) {
    const diff = (new Date(deadline) - new Date()) / (1000*60*60*24);
    if (diff <= 1) return 'urgent';
    if (diff <= 3) return 'warning';
    return 'safe';
}

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
    renderTasks('all');
    renderTopTasks();
    renderArchive();
}

function updateProgress() {
    document.getElementById('progressBar').style.width = ((points/20)*100) + '%';
    document.getElementById('pointsCount').innerText = points;
}

function addTask() {
    const name = document.getElementById('taskName').value;
    const deadline = document.getElementById('taskDeadline').value;
    if (!name || !deadline) return alert("Vul naam en deadline in.");
    const newTask = { id: Date.now().toString(), name, deadline, done: false };
    tasks.push(newTask);
    renderTasks('all');
    renderTopTasks();
    showSection('dashboard');
}

function renderArchive() {
    const list = document.getElementById('archiveList');
    list.innerHTML = '';
    archive.forEach(task => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${task.name}</span><span>${formatDate(task.deadline)}</span>`;
        list.appendChild(li);
    });
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth()+1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

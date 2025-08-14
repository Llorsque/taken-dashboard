
// Load tasks from JSON
let tasks = [];
let points = 0;

fetch('tasks.json')
    .then(response => response.json())
    .then(data => {
        tasks = data;
        renderTasks('all');
        renderTopTasks();
    });

function renderTopTasks() {
    const topTasks = document.getElementById('topTasks');
    topTasks.innerHTML = '';
    const sorted = [...tasks].sort((a,b) => new Date(a.deadline) - new Date(b.deadline));
    sorted.slice(0,3).forEach(task => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="${getUrgency(task.deadline)}">${task.name}</span><span>${task.deadline}</span>`;
        topTasks.appendChild(li);
    });
}

function renderTasks(filter) {
    const list = document.getElementById('taskList');
    list.innerHTML = '';
    let filtered = tasks;
    const today = new Date();
    if (filter === 'urgent') {
        filtered = tasks.filter(t => (new Date(t.deadline) - today) / (1000*60*60*24) <= 1);
    } else if (filter === 'week') {
        filtered = tasks.filter(t => (new Date(t.deadline) - today) / (1000*60*60*24) <= 7);
    } else if (filter === 'later') {
        filtered = tasks.filter(t => (new Date(t.deadline) - today) / (1000*60*60*24) > 7);
    }
    filtered.forEach(task => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="${getUrgency(task.deadline)}">${task.name}</span>
            <span>${task.deadline}</span>
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
        if (t.id === id) {
            t.done = !t.done;
            if (t.done) points += getUrgency(t.deadline) === 'urgent' ? 3 : 1;
        }
        return t;
    });
    document.getElementById('progressBar').style.width = ((points/20)*100) + '%';
    document.getElementById('pointsCount').innerText = points;
    renderTasks('all');
    renderTopTasks();
}

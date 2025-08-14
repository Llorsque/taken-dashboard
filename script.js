
const tasks = [
    {id: 1, title: 'Rapport afronden', deadline: '15-08-2025', category: 'Werk', description: 'Schrijf het kwartaalrapport af', progress: 70},
    {id: 2, title: 'Sporttraining', deadline: '15-08-2025', category: 'Persoonlijk', description: 'Hardlooptraining van 5 km', progress: 40},
    {id: 3, title: 'Boodschappen doen', deadline: '16-08-2025', category: 'Persoonlijk', description: 'Koop groenten en fruit', progress: 0},
    {id: 4, title: 'Website updaten', deadline: '16-08-2025', category: 'Werk', description: 'Voeg nieuwe content toe', progress: 50},
    {id: 5, title: 'Overleg met team', deadline: '17-08-2025', category: 'Werk', description: 'Projectstatus bespreken', progress: 20}
];

const notes = ['Belastingaangifte checken', 'Idee voor nieuwe blogpost'];

function showSection(id) {
    document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function renderTasks() {
    const container = document.getElementById('all-tasks');
    container.innerHTML = '';
    tasks.forEach(task => {
        const div = document.createElement('div');
        div.classList.add('task-item');
        div.innerHTML = `<strong>${task.title}</strong> - ${task.deadline} 
                         <button onclick="viewTask(${task.id})">Bekijk</button>`;
        container.appendChild(div);
    });
}

function renderNotes() {
    const list = document.getElementById('note-list');
    list.innerHTML = '';
    notes.forEach(note => {
        const li = document.createElement('li');
        li.textContent = note;
        list.appendChild(li);
    });
}

function saveNote() {
    const val = document.getElementById('note-input').value;
    if(val) {
        notes.push(val);
        renderNotes();
        document.getElementById('note-input').value = '';
    }
}

function renderTopTasks() {
    const list = document.getElementById('top-tasks');
    list.innerHTML = '';
    tasks.slice(0,5).forEach(task => {
        const li = document.createElement('li');
        li.textContent = `${task.title} (${task.deadline})`;
        list.appendChild(li);
    });
}

function confirmTasks() {
    alert('Dagplanning bevestigd!');
}

function viewTask(id) {
    const task = tasks.find(t => t.id === id);
    alert(`Titel: ${task.title}\nDeadline: ${task.deadline}\nCategorie: ${task.category}\nBeschrijving: ${task.description}\nVoortgang: ${task.progress}%`);
}

function renderChart() {
    const ctx = document.getElementById('progressChart');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: tasks.map(t => t.title),
            datasets: [{
                label: 'Voortgang (%)',
                data: tasks.map(t => t.progress),
                backgroundColor: '#52E8E8'
            }]
        },
        options: { responsive: true }
    });
}

renderTasks();
renderNotes();
renderTopTasks();
renderChart();

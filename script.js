
// ================== Storage helpers ==================
const LS = {
  get(k, d){ try{ const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch{ return d; } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
};

// ================== State ==================
let tasks = [];         // active tasks
let archive = [];       // completed tasks
let overdueIds = [];    // ids flagged as overdue
let dayPlan = [];       // ordered ids for today's plan
let dayPlanLocked = false;
let lastPlanDate = null;
let notes = [];

// ================== Boot ==================
document.addEventListener('DOMContentLoaded', init);

async function init(){
  // Load local state
  tasks = LS.get('tasks', []);
  archive = LS.get('archive', []);
  overdueIds = LS.get('overdueIds', []);
  dayPlan = LS.get('dayPlan', []);
  dayPlanLocked = LS.get('dayPlanLocked', false);
  lastPlanDate = LS.get('lastPlanDate', null);
  notes = LS.get('notes', []);

  // On first run, fetch JSON as seed
  if(tasks.length===0){
    try{
      const t = await fetch('tasks.json'); if(t.ok) tasks = await t.json();
      const a = await fetch('archive.json'); if(a.ok) archive = await a.json();
    }catch(e){}
  }

  dailyResetIfNeeded();

  // Nav
  document.querySelectorAll('.nav button').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.target));
  });

  // Forms
  byId('addForm').addEventListener('submit', onAddTask);
  byId('noteForm').addEventListener('submit', onAddNote);

  // Calendar nav
  byId('calPrev').addEventListener('click', () => { shiftMonth(-1); renderCalendar(); });
  byId('calNext').addEventListener('click', () => { shiftMonth(1); renderCalendar(); });

  // Confirm day plan
  byId('confirmPlanBtn').addEventListener('click', confirmDayPlan);
  byId('unlockPlanBtn').addEventListener('click', unlockDayPlan);

  // Drag & Drop: set up only on the real drop zone (day plan)
  setupDayPlanDropZone();

  renderAll();
  startClock();
}

// ================== Daily reset ==================
function todayISO(){ return new Date().toISOString().slice(0,10); }
function dailyResetIfNeeded(){
  const today = todayISO();
  if(lastPlanDate && lastPlanDate !== today){
    // Push unfinished planned tasks to overdue
    const unfinished = dayPlan.filter(id => {
      const t = tasks.find(x=>x.id===id);
      return t && !t.done;
    });
    overdueIds = [...new Set([...overdueIds, ...unfinished])];
    dayPlan = [];
    dayPlanLocked = false;
    persistPlan();
    LS.set('overdueIds', overdueIds);
  }
  lastPlanDate = today;
  LS.set('lastPlanDate', lastPlanDate);
}

// ================== Views ==================
function showView(id){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  byId(id).classList.add('active');
  if(id==='dashboard') renderDashboard();
  if(id==='tasks') renderTasksView();
  if(id==='calendar') renderCalendar();
  if(id==='overdue') renderOverdue();
  if(id==='archive') renderArchive();
  if(id==='monitor') renderMonitoring();
  if(id==='notes') renderNotes();
}

// ================== Add Task ==================
function onAddTask(e){
  e.preventDefault();
  const title = byId('addTitle').value.trim();
  const deadline = byId('addDeadline').value; // ISO yyyy-mm-dd
  if(!title || !deadline){ alert('Vul minimaal titel en deadline in.'); return; }
  const urgency = byId('addUrgency').value;
  const type = byId('addType').value;
  const category = byId('addCategory').value.trim();
  const duration = byId('addDuration').value;
  const progress = clamp(parseInt(byId('addProgress').value||'0',10),0,100);
  const description = byId('addDesc').value.trim();
  const t = {
    id: rid(),
    title, description,
    deadline, urgencyOverride: urgency || '',
    type, category, duration, progress,
    createdAt: new Date().toISOString(),
    plannedDay: null, done:false, completedAt:null
  };
  tasks.push(t);
  persistTasks();
  e.target.reset();
  showView('dashboard');
  renderAll();
  startClock();
}

// ================== Notes ==================
function onAddNote(e){
  e.preventDefault();
  const title = byId('noteTitle').value.trim();
  const category = byId('noteCategory').value.trim();
  const text = byId('noteText').value.trim();
  if(!title && !text) return;
  notes.push({ id: rid(), title, category, text, createdAt: new Date().toISOString() });
  persistNotes(); e.target.reset(); renderNotes();
}
function renderNotes(){
  const ul = byId('noteList'); ul.innerHTML='';
  notes.forEach(n => {
    const li = document.createElement('li');
    li.className='item';
    li.innerHTML = `
      <div class="item-main"><div class="title">${esc(n.title || '(zonder titel)')}</div></div>
      <div class="meta">
        ${n.category ? `<span class="badge">${esc(n.category)}</span>`:''}
        <button class="btn" onclick="noteToTask('${n.id}')"><i class="fa-solid fa-plus"></i> Maak taak</button>
        <button class="icon-btn" onclick="deleteNote('${n.id}')" title="Verwijder"><i class="fa-solid fa-trash"></i></button>
      </div>`;
    ul.appendChild(li);
  });
}
function noteToTask(id){
  const n = notes.find(x=>x.id===id);
  if(!n) return;
  showView('add');
  byId('addTitle').value = n.title || (n.text||'').slice(0,60);
  byId('addCategory').value = n.category || '';
}
function deleteNote(id){ notes = notes.filter(n=>n.id!==id); persistNotes(); renderNotes(); }

// ================== Dashboard ==================
function renderDashboard(){
  renderUrgentAlert();
  renderSuggestions();
  renderDayPlan();
  renderCategoryOverview();
}
function renderUrgentAlert(){
  const alert = byId('urgentAlert');
  alert.classList.toggle('hidden', !getOpenTasks().some(t => getUrgency(t)==='urgent'));
}
function renderSuggestions(){
  const ul = byId('suggestList'); ul.innerHTML='';
  const suggestions = getOpenTasks().sort(sortByUrgencyDeadline).slice(0, 12);
  suggestions.forEach(t => ul.appendChild(taskRow(t, { draggable:true, calendarButton:true })));
}
function renderDayPlan(){
  const list = byId('dayPlanList');
  const checklist = byId('dayChecklist');
  const info = byId('planInfo');
  const planned = dayPlan.map(id => tasks.find(t=>t.id===id)).filter(Boolean);

  if(dayPlanLocked){
    byId('unlockPlanBtn').classList.remove('hidden');
    list.classList.add('hidden'); checklist.classList.remove('hidden');
    info.textContent = 'Dagplanning bevestigd — werk de taken hieronder af.';
    checklist.innerHTML = '';
    planned.forEach(t => {
      const row = document.createElement('div');
      row.className='check-item';
      row.innerHTML = `
        <input type="checkbox" ${t.done?'checked':''} onchange="toggleDone('${t.id}', this.checked)" />
        <div class="title">${esc(t.title)}</div>
        <div class="meta"><i class="fa-regular fa-calendar"></i> ${fmtDate(t.deadline)} • <span class="badge ${getUrgency(t)}">${urgLabel(getUrgency(t))}</span></div>`;
      checklist.appendChild(row);
    });
  } else {
    byId('unlockPlanBtn').classList.add('hidden');
    list.classList.remove('hidden'); checklist.classList.add('hidden');
    info.textContent = 'Sleep taken hierheen en klik Bevestig.';
    list.innerHTML='';
    planned.forEach(t => list.appendChild(taskRow(t, { draggable:true, inPlan:true })));
  }
}

// Confirm
function confirmDayPlan(){
  dayPlanLocked = true;
  const today = todayISO();
  dayPlan.forEach(id => {
    const t = tasks.find(x=>x.id===id);
    if(t) t.plannedDay = today;
  });
  persistTasks();
  LS.set('dayPlanLocked', dayPlanLocked);
  renderDayPlan();
}

// Mark done (from checklist)
function toggleDone(id, checked){
  const t = tasks.find(x=>x.id===id);
  if(!t) return;
  t.done = checked;
  if(checked){
    t.completedAt = new Date().toISOString();
    archive.push(t);
    tasks = tasks.filter(x=>x.id!==id);
    dayPlan = dayPlan.filter(x=>x!==id);
    overdueIds = overdueIds.filter(x=>x!==id);
    persistAll();
    renderAll();
  startClock();
  } else {
    byId('unlockPlanBtn').classList.add('hidden');
    t.completedAt = null;
    persistTasks();
  }
}

// ================== Tasks view ==================
function renderTasksView(){
  const catSel = byId('filterCategory');
  const cats = [...new Set(tasks.filter(t=>t.category).map(t=>t.category))].sort();
  catSel.innerHTML = '<option value=\"\">Alle categorieën</option>' + cats.map(c=>`<option>${esc(c)}</option>`).join('');

  const ul = byId('taskList'); ul.innerHTML='';
  let list = getOpenTasks();
  const fc = catSel.value;
  const ft = byId('filterType').value;
  const fu = byId('filterUrgency').value;
  if(fc) list = list.filter(t=>t.category===fc);
  if(ft) list = list.filter(t=>t.type===ft);
  if(fu) list = list.filter(t=>getUrgency(t)===fu);
  list.sort(sortByUrgencyDeadline).forEach(t => ul.appendChild(taskRow(t, { draggable:true, calendarButton:true })));
}

// ================== Category overview ==================
function renderCategoryOverview(){
  const wrap = byId('categoryOverview'); wrap.innerHTML='';
  const map = new Map();
  getOpenTasks().forEach(t => map.set(t.category||'Ongecategoriseerd', (map.get(t.category||'Ongecategoriseerd')||0)+1));
  [...map.entries()].sort().forEach(([cat,count]) => {
    const div = document.createElement('div');
    div.className='chip'; div.innerHTML = `<i class="fa-solid fa-tag"></i> ${esc(cat)} <span class="count">${count}</span>`;
    div.addEventListener('click', () => { showView('tasks'); byId('filterCategory').value = cat==='Ongecategoriseerd'?'':cat; renderTasksView(); });
    wrap.appendChild(div);
  });
}

// ================== Overdue & Archive ==================
function renderOverdue(){
  const ul = byId('overdueList'); ul.innerHTML='';
  overdueIds.map(id => tasks.find(t=>t && t.id===id))
    .filter(Boolean).sort(sortByUrgencyDeadline)
    .forEach(t => ul.appendChild(taskRow(t, { draggable:false, calendarButton:true, overdueBadge:true })));
}
function renderArchive(){
  const ul = byId('archiveList'); ul.innerHTML='';
  archive.slice().reverse().forEach(t => {
    const li = document.createElement('li');
    li.className='item';
    li.innerHTML = `
      <div class="item-main">
        <div class="title">${esc(t.title)}</div>
        <div class="meta"><i class="fa-regular fa-calendar"></i> ${fmtDate(t.deadline)} • afgerond ${fmtDateTime(t.completedAt)}</div>
      </div>
      <div class="badge">Voortgang ${t.progress||0}%</div>`;
    ul.appendChild(li);
  });
}

// ================== Calendar ==================
let calYear = (new Date()).getFullYear();
let calMonth = (new Date()).getMonth();
function shiftMonth(delta){
  calMonth += delta;
  if(calMonth<0){ calMonth=11; calYear--; }
  if(calMonth>11){ calMonth=0; calYear++; }
}
function renderCalendar(){
  const title = byId('calTitle');
  const grid = byId('calendarGrid');
  const monthNames = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
  title.textContent = `${monthNames[calMonth]} ${calYear}`;
  grid.innerHTML='';
  const first = new Date(calYear, calMonth, 1);
  const last = new Date(calYear, calMonth+1, 0);
  const startOffset = (first.getDay()+6)%7;
  for(let i=0;i<startOffset;i++){ grid.appendChild(emptyCell()); }
  for(let d=1; d<=last.getDate(); d++){
    const dateISO = new Date(calYear, calMonth, d).toISOString().slice(0,10);
    const cell = document.createElement('div');
    cell.className='cell';
    cell.innerHTML = `<div class="day">${String(d).padStart(2,'0')}</div>`;
    getOpenTasks().filter(t=>t.deadline===dateISO).sort(sortByUrgencyDeadline).forEach(t => {
      const div = document.createElement('div');
      div.className = `small ${getUrgency(t)}`;
      div.textContent = t.title;
      div.addEventListener('click', ()=>openDetail(t.id));
      cell.appendChild(div);
    });
    grid.appendChild(cell);
  }
}
function emptyCell(){ const c=document.createElement('div'); c.className='cell'; return c; }

// ================== Task rows & DnD ==================
function taskRow(t, {draggable=false, calendarButton=false, inPlan=false, overdueBadge=false}={}){
  const li = document.createElement('li');
  li.className='item';
  li.dataset.id = t.id;

  li.innerHTML = `
    <div class="item-main">
      <button class="icon-btn" title="Details" onclick="openDetail('${t.id}')"><i class="fa-regular fa-pen-to-square"></i></button>
      <div class="title">${esc(t.title)}</div>
      <div class="meta">
        <i class="fa-regular fa-calendar"></i> ${fmtDate(t.deadline)}
        <span class="badge ${getUrgency(t)}">${urgLabel(getUrgency(t))}</span>
        ${t.category?`<span class="badge"><i class="fa-solid fa-tag"></i> ${esc(t.category)}</span>`:''}
        ${t.type?`<span class="badge"><i class="fa-solid fa-list"></i> ${esc(t.type)}</span>`:''}
        ${overdueBadge?'<span class="badge urgent">Achterstallig</span>':''}
      </div>
    </div>
    <div class="progress-wrap">
      ${progressBarFor(t)}
      <button class="btn" onclick="addToDayPlan('${t.id}')"><i class="fa-solid fa-calendar-plus"></i></button>
    </div>`;

  if(draggable){
    li.draggable = true;
    li.addEventListener('dragstart', (e)=>{
      try{ e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; }catch(_){}
    });
  }
  return li;
}

function setupDayPlanDropZone(){
  const zone = byId('dayPlanList');
  // highlight on dragover
  zone.addEventListener('dragenter', (e)=>{ e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragover', (e)=>{
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', ()=> zone.classList.remove('drag-over'));

  zone.addEventListener('drop', (e)=>{
    e.preventDefault();
    zone.classList.remove('drag-over');
    if(dayPlanLocked){
    byId('unlockPlanBtn').classList.remove('hidden'); alert('Dagplanning is bevestigd. Wacht tot morgen of reset handmatig.'); return; }
    let id = ''; try{ id = e.dataTransfer.getData('text/plain'); }catch(_){}
    if(!id) return;
    // compute insertion index by mouse Y position
    const index = dropIndexByY(zone, e.clientY);
    // remove existing occurrence
    const from = dayPlan.indexOf(id);
    if(from>-1) dayPlan.splice(from,1);
    // insert at index
    const at = Math.max(0, Math.min(index, dayPlan.length));
    dayPlan.splice(at, 0, id);
    LS.set('dayPlan', dayPlan);
    renderDayPlan();
  });
}

// Compute drop index based on mouse Y relative to children midpoints
function dropIndexByY(container, y){
  const kids = Array.from(container.children);
  for(let i=0;i<kids.length;i++){
    const rect = kids[i].getBoundingClientRect();
    const mid = rect.top + rect.height/2;
    if(y < mid) return i;
  }
  return kids.length;
}

// Direct add via button
function addToDayPlan(id){
  if(dayPlanLocked){
    byId('unlockPlanBtn').classList.remove('hidden'); alert('Dagplanning is bevestigd. Wacht tot morgen of reset handmatig.'); return; }
  if(!dayPlan.includes(id)) dayPlan.push(id);
  LS.set('dayPlan', dayPlan);
  renderDayPlan();
}

// ================== Detail pane ==================
let currentDetailId = null;
function openDetail(id){
  currentDetailId = id;
  const t = tasks.find(x=>x.id===id) || archive.find(x=>x.id===id);
  if(!t) return;
  byId('dTitle').value = t.title||'';
  byId('dDeadline').value = t.deadline||'';
  byId('dUrgency').value = t.urgencyOverride||'';
  byId('dType').value = t.type||'overig';
  byId('dCategory').value = t.category||'';
  byId('dDuration').value = t.duration||'Kort';
  byId('dProgress').value = t.progress||0;
  byId('dDesc').value = t.description||'';

  byId('dSave').onclick = saveDetail;
  byId('dArchive').onclick = ()=> markDone(id);
  byId('dToPlan').onclick = ()=> addToDayPlan(id);

  byId('detailPane').classList.add('open');
}
function closeDetail(){ byId('detailPane').classList.remove('open'); }
function saveDetail(){
  const t = tasks.find(x=>x.id===currentDetailId);
  if(!t){ closeDetail(); return; }
  t.title = byId('dTitle').value.trim()||t.title;
  t.deadline = byId('dDeadline').value || t.deadline;
  t.urgencyOverride = byId('dUrgency').value;
  t.type = byId('dType').value;
  t.category = byId('dCategory').value.trim();
  t.duration = byId('dDuration').value;
  t.progress = clamp(parseInt(byId('dProgress').value||'0',10),0,100);
  t.description = byId('dDesc').value.trim();
  persistTasks(); renderAll();
  startClock(); closeDetail();
}
function markDone(id){
  const t = tasks.find(x=>x.id===id);
  if(!t) return;
  t.done = true; t.completedAt = new Date().toISOString();
  archive.push(t);
  tasks = tasks.filter(x=>x.id!==id);
  dayPlan = dayPlan.filter(x=>x!==id);
  overdueIds = overdueIds.filter(x=>x!==id);
  persistAll(); renderAll();
  startClock(); closeDetail();
}

// ================== Monitoring ==================
function renderMonitoring(){
  byId('statCompleted').textContent = archive.length.toString();
  const withDeadline = archive.filter(t=>t.deadline);
  const onTime = withDeadline.filter(t => new Date(t.completedAt) <= endOfDay(t.deadline));
  const pct = withDeadline.length? Math.round(onTime.length*100/withDeadline.length):0;
  byId('statOnTime').textContent = pct + '%';
  const durations = archive.filter(t=>t.completedAt && t.createdAt).map(t => (new Date(t.completedAt)-new Date(t.createdAt))/36e5);
  const avg = durations.length? (durations.reduce((a,b)=>a+b,0)/durations.length).toFixed(1):'–';
  byId('statAvgDur').textContent = avg==='–'?'–':(avg+' u');

  // simple spark: last 7 days completions
  const ctx = document.getElementById('chartWeekly').getContext('2d');
  const labels = [], data = [];
  for(let i=6;i>=0;i--){
    const d = new Date(); d.setDate(d.getDate()-i);
    const key = d.toISOString().slice(0,10);
    labels.push(key.slice(8,10)+'-'+key.slice(5,7));
    data.push(archive.filter(t=> (t.completedAt||'').slice(0,10)===key ).length);
  }
  if(window._weeklyChart) window._weeklyChart.destroy();
  window._weeklyChart = new Chart(ctx, { type:'bar', data:{ labels, datasets:[{label:'Afgerond', data}] }, options:{ responsive:true, maintainAspectRatio:false } });
}

// ================== Helpers ==================
function renderAll(){
  renderDashboard();
  renderTasksView();
  renderOverdue();
  renderArchive();
  renderNotes();
  renderCalendar();
  refreshFilters();
}

function getOpenTasks(){ return tasks.filter(t=>!t.done); }
function getUrgency(t){
  if(t.urgencyOverride) return t.urgencyOverride;
  const days = (new Date(t.deadline) - new Date())/86400000;
  if(days <= 1) return 'urgent';
  if(days <= 3) return 'warning';
  return 'safe';
}
function urgLabel(u){ return u==='urgent'?'Rood' : u==='warning'?'Geel' : 'Groen'; }
function sortByUrgencyDeadline(a,b){
  const ua = (getUrgency(a)==='urgent'?0 : getUrgency(a)==='warning'?1:2);
  const ub = (getUrgency(b)==='urgent'?0 : getUrgency(b)==='warning'?1:2);
  if(ua!==ub) return ua-ub;
  return new Date(a.deadline) - new Date(b.deadline);
}

function fmtDate(iso){ if(!iso) return ''; const y=iso.slice(0,4), m=iso.slice(5,7), d=iso.slice(8,10); return `${d}-${m}-${y}`; }
function fmtDateTime(iso){
  if(!iso) return '';
  const d = new Date(iso);
  const dd=String(d.getDate()).padStart(2,'0');
  const mm=String(d.getMonth()+1).padStart(2,'0');
  const yy=d.getFullYear();
  const hh=String(d.getHours()).padStart(2,'0');
  const mi=String(d.getMinutes()).padStart(2,'0');
  return `${dd}-${mm}-${yy} ${hh}:${mi}`;
}
function endOfDay(isoDate){ return new Date(isoDate + 'T23:59:59'); }
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function byId(id){ return document.getElementById(id); }
function esc(s){ return (s||'').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function rid(){ return (crypto.getRandomValues(new Uint32Array(4))).join('-'); }
function progressBar(pct){ pct = clamp(pct||0,0,100); return `<div class="progress"><span style="width:${pct}%"></span></div>`; }

function persistTasks(){ LS.set('tasks', tasks); }
function persistArchive(){ LS.set('archive', archive); }
function persistOverdue(){ LS.set('overdueIds', overdueIds); }
function persistPlan(){ LS.set('dayPlan', dayPlan); LS.set('dayPlanLocked', dayPlanLocked); LS.set('lastPlanDate', lastPlanDate); }
function persistNotes(){ LS.set('notes', notes); }
function persistAll(){ persistTasks(); persistArchive(); persistOverdue(); persistPlan(); }

function refreshFilters(){
  const catSel = byId('filterCategory'); const was = catSel.value;
  const cats = [...new Set(tasks.filter(t=>t.category).map(t=>t.category))].sort();
  catSel.innerHTML = '<option value=\"\">Alle categorieën</option>' + cats.map(c=>`<option>${esc(c)}</option>`).join('');
  if(cats.includes(was)) catSel.value = was;
}

// Re-render tasks on filter change
document.addEventListener('change', (e)=>{
  if(e.target && (e.target.id==='filterCategory' || e.target.id==='filterType' || e.target.id==='filterUrgency')){
    renderTasksView();
  }
});


function unlockDayPlan(){
  dayPlanLocked = false;
  LS.set('dayPlanLocked', dayPlanLocked);
  renderDayPlan();
}


function navigate(view){
  showView(view);
  return false;
}


function two(n){ return String(n).padStart(2,'0'); }
function updateClock(){
  const now = new Date();
  const dateStr = `${two(now.getDate())}-${two(now.getMonth()+1)}-${now.getFullYear()}`;
  const timeStr = `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
  const el = document.getElementById('clock');
  if(el){ el.textContent = `– ${dateStr} ${timeStr}`; }
}
function startClock(){ updateClock(); setInterval(updateClock, 1000); }


function typeColor(type){
  switch((type||'').toLowerCase()){
    case 'mail': return '#3b82f6';
    case 'telefoontje': return '#9333ea';
    case 'uitzoekwerk': return '#4f46e5';
    case 'overleg': return '#06b6d4';
    case 'documentatie': return '#64748b';
    case 'creatief': return '#ec4899';
    case 'administratie': return '#f97316';
    default: return '#94a3b8';
  }
}
function progressBarFor(t){
  const pct = Math.max(0, Math.min(100, t.progress||0));
  const urg = getUrgency(t);
  const color = typeColor(t.type);
  return `<div class="progress ${urg}" style="--type-color:${color}"><span style="width:${pct}%"></span></div>`;
}

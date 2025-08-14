
// ---------- Storage helpers ----------
const ls = {
  get(key, def){ try { const v = JSON.parse(localStorage.getItem(key)); return v ?? def; } catch { return def; } },
  set(key, val){ localStorage.setItem(key, JSON.stringify(val)); }
};

// ---------- State ----------
let tasks = [];       // task objects
let archive = [];
let overdueIds = [];  // ids for overdue tasks
let dayPlan = [];     // ordered ids planned for today
let dayPlanLocked = false;
let lastPlanDate = null;
let notes = [];

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', init);
async function init(){
  // Load persisted
  tasks = ls.get('tasks', []);
  archive = ls.get('archive', []);
  overdueIds = ls.get('overdueIds', []);
  dayPlan = ls.get('dayPlan', []);
  dayPlanLocked = ls.get('dayPlanLocked', false);
  lastPlanDate = ls.get('lastPlanDate', null);
  notes = ls.get('notes', []);

  // First time: try JSON files
  if(tasks.length === 0){
    try {
      const t = await fetch('tasks.json'); if (t.ok) tasks = await t.json();
      const a = await fetch('archive.json'); if (a.ok) archive = await a.json();
    } catch(e){}
  }

  dailyRollOverIfNeeded();

  // Nav
  document.querySelectorAll('.nav button').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.target)));

  // Detail pane
  document.getElementById('detailClose').addEventListener('click', closeDetail);

  // Forms
  document.getElementById('addForm').addEventListener('submit', onAddTask);
  document.getElementById('noteForm').addEventListener('submit', onAddNote);

  // Calendar controls
  document.getElementById('calPrev').addEventListener('click', () => { shiftMonth(-1); renderCalendar(); });
  document.getElementById('calNext').addEventListener('click', () => { shiftMonth(1); renderCalendar(); });

  // Day plan confirm
  document.getElementById('confirmPlanBtn').addEventListener('click', confirmDayPlan);

  renderAll();
}

// ---------- Daily rollover ----------
function todayISO(){ return new Date().toISOString().slice(0,10); }
function dailyRollOverIfNeeded(){
  const today = todayISO();
  if(lastPlanDate && lastPlanDate !== today){
    // Move unfinished planned tasks to overdue
    const unfinished = dayPlan.filter(id => {
      const t = tasks.find(x=>x.id===id);
      return t && !t.done;
    });
    overdueIds = [...new Set([...overdueIds, ...unfinished])];
    // Reset plan
    dayPlan = [];
    dayPlanLocked = false;
    ls.set('overdueIds', overdueIds);
    ls.set('dayPlan', dayPlan);
    ls.set('dayPlanLocked', dayPlanLocked);
  }
  lastPlanDate = today;
  ls.set('lastPlanDate', lastPlanDate);
}

// ---------- Views ----------
function showView(id){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if(id==='calendar') renderCalendar();
  if(id==='overdue') renderOverdue();
  if(id==='archive') renderArchive();
  if(id==='monitor') renderMonitoring();
  if(id==='tasks') renderTasksView();
  if(id==='dashboard') renderDashboard();
  if(id==='notes') renderNotes();
}

// ---------- Add task ----------
function onAddTask(e){
  e.preventDefault();
  const title = gid('addTitle').value.trim();
  const deadline = gid('addDeadline').value; // ISO yyyy-mm-dd
  if(!title || !deadline){ alert('Vul minimaal titel en deadline in.'); return; }
  const urgency = gid('addUrgency').value;
  const type = gid('addType').value;
  const category = gid('addCategory').value.trim();
  const duration = gid('addDuration').value;
  const progress = clamp(parseInt(gid('addProgress').value||'0',10),0,100);
  const description = gid('addDesc').value.trim();

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
}

// ---------- Notes ----------
function onAddNote(e){
  e.preventDefault();
  const title = gid('noteTitle').value.trim();
  const category = gid('noteCategory').value.trim();
  const text = gid('noteText').value.trim();
  if(!title && !text) return;
  notes.push({ id: rid(), title, category, text, createdAt: new Date().toISOString() });
  persistNotes();
  e.target.reset();
  renderNotes();
}
function renderNotes(){
  const ul = gid('noteList'); ul.innerHTML='';
  notes.forEach(n => {
    const li = document.createElement('li');
    li.className='item';
    li.innerHTML = `
      <div class="item-main">
        <div class="title">${esc(n.title || '(zonder titel)')}</div>
      </div>
      <div class="meta">
        ${n.category ? `<span class="badge">${esc(n.category)}</span>`:''}
        <button class="btn" onclick="noteToTask('${n.id}')"><i class="fa-solid fa-plus"></i> Maak taak</button>
        <button class="icon-btn" title="Verwijder" onclick="deleteNote('${n.id}')"><i class="fa-solid fa-trash"></i></button>
      </div>`;
    ul.appendChild(li);
  });
}
function noteToTask(id){
  const n = notes.find(x=>x.id===id);
  if(!n) return;
  showView('add');
  gid('addTitle').value = n.title || (n.text||'').slice(0,60);
  gid('addCategory').value = n.category || '';
}
function deleteNote(id){
  notes = notes.filter(n=>n.id!==id);
  persistNotes(); renderNotes();
}

// ---------- Dashboard ----------
function renderDashboard(){
  renderUrgentAlert();
  renderSuggestions();
  renderDayPlan();
  renderCategoryOverview();
}

function renderUrgentAlert(){
  const alert = gid('urgentAlert');
  const anyUrgent = getOpenTasks().some(t => getUrgency(t)==='urgent');
  alert.classList.toggle('hidden', !anyUrgent);
}

function renderSuggestions(){
  const ul = gid('suggestList'); ul.innerHTML='';
  const suggestions = getOpenTasks().sort(sortByUrgencyDeadline).slice(0,8);
  suggestions.forEach(t => ul.appendChild(taskItem(t, {draggable:true, showProgress:true})));
  makeDroppable(ul, 'suggest'); // visual only
}

function renderDayPlan(){
  const list = gid('dayPlanList');
  const checklist = gid('dayChecklist');
  const info = gid('planInfo');
  const plannedTasks = dayPlan.map(id => tasks.find(t=>t.id===id)).filter(Boolean);

  if(dayPlanLocked){
    list.classList.add('hidden');
    checklist.classList.remove('hidden');
    info.textContent = 'Dagplanning bevestigd — werk de taken hieronder af.';
    checklist.innerHTML = '';
    plannedTasks.forEach(t => {
      const row = document.createElement('div');
      row.className='check-item';
      row.innerHTML = `
        <input type="checkbox" ${t.done?'checked':''} onchange="toggleDone('${t.id}', this.checked)" />
        <div class="title">${esc(t.title)}</div>
        <div class="meta"><i class="fa-regular fa-calendar"></i> ${fmtDate(t.deadline)} • <span class="badge ${getUrgency(t)}">${urgLabel(getUrgency(t))}</span></div>`;
      checklist.appendChild(row);
    });
  } else {
    list.classList.remove('hidden');
    checklist.classList.add('hidden');
    info.textContent = 'Sleep taken hierheen en klik Bevestig.';
    list.innerHTML = '';
    plannedTasks.forEach(t => list.appendChild(taskItem(t, {draggable:true, showProgress:true})));
    makeDroppable(list, 'dayplan'); // real drop target
  }
}

function confirmDayPlan(){
  dayPlanLocked = true;
  const today = todayISO();
  dayPlan.forEach(id => {
    const t = tasks.find(x=>x.id===id);
    if(t) t.plannedDay = today;
  });
  persistTasks();
  ls.set('dayPlanLocked', dayPlanLocked);
  renderDayPlan();
}

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
  } else {
    t.completedAt = null;
    persistTasks();
  }
}

// ---------- Tasks view ----------
function renderTasksView(){
  const uniqueCats = [...new Set(tasks.filter(t=>t.category).map(t=>t.category))].sort();
  const catSel = gid('filterCategory'); catSel.innerHTML = '<option value=\"\">Alle categorieën</option>' + uniqueCats.map(c=>`<option>${esc(c)}</option>`).join('');
  const ul = gid('taskList'); ul.innerHTML='';
  let list = getOpenTasks();
  const fc = catSel.value;
  const ft = gid('filterType').value;
  const fu = gid('filterUrgency').value;
  if(fc) list = list.filter(t=>t.category===fc);
  if(ft) list = list.filter(t=>t.type===ft);
  if(fu) list = list.filter(t=>getUrgency(t)===fu);
  list.sort(sortByUrgencyDeadline).forEach(t => ul.appendChild(taskItem(t, {draggable:true, showProgress:true})));
  makeDroppable(ul, 'all');
}

// ---------- Category overview ----------
function renderCategoryOverview(){
  const wrap = gid('categoryOverview'); wrap.innerHTML='';
  const map = new Map();
  getOpenTasks().forEach(t => map.set(t.category||'Ongecategoriseerd', (map.get(t.category||'Ongecategoriseerd')||0)+1));
  [...map.entries()].sort().forEach(([cat,count]) => {
    const div = document.createElement('div');
    div.className='chip'; div.innerHTML = `<i class="fa-solid fa-tag"></i> ${esc(cat)} <span class="count">${count}</span>`;
    div.addEventListener('click', () => { showView('tasks'); gid('filterCategory').value = cat==='Ongecategoriseerd'?'':cat; renderTasksView(); });
    wrap.appendChild(div);
  });
}

// ---------- Overdue ----------
function renderOverdue(){
  const ul = gid('overdueList'); ul.innerHTML='';
  overdueIds.map(id => tasks.find(t=>t && t.id===id))
    .filter(Boolean).sort(sortByUrgencyDeadline)
    .forEach(t => {
      const li = document.createElement('li');
      li.className='item';
      li.innerHTML = `
        <div class="item-main">
          <div class="title">${esc(t.title)}</div>
          <div class="meta"><i class="fa-regular fa-calendar"></i> ${fmtDate(t.deadline)} • <span class="badge urgent">Achterstallig</span></div>
        </div>
        <div class="progress-wrap">
          ${progressBar(t.progress)}
          <button class="btn" onclick="addToDayPlan('${t.id}')"><i class="fa-solid fa-calendar-check"></i> Plan vandaag</button>
        </div>`;
      ul.appendChild(li);
    });
}

// ---------- Archive ----------
function renderArchive(){
  const ul = gid('archiveList'); ul.innerHTML='';
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

// ---------- Calendar ----------
let calYear = (new Date()).getFullYear();
let calMonth = (new Date()).getMonth();
function shiftMonth(delta){
  calMonth += delta;
  if(calMonth<0){ calMonth=11; calYear--; }
  if(calMonth>11){ calMonth=0; calYear++; }
}
function renderCalendar(){
  const title = gid('calTitle');
  const grid = gid('calendarGrid');
  const monthNames = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
  title.textContent = `${monthNames[calMonth]} ${calYear}`;
  grid.innerHTML='';
  const first = new Date(calYear, calMonth, 1);
  const last = new Date(calYear, calMonth+1, 0);
  const startOffset = (first.getDay()+6)%7; // Mon=0
  for(let i=0;i<startOffset;i++){ grid.appendChild(emptyCell()); }
  for(let d=1; d<=last.getDate(); d++){
    const dateISO = new Date(calYear, calMonth, d).toISOString().slice(0,10);
    const cell = document.createElement('div');
    cell.className='cell';
    cell.innerHTML = `<div class="day">${String(d).padStart(2,'0')}</div>`;
    getOpenTasks().filter(t=>t.deadline===dateISO).sort(sortByUrgencyDeadline)
      .forEach(t => {
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

// ---------- Items & drag/drop ----------
function taskItem(t, opts={}){
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
      </div>
    </div>
    <div class="progress-wrap">
      ${opts.showProgress?progressBar(t.progress):''}
      <button class="btn" onclick="addToDayPlan('${t.id}')"><i class="fa-solid fa-calendar-plus"></i></button>
    </div>`;

  if(opts.draggable){
    li.draggable = true;
    li.addEventListener('dragstart', (e)=>{
      try{
        e.dataTransfer.setData('text/plain', t.id);
        e.dataTransfer.setData('text', t.id);
      }catch(_){}
      e.dataTransfer.effectAllowed = 'move';
    });
  }
  return li;
}

function makeDroppable(el, listName){
  el.addEventListener('dragenter', e => { if(listName==='dayplan'){ el.classList.add('drop-active'); } });
  el.addEventListener('dragleave', e => { if(listName==='dayplan'){ el.classList.remove('drop-active'); } });
  el.addEventListener('dragover', e => { e.preventDefault(); if(e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
  el.addEventListener('drop', e => {
    e.preventDefault();
    if(listName!=='dayplan'){ el.classList.remove('drop-active'); return; }
    let id = '';
    try { id = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text'); } catch(_){}
    if(!id) return;
    if(!dayPlan.includes(id)) dayPlan.push(id);
    const children = Array.from(el.children);
    const targetLi = e.target.closest('li');
    let toIndex = targetLi ? children.indexOf(targetLi) : children.length - 1;
    if(toIndex < 0) toIndex = children.length;
    const fromIndex = dayPlan.indexOf(id);
    if(fromIndex > -1){
      dayPlan.splice(fromIndex, 1);
      if(toIndex > dayPlan.length) toIndex = dayPlan.length;
      dayPlan.splice(toIndex, 0, id);
    }
    ls.set('dayPlan', dayPlan);
    el.classList.remove('drop-active');
    renderDayPlan();
  });
}

function addToDayPlan(id){
  if(dayPlanLocked){ alert('Dagplanning is bevestigd. Vrij vanaf 00:00 of reset handmatig.'); return; }
  if(!dayPlan.includes(id)) dayPlan.push(id);
  ls.set('dayPlan', dayPlan);
  renderDayPlan();
}

// ---------- Detail pane ----------
let currentDetailId = null;
function openDetail(id){
  currentDetailId = id;
  const t = tasks.find(x=>x.id===id) || archive.find(x=>x.id===id);
  if(!t) return;
  gid('dTitle').value = t.title||'';
  gid('dDeadline').value = t.deadline||'';
  gid('dUrgency').value = t.urgencyOverride||'';
  gid('dType').value = t.type||'overig';
  gid('dCategory').value = t.category||'';
  gid('dDuration').value = t.duration||'Kort';
  gid('dProgress').value = t.progress||0;
  gid('dDesc').value = t.description||'';

  gid('dSave').onclick = saveDetail;
  gid('dArchive').onclick = ()=> markDone(id);
  gid('dToPlan').onclick = ()=> addToDayPlan(id);

  document.getElementById('detailPane').classList.add('open');
}
function closeDetail(){ document.getElementById('detailPane').classList.remove('open'); }
function saveDetail(){
  const t = tasks.find(x=>x.id===currentDetailId);
  if(!t){ closeDetail(); return; }
  t.title = gid('dTitle').value.trim()||t.title;
  t.deadline = gid('dDeadline').value || t.deadline;
  t.urgencyOverride = gid('dUrgency').value;
  t.type = gid('dType').value;
  t.category = gid('dCategory').value.trim();
  t.duration = gid('dDuration').value;
  t.progress = clamp(parseInt(gid('dProgress').value||'0',10),0,100);
  t.description = gid('dDesc').value.trim();
  persistTasks();
  renderAll();
  closeDetail();
}
function markDone(id){
  const t = tasks.find(x=>x.id===id);
  if(!t) return;
  t.done = true;
  t.completedAt = new Date().toISOString();
  archive.push(t);
  tasks = tasks.filter(x=>x.id!==id);
  dayPlan = dayPlan.filter(x=>x!==id);
  overdueIds = overdueIds.filter(x=>x!==id);
  persistAll();
  renderAll();
  closeDetail();
}

// ---------- Monitoring ----------
function renderMonitoring(){
  gid('statCompleted').textContent = archive.length.toString();
  const withDeadline = archive.filter(t=>t.deadline);
  const onTime = withDeadline.filter(t => new Date(t.completedAt) <= endOfDay(t.deadline));
  const pct = withDeadline.length? Math.round(onTime.length*100/withDeadline.length):0;
  gid('statOnTime').textContent = pct + '%';
  const durations = archive.filter(t=>t.completedAt && t.createdAt).map(t => (new Date(t.completedAt) - new Date(t.createdAt))/36e5);
  const avg = durations.length? (durations.reduce((a,b)=>a+b,0)/durations.length).toFixed(1):'–';
  gid('statAvgDur').textContent = avg==='–'?'–':(avg+' u');
  const ctx = document.getElementById('chartWeekly').getContext('2d');
  const labels=[], data=[];
  for(let i=6;i>=0;i--){
    const d = new Date(); d.setDate(d.getDate()-i);
    const key = d.toISOString().slice(0,10);
    labels.push(key.slice(8,10)+'-'+key.slice(5,7));
    data.push(archive.filter(t=> (t.completedAt||'').slice(0,10)===key ).length);
  }
  if(window._weeklyChart) window._weeklyChart.destroy();
  window._weeklyChart = new Chart(ctx, { type:'bar', data:{ labels, datasets:[{label:'Afgerond', data}] }, options:{ responsive:true, maintainAspectRatio:false } });
}

// ---------- Helpers ----------
function renderAll(){
  renderDashboard();
  renderTasksView();
  renderOverdue();
  renderArchive();
  renderNotes();
  renderCalendar();
  updateFiltersFromTasks();
}
function updateFiltersFromTasks(){
  const catSel = gid('filterCategory');
  const was = catSel.value;
  const cats = [...new Set(tasks.filter(t=>t.category).map(t=>t.category))].sort();
  catSel.innerHTML = '<option value=\"\">Alle categorieën</option>' + cats.map(c=>`<option>${esc(c)}</option>`).join('');
  if(cats.includes(was)) catSel.value = was;
}
function getOpenTasks(){ return tasks.filter(t=>!t.done); }
function sortByUrgencyDeadline(a,b){
  const ua = urgRank(getUrgency(a)); const ub = urgRank(getUrgency(b));
  if(ua!==ub) return ua-ub;
  return new Date(a.deadline) - new Date(b.deadline);
}
function urgRank(u){ return u==='urgent'?0 : u==='warning'?1 : 2; }
function getUrgency(t){
  if(t.urgencyOverride) return t.urgencyOverride;
  const days = (new Date(t.deadline) - new Date())/86400000;
  if(days <= 1) return 'urgent';
  if(days <= 3) return 'warning';
  return 'safe';
}
function urgLabel(u){ return u==='urgent'?'Rood' : u==='warning'?'Geel' : 'Groen'; }
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
function gid(id){ return document.getElementById(id); }
function esc(s){ return (s||'').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function rid(){ return (crypto.getRandomValues(new Uint32Array(4))).join('-'); }
function progressBar(pct){ pct = clamp(pct||0,0,100); return `<div class="progress"><span style="width:${pct}%"></span></div>`; }
function persistTasks(){ ls.set('tasks', tasks); }
function persistArchive(){ ls.set('archive', archive); }
function persistOverdue(){ ls.set('overdueIds', overdueIds); }
function persistPlan(){ ls.set('dayPlan', dayPlan); ls.set('dayPlanLocked', dayPlanLocked); ls.set('lastPlanDate', lastPlanDate); }
function persistNotes(){ ls.set('notes', notes); }
function persistAll(){ persistTasks(); persistArchive(); persistOverdue(); persistPlan(); }

// Filters change handlers
document.addEventListener('change', (e)=>{
  if(e.target && (e.target.id==='filterCategory' || e.target.id==='filterType' || e.target.id==='filterUrgency')){
    renderTasksView();
  }
});

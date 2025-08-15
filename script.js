// ================== Storage helpers & crypto ==================
const LS = {
  get(k, d){ try{ const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch{ return d; } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
};

async function sha256Hex(bytes){
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2,'0')).join('');
}
function utf8(s){ return new TextEncoder().encode(s); }
function concatBytes(a,b){ const out = new Uint8Array(a.length+b.length); out.set(a,0); out.set(b,a.length); return out; }

// ================== State ==================
let userProfile = LS.get('userProfile', null);
let sessionActive = LS.get('sessionActive', false);

let tasks = [];         // active tasks
let archive = [];       // completed tasks
let overdueIds = [];    // ids flagged as overdue
let dayPlan = [];       // ordered ids for today's plan
let dayPlanLocked = false;
let lastPlanDate = null;
let notes = [];

let progMenuId = null;

// ================== Boot ==================
document.addEventListener('DOMContentLoaded', () => { init(); });

async function init(){
  wireAuthUI();
  await ensureAuth();      // blokkeer tot login/profiel

  // Load local state
  tasks = LS.get('tasks', []);
  archive = LS.get('archive', []);
  overdueIds = LS.get('overdueIds', []);
  dayPlan = LS.get('dayPlan', []);
  dayPlanLocked = LS.get('dayPlanLocked', false);
  lastPlanDate = LS.get('lastPlanDate', null);
  notes = LS.get('notes', []);

  // Seed uit JSON als leeg
  if(tasks.length===0){
    try{
      const t = await fetch('tasks.json'); if(t.ok) tasks = await t.json();
      const a = await fetch('archive.json'); if(a.ok) archive = await a.json();
    }catch(e){}
  }

  dailyResetIfNeeded();

  // Forms
  gid('addForm').addEventListener('submit', onAddTask);
  gid('noteForm').addEventListener('submit', onAddNote);
  gid('profileForm').addEventListener('submit', onSaveProfile);

  // Calendar nav
  gid('calPrev').addEventListener('click', () => { shiftMonth(-1); renderCalendar(); });
  gid('calNext').addEventListener('click', () => { shiftMonth(1); renderCalendar(); });

  // Confirm/unlock day plan
  gid('confirmPlanBtn').addEventListener('click', confirmDayPlan);
  gid('unlockPlanBtn').addEventListener('click', unlockDayPlan);

  // Details pane close
  gid('detailClose').addEventListener('click', closeDetail);

  // User dropdown
  gid('userBtn').addEventListener('click', () => gid('userDropdown').classList.toggle('hidden'));
  document.addEventListener('click', (e)=>{
    if(!e.target.closest('.user-menu')) gid('userDropdown').classList.add('hidden');
  });

  // Progress menu
  setupProgressMenu();

  // Drag target
  setupDayPlanDropZone();

  renderAll();
  startClock();
}

// ================== Auth (local) ==================
function wireAuthUI(){
  const tabLogin = gid('tabLogin'), tabCreate = gid('tabCreate');
  const loginForm = gid('loginForm'), createForm = gid('createForm');
  tabLogin.addEventListener('click', ()=>{ tabLogin.classList.add('active'); tabCreate.classList.remove('active'); loginForm.classList.remove('hidden'); createForm.classList.add('hidden'); });
  tabCreate.addEventListener('click', ()=>{ tabCreate.classList.add('active'); tabLogin.classList.remove('active'); createForm.classList.remove('hidden'); loginForm.classList.add('hidden'); });

  loginForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const u = gid('loginUser').value.trim(), p = gid('loginPass').value;
    if(!userProfile){ alert('Maak eerst een profiel.'); return; }
    const salt = Uint8Array.from(userProfile.salt);
    const hash = await sha256Hex(concatBytes(salt, utf8(p)));
    if(u === userProfile.name && hash === userProfile.passHash){
      sessionActive = true; LS.set('sessionActive', true);
      hideAuth();
      applyProfileToUI();
    } else {
      alert('Onjuiste gegevens.');
    }
  });

  createForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const u = gid('createUser').value.trim();
    const email = gid('createEmail').value.trim();
    const p1 = gid('createPass').value, p2 = gid('createPass2').value;
    if(!u || !email || !p1) return;
    if(p1 !== p2){ alert('Wachtwoorden komen niet overeen.'); return; }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await sha256Hex(concatBytes(salt, utf8(p1)));
    userProfile = {
      name: u, email,
      salt: Array.from(salt),
      passHash: hash,
      prefs: { dailyGoal: 5, workStart: '09:00', workEnd: '17:30', notify: 'none' }
    };
    LS.set('userProfile', userProfile);
    sessionActive = true; LS.set('sessionActive', true);
    hideAuth();
    applyProfileToUI();
  });
}

async function ensureAuth(){
  if(!userProfile){ showCreate(); showAuth(); return; }
  if(!sessionActive){ showLogin(); showAuth(); return; }
  applyProfileToUI();
}
function showAuth(){ gid('authOverlay').classList.remove('hidden'); }
function hideAuth(){ gid('authOverlay').classList.add('hidden'); }
function showLogin(){ gid('tabLogin').click(); }
function showCreate(){ gid('tabCreate').click(); }
function lockApp(){
  sessionActive = false; LS.set('sessionActive', false);
  showLogin(); showAuth();
}
function applyProfileToUI(){
  const initials = (userProfile.name||'U').split(/\s+/).map(s=>s[0]?.toUpperCase()).slice(0,2).join('') || 'U';
  gid('avatarInitials').textContent = initials;
  gid('ddName').textContent = userProfile.name||'Gebruiker';
  gid('ddEmail').textContent = userProfile.email||'';
  gid('profName').value = userProfile.name||'';
  gid('profEmail').value = userProfile.email||'';
  gid('profDailyGoal').value = userProfile.prefs?.dailyGoal ?? 5;
  gid('profStart').value = userProfile.prefs?.workStart ?? '09:00';
  gid('profEnd').value = userProfile.prefs?.workEnd ?? '17:30';
  gid('profNotify').value = userProfile.prefs?.notify ?? 'none';
}

// ================== Clock ==================
function two(n){ return String(n).padStart(2,'0'); }
function updateClock(){
  const now = new Date();
  const dateStr = `${two(now.getDate())}-${two(now.getMonth()+1)}-${now.getFullYear()}`;
  const timeStr = `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
  const el = document.getElementById('clock');
  if(el){ el.textContent = `– ${dateStr} ${timeStr}`; }
}
function startClock(){ updateClock(); setInterval(updateClock, 1000); }

// ================== Daily reset ==================
function todayISO(){ return new Date().toISOString().slice(0,10); }
function dailyResetIfNeeded(){
  const today = todayISO();
  if(lastPlanDate && lastPlanDate !== today){
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

// ================== Navigation ==================
function navigate(view){
  document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));
  const link = Array.from(document.querySelectorAll('.nav a')).find(a => a.getAttribute('onclick')?.includes(`'${view}'`));
  if(link) link.classList.add('active');
  showView(view);
  return false;
}

function showView(id){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  gid(id).classList.add('active');

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
  const title = gid('addTitle').value.trim();
  const deadline = gid('addDeadline').value;
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

// ================== Notes ==================
function onAddNote(e){
  e.preventDefault();
  const title = gid('noteTitle').value.trim();
  const category = gid('noteCategory').value.trim();
  const text = gid('noteText').value.trim();
  if(!title && !text) return;
  notes.push({ id: rid(), title, category, text, createdAt: new Date().toISOString() });
  persistNotes(); e.target.reset(); renderNotes();
}
function renderNotes(){
  const ul = gid('noteList'); ul.innerHTML='';
  notes.forEach(n => {
    const li = document.createElement('li'); li.className='item';
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
  gid('addTitle').value = n.title || (n.text||'').slice(0,60);
  gid('addCategory').value = n.category || '';
}
function deleteNote(id){ notes = notes.filter(n=>n.id!==id); persistNotes(); renderNotes(); }

// ================== Dashboard ==================
function renderDashboard(){
  renderUrgentIndicators();
  renderDayPlan();
  renderSuggestions();
  renderTypeOverview();
}
function renderUrgentIndicators(){
  const urgCount = getOpenTasks().filter(t => getUrgency(t)==='urgent').length;
  const topChip = gid('urgentChipTop'); const cardChip = gid('urgentChipCard');
  gid('urgCountTop').textContent = urgCount;
  gid('urgCountCard').textContent = urgCount;
  topChip.classList.toggle('hidden', urgCount===0);
  cardChip.classList.toggle('hidden', urgCount===0);
}

// Day plan
function renderDayPlan(){
  const list = gid('dayPlanList');
  const checklist = gid('dayChecklist');
  const info = gid('planInfo');
  const planned = dayPlan.map(id => tasks.find(t=>t.id===id)).filter(Boolean);

  if(dayPlanLocked){
    gid('unlockPlanBtn').classList.remove('hidden');
    list.classList.add('hidden'); checklist.classList.remove('hidden');
    info.textContent = 'Dagplanning bevestigd — werk de taken hieronder af.';
    checklist.innerHTML = '';
    planned.forEach(t => {
      const row = document.createElement('div');
      row.className='item';
      row.innerHTML = `
        <div class="item-main">
          <input type="checkbox" ${t.done?'checked':''} onchange="toggleDone('${t.id}', this.checked)" />
          <div class="title">${esc(t.title)}</div>
          <div class="meta"><i class="fa-regular fa-calendar"></i> ${fmtDate(t.deadline)} • <span class="badge ${getUrgency(t)}">${urgLabel(getUrgency(t))}</span></div>
        </div>
        <div class="progress-wrap">
          ${progressBarFor(t)}
          <button class="prog-chip" onclick="openProgMenu(event,'${t.id}')">${t.progress||0}% ▾</button>
        </div>`;
      checklist.appendChild(row);
    });
  } else {
    gid('unlockPlanBtn').classList.add('hidden');
    list.classList.remove('hidden'); checklist.classList.add('hidden');
    info.textContent = 'Sleep taken (desktop) of gebruik de knop “Plan vandaag”.';
    list.innerHTML='';
    planned.forEach(t => list.appendChild(taskRow(t, { draggable:true, inPlan:true })));
  }
}

// Confirm/unlock
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
function unlockDayPlan(){
  dayPlanLocked = false;
  LS.set('dayPlanLocked', dayPlanLocked);
  renderDayPlan();
}

// Suggestions
function renderSuggestions(){
  const ul = gid('suggestList'); ul.innerHTML='';
  let suggestions = getOpenTasks()
    .filter(t => !dayPlan.includes(t.id)) // verberg als al ingepland
    .sort(sortByUrgencyDeadline);
  const max = (userProfile?.prefs?.dailyGoal) ?? 5;
  suggestions = suggestions.slice(0, Math.max(5, max));
  suggestions.forEach(t => ul.appendChild(taskRow(t, { draggable:true })));
}

// ================== Tasks view ==================
function renderTasksView(){
  const catSel = gid('filterCategory');
  const cats = [...new Set(tasks.filter(t=>t.category).map(t=>t.category))].sort();
  catSel.innerHTML = '<option value=\"\">Alle categorieën</option>' + cats.map(c=>`<option>${esc(c)}</option>`).join('');

  const ul = gid('taskList'); ul.innerHTML='';
  let list = getOpenTasks();
  const fc = catSel.value;
  const ft = gid('filterType').value;
  const fu = gid('filterUrgency').value;
  if(fc) list = list.filter(t=>t.category===fc);
  if(ft) list = list.filter(t=>t.type===ft);
  if(fu) list = list.filter(t=>getUrgency(t)===fu);
  list.sort(sortByUrgencyDeadline).forEach(t => ul.appendChild(taskRow(t, { draggable:true })));
}

// ================== Type overview (accordion) ==================
function renderTypeOverview(){
  const wrap = gid('typeOverview'); wrap.innerHTML='';
  const groups = new Map();
  getOpenTasks().forEach(t => {
    const key = (t.type||'overig').toLowerCase();
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  const order = ['mail','telefoontje','uitzoekwerk','overleg','documentatie','creatief','administratie','overig'];
  const keys = Array.from(groups.keys()).sort((a,b)=> order.indexOf(a)-order.indexOf(b));
  keys.forEach(key => {
    const list = groups.get(key).sort(sortByUrgencyDeadline);
    const acc = document.createElement('div'); acc.className='acc';
    const header = document.createElement('div'); header.className='acc-header';
    header.innerHTML = `<div class="left"><i class="fa-solid fa-tag"></i> ${cap(key)}</div><div class="count">${list.length}</div>`;
    const body = document.createElement('div'); body.className='acc-body';
    const ul = document.createElement('ul'); ul.className='list';
    list.forEach(t => ul.appendChild(taskRow(t, { draggable:true })));
    body.appendChild(ul);
    header.addEventListener('click', ()=> acc.classList.toggle('open'));
    acc.appendChild(header); acc.appendChild(body);
    wrap.appendChild(acc);
  });
}

// ================== Overdue & Archive ==================
function renderOverdue(){
  const ul = gid('overdueList'); ul.innerHTML='';
  overdueIds.map(id => tasks.find(t=>t && t.id===id))
    .filter(Boolean).sort(sortByUrgencyDeadline)
    .forEach(t => ul.appendChild(taskRow(t, { draggable:false, overdueBadge:true })));
}
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

// ================== Calendar ==================
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

  // Weekdag koppen (ma-first)
  const days = ['Ma','Di','Wo','Do','Vr','Za','Zo'];
  days.forEach(d => {
    const h = document.createElement('div');
    h.className = 'cal-head';
    h.textContent = d;
    grid.appendChild(h);
  });

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
function taskRow(t, {draggable=false, inPlan=false, overdueBadge=false}={}){
  const li = document.createElement('li');
  li.className='item';
  li.dataset.id = t.id;

  const actionBtn = inPlan
    ? `<button class="btn" onclick="removeFromDayPlan('${t.id}')" title="Uit dagplanning"><i class="fa-solid fa-minus"></i> Verwijder</button>`
    : `<button class="btn" onclick="addToDayPlan('${t.id}')" title="Plan vandaag"><i class="fa-solid fa-calendar-plus"></i> Plan</button>`;

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
      <button class="prog-chip" onclick="openProgMenu(event,'${t.id}')">${t.progress||0}% ▾</button>
      ${actionBtn}
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
  const zone = gid('dayPlanList');
  zone.addEventListener('dragenter', (e)=>{ e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragover', (e)=>{ e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', ()=> zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e)=>{
    e.preventDefault();
    zone.classList.remove('drag-over');
    if(dayPlanLocked){ alert('Dagplanning is bevestigd. Ontgrendel om te wijzigen.'); return; }
    let id = ''; try{ id = e.dataTransfer.getData('text/plain'); }catch(_){}
    if(!id) return;
    const index = dropIndexByY(zone, e.clientY);
    const from = dayPlan.indexOf(id);
    if(from>-1) dayPlan.splice(from,1);
    const at = Math.max(0, Math.min(index, dayPlan.length));
    dayPlan.splice(at, 0, id);
    LS.set('dayPlan', dayPlan);
    renderDayPlan();
  });
}

function dropIndexByY(container, y){
  const kids = Array.from(container.children);
  for(let i=0;i<kids.length;i++){
    const rect = kids[i].getBoundingClientRect();
    const mid = rect.top + rect.height/2;
    if(y < mid) return i;
  }
  return kids.length;
}

function addToDayPlan(id){
  if(dayPlanLocked){ alert('Dagplanning is bevestigd. Ontgrendel om te wijzigen.'); return; }
  if(!dayPlan.includes(id)) dayPlan.push(id);
  LS.set('dayPlan', dayPlan);
  renderDayPlan(); renderSuggestions(); renderMonitoring();
}

function removeFromDayPlan(id){
  if(dayPlanLocked){ alert('Dagplanning is bevestigd. Ontgrendel om te wijzigen.'); return; }
  dayPlan = dayPlan.filter(x => x !== id);
  LS.set('dayPlan', dayPlan);
  renderDayPlan(); renderSuggestions(); renderMonitoring();
}

// ================== Progress quick menu ==================
function setupProgressMenu(){
  const menu = gid('progMenu');
  menu.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const v = parseInt(btn.dataset.v ?? btn.getAttribute('data-v'),10);
    if(isNaN(v)) return;
    if(!progMenuId) return closeProgMenu();
    const t = tasks.find(x=>x.id===progMenuId) || archive.find(x=>x.id===progMenuId);
    if(!t) return closeProgMenu();
    t.progress = v;
    persistTasks();
    closeProgMenu();
    renderAll();
  });
  document.addEventListener('click', (e)=>{
    if(e.target.closest('.prog-menu') || e.target.closest('.prog-chip')) return;
    closeProgMenu();
  });
}
function openProgMenu(ev, id){
  progMenuId = id;
  const menu = gid('progMenu');
  const x = ev.clientX, y = ev.clientY;
  menu.style.left = Math.max(6, x-10) + 'px';
  menu.style.top = (y+10) + 'px';
  menu.classList.remove('hidden');
}
function closeProgMenu(){ gid('progMenu').classList.add('hidden'); progMenuId=null; }

// ================== Detail pane ==================
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
  persistTasks(); renderAll(); closeDetail();
}
function markDone(id){
  const t = tasks.find(x=>x.id===id);
  if(!t) return;
  t.done = true; t.completedAt = new Date().toISOString();
  archive.push(t);
  tasks = tasks.filter(x=>x.id!==id);
  dayPlan = dayPlan.filter(x=>x!==id);
  overdueIds = overdueIds.filter(x=>x!==id);
  persistAll(); renderAll(); closeDetail();
}
function toggleDone(id, checked){
  const t = tasks.find(x=>x.id===id);
  if(!t) return;
  t.done = !!checked;
  if(checked){ t.completedAt = new Date().toISOString(); archive.push(t); tasks = tasks.filter(x=>x.id!==id); }
  persistAll(); renderAll();
}

// ================== Monitoring ==================
function renderMonitoring(){
  gid('statOpen').textContent = getOpenTasks().length.toString();
  gid('statOverdue').textContent = overdueIds.length.toString();
  const goal = userProfile?.prefs?.dailyGoal ?? 5;
  gid('statPlannedToday').textContent = `${dayPlan.length}/${goal}`;
  const plannedTasks = dayPlan.map(id => tasks.find(t=>t.id===id) || archive.find(t=>t.id===id)).filter(Boolean);
  const doneInPlan = plannedTasks.filter(t => t.done || archive.some(a=>a.id===t.id)).length;
  gid('statPlanDone').textContent = plannedTasks.length ? Math.round(doneInPlan*100/plannedTasks.length)+'%' : '0%';
  const open = getOpenTasks();
  const avgProg = open.length? Math.round(open.reduce((s,t)=>s+(t.progress||0),0)/open.length):0;
  gid('statAvgProgress').textContent = avgProg+'%';
  const weekCount = archive.filter(t => {
    const d = (t.completedAt||'').slice(0,10);
    if(!d) return false;
    const dt = new Date(d);
    const now = new Date(); const diff = (now - dt)/86400000;
    return diff<=7;
  }).length;
  gid('statWeekCompleted').textContent = weekCount.toString();
  const withDeadline = archive.filter(t=>t.deadline);
  const onTime = withDeadline.filter(t => new Date(t.completedAt) <= endOfDay(t.deadline));
  const pct = withDeadline.length? Math.round(onTime.length*100/offers.length):0;
  gid('statOnTime').textContent = pct + '%';
  const durations = archive.filter(t=>t.completedAt && t.createdAt).map(t => (new Date(t.completedAt)-new Date(t.createdAt))/36e5);
  const avg = durations.length? (durations.reduce((a,b)=>a+b,0)/durations.length).toFixed(1):'–';
  gid('statAvgDur').textContent = avg==='–'?'–':(avg+' u');
}

// ================== Utilities & persistence ==================
function updateProgress(id, val){
  val = clamp(parseInt(val||'0',10), 0, 100);
  const t = tasks.find(x=>x.id===id);
  if(!t) return;
  t.progress = val;
  persistTasks();
  renderAll();
}
function onSaveProfile(e){ e.preventDefault();
  userProfile.name = gid('profName').value.trim()||userProfile.name;
  userProfile.email = gid('profEmail').value.trim()||userProfile.email;
  userProfile.prefs = {
    dailyGoal: parseInt(gid('profDailyGoal').value||'5',10),
    workStart: gid('profStart').value,
    workEnd: gid('profEnd').value,
    notify: gid('profNotify').value
  };
  LS.set('userProfile', userProfile);
  applyProfileToUI();
  alert('Instellingen opgeslagen.');
}

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
function gid(id){ return document.getElementById(id); }
function esc(s){ return (s||'').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function rid(){ return (crypto.getRandomValues(new Uint32Array(4))).join('-'); }
function persistTasks(){ LS.set('tasks', tasks); }
function persistArchive(){ LS.set('archive', archive); }
function persistOverdue(){ LS.set('overdueIds', overdueIds); }
function persistPlan(){ LS.set('dayPlan', dayPlan); LS.set('dayPlanLocked', dayPlanLocked); LS.set('lastPlanDate', lastPlanDate); }
function persistNotes(){ LS.set('notes', notes); }
function persistAll(){ persistTasks(); persistArchive(); persistOverdue(); persistPlan(); }
function cap(s){ return (s||'').charAt(0).toUpperCase() + (s||'').slice(1); }

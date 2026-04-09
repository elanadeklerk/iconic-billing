/**
 * app.js — Iconic Billing Portal — All frontend logic
 * Single file to avoid module loading order issues.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// API CLIENT — all fetch calls go to /api/* on this same server
// ═══════════════════════════════════════════════════════════════

const API = {
  _token: () => sessionStorage.getItem('ib_token') || '',

  async _fetch(path, options = {}) {
    const token   = API._token();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res  = await fetch('/api' + path, {
      method:  options.method || 'GET',
      headers: { ...headers, ...(options.headers || {}) },
      body:    options.body ? JSON.stringify(options.body) : undefined,
    });

    let data = {};
    try { data = await res.json(); } catch (_) {}

    if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
    return data;
  },

  async login(email, password) {
    const data = await API._fetch('/auth/login', { method: 'POST', body: { email, password } });
    sessionStorage.setItem('ib_token',  data.session.access_token);
    sessionStorage.setItem('ib_doctor', JSON.stringify(data.doctor));
    return data;
  },

  async adminLogin(email, password) {
    const data = await API._fetch('/auth/admin-login', { method: 'POST', body: { email, password } });
    sessionStorage.setItem('ib_token',   data.session.access_token);
    sessionStorage.setItem('ib_isAdmin', 'true');
    return data;
  },

  async logout() {
    try { await API._fetch('/auth/logout', { method: 'POST' }); } catch (_) {}
    sessionStorage.clear();
  },

  getDoctor: () => {
    try { return JSON.parse(sessionStorage.getItem('ib_doctor') || 'null'); } catch (_) { return null; }
  },

  async getPatients()             { return API._fetch('/patients'); },
  async extractCodes(transcript)  { return API._fetch('/billing/extract', { method: 'POST', body: { transcript } }); },
  async submitBilling(payload)    { return API._fetch('/billing/submit',  { method: 'POST', body: payload }); },
  async getRecentBillings(limit)  { return API._fetch('/billing/recent?limit=' + (limit || 8)); },
  async getDoctors()              { return API._fetch('/admin/doctors'); },
  async createDoctor(payload)     { return API._fetch('/admin/doctors',        { method: 'POST',  body: payload }); },
  async updateDoctor(id, payload) { return API._fetch('/admin/doctors/' + id,  { method: 'PATCH', body: payload }); },
};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let allPatients    = [];
let selectedPatient = null;
let doctorProfile  = null;
let transcript     = '';
let recognition    = null;
let isRecording    = false;
let billingMode    = 'voice';
let wardVisits     = [];
let wardRemovedDates = new Set();

// ═══════════════════════════════════════════════════════════════
// SCREEN HELPERS
// ═══════════════════════════════════════════════════════════════

function showScreen(id) {
  ['loadingScreen','loginScreen','mainApp','adminScreen'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById(id);
  if (el) el.style.display = id === 'loginScreen' ? 'flex' : 'block';
}

function showLogin() {
  showScreen('loginScreen');
  el('loginError') && (el('loginError').style.display = 'none');
  el('loginEmail')    && (el('loginEmail').value = '');
  el('loginPassword') && (el('loginPassword').value = '');
}

function el(id) { return document.getElementById(id); }

function setTodayDate() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-ZA', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  if (el('currentDate')) el('currentDate').textContent = dateStr;
  if (el('dashDate'))    el('dashDate').textContent    = dateStr;
  if (el('dosDate'))     el('dosDate').value           = now.toISOString().split('T')[0];
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

window.onload = async () => {
  setTodayDate();
  sessionStorage.clear();
  try { await API.logout(); } catch (_) {}
  showLogin();
};

// ═══════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════

async function login() {
  const email    = el('loginEmail').value.trim();
  const password = el('loginPassword').value;
  const btn      = el('loginBtn');
  const errEl    = el('loginError');

  if (!email || !password) {
    errEl.textContent = 'Please enter your email and password.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Signing in…';
  errEl.style.display = 'none';

  try {
    const data = await API.login(email, password);
    doctorProfile = data.doctor;
    setTodayDate();
    showScreen('loadingScreen');
    el('loadingScreen').querySelector('.loading-text').textContent = 'Loading patients…';
    await loadPatientsAndStart();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

async function logout() {
  await API.logout();
  doctorProfile = null;
  allPatients   = [];
  selectedPatient = null;
  showLogin();
}

function showAdminLogin() {
  el('adminLoginOverlay').style.display = 'flex';
  setTimeout(() => el('adminLoginEmail') && el('adminLoginEmail').focus(), 80);
}

function hideAdminLogin() {
  el('adminLoginOverlay').style.display = 'none';
  el('adminLoginError').style.display = 'none';
  el('adminLoginEmail').value    = '';
  el('adminLoginPassword').value = '';
}

async function adminLogin() {
  const email    = el('adminLoginEmail').value.trim();
  const password = el('adminLoginPassword').value;
  const btn      = el('adminLoginBtn');
  const errEl    = el('adminLoginError');

  if (!email || !password) {
    errEl.textContent = 'Please enter both fields.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verifying…';
  errEl.style.display = 'none';

  try {
    await API.adminLogin(email, password);
    hideAdminLogin();
    showScreen('adminScreen');
    clearAdminForm();
    await loadAdminDoctors();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enter Admin Panel';
  }
}

async function exitAdmin() {
  await API.logout().catch(() => {});
  showLogin();
}

// ═══════════════════════════════════════════════════════════════
// PATIENTS
// ═══════════════════════════════════════════════════════════════

async function loadPatientsAndStart() {
  try {
    const { patients } = await API.getPatients();
    allPatients = patients || [];
    if (el('dashPatientCount')) el('dashPatientCount').textContent = allPatients.length || '—';
    showDashboard();
  } catch (err) {
    showLogin();
    el('loginError').textContent = 'Could not load patients: ' + err.message;
    el('loginError').style.display = 'block';
  }
}

function searchPatient(query) {
  const resultsEl = el('patientResults');
  const hintEl    = el('searchHint');

  if (!query || query.trim().length < 2) {
    resultsEl.style.display = 'none';
    hintEl.style.display    = 'block';
    return;
  }

  const q       = query.toLowerCase();
  const matches = allPatients.filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.fileNo || '').toLowerCase().includes(q)
  ).slice(0, 20);

  hintEl.style.display = 'none';
  resultsEl.style.display = 'block';

  if (!matches.length) {
    resultsEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;">No patients found</div>';
    return;
  }

  resultsEl.innerHTML = matches.map(p => {
    const globalIdx = allPatients.indexOf(p);
    const nameHl = highlight(p.name, q);
    return `<div class="patient-item" onclick="selectPatient(${globalIdx})">
      <div class="patient-name">${nameHl}</div>
      <div class="patient-meta">
        <span class="file-badge">${p.fileNo || '—'}</span>
        ${p.funding ? '<span>' + p.funding + '</span>' : ''}
        ${p.medAid  ? '<span>' + p.medAid  + '</span>' : ''}
      </div>
    </div>`;
  }).join('');
}

function highlight(text, query) {
  if (!text) return '—';
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return text;
  return text.slice(0, idx) +
    '<mark style="background:rgba(0,194,255,0.2);border-radius:3px;color:var(--accent);">' +
    text.slice(idx, idx + query.length) + '</mark>' +
    text.slice(idx + query.length);
}

function selectPatient(idx) {
  selectedPatient = allPatients[idx];
  const p = selectedPatient;
  if (el('sel-name'))    el('sel-name').textContent    = p.name    || '—';
  if (el('sel-fileno'))  el('sel-fileno').textContent  = p.fileNo  || '—';
  if (el('sel-funding')) el('sel-funding').textContent = p.funding || '—';
  if (el('sel-medaid'))  el('sel-medaid').textContent  = p.medAid  || '—';
  if (el('sel-plan'))    el('sel-plan').textContent    = p.plan    || '—';
  if (el('sel-memb'))    el('sel-memb').textContent    = p.membNo  || '—';

  el('searchInput').value = '';
  el('patientResults').style.display = 'none';
  el('searchHint').style.display = 'block';
  goToScreen(2);
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

function showDashboard() {
  // Hide all screens
  ['loadingScreen','loginScreen','adminScreen'].forEach(s => {
    const e = el(s); if (e) e.style.display = 'none';
  });
  el('mainApp').style.display = 'block';
  el('dashboardScreen').style.display = 'block';
  el('stepsBar').style.display = 'none';
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

  // Populate
  const dr = doctorProfile || API.getDoctor();
  if (dr) {
    if (el('dashDrName'))   el('dashDrName').textContent   = dr.doctor_name || 'Doctor';
    if (el('drNameHeader')) el('drNameHeader').textContent = (dr.doctor_name || 'Billing') + ' — Billing';
    if (el('sidebarDrName')) el('sidebarDrName').textContent = dr.doctor_name || '';
    // Show collections link if configured
    const collBtn = el('sidebarCollections');
    if (collBtn) collBtn.style.display = dr.collections_sheet_id ? 'flex' : 'none';
  }

  setTodayDate();
  if (el('dashPatientCount')) el('dashPatientCount').textContent = allPatients.length || '—';

  // Clear search
  if (el('searchInput')) el('searchInput').value = '';
  if (el('patientResults')) el('patientResults').style.display = 'none';
  if (el('searchHint')) el('searchHint').style.display = 'block';

  loadRecentBillings();
  window.scrollTo(0, 0);
}

async function loadRecentBillings() {
  const listEl  = el('dashRecentList');
  const todayEl = el('dashTodayCount');
  if (!listEl) return;

  listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px;">Loading…</div>';

  try {
    const { billings } = await API.getRecentBillings(8);
    const today = new Date().toISOString().split('T')[0];
    if (todayEl) todayEl.textContent = (billings || []).filter(b => (b.timestamp || '').startsWith(today)).length || '0';

    if (!billings || !billings.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:12px;">No recent billings</div>';
      return;
    }

    listEl.innerHTML = billings.map(b => `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${b.patientName || b.patient || '—'}</div>
          <div style="font-size:11px;color:var(--text3);font-family:var(--mono);">${b.fileNo || '—'} · ${b.dateOfService || b.date || '—'}</div>
        </div>
        <span style="font-size:11px;font-family:var(--mono);color:var(--accent);background:rgba(0,194,255,0.08);border:1px solid rgba(0,194,255,0.15);padding:3px 8px;border-radius:6px;flex-shrink:0;">${b.tariff || '—'}</span>
      </div>`).join('');
  } catch (_) {
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:12px;">Could not load recent billings</div>';
  }
}

function newBilling() {
  el('dashboardScreen').style.display = 'none';
  el('stepsBar').style.display = 'flex';
  transcript = '';
  isRecording = false;
  if (recognition) { try { recognition.stop(); } catch(_){} recognition = null; }
  wardVisits = [];
  wardRemovedDates = new Set();
  billingMode = 'voice';
  resetWardVisits();
  switchBillingMode('voice');
  // Clear confirm fields
  ['conf-tariff','conf-icd10','conf-modifier','conf-notes'].forEach(id => { if(el(id)) el(id).value = ''; });
  ['conf-fileno','conf-patient','conf-funding','conf-dos'].forEach(id => { if(el(id)) el(id).textContent = '—'; });
  if (el('aiStatusBox')) el('aiStatusBox').textContent = '';
  if (el('wardVisitsSummary')) el('wardVisitsSummary').style.display = 'none';
  if (el('processBtn')) el('processBtn').style.display = 'none';
  goToScreen(1);
}

function samePatientNewVisit() {
  if (!selectedPatient) { newBilling(); return; }
  el('dashboardScreen').style.display = 'none';
  el('stepsBar').style.display = 'flex';
  transcript = '';
  wardVisits = [];
  wardRemovedDates = new Set();
  switchBillingMode('voice');
  resetWardVisits();
  ['conf-tariff','conf-icd10','conf-modifier','conf-notes'].forEach(id => { if(el(id)) el(id).value = ''; });
  setTodayDate();
  goToScreen(2);
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

function goToScreen(n) {
  document.querySelectorAll('.screen').forEach((s, i) => s.classList.toggle('active', i + 1 === n));
  document.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('active', i + 1 <= n));
  el('stepsBar').style.display = n === 4 ? 'none' : 'flex';
  window.scrollTo(0, 0);
}

// ═══════════════════════════════════════════════════════════════
// BILLING MODE
// ═══════════════════════════════════════════════════════════════

function switchBillingMode(mode) {
  billingMode = mode;
  el('tabVoice').classList.toggle('active', mode === 'voice');
  el('tabManual').classList.toggle('active', mode === 'manual');
  el('voicePanel').style.display  = mode === 'voice'  ? 'block' : 'none';
  el('manualPanel').style.display = mode === 'manual' ? 'block' : 'none';
  if (mode !== 'voice' && isRecording) stopRecording();
}

// ═══════════════════════════════════════════════════════════════
// VOICE RECORDING
// ═══════════════════════════════════════════════════════════════

function toggleRecording() { isRecording ? stopRecording() : startRecording(); }

function startRecording() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('Speech recognition not supported. Please use Chrome.'); return; }

  transcript  = '';
  recognition = new SR();
  recognition.lang = 'en-ZA';
  recognition.continuous = true;
  recognition.interimResults = true;

  const box   = el('transcriptBox');
  const btn   = el('recordBtn');
  const label = el('recordLabel');

  box.classList.remove('empty');
  btn.classList.add('recording');
  label.classList.add('recording');
  label.textContent = 'Recording — tap to stop';
  isRecording = true;

  recognition.onresult = e => {
    let final = '', interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final   += e.results[i][0].transcript;
      else                       interim += e.results[i][0].transcript;
    }
    transcript += final;
    box.textContent = transcript + (interim ? ' …' + interim : '');
  };
  recognition.onend = () => { if (isRecording) recognition.start(); };
  recognition.onerror = e => { if (e.error !== 'no-speech') stopRecording(); };
  recognition.start();
}

function stopRecording() {
  isRecording = false;
  if (recognition) { try { recognition.stop(); } catch(_){} }
  el('recordBtn').classList.remove('recording');
  el('recordLabel').classList.remove('recording');
  el('recordLabel').textContent = 'Tap to start recording';
  if (transcript.trim()) el('processBtn').style.display = 'flex';
}

// ═══════════════════════════════════════════════════════════════
// AI EXTRACTION
// ═══════════════════════════════════════════════════════════════

async function processWithAI() {
  if (!transcript.trim()) return;
  const btn = el('processBtn');
  btn.disabled = true;
  btn.textContent = 'Extracting codes…';

  try {
    const result = await API.extractCodes(transcript);
    populateConfirmScreen(result.tariff, result.icd10, result.modifier, result.notes);
    showAIStatus('done', 'Codes extracted — please review and confirm');
  } catch (err) {
    populateConfirmScreen('', '', '', '');
    showAIStatus('error', 'AI extraction failed: ' + err.message + ' — enter codes manually below.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Extract Billing Codes';
  }
}

function showAIStatus(type, msg) {
  const el2 = el('aiStatusBox');
  if (!el2) return;
  const colors = { done: 'var(--success)', error: 'var(--danger)', loading: 'var(--accent)' };
  el2.style.cssText = 'padding:10px 14px;border-radius:10px;font-size:12px;margin-bottom:12px;background:rgba(0,0,0,0.15);color:' + (colors[type] || 'var(--text2)') + ';';
  el2.textContent = msg;
}

function populateConfirmScreen(tariff, icd10, modifier, notes) {
  const p = selectedPatient || {};
  if (el('conf-fileno'))  el('conf-fileno').textContent  = p.fileNo  || '—';
  if (el('conf-patient')) el('conf-patient').textContent = p.name    || '—';
  if (el('conf-funding')) el('conf-funding').textContent = (p.funding || '') + (p.medAid ? ' — ' + p.medAid : '');
  if (el('conf-dos'))     el('conf-dos').textContent     = el('dosDate') ? el('dosDate').value : '—';
  if (el('conf-tariff'))  el('conf-tariff').value        = tariff   || '';
  if (el('conf-icd10'))   el('conf-icd10').value         = icd10    || '';
  if (el('conf-modifier'))el('conf-modifier').value      = modifier || '';
  if (el('conf-notes') && notes) el('conf-notes').value  = notes;
  renderWardVisitsSummary();
  goToScreen(3);
}

// ═══════════════════════════════════════════════════════════════
// MANUAL ENTRY
// ═══════════════════════════════════════════════════════════════

function applyManualCodes() {
  const tariff   = el('manualTariff').value.trim();
  const icd10    = el('manualIcd10').value.trim();
  const modifier = el('manualModifier').value.trim();
  const notes    = el('manualNotes')   ? el('manualNotes').value.trim() : '';

  if (!tariff && !icd10) {
    ['manualTariff','manualIcd10'].forEach(id => {
      el(id).style.borderColor = 'var(--danger)';
      setTimeout(() => el(id).style.borderColor = '', 1400);
    });
    return;
  }
  populateConfirmScreen(tariff, icd10, modifier, notes);
  showAIStatus('done', 'Codes entered manually — please review and confirm');
}

// ═══════════════════════════════════════════════════════════════
// SUBMIT BILLING
// ═══════════════════════════════════════════════════════════════

async function submitBilling() {
  const p = selectedPatient;
  if (!p) { alert('No patient selected.'); return; }

  const tariff   = el('conf-tariff').value.trim();
  const icd10    = el('conf-icd10').value.trim();
  const modifier = el('conf-modifier') ? el('conf-modifier').value.trim() : '';
  const notes    = el('conf-notes')    ? el('conf-notes').value.trim()    : '';
  const dos      = el('conf-dos')      ? el('conf-dos').textContent.trim() : '';

  if (!tariff || !icd10) { alert('Please enter Tariff code and ICD-10 code.'); return; }

  const btn = el('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    await API.submitBilling({
      fileNo:        p.fileNo,
      patientName:   p.name,
      dateOfService: dos,
      fundingType:   p.funding || '',
      medAid:        p.medAid  || '',
      membNo:        p.membNo  || '',
      tariff, icd10, modifier, notes,
      wardVisits: wardVisits.length ? JSON.stringify(wardVisits) : '',
    });

    el('successMsg').textContent = 'Billing submitted for ' + p.name + ' (' + p.fileNo + ')';
    goToScreen(4);
    wardVisits = [];
    wardRemovedDates = new Set();
  } catch (err) {
    alert('Submission failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Billing Entry';
  }
}

// ═══════════════════════════════════════════════════════════════
// WARD VISITS
// ═══════════════════════════════════════════════════════════════

function toggleWardPanel() {
  const panel = el('wardPanel');
  if (panel.style.display !== 'none') { cancelWardPanel(); return; }

  panel.style.display = 'block';
  const btn = el('wardToggleBtn');
  btn.textContent = '✕ Close';
  btn.classList.add('active');

  const today = new Date().toISOString().split('T')[0];
  const from = el('wardFrom'), to = el('wardTo');
  if (!from.value) from.value = today;
  if (!to.value)   to.value   = today;
  buildWardTimeline();
  from.onchange = buildWardTimeline;
  to.onchange   = buildWardTimeline;
}

function cancelWardPanel() {
  wardRemovedDates.clear();
  el('wardPanel').style.display    = 'none';
  el('wardTimeline').style.display = 'none';
  const btn = el('wardToggleBtn');
  btn.textContent = wardVisits.length ? '✏️ Edit (' + wardVisits.length + ')' : '+ Add';
  btn.classList.remove('active');
}

function buildWardTimeline() {
  const from = el('wardFrom').value, to = el('wardTo').value;
  const tl = el('wardTimeline'), days = el('wardTimelineDays');
  if (!from || !to || from > to) { tl.style.display = 'none'; return; }

  const dates = [];
  let cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end && dates.length < 60) { dates.push(cur.toISOString().split('T')[0]); cur.setDate(cur.getDate() + 1); }
  if (!dates.length) { tl.style.display = 'none'; return; }

  days.innerHTML = dates.map(d => {
    const removed = wardRemovedDates.has(d);
    const dt = new Date(d + 'T00:00:00');
    return '<div class="ward-day-dot' + (removed ? ' removed' : '') + '" onclick="toggleWardDay(\'' + d + '\')" title="' + (removed ? 'Restore' : 'Remove') + '">' +
      '<span class="ward-day-label-day">' + dt.getDate() + '</span>' +
      '<span class="ward-day-label-mon">' + dt.toLocaleString('en-ZA',{month:'short'}) + '</span></div>';
  }).join('');

  const included = dates.filter(d => !wardRemovedDates.has(d)).length;
  el('wardVisitCount').textContent = included + ' of ' + dates.length + ' days included';
  tl.style.display = 'block';
}

function toggleWardDay(d) {
  wardRemovedDates.has(d) ? wardRemovedDates.delete(d) : wardRemovedDates.add(d);
  buildWardTimeline();
}

function saveWardVisits() {
  const from = el('wardFrom').value, to = el('wardTo').value;
  const tariff = el('wardTariff').value.trim(), icd10 = el('wardIcd10').value.trim();
  const flag = ids => ids.forEach(id => { el(id).style.borderColor = 'var(--danger)'; setTimeout(() => el(id).style.borderColor = '', 1400); });
  if (!from || !to) { flag(['wardFrom','wardTo']); return; }
  if (!tariff || !icd10) { flag(['wardTariff','wardIcd10']); return; }
  if (from > to) { flag(['wardFrom']); return; }

  let cur = new Date(from + 'T00:00:00'), added = 0;
  const end = new Date(to + 'T00:00:00');
  while (cur <= end && added < 60) {
    const d = cur.toISOString().split('T')[0];
    if (!wardRemovedDates.has(d) && !wardVisits.some(v => v.date === d && v.tariff === tariff)) {
      wardVisits.push({ date: d, tariff, icd10 }); added++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  wardVisits.sort((a,b) => a.date.localeCompare(b.date));
  wardRemovedDates.clear();
  renderWardChips();
  cancelWardPanel();
}

function removeWardVisit(idx) {
  wardVisits.splice(idx, 1);
  renderWardChips();
  if (!wardVisits.length) { el('wardSummary').style.display = 'none'; el('wardToggleBtn').textContent = '+ Add'; }
}

function renderWardChips() {
  const summary = el('wardSummary'), chips = el('wardChips'), btn = el('wardToggleBtn');
  if (!wardVisits.length) { if(summary) summary.style.display = 'none'; btn.textContent = '+ Add'; return; }
  if (chips) chips.innerHTML = wardVisits.map((v,i) => {
    const label = new Date(v.date + 'T00:00:00').toLocaleDateString('en-ZA',{day:'numeric',month:'short'});
    return '<div class="ward-chip"><span class="ward-chip-date">' + label + '</span><span>' + v.tariff + '</span><span style="color:var(--text3);">·</span><span>' + v.icd10 + '</span><button class="ward-chip-remove" onclick="removeWardVisit(' + i + ')">×</button></div>';
  }).join('');
  if (summary) summary.style.display = 'block';
  btn.textContent = '✏️ Edit (' + wardVisits.length + ')';
  btn.classList.remove('active');
}

function resetWardVisits() {
  wardVisits = []; wardRemovedDates = new Set();
  ['wardSummary','wardPanel','wardTimeline'].forEach(id => { if(el(id)) el(id).style.display = 'none'; });
  if(el('wardToggleBtn')) { el('wardToggleBtn').textContent = '+ Add'; el('wardToggleBtn').classList.remove('active'); }
  ['wardTariff','wardIcd10','wardFrom','wardTo'].forEach(id => { if(el(id)) el(id).value = ''; });
  if(el('wardChips')) el('wardChips').innerHTML = '';
}

function renderWardVisitsSummary() {
  const e = el('wardVisitsSummary');
  if (!e) return;
  if (!wardVisits.length) { e.style.display = 'none'; return; }
  e.style.display = 'block';
  e.innerHTML = '<div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text3);margin-bottom:8px;">Ward Visits (' + wardVisits.length + ')</div>' +
    wardVisits.map(v => {
      const label = new Date(v.date + 'T00:00:00').toLocaleDateString('en-ZA',{weekday:'short',day:'numeric',month:'short'});
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);"><span style="font-size:12px;font-family:var(--mono);color:var(--accent);min-width:80px;">' + label + '</span><span style="font-size:11px;font-family:var(--mono);color:var(--text2);">' + v.tariff + '</span><span style="color:var(--text3);">·</span><span style="font-size:11px;font-family:var(--mono);color:var(--text2);">' + v.icd10 + '</span></div>';
    }).join('');
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR & UI
// ═══════════════════════════════════════════════════════════════

function openSidebar()  { el('sidebar').classList.add('open'); el('sidebarOverlay').classList.add('show'); }
function closeSidebar() { el('sidebar').classList.remove('open'); el('sidebarOverlay').classList.remove('show'); }

function sidebarGoTo(dest) {
  closeSidebar();
  if (dest === 'dashboard') showDashboard();
  else if (dest === 'billing') newBilling();
}

function openSheetModal() {
  closeSidebar();
  const dr = doctorProfile || API.getDoctor();
  if (!dr || !dr.collections_sheet_id) return;
  const id = dr.collections_sheet_id;
  el('sheetIframe').src   = 'https://docs.google.com/spreadsheets/d/' + id + '/preview';
  el('sheetDirectLink').href = 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
  if (el('sheetModalTitle')) el('sheetModalTitle').textContent = (dr.doctor_name || 'Doctor') + ' — Collections';
  el('sheetModal').style.display = 'flex';
}

function closeSheetModal() {
  el('sheetModal').style.display = 'none';
  el('sheetIframe').src = '';
}

function openGenericSheet() { closeSidebar(); }

// ═══════════════════════════════════════════════════════════════
// ADMIN PANEL
// ═══════════════════════════════════════════════════════════════

async function loadAdminDoctors() {
  const listEl = el('adminDoctorList');
  if (!listEl) return;
  listEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text3);font-size:12px;">Loading…</div>';
  try {
    const { doctors } = await API.getDoctors();
    if (!doctors || !doctors.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:12px;">No doctors configured yet.</div>';
      return;
    }
    listEl.innerHTML = doctors.map(dr => {
      const initials = (dr.doctor_name || 'DR').split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
      const ready    = !!(dr.intake_sheet_id && dr.apps_script_url);
      return '<div class="doctor-card">' +
        '<div class="doctor-avatar">' + initials + '</div>' +
        '<div class="doctor-info"><div class="doctor-name">' + (dr.doctor_name||'—') + '</div><div class="doctor-email">' + (dr.email||'—') + '</div></div>' +
        '<span class="doctor-status ' + (ready?'ok':'pending') + '">' + (ready?'✓ Ready':'⚠ Incomplete') + '</span>' +
        '<button class="doctor-edit-btn" onclick=\'adminEditDoctor(' + JSON.stringify(dr) + ')\'>Edit</button></div>';
    }).join('');
  } catch (err) {
    listEl.innerHTML = '<div style="color:var(--danger);padding:16px;font-size:12px;">Error: ' + err.message + '</div>';
  }
}

function adminEditDoctor(dr) {
  el('adminEditUserId').value    = dr.id             || '';
  el('adminDrName').value        = dr.doctor_name    || '';
  el('adminDrEmail').value       = dr.email          || '';
  el('adminSheetId').value       = dr.intake_sheet_id || '';
  el('adminIntakeTab').value     = dr.intake_tab_name || 'Form responses 1';
  el('adminAppsScript').value   = dr.apps_script_url || '';
  el('adminGoogleKey').value    = '';
  el('adminAnthropicKey').value = '';
  el('adminCollectionsId').value = dr.collections_sheet_id || '';
  el('adminSaveBtn').textContent = 'Update Doctor';
  el('adminMsg').style.display   = 'none';
  document.querySelector('.admin-form-card').scrollIntoView({ behavior:'smooth', block:'start' });
}

function clearAdminForm() {
  ['adminEditUserId','adminDrName','adminDrEmail','adminSheetId','adminAppsScript','adminGoogleKey','adminAnthropicKey','adminCollectionsId']
    .forEach(id => { if(el(id)) el(id).value = ''; });
  if(el('adminIntakeTab')) el('adminIntakeTab').value = 'Form responses 1';
  if(el('adminSaveBtn')) el('adminSaveBtn').textContent = 'Save Doctor';
  if(el('adminMsg')) el('adminMsg').style.display = 'none';
}

async function adminSaveDoctor() {
  const btn    = el('adminSaveBtn');
  const editId = el('adminEditUserId').value.trim();
  const fields = {
    doctor_name:          el('adminDrName').value.trim(),
    email:                el('adminDrEmail').value.trim(),
    intake_sheet_id:      el('adminSheetId').value.trim(),
    intake_tab_name:      (el('adminIntakeTab').value.trim() || 'Form responses 1'),
    apps_script_url:      el('adminAppsScript').value.trim(),
    google_key:           el('adminGoogleKey').value.trim(),
    anthropic_key:        el('adminAnthropicKey').value.trim(),
    collections_sheet_id: el('adminCollectionsId').value.trim() || null,
  };

  if (!fields.doctor_name || !fields.email || !fields.intake_sheet_id || !fields.apps_script_url) {
    showAdminMsg('Please fill in Name, Email, Sheet ID and Apps Script URL.', 'error'); return;
  }
  if (!editId && (!fields.google_key || !fields.anthropic_key)) {
    showAdminMsg('Google API key and Anthropic API key are required for new doctors.', 'error'); return;
  }

  const payload = { ...fields };
  if (!payload.google_key)    delete payload.google_key;
  if (!payload.anthropic_key) delete payload.anthropic_key;
  if (!payload.collections_sheet_id) delete payload.collections_sheet_id;

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    if (editId) {
      await API.updateDoctor(editId, payload);
      showAdminMsg('✓ Doctor updated!', 'success');
    } else {
      await API.createDoctor(payload);
      showAdminMsg('✓ Doctor added! Now create their Supabase Auth account at supabase.com → Authentication → Users → Add user.', 'success');
    }
    clearAdminForm();
    await loadAdminDoctors();
  } catch (err) {
    showAdminMsg('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = editId ? 'Update Doctor' : 'Save Doctor';
  }
}

function showAdminMsg(msg, type) {
  const e = el('adminMsg');
  e.textContent = msg;
  e.className   = 'admin-msg ' + type;
  e.style.display = 'block';
}

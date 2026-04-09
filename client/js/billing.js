/**
 * billing.js — Voice recording, manual entry, ward visits, AI extraction, submission
 */

/* ── State ──────────────────────────────────────────────────── */
let transcript   = '';
let recognition  = null;
let isRecording  = false;
let billingMode  = 'voice';
let wardVisits   = [];
let wardRemovedDates = new Set();

function resetBillingState() {
  transcript = '';
  isRecording = false;
  if (recognition) { try { recognition.stop(); } catch(_){} recognition = null; }
  wardVisits = [];
  wardRemovedDates = new Set();
  billingMode = 'voice';
}

/* ── Screen navigation ───────────────────────────────────────── */
function goToScreen(n) {
  document.querySelectorAll('.screen').forEach((s, i) => {
    s.classList.toggle('active', i + 1 === n);
  });
  document.querySelectorAll('.step').forEach((s, i) => {
    s.classList.toggle('active', i + 1 <= n);
  });
  document.getElementById('stepsBar').style.display = n === 4 ? 'none' : 'flex';
  window.scrollTo(0, 0);
}

/* ── Billing mode tabs ───────────────────────────────────────── */
function switchBillingMode(mode) {
  billingMode = mode;
  document.getElementById('tabVoice').classList.toggle('active', mode === 'voice');
  document.getElementById('tabManual').classList.toggle('active', mode === 'manual');
  document.getElementById('voicePanel').style.display  = mode === 'voice'  ? 'block' : 'none';
  document.getElementById('manualPanel').style.display = mode === 'manual' ? 'block' : 'none';
  if (mode !== 'voice' && isRecording) stopRecording();
}

/* ── Voice recording ────────────────────────────────────────── */
function toggleRecording() {
  isRecording ? stopRecording() : startRecording();
}

function startRecording() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Speech recognition is not supported in this browser. Please use Chrome.');
    return;
  }

  transcript  = '';
  recognition = new SpeechRecognition();
  recognition.lang        = 'en-ZA';
  recognition.continuous  = true;
  recognition.interimResults = true;

  const box   = document.getElementById('transcriptBox');
  const btn   = document.getElementById('recordBtn');
  const label = document.getElementById('recordLabel');

  box.classList.remove('empty');
  btn.classList.add('recording');
  label.classList.add('recording');
  label.textContent = 'Recording — tap to stop';
  isRecording = true;

  recognition.onresult = (e) => {
    let final = '', interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final   += e.results[i][0].transcript;
      else                       interim += e.results[i][0].transcript;
    }
    transcript += final;
    box.textContent = transcript + (interim ? ' …' + interim : '');
  };

  recognition.onend = () => {
    if (isRecording) recognition.start(); // keep going until manually stopped
  };

  recognition.onerror = (e) => {
    if (e.error !== 'no-speech') stopRecording();
  };

  recognition.start();
}

function stopRecording() {
  isRecording = false;
  if (recognition) { try { recognition.stop(); } catch(_){} }

  const btn   = document.getElementById('recordBtn');
  const label = document.getElementById('recordLabel');
  btn.classList.remove('recording');
  label.classList.remove('recording');
  label.textContent = 'Tap to start recording';

  const processBtn = document.getElementById('processBtn');
  if (transcript.trim()) processBtn.style.display = 'flex';
}

/* ── AI code extraction ─────────────────────────────────────── */
async function processWithAI() {
  if (!transcript.trim()) return;

  const btn = document.getElementById('processBtn');
  btn.disabled    = true;
  btn.textContent = 'Extracting codes…';

  try {
    const result = await API.extractCodes(transcript);

    goToScreen(3);
    showAIStatus('done', 'Codes extracted — please review and confirm');

    document.getElementById('conf-fileno').textContent  = window.selectedPatient.fileNo;
    document.getElementById('conf-patient').textContent = window.selectedPatient.name;
    const funding = window.selectedPatient.funding + (window.selectedPatient.medAid ? ' — ' + window.selectedPatient.medAid : '');
    document.getElementById('conf-funding').textContent  = funding;
    document.getElementById('conf-dos').textContent      = document.getElementById('dosDate').value;
    document.getElementById('conf-tariff').value         = result.tariff   || '';
    document.getElementById('conf-icd10').value          = result.icd10    || '';
    document.getElementById('conf-modifier').value       = result.modifier || '';
    const notesEl = document.getElementById('conf-notes');
    if (notesEl && result.notes) notesEl.value = result.notes;

    renderWardVisitsSummary();
  } catch (err) {
    showAIStatus('error', 'AI extraction failed: ' + err.message + ' — you can still enter codes manually below.');
    goToScreen(3);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Extract Billing Codes';
  }
}

function showAIStatus(type, msg) {
  const el = document.getElementById('aiStatusBox');
  if (!el) return;
  const colors = { done: 'var(--success)', error: 'var(--danger)', loading: 'var(--accent)' };
  el.style.cssText = `padding:10px 14px; border-radius:10px; font-size:12px; margin-bottom:12px; background:rgba(0,0,0,0.15); color:${colors[type]||'var(--text2)'};`;
  el.textContent = msg;
}

/* ── Manual entry ───────────────────────────────────────────── */
function applyManualCodes() {
  const tariff   = document.getElementById('manualTariff').value.trim();
  const icd10    = document.getElementById('manualIcd10').value.trim();
  const modifier = document.getElementById('manualModifier').value.trim();
  const notes    = document.getElementById('manualNotes').value.trim();

  if (!tariff && !icd10) {
    ['manualTariff', 'manualIcd10'].forEach(id => {
      const el = document.getElementById(id);
      el.style.borderColor = 'var(--danger)';
      setTimeout(() => el.style.borderColor = '', 1400);
    });
    return;
  }

  goToScreen(3);
  showAIStatus('done', 'Codes entered manually — please review and confirm');

  const p = window.selectedPatient;
  document.getElementById('conf-fileno').textContent  = p.fileNo;
  document.getElementById('conf-patient').textContent = p.name;
  document.getElementById('conf-funding').textContent = p.funding + (p.medAid ? ' — ' + p.medAid : '');
  document.getElementById('conf-dos').textContent     = document.getElementById('dosDate').value;
  document.getElementById('conf-tariff').value        = tariff;
  document.getElementById('conf-icd10').value         = icd10;
  document.getElementById('conf-modifier').value      = modifier;
  const notesEl = document.getElementById('conf-notes');
  if (notesEl && notes) notesEl.value = notes;

  renderWardVisitsSummary();
}

/* ── Billing submission ─────────────────────────────────────── */
async function submitBilling() {
  const btn = document.getElementById('submitBtn');
  const p   = window.selectedPatient;

  if (!p) { alert('No patient selected.'); return; }

  const tariff   = document.getElementById('conf-tariff').value.trim();
  const icd10    = document.getElementById('conf-icd10').value.trim();
  const modifier = document.getElementById('conf-modifier').value.trim();
  const notes    = document.getElementById('conf-notes').value.trim();
  const dos      = document.getElementById('conf-dos').textContent.trim();

  if (!tariff || !icd10) {
    alert('Please enter at least a Tariff code and ICD-10 code.');
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Submitting…';

  try {
    await API.submitBilling({
      fileNo:        p.fileNo,
      patientName:   p.name,
      dateOfService: dos,
      fundingType:   p.funding,
      medAid:        p.medAid,
      membNo:        p.membNo,
      tariff,
      icd10,
      modifier,
      notes,
      wardVisits: wardVisits.length ? JSON.stringify(wardVisits) : '',
    });

    const msg = `Billing submitted for ${p.name} (${p.fileNo})`;
    document.getElementById('successMsg').textContent = msg;
    goToScreen(4);
    resetBillingState();

  } catch (err) {
    alert('Submission failed: ' + err.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Submit Billing Entry';
  }
}

/* ── Ward visits ─────────────────────────────────────────────── */
function toggleWardPanel() {
  const panel = document.getElementById('wardPanel');
  const isOpen = panel.style.display !== 'none';
  if (isOpen) { cancelWardPanel(); return; }

  panel.style.display = 'block';
  const btn = document.getElementById('wardToggleBtn');
  btn.textContent = '✕ Close';
  btn.classList.add('active');

  const today = new Date().toISOString().split('T')[0];
  const from  = document.getElementById('wardFrom');
  const to    = document.getElementById('wardTo');
  if (!from.value) from.value = today;
  if (!to.value)   to.value   = today;
  buildWardTimeline();
  from.addEventListener('change', buildWardTimeline);
  to.addEventListener('change', buildWardTimeline);
}

function cancelWardPanel() {
  wardRemovedDates.clear();
  document.getElementById('wardPanel').style.display    = 'none';
  document.getElementById('wardTimeline').style.display = 'none';
  const btn = document.getElementById('wardToggleBtn');
  btn.textContent = wardVisits.length ? `✏️ Edit (${wardVisits.length})` : '+ Add';
  btn.classList.remove('active');
}

function buildWardTimeline() {
  const from = document.getElementById('wardFrom').value;
  const to   = document.getElementById('wardTo').value;
  const tl   = document.getElementById('wardTimeline');
  const days = document.getElementById('wardTimelineDays');

  if (!from || !to || from > to) { tl.style.display = 'none'; return; }

  const dates = [];
  let cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end && dates.length < 60) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate() + 1);
  }

  if (!dates.length) { tl.style.display = 'none'; return; }

  days.innerHTML = dates.map(d => {
    const removed = wardRemovedDates.has(d);
    const dt = new Date(d + 'T00:00:00');
    return `<div class="ward-day-dot${removed ? ' removed' : ''}" onclick="toggleWardDay('${d}')" title="${removed ? 'Restore' : 'Remove'}">
      <span class="ward-day-label-day">${dt.getDate()}</span>
      <span class="ward-day-label-mon">${dt.toLocaleString('en-ZA',{month:'short'})}</span>
    </div>`;
  }).join('');

  const included = dates.filter(d => !wardRemovedDates.has(d)).length;
  document.getElementById('wardVisitCount').textContent = `${included} of ${dates.length} days included`;
  tl.style.display = 'block';
}

function toggleWardDay(dateStr) {
  wardRemovedDates.has(dateStr) ? wardRemovedDates.delete(dateStr) : wardRemovedDates.add(dateStr);
  buildWardTimeline();
}

function saveWardVisits() {
  const from   = document.getElementById('wardFrom').value;
  const to     = document.getElementById('wardTo').value;
  const tariff = document.getElementById('wardTariff').value.trim();
  const icd10  = document.getElementById('wardIcd10').value.trim();

  const flag = (ids) => ids.forEach(id => {
    const el = document.getElementById(id);
    el.style.borderColor = 'var(--danger)';
    setTimeout(() => el.style.borderColor = '', 1400);
  });

  if (!from || !to)      { flag(['wardFrom', 'wardTo']); return; }
  if (!tariff || !icd10) { flag(['wardTariff', 'wardIcd10']); return; }
  if (from > to)         { flag(['wardFrom']); return; }

  let cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  let added = 0;
  while (cur <= end && added < 60) {
    const dateStr = cur.toISOString().split('T')[0];
    if (!wardRemovedDates.has(dateStr) && !wardVisits.some(v => v.date === dateStr && v.tariff === tariff)) {
      wardVisits.push({ date: dateStr, tariff, icd10 });
      added++;
    }
    cur.setDate(cur.getDate() + 1);
  }

  wardVisits.sort((a, b) => a.date.localeCompare(b.date));
  wardRemovedDates.clear();
  renderWardChips();
  cancelWardPanel();
}

function removeWardVisit(idx) {
  wardVisits.splice(idx, 1);
  renderWardChips();
  if (!wardVisits.length) {
    document.getElementById('wardSummary').style.display = 'none';
    document.getElementById('wardToggleBtn').textContent = '+ Add';
  }
}

function renderWardChips() {
  const summary = document.getElementById('wardSummary');
  const chips   = document.getElementById('wardChips');
  const btn     = document.getElementById('wardToggleBtn');

  if (!wardVisits.length) { summary.style.display = 'none'; btn.textContent = '+ Add'; return; }

  chips.innerHTML = wardVisits.map((v, i) => {
    const label = new Date(v.date + 'T00:00:00').toLocaleDateString('en-ZA', { day:'numeric', month:'short' });
    return `<div class="ward-chip">
      <span class="ward-chip-date">${label}</span>
      <span>${v.tariff}</span>
      <span style="color:var(--text3);">·</span>
      <span>${v.icd10}</span>
      <button class="ward-chip-remove" onclick="removeWardVisit(${i})">×</button>
    </div>`;
  }).join('');

  summary.style.display = 'block';
  btn.textContent = `✏️ Edit (${wardVisits.length})`;
  btn.classList.remove('active');
}

function resetWardVisits() {
  wardVisits = [];
  wardRemovedDates = new Set();
  document.getElementById('wardSummary').style.display  = 'none';
  document.getElementById('wardPanel').style.display    = 'none';
  document.getElementById('wardTimeline').style.display = 'none';
  document.getElementById('wardToggleBtn').textContent  = '+ Add';
  document.getElementById('wardToggleBtn').classList.remove('active');
  document.getElementById('wardTariff').value = '';
  document.getElementById('wardIcd10').value  = '';
  document.getElementById('wardFrom').value   = '';
  document.getElementById('wardTo').value     = '';
  document.getElementById('wardChips').innerHTML = '';
}

function renderWardVisitsSummary() {
  const el = document.getElementById('wardVisitsSummary');
  if (!el) return;
  if (!wardVisits.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = `<div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text3);margin-bottom:8px;">Ward Visits (${wardVisits.length})</div>` +
    wardVisits.map(v => {
      const label = new Date(v.date + 'T00:00:00').toLocaleDateString('en-ZA', { weekday:'short', day:'numeric', month:'short' });
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:12px;font-family:var(--mono);color:var(--accent);min-width:80px;">${label}</span>
        <span style="font-size:11px;font-family:var(--mono);color:var(--text2);">${v.tariff}</span>
        <span style="font-size:11px;color:var(--text3);">·</span>
        <span style="font-size:11px;font-family:var(--mono);color:var(--text2);">${v.icd10}</span>
      </div>`;
    }).join('');
}

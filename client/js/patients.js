/**
 * patients.js — Patient loading, search, selection
 */

window.allPatients   = [];
window.selectedPatient = null;

async function loadPatientsAndStart() {
  showScreen('loadingScreen');
  document.querySelector('#loadingScreen .loading-text').textContent = 'Loading patients…';

  try {
    const { patients } = await API.getPatients();
    window.allPatients = patients;

    // Update dashboard stats
    const countEl = document.getElementById('dashPatientCount');
    if (countEl) countEl.textContent = patients.length || '—';

    showDashboard();
  } catch (err) {
    // Show error on login screen
    showLogin();
    const errEl = document.getElementById('loginError');
    errEl.textContent = 'Could not load patients: ' + err.message;
    errEl.style.display = 'block';
  }
}

function searchPatient(query) {
  const resultsEl = document.getElementById('patientResults');
  const hintEl    = document.getElementById('searchHint');

  if (!query || query.trim().length < 2) {
    resultsEl.style.display = 'none';
    hintEl.style.display    = 'block';
    return;
  }

  const q       = query.toLowerCase();
  const matches = window.allPatients.filter(p =>
    p.name?.toLowerCase().includes(q) ||
    p.fileNo?.toLowerCase().includes(q)
  ).slice(0, 20);

  hintEl.style.display = 'none';

  if (matches.length === 0) {
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text3); font-size:13px;">No patients found</div>';
    return;
  }

  resultsEl.style.display = 'block';
  resultsEl.innerHTML = matches.map((p, i) => `
    <div class="patient-item" onclick="selectPatient(${window.allPatients.indexOf(p)})">
      <div class="patient-name">${highlight(p.name, q)}</div>
      <div class="patient-meta">
        <span class="file-badge">${p.fileNo || '—'}</span>
        ${p.funding ? `<span>${p.funding}</span>` : ''}
        ${p.medAid  ? `<span>${p.medAid}</span>`  : ''}
      </div>
    </div>
  `).join('');
}

function highlight(text, query) {
  if (!text) return '—';
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return text;
  return text.slice(0, idx) +
    `<mark style="background:rgba(0,194,255,0.2); border-radius:3px; color:var(--accent);">${text.slice(idx, idx + query.length)}</mark>` +
    text.slice(idx + query.length);
}

function selectPatient(idx) {
  window.selectedPatient = window.allPatients[idx];
  const p = window.selectedPatient;

  document.getElementById('sel-name').textContent    = p.name    || '—';
  document.getElementById('sel-fileno').textContent  = p.fileNo  || '—';
  document.getElementById('sel-funding').textContent = p.funding || '—';
  document.getElementById('sel-medaid').textContent  = p.medAid  || '—';
  document.getElementById('sel-plan').textContent    = p.plan    || '—';
  document.getElementById('sel-memb').textContent    = p.membNo  || '—';

  // Clear search
  document.getElementById('searchInput').value = '';
  document.getElementById('patientResults').style.display = 'none';
  document.getElementById('searchHint').style.display = 'block';

  goToScreen(2);
}

/**
 * dashboard.js — Dashboard screen, stats, recent billings
 */

let dashboardVisible = false;

function showDashboard() {
  dashboardVisible = true;

  // Clear search state
  const si = document.getElementById('searchInput');
  if (si) si.value = '';
  const pr = document.getElementById('patientResults');
  if (pr) pr.style.display = 'none';
  const sh = document.getElementById('searchHint');
  if (sh) { sh.style.display = 'block'; sh.textContent = 'Start typing to search'; }

  // Hide billing screens
  document.getElementById('stepsBar').style.display = 'none';
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

  // Show mainApp, hide other screens
  ['loadingScreen', 'loginScreen', 'adminScreen'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = 'none';
  });
  document.getElementById('mainApp').style.display       = 'block';
  document.getElementById('dashboardScreen').style.display = 'block';

  // Populate greeting
  const doctor = window.doctorProfile || API.getDoctor();
  if (doctor) {
    const nameEl = document.getElementById('dashDrName');
    const hdrEl  = document.getElementById('drNameHeader');
    if (nameEl) nameEl.textContent = doctor.doctor_name || 'Doctor';
    if (hdrEl)  hdrEl.textContent  = (doctor.doctor_name || 'Billing') + ' — Billing';
    updateSidebarForDoctor(doctor.doctor_name);
  }

  const now = new Date();
  const dateEl = document.getElementById('dashDate');
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  document.getElementById('dashPatientCount').textContent = (window.allPatients || []).length || '—';

  loadRecentBillings();
  window.scrollTo(0, 0);
}

function hideDashboard() {
  dashboardVisible = false;
  document.getElementById('dashboardScreen').style.display = 'none';
  document.getElementById('stepsBar').style.display = 'flex';
}

function newBilling() {
  hideDashboard();
  switchBillingMode('voice');
  resetWardVisits();
  resetBillingState();

  // Reset confirm screen fields
  ['conf-tariff','conf-icd10','conf-modifier','conf-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['conf-fileno','conf-patient','conf-funding','conf-dos'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
  const aiBox = document.getElementById('aiStatusBox');
  if (aiBox) aiBox.textContent = '';

  // Reset ward summary
  const ws = document.getElementById('wardVisitsSummary');
  if (ws) ws.style.display = 'none';

  goToScreen(1);
}

function samePatientNewVisit() {
  // Keep selectedPatient, go back to billing screen
  if (!window.selectedPatient) { newBilling(); return; }

  resetBillingState();
  switchBillingMode('voice');
  resetWardVisits();

  ['conf-tariff','conf-icd10','conf-modifier','conf-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const aiBox = document.getElementById('aiStatusBox');
  if (aiBox) aiBox.textContent = '';

  hideDashboard();
  setTodayDate();
  goToScreen(2);
}

async function loadRecentBillings() {
  const listEl  = document.getElementById('dashRecentList');
  const todayEl = document.getElementById('dashTodayCount');
  if (!listEl) return;

  listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:12px;">
    <div class="spinner" style="width:13px;height:13px;border-color:var(--text3);border-top-color:transparent;flex-shrink:0;"></div>Loading…</div>`;

  try {
    const { billings } = await API.getRecentBillings(8);

    if (!billings || billings.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:12px;">No recent billings</div>';
      if (todayEl) todayEl.textContent = '0';
      return;
    }

    // Count today's billings
    const today = new Date().toISOString().split('T')[0];
    const todayCount = billings.filter(b => (b.timestamp || b.date || '').startsWith(today)).length;
    if (todayEl) todayEl.textContent = todayCount || '0';

    listEl.innerHTML = billings.map(b => {
      const name    = b.patientName || b.patient || '—';
      const fileNo  = b.fileNo      || b.file_no || '—';
      const tariff  = b.tariff      || '—';
      const dos     = b.dateOfService || b.date || '—';
      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
          <div style="font-size:11px;color:var(--text3);font-family:var(--mono);">${fileNo} · ${dos}</div>
        </div>
        <span style="font-size:11px;font-family:var(--mono);color:var(--accent);background:rgba(0,194,255,0.08);border:1px solid rgba(0,194,255,0.15);padding:3px 8px;border-radius:6px;flex-shrink:0;">${tariff}</span>
      </div>`;
    }).join('');

  } catch (_) {
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:12px;">Could not load recent billings</div>';
  }
}

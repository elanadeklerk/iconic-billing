/**
 * ui.js — Shared UI helpers: sidebar, dates, steps, collections sheet
 */

/* ── Date helpers ───────────────────────────────────────────── */
function setTodayDate() {
  const now   = new Date();
  const dateEl = document.getElementById('currentDate');
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const dosEl = document.getElementById('dosDate');
  if (dosEl) dosEl.value = now.toISOString().split('T')[0];
}

/* ── Sidebar ─────────────────────────────────────────────────── */
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('show');
  document.addEventListener('keydown', closeSidebarOnEsc);
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
  document.removeEventListener('keydown', closeSidebarOnEsc);
}

function closeSidebarOnEsc(e) {
  if (e.key === 'Escape') closeSidebar();
}

function setSidebarActive(id) {
  document.querySelectorAll('.sidebar-nav-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function updateSidebarForDoctor(drName) {
  // Show doctor name in sidebar
  const nameEl = document.getElementById('sidebarDrName');
  if (nameEl) nameEl.textContent = drName || '';

  // Show collections sheet link if doctor has one
  const doctor = window.doctorProfile || API.getDoctor();
  const collBtn = document.getElementById('sidebarCollections');
  if (collBtn) {
    collBtn.style.display = (doctor && doctor.collections_sheet_id) ? 'flex' : 'none';
  }
}

function sidebarGoTo(dest) {
  closeSidebar();
  if (dest === 'dashboard') {
    setSidebarActive('sidebar-nav-dashboard');
    showDashboard();
  } else if (dest === 'billing') {
    setSidebarActive('sidebar-nav-billing');
    newBilling();
  }
}

/* ── Collections Sheet modal ─────────────────────────────────── */
function openSheetModal() {
  closeSidebar();
  const doctor = window.doctorProfile || API.getDoctor();
  if (!doctor || !doctor.collections_sheet_id) return;

  const modal   = document.getElementById('sheetModal');
  const iframe  = document.getElementById('sheetIframe');
  const titleEl = document.getElementById('sheetModalTitle');
  const linkEl  = document.getElementById('sheetDirectLink');

  const embedUrl  = `https://docs.google.com/spreadsheets/d/${doctor.collections_sheet_id}/preview`;
  const directUrl = `https://docs.google.com/spreadsheets/d/${doctor.collections_sheet_id}/edit`;

  if (titleEl) titleEl.textContent = (window.doctorProfile?.doctor_name || 'Doctor') + ' — Collections';
  if (linkEl)  linkEl.href = directUrl;
  if (iframe)  iframe.src  = embedUrl;

  modal.style.display = 'flex';
}

function closeSheetModal() {
  const modal  = document.getElementById('sheetModal');
  const iframe = document.getElementById('sheetIframe');
  modal.style.display = 'none';
  if (iframe) iframe.src = '';
}

/* ── Tariff codes reference ──────────────────────────────────── */
function openTariffRef() {
  closeSidebar();
  document.getElementById('tariffModal').style.display = 'flex';
}

function closeTariffRef() {
  document.getElementById('tariffModal').style.display = 'none';
}

/* ── Generic tariff reference sheet ─────────────────────────── */
function openGenericSheet() {
  closeSidebar();
  openTariffRef();
}

/* ── Global JS error handler (dev helper) ───────────────────── */
window.onerror = function(msg, src, line, col, err) {
  console.error('JS Error:', msg, 'at', src, line + ':' + col, err);
  return false;
};

/**
 * auth.js — Login, logout, admin auth
 */

/* ── Screen visibility ──────────────────────────────────────── */
function showScreen(id) {
  ['loadingScreen', 'loginScreen', 'mainApp', 'adminScreen'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(id);
  if (target) target.style.display = (id === 'loginScreen') ? 'flex' : 'block';
}

function showLogin() {
  showScreen('loginScreen');
  const errEl = document.getElementById('loginError');
  if (errEl) errEl.style.display = 'none';
  const emailEl = document.getElementById('loginEmail');
  const passEl  = document.getElementById('loginPassword');
  if (emailEl) emailEl.value = '';
  if (passEl)  passEl.value  = '';
}

/* ── Doctor login ───────────────────────────────────────────── */
async function login() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn      = document.getElementById('loginBtn');
  const errEl    = document.getElementById('loginError');

  if (!email || !password) {
    errEl.textContent   = 'Please enter your email and password.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Signing in…';
  errEl.style.display = 'none';

  try {
    const { doctor } = await API.login(email, password);
    window.doctorProfile = doctor;
    setTodayDate();
    await loadPatientsAndStart();
  } catch (err) {
    errEl.textContent   = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Sign In';
  }
}

async function logout() {
  await API.logout().catch(() => {});
  window.doctorProfile = null;
  window.allPatients   = [];
  sessionStorage.clear();
  showLogin();
}

/* ── Page init — always force login on every visit ──────────── */
window.onload = async () => {
  setTodayDate();
  // Destroy any cached session — medical app must always require fresh login
  sessionStorage.clear();
  await API.logout().catch(() => {});
  showLogin();
};

/* ── Admin login overlay ─────────────────────────────────────── */
function showAdminLogin() {
  const overlay = document.getElementById('adminLoginOverlay');
  if (overlay) overlay.style.display = 'flex';
  setTimeout(() => {
    const el = document.getElementById('adminLoginEmail');
    if (el) el.focus();
  }, 80);
}

function hideAdminLogin() {
  const overlay = document.getElementById('adminLoginOverlay');
  if (overlay) overlay.style.display = 'none';
  const errEl = document.getElementById('adminLoginError');
  if (errEl) errEl.style.display = 'none';
  const emailEl = document.getElementById('adminLoginEmail');
  const passEl  = document.getElementById('adminLoginPassword');
  if (emailEl) emailEl.value = '';
  if (passEl)  passEl.value  = '';
}

async function adminLogin() {
  const email    = document.getElementById('adminLoginEmail').value.trim();
  const password = document.getElementById('adminLoginPassword').value;
  const btn      = document.getElementById('adminLoginBtn');
  const errEl    = document.getElementById('adminLoginError');

  if (!email || !password) {
    errEl.textContent   = 'Please enter both fields.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Verifying…';
  errEl.style.display = 'none';

  try {
    // Use the separate admin-login endpoint — no doctors row needed
    await API.adminLogin(email, password);
    hideAdminLogin();
    showScreen('adminScreen');
    clearAdminForm();
    await loadAdminDoctors();
  } catch (err) {
    errEl.textContent   = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Enter Admin Panel';
  }
}

async function exitAdmin() {
  await API.logout().catch(() => {});
  sessionStorage.clear();
  showLogin();
}

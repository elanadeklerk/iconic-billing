/**
 * auth.js — Login, logout, admin auth
 */

/* ── Screen visibility helpers ─────────────────────────────── */
function showScreen(id) {
  ['loadingScreen', 'loginScreen', 'mainApp', 'adminScreen'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(id);
  if (target) target.style.display = id === 'loginScreen' ? 'flex' : 'block';
}

function showLogin() {
  showScreen('loginScreen');
  document.getElementById('loginError').style.display = 'none';
  document.getElementById('loginEmail').value    = '';
  document.getElementById('loginPassword').value = '';
}

/* ── Doctor login ───────────────────────────────────────────── */
async function login() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn      = document.getElementById('loginBtn');
  const errEl    = document.getElementById('loginError');

  if (!email || !password) {
    errEl.textContent = 'Please enter your email and password.';
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
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Sign In';
  }
}

async function logout() {
  await API.logout();
  window.doctorProfile = null;
  window.allPatients   = [];
  resetBillingState();
  showLogin();
}

/* ── Page init ───────────────────────────────────────────────── */
window.onload = async () => {
  setTodayDate();
  // Always force login — no session persistence between visits
  await API.logout().catch(() => {});
  showLogin();
};

/* ── Admin login overlay ─────────────────────────────────────── */
function showAdminLogin() {
  document.getElementById('adminLoginOverlay').style.display = 'flex';
  setTimeout(() => document.getElementById('adminLoginEmail').focus(), 80);
}

function hideAdminLogin() {
  document.getElementById('adminLoginOverlay').style.display = 'none';
  document.getElementById('adminLoginError').style.display = 'none';
  document.getElementById('adminLoginEmail').value    = '';
  document.getElementById('adminLoginPassword').value = '';
}

async function adminLogin() {
  const email    = document.getElementById('adminLoginEmail').value.trim();
  const password = document.getElementById('adminLoginPassword').value;
  const btn      = document.getElementById('adminLoginBtn');
  const errEl    = document.getElementById('adminLoginError');

  if (!email || !password) {
    errEl.textContent = 'Please enter both fields.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Verifying…';
  errEl.style.display = 'none';

  try {
    // Login through the same endpoint — server enforces ADMIN_EMAIL check via the admin routes
    await API.login(email, password);
    hideAdminLogin();
    showScreen('adminScreen');
    clearAdminForm();
    await loadAdminDoctors();
  } catch (err) {
    errEl.textContent = err.message.includes('No doctor profile')
      ? 'Access denied — not an admin account.'
      : err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Enter Admin Panel';
  }
}

async function exitAdmin() {
  await API.logout();
  showLogin();
}

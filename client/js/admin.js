/**
 * admin.js — Admin panel: list doctors, add/edit doctor
 */

async function loadAdminDoctors() {
  const listEl = document.getElementById('adminDoctorList');
  listEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text3);font-size:12px;">Loading…</div>';

  try {
    const { doctors } = await API.getDoctors();

    if (!doctors || doctors.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:12px;">No doctors configured yet.</div>';
      return;
    }

    listEl.innerHTML = doctors.map(dr => {
      const initials = (dr.doctor_name || 'DR').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
      const ready    = !!(dr.intake_sheet_id && dr.apps_script_url);
      return `<div class="doctor-card">
        <div class="doctor-avatar">${initials}</div>
        <div class="doctor-info">
          <div class="doctor-name">${dr.doctor_name || '—'}</div>
          <div class="doctor-email">${dr.email || '—'}</div>
        </div>
        <span class="doctor-status ${ready ? 'ok' : 'pending'}">${ready ? '✓ Ready' : '⚠ Incomplete'}</span>
        <button class="doctor-edit-btn" onclick='adminEditDoctor(${JSON.stringify(dr)})'>Edit</button>
      </div>`;
    }).join('');

  } catch (err) {
    listEl.innerHTML = `<div style="text-align:center;padding:16px;color:var(--danger);font-size:12px;">Error: ${err.message}</div>`;
  }
}

function adminEditDoctor(dr) {
  document.getElementById('adminEditUserId').value    = dr.id             || '';
  document.getElementById('adminDrName').value        = dr.doctor_name    || '';
  document.getElementById('adminDrEmail').value       = dr.email          || '';
  document.getElementById('adminSheetId').value       = dr.intake_sheet_id || '';
  document.getElementById('adminIntakeTab').value     = dr.intake_tab_name || 'Form responses 1';
  document.getElementById('adminAppsScript').value   = dr.apps_script_url || '';
  document.getElementById('adminGoogleKey').value    = '';   // never pre-fill keys from server
  document.getElementById('adminAnthropicKey').value = '';
  document.getElementById('adminCollectionsId').value = dr.collections_sheet_id || '';

  document.getElementById('adminSaveBtn').textContent = 'Update Doctor';
  document.getElementById('adminMsg').style.display   = 'none';
  document.querySelector('.admin-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearAdminForm() {
  ['adminEditUserId','adminDrName','adminDrEmail','adminSheetId',
   'adminAppsScript','adminGoogleKey','adminAnthropicKey','adminCollectionsId'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('adminIntakeTab').value     = 'Form responses 1';
  document.getElementById('adminSaveBtn').textContent = 'Save Doctor';
  document.getElementById('adminMsg').style.display   = 'none';
}

async function adminSaveDoctor() {
  const btn    = document.getElementById('adminSaveBtn');
  const editId = document.getElementById('adminEditUserId').value.trim();

  const fields = {
    doctor_name:          document.getElementById('adminDrName').value.trim(),
    email:                document.getElementById('adminDrEmail').value.trim(),
    intake_sheet_id:      document.getElementById('adminSheetId').value.trim(),
    intake_tab_name:      document.getElementById('adminIntakeTab').value.trim() || 'Form responses 1',
    apps_script_url:      document.getElementById('adminAppsScript').value.trim(),
    google_key:           document.getElementById('adminGoogleKey').value.trim(),
    anthropic_key:        document.getElementById('adminAnthropicKey').value.trim(),
    collections_sheet_id: document.getElementById('adminCollectionsId').value.trim() || null,
  };

  // Validation
  const required = ['doctor_name', 'email', 'intake_sheet_id', 'apps_script_url'];
  if (!editId) required.push('google_key', 'anthropic_key');  // required on create

  for (const f of required) {
    if (!fields[f]) {
      showAdminMsg('Please fill in all required fields.', 'error');
      return;
    }
  }

  // Strip empty optional fields from update payload
  const payload = { ...fields };
  if (!payload.google_key)    delete payload.google_key;
  if (!payload.anthropic_key) delete payload.anthropic_key;
  if (!payload.collections_sheet_id) delete payload.collections_sheet_id;

  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    if (editId) {
      await API.updateDoctor(editId, payload);
      showAdminMsg('✓ Doctor updated successfully!', 'success');
    } else {
      await API.createDoctor(payload);
      showAdminMsg('✓ Doctor added! Now create their Supabase Auth account with this email at supabase.com → Authentication → Users → Add user.', 'success');
    }
    clearAdminForm();
    await loadAdminDoctors();
  } catch (err) {
    showAdminMsg('Error: ' + err.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = editId ? 'Update Doctor' : 'Save Doctor';
  }
}

function showAdminMsg(msg, type) {
  const el = document.getElementById('adminMsg');
  el.textContent   = msg;
  el.className     = 'admin-msg ' + type;
  el.style.display = 'block';
}

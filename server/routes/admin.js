const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');

const router = express.Router();

// Service role client - bypasses ALL RLS policies
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

router.use(requireAuth, requireAdmin);

/**
 * GET /api/admin/doctors
 */
router.get('/doctors', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('doctors')
      .select('id, doctor_name, email, intake_sheet_id, intake_tab_name, apps_script_url, collections_sheet_id, sheet_column_map, notify_phone, notify_email, notify_whatsapp_enabled, notify_email_enabled')
      .order('doctor_name');

    if (error) {
      console.error('Admin get doctors error:', error);
      throw error;
    }
    res.json({ doctors: data || [] });
  } catch (err) {
    console.error('Admin doctors route error:', err);
    res.status(500).json({ error: 'Could not load doctors: ' + err.message });
  }
});

/**
 * POST /api/admin/doctors
 * Creates doctor row + Supabase Auth account automatically.
 */
router.post('/doctors', async (req, res) => {
  const {
    doctor_name, email, password,
    intake_sheet_id, intake_tab_name,
    apps_script_url, google_key, anthropic_key,
    collections_sheet_id
  } = req.body;

  if (!doctor_name || !email || !password || !intake_sheet_id || !apps_script_url || !google_key || !anthropic_key) {
    return res.status(400).json({ error: 'Name, email, password, Sheet ID, Apps Script URL, Google key and Anthropic key are all required.' });
  }

  const cleanEmail = email.toLowerCase().trim();

  try {
    // 1. Create Supabase Auth account
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email:         cleanEmail,
      password:      password,
      email_confirm: true,
    });

    if (authErr && !authErr.message.toLowerCase().includes('already')) {
      return res.status(400).json({ error: 'Could not create login: ' + authErr.message });
    }

    // 2. Create doctors row
    const payload = {
      doctor_name,
      email:               cleanEmail,
      intake_sheet_id:     intake_sheet_id.trim(),
      intake_tab_name:     (intake_tab_name || 'Form responses 1').trim(),
      apps_script_url:     apps_script_url.trim(),
      google_key:          google_key.trim(),
      anthropic_key:       anthropic_key.trim(),
      collections_sheet_id: collections_sheet_id?.trim() || null,
    };

    const { data, error } = await supabaseAdmin.from('doctors').insert([payload]).select('id').single();
    if (error) throw error;

    res.status(201).json({
      ok: true,
      id: data.id,
      message: `✓ Doctor "${doctor_name}" added. Login account created automatically.`
    });
  } catch (err) {
    console.error('Create doctor error:', err);
    res.status(500).json({ error: 'Could not create doctor: ' + err.message });
  }
});

/**
 * PATCH /api/admin/doctors/:id
 */
router.patch('/doctors/:id', async (req, res) => {
  const allowed = ['doctor_name','email','intake_sheet_id','intake_tab_name',
                   'apps_script_url','google_key','anthropic_key','collections_sheet_id',
                   'sheet_column_map','notify_phone','notify_email',
                   'notify_whatsapp_enabled','notify_email_enabled'];
  const updates = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined && req.body[field] !== '') {
      updates[field] = field === 'email' ? req.body[field].toLowerCase().trim() : req.body[field];
    }
  }

  try {
    if (req.body.password) {
      const { data: doc } = await supabaseAdmin.from('doctors').select('email').eq('id', req.params.id).single();
      if (doc) {
        const { data: users } = await supabaseAdmin.auth.admin.listUsers();
        const authUser = users?.users?.find(u => u.email === doc.email);
        if (authUser) await supabaseAdmin.auth.admin.updateUserById(authUser.id, { password: req.body.password });
      }
    }
    if (Object.keys(updates).length > 0) {
      const { error } = await supabaseAdmin.from('doctors').update(updates).eq('id', req.params.id);
      if (error) throw error;
    }
    res.json({ ok: true, message: 'Doctor updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not update: ' + err.message });
  }
});

/**
 * GET /api/admin/doctors/:id/sheet-headers
 * Returns the first row (column headers) of the doctor's intake sheet.
 * Used by the admin UI to let the user pick which column contains each field.
 */
router.get('/doctors/:id/sheet-headers', async (req, res) => {
  try {
    const { getSheetsAuthHeader } = require('../utils/googleAuth');

    const { data: doctor, error } = await supabaseAdmin
      .from('doctors')
      .select('intake_sheet_id, intake_tab_name')
      .eq('id', req.params.id)
      .single();

    if (error || !doctor?.intake_sheet_id) {
      return res.status(404).json({ error: 'Doctor or sheet not found.' });
    }

    const tabName  = encodeURIComponent(doctor.intake_tab_name || 'Form responses 1');
    // Only fetch row 1 to get headers
    const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${doctor.intake_sheet_id}/values/${tabName}!1:1`;
    const authHeader = await getSheetsAuthHeader();

    const sheetRes = await fetch(sheetUrl, { headers: authHeader });
    if (!sheetRes.ok) {
      const errText = await sheetRes.text();
      console.error('Sheets API error (headers):', errText);
      return res.status(502).json({ error: 'Could not load sheet headers.' });
    }

    const data    = await sheetRes.json();
    const headers = (data.values && data.values[0]) ? data.values[0] : [];
    res.json({ headers });
  } catch (err) {
    console.error('Sheet headers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/admin/doctors/:id
 */
router.delete('/doctors/:id', async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('doctors').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete: ' + err.message });
  }
});

module.exports = router;

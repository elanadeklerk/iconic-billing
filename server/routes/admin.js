/**
 * /api/admin
 * Doctor management — only accessible to ADMIN_EMAIL.
 * All sensitive fields (google_key, anthropic_key) are handled here.
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');

const router = express.Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// All admin routes require both auth + admin role
router.use(requireAuth, requireAdmin);

/**
 * GET /api/admin/doctors
 * Returns all doctors (safe fields only — no API keys).
 */
router.get('/doctors', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('doctors')
      .select('id, doctor_name, email, intake_sheet_id, intake_tab_name, apps_script_url, collections_sheet_id')
      .order('doctor_name');

    if (error) throw error;
    res.json({ doctors: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'Could not load doctors: ' + err.message });
  }
});

/**
 * GET /api/admin/doctors/:id
 * Returns a single doctor's full config (including keys — admin only).
 */
router.get('/doctors/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('doctors')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Doctor not found.' });

    // Return everything except anthropic_key (never expose that even to admin UI)
    const { anthropic_key: _hidden, ...safe } = data;
    res.json({ doctor: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/doctors
 * Body: { doctor_name, email, intake_sheet_id, intake_tab_name,
 *         apps_script_url, google_key, anthropic_key, collections_sheet_id }
 */
router.post('/doctors', async (req, res) => {
  const { doctor_name, email, intake_sheet_id, apps_script_url, google_key, anthropic_key } = req.body;

  if (!doctor_name || !email || !intake_sheet_id || !apps_script_url || !google_key || !anthropic_key) {
    return res.status(400).json({ error: 'All required fields must be provided when creating a new doctor.' });
  }

  try {
    const payload = {
      doctor_name,
      email:               email.toLowerCase().trim(),
      intake_sheet_id:     intake_sheet_id.trim(),
      intake_tab_name:     (req.body.intake_tab_name || 'Form responses 1').trim(),
      apps_script_url:     apps_script_url.trim(),
      google_key:          google_key.trim(),
      anthropic_key:       anthropic_key.trim(),
      collections_sheet_id: req.body.collections_sheet_id?.trim() || null,
    };

    const { data, error } = await supabaseAdmin.from('doctors').insert([payload]).select('id').single();
    if (error) throw error;

    res.status(201).json({ ok: true, id: data.id, message: 'Doctor created. Now create their Supabase Auth account.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not create doctor: ' + err.message });
  }
});

/**
 * PATCH /api/admin/doctors/:id
 * Partial update — only updates fields that are provided.
 * anthropic_key is only updated if explicitly provided.
 */
router.patch('/doctors/:id', async (req, res) => {
  const allowed = ['doctor_name', 'email', 'intake_sheet_id', 'intake_tab_name',
                   'apps_script_url', 'google_key', 'anthropic_key', 'collections_sheet_id'];

  const updates = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined && req.body[field] !== '') {
      updates[field] = req.body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update.' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('doctors')
      .update(updates)
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ ok: true, message: 'Doctor updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not update doctor: ' + err.message });
  }
});

/**
 * DELETE /api/admin/doctors/:id
 */
router.delete('/doctors/:id', async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('doctors')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ ok: true, message: 'Doctor removed.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete doctor: ' + err.message });
  }
});

module.exports = router;

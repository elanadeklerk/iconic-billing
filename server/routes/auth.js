/**
 * /api/auth
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * POST /api/auth/login  — doctors only
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    // 1. Authenticate with Supabase
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: error.message });

    // 2. Verify a doctor profile exists
    const { data: doctor, error: drErr } = await supabaseAdmin
      .from('doctors')
      .select('id, doctor_name, email, intake_sheet_id, intake_tab_name, apps_script_url, collections_sheet_id')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (drErr || !doctor) {
      // Sign them back out — no profile, no access
      try { await supabaseAdmin.auth.admin.signOut(data.user.id); } catch (_) {}
      return res.status(403).json({ error: 'No doctor profile found for this account. Contact your administrator.' });
    }

    res.json({
      session: {
        access_token:  data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at:    data.session.expires_at,
      },
      doctor: {
        id:                   doctor.id,
        doctor_name:          doctor.doctor_name,
        email:                doctor.email,
        has_sheet:            !!(doctor.intake_sheet_id && doctor.apps_script_url),
        collections_sheet_id: doctor.collections_sheet_id || null,
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

/**
 * POST /api/auth/admin-login  — admin only, no doctors row needed
 */
router.post('/admin-login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  if (!adminEmail) {
    return res.status(503).json({ error: 'Admin email not configured on server.' });
  }
  if (email.toLowerCase().trim() !== adminEmail) {
    return res.status(403).json({ error: 'Access denied — not an admin account.' });
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: error.message });

    res.json({
      session: {
        access_token:  data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at:    data.session.expires_at,
      },
      isAdmin: true,
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await supabaseAdmin.auth.admin.signOut(req.user.id);
  } catch (_) {
    // Don't fail logout even if server-side revocation fails
  }
  res.json({ ok: true });
});

/**
 * GET /api/auth/me
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data: doctor } = await supabaseAdmin
      .from('doctors')
      .select('id, doctor_name, email, collections_sheet_id')
      .eq('email', req.user.email)
      .single();
    res.json({ doctor: doctor || null });
  } catch (err) {
    res.status(500).json({ error: 'Could not load profile.' });
  }
});

module.exports = router;

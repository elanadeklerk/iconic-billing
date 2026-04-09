/**
 * /api/auth
 * Proxies Supabase auth so the frontend never holds the service role key.
 * The anon key IS safe in the browser (it's public), but we centralise
 * auth here so we can add audit logging, MFA checks, etc. in future.
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// Public Supabase client (anon key) — used for sign-in only
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Admin Supabase client (service role) — used for fetching doctor config
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { session: { access_token, ... }, doctor: { doctor_name, ... } }
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: error.message });

    // Load doctor config (server-side — keys NEVER leave this function)
    const { data: doctor, error: drErr } = await supabaseAdmin
      .from('doctors')
      .select('id, doctor_name, email, intake_sheet_id, intake_tab_name, apps_script_url, collections_sheet_id')
      .eq('email', email)
      .single();

    if (drErr || !doctor) {
      return res.status(403).json({ error: 'No doctor profile found for this account. Contact your administrator.' });
    }

    // Return session token + safe doctor info (no API keys)
    res.json({
      session: {
        access_token:  data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at:    data.session.expires_at,
      },
      doctor: {
        id:                  doctor.id,
        doctor_name:         doctor.doctor_name,
        email:               doctor.email,
        has_sheet:           !!(doctor.intake_sheet_id && doctor.apps_script_url),
        collections_sheet_id: doctor.collections_sheet_id || null,
        // Note: intake_sheet_id, apps_script_url, google_key, anthropic_key
        // are NEVER sent to the browser. The server uses them directly.
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

/**
 * POST /api/auth/logout
 * Invalidates the session server-side.
 */
router.post('/logout', requireAuth, async (req, res) => {
  try {
    // Sign out using the admin client to ensure server-side revocation
    await supabaseAdmin.auth.admin.signOut(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    // Even if this fails, the client should clear its token
    res.json({ ok: true });
  }
});

/**
 * GET /api/auth/me
 * Returns the currently logged-in doctor's safe profile.
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data: doctor } = await supabaseAdmin
      .from('doctors')
      .select('id, doctor_name, email, collections_sheet_id')
      .eq('email', req.user.email)
      .single();

    res.json({ doctor });
  } catch (err) {
    res.status(500).json({ error: 'Could not load profile.' });
  }
});

module.exports = router;

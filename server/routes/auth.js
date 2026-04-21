const express  = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge:   8 * 60 * 60 * 1000,  // 8 hours
  path:     '/',
};

/** POST /api/auth/login */
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required.' });

  const cleanEmail = email.toLowerCase().trim();
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    if (error) return res.status(401).json({ error: error.message });

    const { data: doctor, error: drErr } = await supabaseAdmin
      .from('doctors')
      .select('id, doctor_name, email, intake_sheet_id, intake_tab_name, apps_script_url, collections_sheet_id, google_key')
      .ilike('email', cleanEmail).limit(1).single();

    if (drErr || !doctor) {
      try { await supabaseAdmin.auth.admin.signOut(data.user.id); } catch (_) {}
      return res.status(403).json({ error: 'No doctor profile found for this account.' });
    }

    // Set HttpOnly session cookie
    res.cookie('ib_session', data.session.access_token, COOKIE_OPTS);

    res.json({
      ok: true,
      doctor: {
        id:                   doctor.id,
        doctor_name:          doctor.doctor_name,
        email:                doctor.email,
        intake_sheet_id:      doctor.intake_sheet_id || null,
        has_sheet:            !!(doctor.intake_sheet_id && doctor.apps_script_url),
        collections_sheet_id: doctor.collections_sheet_id || null,
        has_google_key:       !!doctor.google_key,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

/** POST /api/auth/admin-login */
router.post('/admin-login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required.' });
  const cleanEmail = email.toLowerCase().trim();
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  // Allow if email matches env var OR doctor has is_admin = true in the database
  let isAllowed = cleanEmail === adminEmail;
  if (!isAllowed) {
    try {
      const { data } = await supabaseAdmin
        .from('doctors')
        .select('is_admin')
        .ilike('email', cleanEmail)
        .single();
      if (data?.is_admin === true) isAllowed = true;
    } catch (_) {}
  }
  if (!isAllowed) return res.status(403).json({ error: 'Access denied.' });
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    if (error) return res.status(401).json({ error: error.message });
    res.cookie('ib_session', data.session.access_token, COOKIE_OPTS);
    res.json({ ok: true, isAdmin: true });
  } catch (err) {
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

/** POST /api/auth/logout */
router.post('/logout', async (req, res) => {
  const token = req.cookies?.ib_session;
  if (token) {
    try {
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);
      if (user) await supabaseAdmin.auth.admin.signOut(user.id);
    } catch (_) {}
  }
  res.clearCookie('ib_session', { path: '/' });
  res.json({ ok: true });
});

/** GET /api/auth/me — heartbeat + session validation */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data: doctor } = await supabaseAdmin
      .from('doctors')
      .select('id, doctor_name, email, intake_sheet_id, collections_sheet_id, google_key')
      .ilike('email', req.user.email).single();
    res.json({ doctor: doctor || null });
  } catch (err) {
    res.status(500).json({ error: 'Could not load profile.' });
  }
});

module.exports = router;

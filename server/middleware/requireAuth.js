/**
 * requireAuth middleware — supports BOTH:
 *   1. HttpOnly cookie  (ib_session) — set by /api/auth/login
 *   2. Bearer token     (Authorization header) — legacy fallback
 *
 * Attach req.user = { id, email } for downstream routes.
 */
const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function requireAuth(req, res, next) {
  // Prefer HttpOnly cookie; fall back to Bearer header
  const token = req.cookies?.ib_session ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.split(' ')[1]
      : null);

  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      res.clearCookie('ib_session');
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    req.user  = { id: user.id, email: user.email };
    req.token = token;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Auth check failed.' });
  }
}

async function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
  const envAdmin = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  if (req.user.email.toLowerCase() === envAdmin) return next();
  // Also allow doctors with is_admin = true in the database
  try {
    const { data } = await supabaseAdmin
      .from('doctors')
      .select('is_admin')
      .eq('email', req.user.email)
      .single();
    if (data?.is_admin === true) return next();
  } catch (_) {}
  return res.status(403).json({ error: 'Admin access only.' });
}

module.exports = { requireAuth, requireAdmin };

/**
 * requireAuth middleware
 * Validates the Supabase JWT sent in the Authorization header.
 * Attaches req.user = { id, email } for downstream routes.
 */

const { createClient } = require('@supabase/supabase-js');

// Admin-level Supabase client (service role) — for server-side user verification
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verify the JWT with Supabase — this also checks expiry
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
    }

    req.user  = { id: user.id, email: user.email };
    req.token = token;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    return res.status(500).json({ error: 'Authentication check failed.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.user.email.toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: 'Admin access only.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };

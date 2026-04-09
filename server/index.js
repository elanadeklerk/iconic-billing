require('dotenv').config();
const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const authRoutes    = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const billingRoutes = require('./routes/billing');
const adminRoutes   = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security headers ─────────────────────────────────────────────
// Use helmet but with a relaxed CSP — the app is served from the same origin
// so 'self' covers all API calls. Fonts and iframes are the only exceptions.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      frameSrc:   ["'self'", 'https://docs.google.com'],
    }
  },
  crossOriginEmbedderPolicy: false,
}));

// ── CORS — same-origin app, so just allow self ───────────────────
// The frontend and API are the same Express server, so CORS only matters
// if you later split them. For now, allow all origins to avoid any CORS issues.
app.use(cors());

// ── Body parsing ─────────────────────────────────────────────────
app.use(express.json());

// ── Rate limiting ─────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
}));

app.use('/api/billing/extract', rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'AI rate limit reached. Please wait a moment.' }
}));

// ── API Routes ───────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/billing',  billingRoutes);
app.use('/api/admin',    adminRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Serve frontend static files ──────────────────────────────────
app.use(express.static(path.join(__dirname, '../client'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

// Serve index.html for all non-API routes
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// ── Start ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏥 Iconic Billing running on port ${PORT}`);
  console.log(`   NODE_ENV:    ${process.env.NODE_ENV || 'development'}`);
  console.log(`   ADMIN_EMAIL: ${process.env.ADMIN_EMAIL || '(not set)'}`);
  console.log(`   SUPABASE:    ${process.env.SUPABASE_URL ? 'configured' : '⚠ MISSING'}`);
  console.log(`   ANTHROPIC:   ${process.env.ANTHROPIC_API_KEY ? 'configured' : '(using per-doctor key)'}\n`);
});

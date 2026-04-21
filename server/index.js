require('dotenv').config();
const express     = require('express');
const cookieParser = require('cookie-parser');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const authRoutes    = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const billingRoutes = require('./routes/billing');
const adminRoutes   = require('./routes/admin');
const { startDigestScheduler } = require('./services/notifications');

const app  = express();
app.set('trust proxy', 1); // Required for Render — sits behind a reverse proxy
const PORT = process.env.PORT || 3000;

// ── Security headers ─────────────────────────────────────────────
// CSP is disabled — app is single-origin with inline onclick handlers.
// helmet still provides HSTS, X-Frame-Options, X-Content-Type-Options etc.
app.use(helmet({
  contentSecurityPolicy:    false,
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ─────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || true,
  credentials: true,
}));

// ── Cookie parsing ───────────────────────────────────────────────
app.use(cookieParser());

// ── Body parsing ─────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

// ── Serve frontend ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../client'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    // Service worker must not be cached
    if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-store');
  }
}));

app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// ── Start ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏥 Iconic Billing running on port ${PORT}`);
  console.log(`   NODE_ENV:    ${process.env.NODE_ENV || 'development'}`);
  console.log(`   ADMIN_EMAIL: ${process.env.ADMIN_EMAIL || '(not set)'}`);
  console.log(`   SUPABASE:    ${process.env.SUPABASE_URL ? 'configured ✅' : '⚠ MISSING'}`);
  console.log(`   ANTHROPIC:   ${process.env.ANTHROPIC_API_KEY ? 'configured ✅' : '(per-doctor key)'}\n`);
  // Start 2-hour billing digest email scheduler
  startDigestScheduler();
});

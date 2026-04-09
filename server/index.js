/**
 * Iconic Billing Portal — Backend Server
 * All secrets live here. The frontend is served as static files
 * and calls this server's API. No keys ever reach the browser.
 */

require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const authRoutes    = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const billingRoutes = require('./routes/billing');
const adminRoutes   = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security headers ──────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", 'https://cdn.jsdelivr.net'],          // Supabase JS CDN
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:'],
      connectSrc:  ["'self'"],                                       // All API calls go to THIS server
      frameSrc:    ["'self'", 'https://docs.google.com'],            // For collections sheet embed
    }
  },
  crossOriginEmbedderPolicy: false,   // needed for Google Sheets iframe
}));

// ── CORS ─────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGIN || 'https://yourdomain.com'
    : 'http://localhost:3000',
  credentials: true,
}));

// ── Body parsing ─────────────────────────────────────────────────
app.use(express.json());

// ── Rate limiting ─────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 100,                    // 100 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', apiLimiter);

// Stricter limit on the AI extraction endpoint (costs money per call)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 10,               // 10 AI calls per minute per IP
  message: { error: 'AI extraction rate limit reached. Please wait a moment.' }
});
app.use('/api/billing/extract', aiLimiter);

// ── API Routes ───────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/billing',  billingRoutes);
app.use('/api/admin',    adminRoutes);

// ── Health check ─────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Serve frontend ───────────────────────────────────────────────
// Cache-Control: no-store on HTML so browsers always re-fetch (patient data security)
app.use(express.static(path.join(__dirname, '../client'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  }
}));

// Catch-all → serve index.html for client-side routing
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// ── Start ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏥 Iconic Billing running on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Admin email: ${process.env.ADMIN_EMAIL}\n`);
});

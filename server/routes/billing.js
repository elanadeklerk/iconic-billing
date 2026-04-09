/**
 * /api/billing
 * Handles:
 *  POST /api/billing/extract  — AI billing code extraction via Anthropic
 *  POST /api/billing/submit   — Submit billing to doctor's Apps Script
 *  GET  /api/billing/recent   — Fetch recent billings from Apps Script
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Helper: get doctor's full config (with secrets) from DB
async function getDoctorConfig(email) {
  const { data, error } = await supabaseAdmin
    .from('doctors')
    .select('doctor_name, intake_sheet_id, apps_script_url, google_key, anthropic_key')
    .eq('email', email)
    .single();
  if (error) throw new Error('Doctor config not found.');
  return data;
}

/**
 * POST /api/billing/extract
 * Body: { transcript: string }
 * Returns: { tariff, icd10, modifier, notes }
 *
 * Uses the shared ANTHROPIC_API_KEY from .env (not per-doctor).
 * Falls back to per-doctor key in DB if env var not set.
 */
router.post('/extract', requireAuth, async (req, res) => {
  const { transcript } = req.body;
  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ error: 'Transcript is required.' });
  }

  // Use shared server key first, fall back to per-doctor key
  let anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    try {
      const doctor = await getDoctorConfig(req.user.email);
      anthropicKey = doctor.anthropic_key;
    } catch (_) {}
  }
  if (!anthropicKey) {
    return res.status(503).json({ error: 'AI service not configured. Contact your administrator.' });
  }

  try {
    const { default: fetch } = await import('node-fetch');

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':            'application/json',
        'x-api-key':               anthropicKey,
        'anthropic-version':       '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{
          role:    'user',
          content: `You are a South African medical billing assistant. Extract billing codes from the following transcript and return ONLY valid JSON in this exact format (no markdown, no explanation):
{"tariff": "code1, code2", "icd10": "code1, code2", "modifier": "code or empty string", "notes": "any additional clinical notes"}

Transcript: "${transcript.replace(/"/g, '\\"')}"`
        }]
      })
    });

    if (!aiRes.ok) {
      const errBody = await aiRes.text();
      console.error('Anthropic API error:', errBody);
      return res.status(502).json({ error: 'AI extraction failed. Please try again or use manual entry.' });
    }

    const aiData  = await aiRes.json();
    const rawText = aiData.content?.map(b => b.text || '').join('') || '';

    // Parse the JSON response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(422).json({ error: 'Could not parse AI response. Please use manual entry.' });
    }

    const extracted = JSON.parse(jsonMatch[0]);
    res.json({
      tariff:   extracted.tariff   || '',
      icd10:    extracted.icd10    || '',
      modifier: extracted.modifier || '',
      notes:    extracted.notes    || '',
    });

  } catch (err) {
    console.error('AI extraction error:', err.message);
    res.status(500).json({ error: 'AI extraction failed: ' + err.message });
  }
});

/**
 * POST /api/billing/submit
 * Body: { fileNo, patientName, dateOfService, fundingType, medAid, membNo,
 *         tariff, icd10, modifier, notes, wardVisits }
 * Forwards to the doctor's Apps Script and returns its response.
 */
router.post('/submit', requireAuth, async (req, res) => {
  const required = ['fileNo', 'patientName', 'dateOfService', 'tariff', 'icd10'];
  for (const field of required) {
    if (!req.body[field]) {
      return res.status(400).json({ error: `Missing required field: ${field}` });
    }
  }

  try {
    const doctor = await getDoctorConfig(req.user.email);
    if (!doctor.apps_script_url) {
      return res.status(422).json({ error: 'Billing submission not configured. Contact your administrator.' });
    }

    const { default: fetch } = await import('node-fetch');

    const payload = {
      timestamp:     new Date().toISOString(),
      fileNo:        req.body.fileNo,
      patientName:   req.body.patientName,
      dateOfService: req.body.dateOfService,
      fundingType:   req.body.fundingType   || '',
      medAid:        req.body.medAid        || '',
      membNo:        req.body.membNo        || '',
      tariff:        req.body.tariff,
      icd10:         req.body.icd10,
      modifier:      req.body.modifier      || '',
      notes:         req.body.notes         || '',
      wardVisits:    req.body.wardVisits     || '',
      doctorName:    doctor.doctor_name,
    };

    const scriptRes = await fetch(doctor.apps_script_url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (!scriptRes.ok) {
      return res.status(502).json({ error: 'Billing submission failed. Please try again.' });
    }

    const scriptData = await scriptRes.json().catch(() => ({ success: true }));
    res.json({ ok: true, data: scriptData });

  } catch (err) {
    console.error('Submit billing error:', err.message);
    res.status(500).json({ error: 'Submission failed: ' + err.message });
  }
});

/**
 * GET /api/billing/recent?limit=8
 * Returns recent billing entries from the doctor's Apps Script.
 */
router.get('/recent', requireAuth, async (req, res) => {
  const limit = parseInt(req.query.limit) || 8;

  try {
    const doctor = await getDoctorConfig(req.user.email);
    if (!doctor.apps_script_url) {
      return res.json({ billings: [] });
    }

    const { default: fetch } = await import('node-fetch');
    const url = `${doctor.apps_script_url}?mode=fetch&limit=${limit}`;

    const scriptRes = await fetch(url, { method: 'GET' });
    if (!scriptRes.ok) return res.json({ billings: [] });

    const data = await scriptRes.json().catch(() => ({ billings: [] }));
    res.json({ billings: data.billings || data.data || [] });

  } catch (err) {
    console.error('Recent billings error:', err.message);
    res.json({ billings: [] });
  }
});

module.exports = router;

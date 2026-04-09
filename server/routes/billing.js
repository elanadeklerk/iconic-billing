/**
 * /api/billing
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getDoctorConfig(email) {
  const { data, error } = await supabaseAdmin
    .from('doctors')
    .select('doctor_name, apps_script_url, anthropic_key')
    .eq('email', email)
    .single();
  if (error || !data) throw new Error('Doctor config not found.');
  return data;
}

/**
 * POST /api/billing/extract
 */
router.post('/extract', requireAuth, async (req, res) => {
  const { transcript } = req.body;
  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ error: 'Transcript is required.' });
  }

  let anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    try {
      const doctor = await getDoctorConfig(req.user.email);
      anthropicKey = doctor.anthropic_key;
    } catch (_) {}
  }
  if (!anthropicKey) {
    return res.status(503).json({ error: 'AI service not configured.' });
  }

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{
          role:    'user',
          content: `You are a South African medical billing assistant. Extract billing codes from the transcript below and return ONLY valid JSON with no markdown, no explanation:
{"tariff":"code1, code2","icd10":"code1, code2","modifier":"code or empty","notes":"any notes"}

Transcript: "${transcript.replace(/"/g, '\\"')}"`
        }]
      })
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      console.error('Anthropic error:', err);
      return res.status(502).json({ error: 'AI extraction failed. Use manual entry.' });
    }

    const aiData  = await aiRes.json();
    const rawText = (aiData.content || []).map(b => b.text || '').join('');
    const match   = rawText.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not parse AI response. Use manual entry.' });

    const extracted = JSON.parse(match[0]);
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
 */
router.post('/submit', requireAuth, async (req, res) => {
  const required = ['fileNo', 'patientName', 'dateOfService', 'tariff', 'icd10'];
  for (const field of required) {
    if (!req.body[field]) return res.status(400).json({ error: `Missing field: ${field}` });
  }

  try {
    const doctor = await getDoctorConfig(req.user.email);
    if (!doctor.apps_script_url) {
      return res.status(422).json({ error: 'Billing submission not configured.' });
    }

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

    if (!scriptRes.ok) return res.status(502).json({ error: 'Billing submission failed.' });

    const scriptData = await scriptRes.json().catch(() => ({ success: true }));
    res.json({ ok: true, data: scriptData });
  } catch (err) {
    console.error('Submit error:', err.message);
    res.status(500).json({ error: 'Submission failed: ' + err.message });
  }
});

/**
 * GET /api/billing/recent
 */
router.get('/recent', requireAuth, async (req, res) => {
  const limit = parseInt(req.query.limit) || 8;
  try {
    const doctor = await getDoctorConfig(req.user.email);
    if (!doctor.apps_script_url) return res.json({ billings: [] });

    const url = `${doctor.apps_script_url}?mode=fetch&limit=${limit}`;
    const scriptRes = await fetch(url);
    if (!scriptRes.ok) return res.json({ billings: [] });

    const data = await scriptRes.json().catch(() => ({ billings: [] }));
    res.json({ billings: data.billings || data.data || [] });
  } catch (err) {
    res.json({ billings: [] });
  }
});

module.exports = router;

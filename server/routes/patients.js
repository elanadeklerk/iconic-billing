/**
 * /api/patients
 * Fetches patient data from the doctor's linked Google Sheet.
 * The google_key is read from the database SERVER-SIDE only.
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../middleware/requireAuth');
const { getSheetsAuthHeader } = require('../utils/googleAuth');

const router = express.Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.get('/', requireAuth, async (req, res) => {
  try {
    const { data: doctor, error } = await supabaseAdmin
      .from('doctors')
      .select('intake_sheet_id, intake_tab_name, sheet_column_map')
      .eq('email', req.user.email)
      .single();

    if (error || !doctor) {
      return res.status(404).json({ error: 'Doctor configuration not found.' });
    }
    if (!doctor.intake_sheet_id) {
      return res.status(422).json({ error: 'Google Sheet not configured. Contact your administrator.' });
    }

    const tabName  = encodeURIComponent(doctor.intake_tab_name || 'Form responses 1');
    const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${doctor.intake_sheet_id}/values/${tabName}`;
    const authHeader = await getSheetsAuthHeader();

    const sheetRes = await fetch(sheetUrl, { headers: authHeader });

    if (!sheetRes.ok) {
      const errText = await sheetRes.text();
      console.error('Sheets API error:', errText);
      return res.status(502).json({ error: 'Could not load patient data from Google Sheets.' });
    }

    const sheetData = await sheetRes.json();
    const rows      = sheetData.values || [];

    if (rows.length < 2) return res.json({ patients: [] });

    // Build column index map — use per-doctor config if set, fall back to defaults
    const DEFAULT_COLS = { fileNo: 1, name: 2, funding: 10, medAid: 11, plan: 12, membNo: 13, depCode: 14 };
    const cols = Object.assign({}, DEFAULT_COLS, doctor.sheet_column_map || {});

    // Build patient list — deduplicate by fileNo (keep latest row per patient)
    // Form Responses 1 has one row per billing submission so same patient appears many times
    const seen = new Map();
    rows.slice(1).forEach(row => {
      const fileNo  = (row[cols.fileNo]  || '').trim();
      const name    = (row[cols.name]    || '').trim();
      const key     = fileNo || name.toLowerCase();
      if (!key) return;
      // Later rows may have more complete data — overwrite earlier entries
      seen.set(key, {
        fileNo,
        name,
        funding: (row[cols.funding] || '').trim(),
        medAid:  (row[cols.medAid]  || '').trim(),
        plan:    (row[cols.plan]    || '').trim(),
        membNo:  (row[cols.membNo]  || '').trim(),
        depCode: (row[cols.depCode] || '').trim(),
      });
    });

    const patients = [...seen.values()].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '')
    );

    res.json({ patients });
  } catch (err) {
    console.error('Patients fetch error:', err.message);
    res.status(500).json({ error: 'Failed to load patients: ' + err.message });
  }
});

/**
 * POST /api/patients/submit
 * Submits a new patient (scanned from sticker) to the doctor's intake Google Sheet.
 * Appends a row matching the Form Responses 1 structure.
 */
router.post('/submit', requireAuth, async (req, res) => {
  try {
    const { data: doctor, error } = await supabaseAdmin
      .from('doctors')
      .select('intake_sheet_id, apps_script_url')
      .eq('email', req.user.email)
      .single();

    if (error || !doctor?.apps_script_url) {
      return res.status(422).json({ error: 'Doctor not configured.' });
    }

    // Submit patient data through the Apps Script so it lands in Form Responses 1
    // We use a special "patientOnly" flag so the script doesn't create a billing row
    const payload = {
      timestamp:     new Date().toISOString(),
      fileNo:        req.body.fileNo        || '',
      patientName:   req.body.name          || req.body.patientName || '',
      dateOfService: new Date().toISOString().split('T')[0],
      fundingType:   req.body.funding       || 'Medical Aid',
      medAid:        req.body.medAid        || '',
      membNo:        req.body.membNo        || '',
      tariff:        'INTAKE',  // marker so billing log ignores this row
      icd10:         '',
      modifier:      '',
      notes:         'Patient registered via sticker scan — no billing yet',
      patientOnly:   true,
    };

    const scriptRes = await fetch(doctor.apps_script_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [payload] }),
    });

    res.json({ ok: scriptRes.ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

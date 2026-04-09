/**
 * /api/patients
 * Fetches patient data from the doctor's linked Google Sheet.
 * The google_key is read from the database SERVER-SIDE only.
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.get('/', requireAuth, async (req, res) => {
  try {
    const { data: doctor, error } = await supabaseAdmin
      .from('doctors')
      .select('intake_sheet_id, intake_tab_name, google_key')
      .eq('email', req.user.email)
      .single();

    if (error || !doctor) {
      return res.status(404).json({ error: 'Doctor configuration not found.' });
    }
    if (!doctor.intake_sheet_id || !doctor.google_key) {
      return res.status(422).json({ error: 'Google Sheet not configured. Contact your administrator.' });
    }

    const tabName  = encodeURIComponent(doctor.intake_tab_name || 'Form responses 1');
    const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${doctor.intake_sheet_id}/values/${tabName}?key=${doctor.google_key}`;

    const sheetRes = await fetch(sheetUrl);

    if (!sheetRes.ok) {
      const errText = await sheetRes.text();
      console.error('Sheets API error:', errText);
      return res.status(502).json({ error: 'Could not load patient data from Google Sheets.' });
    }

    const sheetData = await sheetRes.json();
    const rows      = sheetData.values || [];

    if (rows.length < 2) return res.json({ patients: [] });

    const patients = rows.slice(1).map(row => ({
      fileNo:  (row[1]  || '').trim(),
      name:    (row[2]  || '').trim(),
      funding: (row[10] || '').trim(),
      medAid:  (row[11] || '').trim(),
      plan:    (row[12] || '').trim(),
      membNo:  (row[13] || '').trim(),
      depCode: (row[14] || '').trim(),
    })).filter(p => p.fileNo || p.name);

    res.json({ patients });
  } catch (err) {
    console.error('Patients fetch error:', err.message);
    res.status(500).json({ error: 'Failed to load patients: ' + err.message });
  }
});

module.exports = router;

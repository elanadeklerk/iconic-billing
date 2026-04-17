/**
 * /api/billing
 * All routes that interact with the doctor's Apps Script and AI.
 * 
 * Dr Hlahla's Apps Script structure (representative for all doctors):
 * - doPost() appends to "Form Responses 1" with columns:
 *   [timestamp, fileNo, patientName, dateOfService, fundingType, medAid, membNo, tariff, icd10, modifier, notes]
 * - refreshBillingLog() builds "Billing Log" tab with financial tracking columns
 * - refreshCollections() builds "Collections Summary" tab
 * - Revenue data lives in "Billing Log": Amount Billed(col10), Amount Paid(col11), Status(col14)
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

async function getDoctorConfig(email) {
  const { data, error } = await supabaseAdmin
    .from('doctors')
    .select('doctor_name, apps_script_url, anthropic_key, intake_sheet_id, collections_sheet_id')
    .eq('email', email)
    .single();
  if (error || !data) throw new Error('Doctor config not found.');
  return data;
}

function getAnthropicKey(doctor) {
  return process.env.ANTHROPIC_API_KEY || doctor.anthropic_key || null;
}

/**
 * POST /api/billing/extract — AI code extraction from voice transcript
 */
router.post('/extract', requireAuth, async (req, res) => {
  const { transcript } = req.body;
  if (!transcript?.trim()) return res.status(400).json({ error: 'Transcript is required.' });
  try {
    const doctor = await getDoctorConfig(req.user.email);
    const key = getAnthropicKey(doctor);
    if (!key) return res.status(503).json({ error: 'AI service not configured.' });

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `You are a South African medical billing assistant. Extract billing codes from the doctor's dictation below.

Return ONLY valid JSON, no markdown, no explanation:
{"tariff":"","icd10":"","modifier":"","notes":""}

RULES:
- tariff: SAMA tariff codes — numbers only, comma-separated if multiple (e.g. "0190,0191"). Preserve leading zeros exactly as spoken (e.g. "0190" not "190").
- icd10: ICD-10 codes — ALWAYS uppercase letter+digits format (e.g. "J06.9", "M54.5"). Comma-separated if multiple. Map diagnosis names to their correct ICD-10 code.
- modifier: Modifier codes if explicitly mentioned. Empty string if none.
- notes: Brief clinical context not captured in codes.
- ONLY extract codes explicitly stated or clearly named by the doctor. Do NOT infer, assume, or add extra codes based on clinical context.
- If the doctor says a specific code number, use it exactly as spoken.
- Return ONLY the JSON object, nothing else.

Transcript: "${transcript.replace(/"/g, '\\"')}"`
        }]
      })
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('Anthropic error:', errText);
      return res.status(502).json({ error: 'AI extraction failed. Please use manual entry.' });
    }

    const aiData = await aiRes.json();
    const text   = (aiData.content || []).map(b => b.text || '').join('');
    const match  = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not parse AI response. Please use manual entry.' });

    const parsed = JSON.parse(match[0]);
    res.json({
      tariff:   parsed.tariff   || '',
      icd10:    parsed.icd10    || '',
      modifier: parsed.modifier || '',
      notes:    parsed.notes    || '',
    });
  } catch (err) {
    console.error('Extract error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/billing/scan-sticker — OCR hospital patient sticker via Claude Vision
 */
router.post('/scan-sticker', requireAuth, async (req, res) => {
  const { imageBase64, mediaType } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Image data required.' });
  try {
    const doctor = await getDoctorConfig(req.user.email);
    const key = getAnthropicKey(doctor);
    if (!key) return res.status(503).json({ error: 'AI service not configured.' });

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: `You are reading a South African hospital patient sticker. Extract patient info and return ONLY valid JSON:
{"fileNo":"","name":"","medAid":"","plan":"","membNo":"","depCode":"","idNo":"","cellNo":"","dob":""}

RULES:
- fileNo: hospital file/case number at top of sticker (e.g. "770810285")
- name: patient surname and first name (remove titles like MS/MR/DR)
- medAid: full medical aid scheme name (e.g. "Camaf", "Discovery Health", "Bonitas")
- plan: plan/option within the scheme (e.g. "Double Plus", "Executive")
- membNo: the membership NUMBER — on Camaf stickers look for the number after "#" (e.g. "03867 #7210161" → membNo="7210161"). NOT the WK or HM phone numbers. NOT the MEM name field
- depCode: dependant code, labeled "DEPEND CODE:" or "Dep:" (e.g. "02")
- idNo: 13-digit SA ID number starting with birth year digits (e.g. "7210160071088")
- cellNo: 10-digit phone number starting with 06/07/08 — from WK (work) or HM (home) fields
- dob: date of birth if labeled "DOB:" or "D.O.B:"
Use "" for any field not visible. Return ONLY the JSON.` }
          ]
        }]
      })
    });

    if (!aiRes.ok) return res.status(502).json({ error: 'Sticker scan failed. Please try again.' });

    const aiData = await aiRes.json();
    const text   = (aiData.content || []).map(b => b.text || '').join('');
    const match  = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not read sticker. Please try a clearer photo.' });

    const parsed = JSON.parse(match[0]);
    res.json({
      fileNo:  parsed.fileNo  || '',
      name:    parsed.name    || '',
      medAid:  parsed.medAid  || '',
      plan:    parsed.plan    || '',
      membNo:  parsed.membNo  || '',
      depCode: parsed.depCode || '',
      idNo:    parsed.idNo    || '',
      cellNo:  parsed.cellNo  || '',
      dob:     parsed.dob     || '',
      ward:    parsed.ward    || '',
    });
  } catch (err) {
    console.error('Sticker scan error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**

/**
 * POST /api/billing/transcribe
 * Receives base64 audio (MediaRecorder), sends to Claude for transcription + code extraction.
 * Works on all browsers that support MediaRecorder: Safari, Firefox, Chrome.
 */
router.post('/transcribe', requireAuth, async (req, res) => {
  const { audioBase64, mimeType } = req.body;
  if (!audioBase64) return res.status(400).json({ error: 'Audio data required.' });
  try {
    const doctor = await getDoctorConfig(req.user.email);
    const key    = getAnthropicKey(doctor);
    if (!key) return res.status(503).json({ error: 'AI not configured.' });

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 600,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: mimeType || 'audio/webm', data: audioBase64 } },
          { type: 'text', text: `You are an expert South African medical billing assistant. Listen to this doctor dictation and extract billing codes.
Return ONLY valid JSON: {"transcript":"","tariff":"","icd10":"","modifier":"","notes":""}
- transcript: verbatim what was said
- tariff: SAMA codes e.g. "0190". Multiple comma-separated. 0190=GP consult, 0191=extended, 0192=after hours, 0193=home visit
- icd10: ICD-10 codes e.g. "J06.9". Multiple comma-separated. Map diagnosis names to correct codes
- modifier: modifier codes if mentioned e.g. "0009". Empty if none
- notes: clinical context not captured above
Return ONLY the JSON object.` }
        ]}]
      })
    });

    if (!aiRes.ok) return res.status(502).json({ error: 'Transcription failed. Use manual entry.' });
    const aiData = await aiRes.json();
    const text   = (aiData.content || []).map(b => b.text || '').join('');
    const match  = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not parse response.' });
    const parsed = JSON.parse(match[0]);
    res.json({ transcript: parsed.transcript || '', tariff: parsed.tariff || '', icd10: parsed.icd10 || '', modifier: parsed.modifier || '', notes: parsed.notes || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/billing/submit
 *
 * Sends the main billing entry + each ward visit as a SEPARATE row
 * to the Apps Script doPost(), which appends to "Form Responses 1" and
 * then calls refreshBillingLog() and refreshCollections() automatically.
 *
 * Column order for doPost (from Dr Hlahla's Apps Script):
 * timestamp, fileNo, patientName, dateOfService, fundingType, medAid, membNo,
 * tariff, icd10, modifier, notes
 */
router.post('/submit', requireAuth, async (req, res) => {
  const required = ['fileNo', 'patientName', 'dateOfService', 'tariff', 'icd10'];
  for (const f of required) {
    if (!req.body[f]) return res.status(400).json({ error: `Missing required field: ${f}` });
  }

  try {
    const doctor = await getDoctorConfig(req.user.email);
    if (!doctor.apps_script_url) return res.status(422).json({ error: 'Billing not configured. Contact your administrator.' });

    // Parse ward visits
    let wardVisits = [];
    if (req.body.wardVisits) {
      try { wardVisits = JSON.parse(req.body.wardVisits); } catch (_) {}
    }

    // Build ward visits summary for the notes field (single row, no looping)
    let notesField = req.body.notes || '';
    if (wardVisits.length > 0) {
      const wardDates  = wardVisits.map(v => v.date).join(', ');
      const wardTariff = wardVisits[0].tariff;
      const wardIcd10  = wardVisits[0].icd10;
      const wardSummary = `Ward visits: ${wardDates} | Tariff: ${wardTariff} | ICD-10: ${wardIcd10}`;
      notesField = notesField ? `${notesField} | ${wardSummary}` : wardSummary;
    }

    // Single row — ward visit dates + codes go into the notes column
    const payload = {
      timestamp:     new Date().toISOString(),
      fileNo:        req.body.fileNo,
      patientName:   req.body.patientName,
      dateOfService: req.body.dateOfService,
      fundingType:   req.body.fundingType || '',
      medAid:        req.body.medAid      || '',
      membNo:        req.body.membNo      || '',
      tariff:        String(req.body.tariff  || '').trim(),
      icd10:         String(req.body.icd10   || '').trim(),
      modifier:      String(req.body.modifier || '').trim(),
      notes:         notesField,
    };

    const mainRes = await fetch(doctor.apps_script_url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!mainRes.ok) return res.status(502).json({ error: 'Billing submission failed. Please try again.' });

    res.json({
      ok:       true,
      rowCount: 1,
      hasWard:  wardVisits.length > 0,
    });
  } catch (err) {
    console.error('Submit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/billing/recent
 * Fetches recent billings from Apps Script (doGet with mode=fetch)
 */
router.get('/recent', requireAuth, async (req, res) => {
  const limit = parseInt(req.query.limit) || 8;
  try {
    const doctor = await getDoctorConfig(req.user.email);
    if (!doctor.apps_script_url) return res.json({ billings: [] });
    const r = await fetch(`${doctor.apps_script_url}?mode=fetch&limit=${limit}`);
    if (!r.ok) return res.json({ billings: [] });
    const data = await r.json().catch(() => ({}));
    res.json({ billings: data.billings || [] });
  } catch (_) {
    res.json({ billings: [] });
  }
});


/**
 * GET /api/billing/stats
 * Reads directly from Billing Log tab for accurate dashboard stats.
 * Returns today count, week count, recent billings list.
 */
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const { data: doctor } = await supabaseAdmin
      .from('doctors')
      .select('intake_sheet_id, collections_sheet_id, doctor_name')
      .eq('email', req.user.email)
      .single();

    const statsSheetId = doctor?.collections_sheet_id || doctor?.intake_sheet_id;
    if (!statsSheetId) {
      return res.json({ available: false, today: 0, week: 0, recent: [] });
    }

    const tabName    = encodeURIComponent('Billing Log');
    const url        = `https://sheets.googleapis.com/v4/spreadsheets/${statsSheetId}/values/${tabName}`;
    const authHeader = await getSheetsAuthHeader();
    const r          = await fetch(url, { headers: authHeader });
    if (!r.ok) return res.json({ available: false, today: 0, week: 0, recent: [] });

    const data = await r.json();
    const rows = data.values || [];
    if (rows.length < 2) return res.json({ available: true, today: 0, week: 0, recent: [] });

    // Known column positions from the Apps Script refreshBillingLog():
    // 0=FileNo, 1=PatientName, 2=FundingType, 3=MedAid, 6=DateOfService
    // 7=Tariff, 8=ICD10, 10=AmountBilled, 11=AmountPaid, 14=Status

    const todayStr = new Date().toISOString().split('T')[0];
    // "This week" = Monday 00:00 to now (ISO week, Mon-Sun)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon ... 6=Sat
    const daysToMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // days back to Monday
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - daysToMon);
    weekStart.setHours(0, 0, 0, 0);

    let todayCount = 0, weekCount = 0;
    const recent = [];

    rows.slice(1).forEach(row => {
      const dosRaw = (row[6] || '').toString().trim();
      if (!dosRaw) return;

      // Parse date - handles "2025-03-27", "27/03/2025", "03/27/2025"
      let dos = null;
      if (/\d{4}-\d{2}-\d{2}/.test(dosRaw)) {
        dos = new Date(dosRaw);
      } else if (/\d{2}\/\d{2}\/\d{4}/.test(dosRaw)) {
        const [a, b, y] = dosRaw.split('/');
        // Try both DD/MM and MM/DD
        dos = new Date(`${y}-${a.padStart(2,'0')}-${b.padStart(2,'0')}`);
        if (isNaN(dos)) dos = new Date(`${y}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`);
      }

      if (!dos || isNaN(dos)) return;
      const dosStr = dos.toISOString().split('T')[0];

      if (dosStr === todayStr) todayCount++;
      if (dos >= weekStart)    weekCount++;

      recent.push({
        fileNo:   (row[0]  || '').toString(),
        patient:  (row[1]  || '').toString(),
        funding:  (row[2]  || '').toString(),
        medAid:   (row[3]  || '').toString(),
        dos:      dosStr,
        tariff:   (row[7]  || '').toString(),
        icd10:    (row[8]  || '').toString(),
        billed:   parseFloat((row[10] || '').toString().replace(/[R,\s]/g,'')) || 0,
        paid:     parseFloat((row[11] || '').toString().replace(/[R,\s]/g,'')) || 0,
        status:   (row[14] || '').toString(),
      });
    });

    // Sort most recent first
    recent.sort((a, b) => b.dos.localeCompare(a.dos));

    res.json({
      available: true,
      today:     todayCount,
      week:      weekCount,
      recent:    recent.slice(0, 12),
    });
  } catch (err) {
    console.error('Stats error:', err.message);
    res.json({ available: false, today: 0, week: 0, recent: [] });
  }
});

/**
 * GET /api/billing/status
 *
 * Returns ALL rows from the Billing Log tab for the Patient Status screen.
 * Unlike /stats which caps at 12, this returns every patient record.
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const doctor  = await getDoctorConfig(req.user.email);
    const sheetId = doctor.collections_sheet_id || doctor.intake_sheet_id;
    if (!sheetId) return res.json({ available: false, patients: [] });

    const tabName    = encodeURIComponent('Billing Log');
    const url        = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${tabName}`;
    const authHeader = await getSheetsAuthHeader();
    const r          = await fetch(url, { headers: authHeader });
    if (!r.ok) return res.json({ available: false, patients: [] });

    const data = await r.json();
    const rows = (data.values || []).slice(1); // skip header row

    const patients = rows
      .filter(row => row[0] || row[1]) // skip empty rows
      .map(row => ({
        fileNo:      (row[0]  || '').toString(),
        patient:     (row[1]  || '').toString(),
        funding:     (row[2]  || '').toString(),
        medAid:      (row[3]  || '').toString(),
        dos:         (row[6]  || '').toString(),
        tariff:      (row[7]  || '').toString(),
        icd10:       (row[8]  || '').toString(),
        billed:      parseFloat((row[10] || '').toString().replace(/[R,\s]/g, '')) || 0,
        paid:        parseFloat((row[11] || '').toString().replace(/[R,\s]/g, '')) || 0,
        outstanding: parseFloat((row[12] || '').toString().replace(/[R,\s]/g, '')) || 0,
        status:      (row[14] || 'Unbilled').toString(),
      }));

    // Most recent date of service first
    patients.sort((a, b) => b.dos.localeCompare(a.dos));

    res.json({ available: true, patients });
  } catch (err) {
    console.error('Status error:', err.message);
    res.json({ available: false, patients: [] });
  }
});

/**
 * GET /api/billing/revenue
 *
 * Reads the "Billing Log" tab from the doctor's Google Sheet.
 * This tab is maintained by the Apps Script's refreshBillingLog() function.
 *
 * Billing Log columns (0-indexed):
 *  0: File No        1: Patient Name    2: Funding Type
 *  3: Medical Aid    4: Plan/Option     5: Membership No
 *  6: Date of Service 7: Tariff        8: ICD-10
 *  9: Modifiers      10: Amount Billed  11: Amount Paid
 *  12: Outstanding   13: Payment Date  14: Status       15: Notes
 */
router.get('/revenue', requireAuth, async (req, res) => {
  try {
    const { data: doctor } = await supabaseAdmin
      .from('doctors')
      .select('intake_sheet_id, collections_sheet_id, doctor_name')
      .eq('email', req.user.email)
      .single();

    const revenueSheetId = doctor?.collections_sheet_id || doctor?.intake_sheet_id;
    if (!revenueSheetId) {
      return res.json({
        available: false,
        message: 'Google Sheet not configured. Contact your administrator.',
      });
    }

    // Read the "Billing Log" tab — this is where the financial data lives
    const tabName    = encodeURIComponent('Billing Log');
    const url        = `https://sheets.googleapis.com/v4/spreadsheets/${revenueSheetId}/values/${tabName}`;
    const authHeader = await getSheetsAuthHeader();
    console.log(`Revenue: reading Billing Log from sheet ${revenueSheetId}`);
    const sheetRes   = await fetch(url, { headers: authHeader });

    if (!sheetRes.ok) {
      // Billing Log might not exist yet (needs at least one submission + refresh)
      const errText = await sheetRes.text();
      console.error('Billing Log read error:', errText);
      return res.json({
        available: false,
        message: 'Billing Log not found. Submit at least one billing entry first, then open the sheet and run Billing → Refresh All.',
      });
    }

    const sheetData = await sheetRes.json();
    const rows = sheetData.values || [];

    if (rows.length < 2) {
      return res.json({
        available: true,
        invoiced: 0, claimed: 0, paid: 0, outstanding: 0,
        claims: { rejected: 0, inProgress: 0, paid: 0, total: 0 },
        recent: [],
        sheetName: doctor.doctor_name + ' — Billing Log',
        detectedColumns: rows[0] || [],
      });
    }

    const header = rows[0];
    console.log('Billing Log headers:', header);

    // Known column positions from the Apps Script (0-indexed)
    // These are fixed because we know the exact structure
    const COL = {
      fileNo:     0,
      patient:    1,
      funding:    2,
      medAid:     3,
      dos:        6,
      tariff:     7,
      billed:    10,
      paid:      11,
      outstanding: 12,
      status:    14,
      notes:     15,
    };

    const parseAmt = v => {
      if (!v || v === '' || v === 'R 0.00') return 0;
      const n = parseFloat(String(v).replace(/[R,\s]/g, ''));
      return isNaN(n) ? 0 : n;
    };

    let totalBilled = 0, totalPaid = 0, totalOutstanding = 0;
    const recentRows = [];
    const statusCounts = {};

    rows.slice(1).forEach(row => {
      const billed      = parseAmt(row[COL.billed]);
      const paid        = parseAmt(row[COL.paid]);
      const outstanding = parseAmt(row[COL.outstanding]) || Math.max(0, billed - paid);
      const status      = (row[COL.status] || '').toString().trim();

      totalBilled      += billed;
      totalPaid        += paid;
      totalOutstanding += outstanding;

      if (status) {
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      }

      recentRows.push({
        patient:     (row[COL.patient]  || '—').toString(),
        date:        (row[COL.dos]      || '').toString(),
        status:      status,
        medAid:      (row[COL.medAid]   || '').toString(),
        billed,
        paid,
        outstanding,
        // invoiced = billed for compatibility with frontend
        invoiced:    billed,
        claimed:     billed, // claimed = billed in this system
      });
    });

    // Recent = last 12 rows (sheet is newest-last, so reverse)
    const recent = [...recentRows].reverse().slice(0, 12);

    // Status breakdown
    const rejected   = rows.slice(1).filter(r => /reject|denied/i.test(r[COL.status] || '')).length;
    const inProgress = rows.slice(1).filter(r => /unbilled|billed|submitted|process|awaiting|call|re-process/i.test(r[COL.status] || '')).length;
    const paidCount  = rows.slice(1).filter(r => /^paid$|settled|partial/i.test(r[COL.status] || '')).length;

    res.json({
      available:    true,
      sheetName:    doctor.doctor_name + ' — Billing Log',
      invoiced:     totalBilled,
      claimed:      totalBilled,
      paid:         totalPaid,
      outstanding:  totalOutstanding,
      claims: {
        rejected,
        inProgress,
        paid:  paidCount,
        total: rows.length - 1,
      },
      recent,
      statusBreakdown: statusCounts,
      detectedColumns: header,
    });
  } catch (err) {
    console.error('Revenue error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/billing/collections
 *
 * Reads the Billing Log tab and computes a full collections/ageing analysis
 * server-side using the service account — no Google login required in-app.
 *
 * Returns: totals, ageing buckets, by-funding breakdown, by-status breakdown,
 *          and an outstanding-patient list sorted oldest → newest.
 */
router.get('/collections', requireAuth, async (req, res) => {
  try {
    const doctor  = await getDoctorConfig(req.user.email);
    const sheetId = doctor.collections_sheet_id || doctor.intake_sheet_id;
    if (!sheetId) return res.json({ available: false });

    const tabName    = encodeURIComponent('Billing Log');
    const url        = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${tabName}`;
    const authHeader = await getSheetsAuthHeader();
    const r          = await fetch(url, { headers: authHeader });
    if (!r.ok) return res.json({ available: false, message: 'Billing Log not found. Run Billing → Refresh All in the sheet first.' });

    const sheetData = await r.json();
    const rows      = (sheetData.values || []).slice(1).filter(row => row[0] || row[1]);
    if (!rows.length) return res.json({ available: true, empty: true, totals: {}, ageing: {}, byFunding: [], byStatus: [], outstanding: [] });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const parseAmt = v => { const n = parseFloat(String(v || '').replace(/[R,\s]/g, '')); return isNaN(n) ? 0 : n; };
    const parseDos = s => {
      s = String(s || '').trim();
      if (/\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s);
      if (/\d{2}\/\d{2}\/\d{4}/.test(s)) {
        const [a, b, y] = s.split('/');
        const d1 = new Date(`${y}-${a}-${b}`);
        return isNaN(d1) ? new Date(`${y}-${b}-${a}`) : d1;
      }
      return null;
    };

    let totalBilled = 0, totalPaid = 0, totalOutstanding = 0;
    const ageing    = { d0: 0, d30: 0, d60: 0, d90: 0, d120: 0 };
    const byFunding = {};
    const byStatus  = {};
    const outstanding = [];

    rows.forEach(row => {
      const billed  = parseAmt(row[10]);
      const paid    = parseAmt(row[11]);
      const owed    = Math.max(0, parseAmt(row[12]) || (billed - paid));
      const status  = (row[14] || 'Unbilled').toString().trim();
      const funding = (row[2]  || 'Unknown').toString().trim();
      const dos     = parseDos(row[6]);

      totalBilled      += billed;
      totalPaid        += paid;
      totalOutstanding += owed;

      if (owed > 0 && dos && !isNaN(dos)) {
        const age = Math.floor((today - dos) / 86400000);
        if      (age <= 30)  ageing.d0   += owed;
        else if (age <= 60)  ageing.d30  += owed;
        else if (age <= 90)  ageing.d60  += owed;
        else if (age <= 120) ageing.d90  += owed;
        else                 ageing.d120 += owed;

        outstanding.push({
          fileNo:  (row[0] || '').toString(),
          patient: (row[1] || '').toString(),
          funding,
          medAid:  (row[3] || '').toString(),
          dos:     dos.toISOString().split('T')[0],
          age,
          billed,
          paid,
          outstanding: owed,
          status,
        });
      }

      if (!byFunding[funding]) byFunding[funding] = { billed: 0, paid: 0, outstanding: 0 };
      byFunding[funding].billed      += billed;
      byFunding[funding].paid        += paid;
      byFunding[funding].outstanding += owed;

      if (!byStatus[status]) byStatus[status] = { count: 0, outstanding: 0 };
      byStatus[status].count++;
      byStatus[status].outstanding += owed;
    });

    // Sort outstanding oldest first
    outstanding.sort((a, b) => b.age - a.age);

    res.json({
      available: true,
      doctorName: doctor.doctor_name || '',
      totals: { billed: totalBilled, paid: totalPaid, outstanding: totalOutstanding },
      ageing,
      byFunding: Object.entries(byFunding).map(([name, v]) => ({ name, ...v }))
                       .sort((a, b) => b.outstanding - a.outstanding),
      byStatus:  Object.entries(byStatus).map(([name, v])  => ({ name, ...v }))
                       .sort((a, b) => b.outstanding - a.outstanding),
      outstanding,
    });
  } catch (err) {
    console.error('Collections error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

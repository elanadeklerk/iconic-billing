/**
 * Billing notification service — Email digest via Resend
 *
 * Instead of sending an email per submission, entries are queued in Supabase.
 * Every 2 hours the server flushes the queue and sends one digest email per
 * doctor. If a doctor has no queued entries, nothing is sent.
 *
 * Required env vars:
 *   RESEND_API_KEY      — resend.com → API Keys
 *   RESEND_FROM_EMAIL   — e.g. "notifications@iconicbilling.co.za"
 *
 * Required Supabase table (run once):
 *   CREATE TABLE notification_queue (
 *     id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     doctor_email    text NOT NULL,
 *     doctor_name     text,
 *     notify_email    text NOT NULL,
 *     sheet_url       text,
 *     patient_name    text,
 *     date_of_service text,
 *     tariff          text,
 *     icd10           text,
 *     auth_no         text,
 *     notes           text,
 *     created_at      timestamptz DEFAULT now()
 *   );
 */

const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ─── Queue a single billing entry ─────────────────────────────────────────

async function queueBillingNotification({ doctor, billing }) {
  if (!doctor.notify_email_enabled || !doctor.notify_email) return;

  const supabase = getSupabase();
  const sheetUrl = doctor.collections_sheet_id
    ? `https://docs.google.com/spreadsheets/d/${doctor.collections_sheet_id}`
    : '';

  const { error } = await supabase.from('notification_queue').insert({
    doctor_email:    doctor.email || '',
    doctor_name:     doctor.doctor_name || '',
    notify_email:    doctor.notify_email,
    sheet_url:       sheetUrl,
    patient_name:    billing.patientName,
    date_of_service: billing.dateOfService,
    tariff:          billing.tariff,
    icd10:           billing.icd10,
    auth_no:         billing.authNo  || '',
    notes:           billing.notes   || '',
  });

  if (error) {
    console.error('[Notify] Queue insert failed:', error.message);
  } else {
    console.log(`[Notify] Queued entry for ${billing.patientName} → digest to ${doctor.notify_email}`);
  }
}

// ─── Build digest HTML email ───────────────────────────────────────────────

function buildDigestHtml({ doctorName, entries, sheetUrl }) {
  const entryRows = entries.map((e, i) => {
    const surname = (e.patient_name || '').trim().split(/\s+/).pop();
    const extras = [
      e.auth_no ? `Auth: ${e.auth_no}` : '',
      e.notes   ? `Notes: ${e.notes}`  : '',
    ].filter(Boolean).join(' · ');

    return `
      <tr style="background:${i % 2 === 0 ? '#0d1a2e' : '#0a1525'}">
        <td style="padding:11px 14px;font-size:13px;color:#e8edf2;font-weight:600;">${surname}</td>
        <td style="padding:11px 14px;font-size:13px;color:#a0b4c8;">${e.date_of_service || '—'}</td>
        <td style="padding:11px 14px;font-size:13px;color:#00c2ff;">${e.tariff || '—'}</td>
        <td style="padding:11px 14px;font-size:13px;color:#a0b4c8;">${e.icd10 || '—'}</td>
        <td style="padding:11px 14px;font-size:12px;color:#6a8099;">${extras || '—'}</td>
      </tr>`;
  }).join('');

  const now = new Date().toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:20px;background:#060d1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:680px;margin:0 auto;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0055cc,#00aaff);border-radius:16px 16px 0 0;padding:28px 32px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;
                  color:rgba(255,255,255,0.6);margin-bottom:6px;">Iconic Billing · Digest</div>
      <div style="font-size:22px;font-weight:700;color:#fff;">Billing Summary</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:4px;">
        ${doctorName} · ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} · ${now}
      </div>
    </div>

    <!-- Table -->
    <div style="background:#0d1a2e;border:1px solid #1a2d45;border-top:none;border-radius:0 0 16px 16px;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#071020;">
            <th style="padding:10px 14px;font-size:10px;font-weight:700;letter-spacing:0.1em;
                       text-transform:uppercase;color:#4a6a8a;text-align:left;">Patient</th>
            <th style="padding:10px 14px;font-size:10px;font-weight:700;letter-spacing:0.1em;
                       text-transform:uppercase;color:#4a6a8a;text-align:left;">Date</th>
            <th style="padding:10px 14px;font-size:10px;font-weight:700;letter-spacing:0.1em;
                       text-transform:uppercase;color:#4a6a8a;text-align:left;">Tariff</th>
            <th style="padding:10px 14px;font-size:10px;font-weight:700;letter-spacing:0.1em;
                       text-transform:uppercase;color:#4a6a8a;text-align:left;">ICD-10</th>
            <th style="padding:10px 14px;font-size:10px;font-weight:700;letter-spacing:0.1em;
                       text-transform:uppercase;color:#4a6a8a;text-align:left;">Notes</th>
          </tr>
        </thead>
        <tbody>${entryRows}</tbody>
      </table>

      <div style="padding:20px 32px;">
        ${sheetUrl ? `
        <a href="${sheetUrl}"
           style="display:inline-block;padding:13px 26px;
                  background:linear-gradient(135deg,#0066ff,#00c2ff);
                  color:#fff;border-radius:10px;text-decoration:none;
                  font-weight:600;font-size:14px;">
          View Google Sheet →
        </a>` : ''}
        <div style="margin-top:20px;font-size:11px;color:#3a5068;">
          Iconic Billing — automated 2-hour digest · ${now}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ─── Send one digest email ─────────────────────────────────────────────────

async function sendDigestEmail({ toEmail, doctorName, entries, sheetUrl }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from   = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    console.warn('[Notify] Resend env vars not set — skipping digest');
    return;
  }

  const count = entries.length;
  const html  = buildDigestHtml({ doctorName, entries, sheetUrl });

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from,
      to:      [toEmail],
      subject: `Billing digest — ${count} entr${count === 1 ? 'y' : 'ies'} — ${new Date().toLocaleDateString('en-ZA')}`,
      html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend error: ${errText}`);
  }

  console.log(`[Notify] Digest sent → ${toEmail} (${count} entries for ${doctorName})`);
}

// ─── Flush the queue — called every 2 hours ────────────────────────────────

async function flushNotificationQueue() {
  const supabase = getSupabase();

  // Fetch all queued entries
  const { data: entries, error } = await supabase
    .from('notification_queue')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Notify] Queue fetch failed:', error.message);
    return;
  }

  if (!entries || entries.length === 0) {
    console.log('[Notify] Digest check — queue empty, nothing to send.');
    return;
  }

  // Group entries by notify_email (one digest per recipient)
  const grouped = {};
  for (const entry of entries) {
    const key = entry.notify_email;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(entry);
  }

  const sentIds = [];

  for (const [toEmail, doctorEntries] of Object.entries(grouped)) {
    const first = doctorEntries[0];
    try {
      await sendDigestEmail({
        toEmail,
        doctorName: first.doctor_name || 'Doctor',
        entries:    doctorEntries,
        sheetUrl:   first.sheet_url  || '',
      });
      sentIds.push(...doctorEntries.map(e => e.id));
    } catch (err) {
      console.error(`[Notify] Digest failed for ${toEmail}:`, err.message);
    }
  }

  // Delete only successfully sent entries
  if (sentIds.length > 0) {
    const { error: delError } = await supabase
      .from('notification_queue')
      .delete()
      .in('id', sentIds);

    if (delError) console.error('[Notify] Queue cleanup failed:', delError.message);
    else console.log(`[Notify] Cleared ${sentIds.length} queued entries.`);
  }
}

// ─── Start the 2-hour digest scheduler ────────────────────────────────────

const TWO_HOURS = 2 * 60 * 60 * 1000;

function startDigestScheduler() {
  console.log('[Notify] Digest scheduler started — fires every 2 hours.');
  // Fire once after 2 hours, then repeat
  setInterval(() => {
    flushNotificationQueue().catch(e => console.error('[Notify] Flush error:', e.message));
  }, TWO_HOURS);
}

module.exports = { queueBillingNotification, startDigestScheduler, flushNotificationQueue };

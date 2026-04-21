/**
 * Billing notification service — Email via Resend
 * Sends an email to the doctor when a billing entry is submitted.
 *
 * Required env vars:
 *   RESEND_API_KEY      — resend.com → API Keys
 *   RESEND_FROM_EMAIL   — e.g. "notifications@iconicbilling.co.za" (verified domain in Resend)
 */

async function sendEmail({ to, patientName, dateOfService, tariff, icd10, authNo, notes, sheetUrl, doctorName }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from   = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    console.warn('[Notify] RESEND_API_KEY or RESEND_FROM_EMAIL not set — skipping');
    return;
  }
  if (!to) return;

  const surname = patientName.trim().split(/\s+/).pop();

  const rows = [
    ['Patient',   patientName],
    ['Date',      dateOfService],
    ['Tariff',    tariff],
    ['ICD-10',    icd10],
    ...(authNo ? [['Auth No', authNo]] : []),
    ...(notes  ? [['Notes',   notes]]  : []),
  ];

  const tableRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:10px 0;color:#7a8aa0;font-size:12px;text-transform:uppercase;
                 letter-spacing:0.08em;white-space:nowrap;vertical-align:top;width:110px;">
        ${label}
      </td>
      <td style="padding:10px 0;font-size:14px;color:#e8edf2;font-weight:500;">
        ${value}
      </td>
    </tr>
    <tr><td colspan="2" style="border-bottom:1px solid #1e2d40;padding:0;"></td></tr>
  `).join('');

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:20px;background:#060d1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:0 auto;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0055cc,#00aaff);border-radius:16px 16px 0 0;padding:28px 32px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;
                  color:rgba(255,255,255,0.6);margin-bottom:6px;">Iconic Billing</div>
      <div style="font-size:22px;font-weight:700;color:#fff;">New Billing Entry</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:4px;">${doctorName}</div>
    </div>

    <!-- Body -->
    <div style="background:#0d1a2e;border:1px solid #1a2d45;border-top:none;
                border-radius:0 0 16px 16px;padding:28px 32px;">
      <table style="width:100%;border-collapse:collapse;">
        ${tableRows}
      </table>

      ${sheetUrl ? `
      <a href="${sheetUrl}"
         style="display:inline-block;margin-top:24px;padding:13px 26px;
                background:linear-gradient(135deg,#0066ff,#00c2ff);
                color:#fff;border-radius:10px;text-decoration:none;
                font-weight:600;font-size:14px;letter-spacing:0.01em;">
        View Google Sheet →
      </a>` : ''}

      <div style="margin-top:28px;padding-top:20px;border-top:1px solid #1e2d40;
                  font-size:11px;color:#3a5068;">
        Iconic Billing — automated billing notification
      </div>
    </div>
  </div>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from,
      to:      [to],
      subject: `Billing submitted — ${surname} — ${dateOfService}`,
      html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend error: ${errText}`);
  }

  console.log(`[Notify] Email sent → ${to} (${surname})`);
}

/**
 * Main entry point — fires email notification non-blocking.
 * Called after a successful Google Sheets submission.
 */
function sendBillingNotifications({ doctor, billing }) {
  const sheetUrl = doctor.collections_sheet_id
    ? `https://docs.google.com/spreadsheets/d/${doctor.collections_sheet_id}`
    : '';

  if (doctor.notify_email_enabled && doctor.notify_email) {
    sendEmail({
      to:            doctor.notify_email,
      patientName:   billing.patientName,
      dateOfService: billing.dateOfService,
      tariff:        billing.tariff,
      icd10:         billing.icd10,
      authNo:        billing.authNo  || '',
      notes:         billing.notes   || '',
      sheetUrl,
      doctorName:    doctor.doctor_name,
    }).catch(e => console.error('[Notify] Email failed:', e.message));
  }
}

module.exports = { sendBillingNotifications };

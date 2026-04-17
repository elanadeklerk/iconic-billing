# Iconic Billing Portal

Secure medical billing web app for South African doctors.

---

## 🚀 Deploying Updates to Render

### First time setup (already done)
1. Unzip project folder
2. Create GitHub private repo
3. Push code
4. Connect to Render with env vars

### Pushing an update
Every time you get a new zip from development:

```bash
# 1. Unzip new files — replace the old folder completely
# 2. Open terminal/command prompt in the iconic-billing folder, then:

git add .
git commit -m "Update"
git push
```

Render auto-deploys within 2–3 minutes.

---

## ⚙️ Environment Variables (Render)

| Variable | Where to find it |
|---|---|
| `NODE_ENV` | Set to `production` |
| `SUPABASE_URL` | Supabase → Settings → API |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API |
| `ADMIN_EMAIL` | Your admin email address |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |

---

## 🏗️ Project Structure

```
iconic-billing/
├── server/                  ← Node.js backend (holds ALL secrets)
│   ├── index.js             ← Express server entry point
│   ├── middleware/
│   │   └── requireAuth.js   ← JWT auth check on every protected route
│   └── routes/
│       ├── auth.js          ← /api/auth/login, /api/auth/admin-login
│       ├── patients.js      ← /api/patients  (Google Sheets proxy)
│       ├── billing.js       ← /api/billing   (AI + Apps Script proxy)
│       └── admin.js         ← /api/admin     (doctor management)
├── client/                  ← Frontend (zero secrets)
│   ├── index.html
│   ├── css/main.css
│   └── js/app.js            ← All frontend logic in one file
├── .env.example             ← Copy to .env, fill in values
└── package.json
```

---

## 👩‍⚕️ Adding a New Doctor

1. **They create a Google Form** for patient intake and link it to a Sheet
2. **Share the Sheet** → Anyone with link → Viewer
3. **Get Sheet ID** from URL: `spreadsheets/d/[ID HERE]/edit`
4. **Deploy Apps Script** in the Sheet → Extensions → Apps Script → paste template below → Deploy → copy URL
5. **Get Google API key** from console.cloud.google.com → restrict to Sheets API
6. **Open app** → Admin Access (bottom of login screen) → fill in the form → Save Doctor
7. **Create Supabase account** for them: supabase.com → Authentication → Users → Add user

---

## 📋 Apps Script Template

Paste in Sheet → Extensions → Apps Script. Deploy as: Execute as Me, Anyone can access.

```javascript
function doPost(e) {
  var data  = JSON.parse(e.postData.contents);
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Billings') || ss.insertSheet('Billings');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp','File No','Patient','Date','Tariff','ICD-10','Modifier','Notes','Ward Visits','Doctor']);
  }
  sheet.appendRow([data.timestamp, data.fileNo, data.patientName, data.dateOfService,
    data.tariff, data.icd10, data.modifier, data.notes, data.wardVisits, data.doctorName]);
  return ContentService.createTextOutput(JSON.stringify({success:true}))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (e.parameter.mode !== 'fetch') return ContentService.createTextOutput('{}');
  var limit = parseInt(e.parameter.limit) || 8;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Billings');
  if (!sheet || sheet.getLastRow() < 2) return ContentService.createTextOutput(JSON.stringify({billings:[]}));
  var rows = sheet.getDataRange().getValues();
  var header = rows[0];
  var data = rows.slice(1).reverse().slice(0, limit).map(function(row) {
    var obj = {}; header.forEach(function(h,i){ obj[h]=row[i]; }); return obj;
  });
  return ContentService.createTextOutput(JSON.stringify({billings:data}))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

## 🔒 Supabase RLS Setup (one-time)

In Supabase → SQL Editor → run:

```sql
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doctors_own_row" ON doctors
  FOR SELECT USING (auth.email() = email);
```

---

## 🩺 Doctors Table Schema

```sql
CREATE TABLE IF NOT EXISTS doctors (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  doctor_name          TEXT NOT NULL,
  email                TEXT NOT NULL UNIQUE,
  intake_sheet_id      TEXT,
  intake_tab_name      TEXT DEFAULT 'Form responses 1',
  apps_script_url      TEXT,
  google_key           TEXT,
  anthropic_key        TEXT,
  collections_sheet_id TEXT
);
```

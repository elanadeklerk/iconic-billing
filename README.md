# Iconic Billing Portal

A secure, production-ready medical billing web application for South African doctors.

## Architecture

```
iconic-billing/
├── server/                  # Node.js/Express backend (holds ALL secrets)
│   ├── index.js             # Server entry point
│   ├── middleware/
│   │   └── requireAuth.js   # JWT verification middleware
│   └── routes/
│       ├── auth.js          # Login/logout — returns JWT, never returns API keys
│       ├── patients.js      # Google Sheets proxy — google_key stays server-side
│       ├── billing.js       # Anthropic AI + Apps Script submission
│       └── admin.js         # Doctor CRUD (admin only)
├── client/                  # Frontend (zero secrets — just HTML/CSS/JS)
│   ├── index.html
│   ├── css/main.css
│   └── js/
│       ├── api.js           # All fetch calls go to /api/* (this server)
│       ├── auth.js          # Login/logout UI
│       ├── patients.js      # Patient search & selection
│       ├── billing.js       # Voice, manual, ward visits, submit
│       ├── dashboard.js     # Dashboard, stats, recent billings
│       ├── admin.js         # Admin panel UI
│       └── ui.js            # Shared helpers (sidebar, dates, modals)
├── .env.example             # Template — copy to .env and fill in values
├── .gitignore
└── package.json
```

**Security model:** The browser never sees any API key. Every sensitive operation goes through `POST /api/...` which the server handles using keys from `.env`.

---

## Setup

### 1. Clone and install

```bash
git clone <your-repo>
cd iconic-billing
npm install
```

### 2. Create your .env file

```bash
cp .env.example .env
```

Open `.env` and fill in:

| Variable | Where to get it |
|---|---|
| `SUPABASE_URL` | Supabase dashboard → Settings → API |
| `SUPABASE_ANON_KEY` | Supabase dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Settings → API (keep secret!) |
| `SUPABASE_JWT_SECRET` | Supabase dashboard → Settings → API → JWT Secret |
| `ADMIN_EMAIL` | Your admin email (must also exist in Supabase Auth) |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |

### 3. Set up Supabase

#### Enable Row Level Security on the doctors table
Run this in the Supabase SQL editor:

```sql
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;

-- Doctors can only read their own row
CREATE POLICY "doctors_own_row" ON doctors
  FOR SELECT USING (auth.email() = email);

-- Only the service role (server) can insert/update/delete
-- (your server uses the service role key, so no policy needed for those)
```

#### Create the admin user
In Supabase dashboard → Authentication → Users → Add user:
- Email: the value you put in `ADMIN_EMAIL`
- Password: something strong

#### Doctors table schema (if not already created)
```sql
CREATE TABLE doctors (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  doctor_name         TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  intake_sheet_id     TEXT,
  intake_tab_name     TEXT DEFAULT 'Form responses 1',
  apps_script_url     TEXT,
  google_key          TEXT,
  anthropic_key       TEXT,
  collections_sheet_id TEXT
);
```

### 4. Run the server

```bash
# Development (auto-restarts on file changes)
npm run dev

# Production
npm start
```

The app runs at **http://localhost:3000**

---

## Adding a New Doctor

1. **Doctor creates a Google Form** for patient intake (File No, Name, Funding, Medical Aid, etc.) — this auto-creates a linked Google Sheet
2. **Set the Sheet to public viewer**: Share → Anyone with link → Viewer
3. **Copy the Sheet ID** from the URL: `docs.google.com/spreadsheets/d/**[ID HERE]**/edit`
4. **Deploy Apps Script**: In the Sheet → Extensions → Apps Script → paste billing script → Deploy → Copy URL
5. **Get a Google API key** from [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials → Create API Key → Restrict to Sheets API
6. **Log in to Admin Panel**: Open the app → tap "Admin Access" at the bottom of the login screen
7. **Fill in the form**: Doctor name, email, Sheet ID, Apps Script URL, Google key, Anthropic key
8. **Create their Supabase Auth account**: Supabase dashboard → Authentication → Users → Add user (use same email)
9. Done — doctor logs in with their email and password

---

## Apps Script Template

The doctor deploys this in their Google Sheet (Extensions → Apps Script):

```javascript
function doPost(e) {
  var data  = JSON.parse(e.postData.contents);
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Billings') || ss.insertSheet('Billings');

  // Add header row if sheet is empty
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp','File No','Patient','Date of Service',
                     'Tariff','ICD-10','Modifier','Notes','Ward Visits','Doctor']);
  }

  sheet.appendRow([
    data.timestamp, data.fileNo, data.patientName, data.dateOfService,
    data.tariff, data.icd10, data.modifier, data.notes, data.wardVisits, data.doctorName
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (e.parameter.mode !== 'fetch') {
    return ContentService.createTextOutput(JSON.stringify({ error: 'Invalid mode' }));
  }
  var limit = parseInt(e.parameter.limit) || 8;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Billings');
  if (!sheet || sheet.getLastRow() < 2) {
    return ContentService.createTextOutput(JSON.stringify({ billings: [] }));
  }
  var rows   = sheet.getDataRange().getValues();
  var header = rows[0];
  var data   = rows.slice(1).reverse().slice(0, limit).map(function(row) {
    var obj = {};
    header.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
  return ContentService
    .createTextOutput(JSON.stringify({ billings: data }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

**Deploy settings:** Execute as → Me | Who has access → Anyone

---

## Deployment (Production)

### Option A — Render.com (recommended, free tier)
1. Push to GitHub
2. New Web Service → connect repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add all environment variables from `.env`

### Option B — Railway.app
Same as Render, slightly faster deployments.

### Option C — Your own VPS
```bash
# Install Node 20+, then:
npm install --production
NODE_ENV=production npm start
# Use PM2 for process management:
npm install -g pm2
pm2 start server/index.js --name iconic-billing
pm2 startup && pm2 save
```

### Custom domain + HTTPS
Both Render and Railway provide free HTTPS automatically. For a custom domain, add a CNAME record pointing to your service URL.

---

## Security Notes

- **Never commit `.env`** — it's in `.gitignore`
- **Rotate the Anthropic key** in `.env` after removing the old one from the database
- **Enable Supabase RLS** as shown above before going live
- **Rate limits** are applied: 100 req/15min per IP, 10 AI calls/min per IP
- **Session tokens** are stored in `sessionStorage` (cleared when browser tab closes, not `localStorage`)
- **Every page load forces fresh login** — no auto-login from cached sessions

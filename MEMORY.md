# Iconic Flow — Project Memory
> Medical Billing Portal · Last updated: April 2026
> Live URL: https://iconic-billing.onrender.com
> Repo: https://github.com/elanadeklerk/iconic-billing (private, `main` branch)
> Deploy: Render.com free tier (auto-deploys on push, spins down after 15min idle)

---

## 1. What This App Is

**Iconic Flow** (formerly "Iconic Billing") is a Progressive Web App for South African medical practitioners. It allows doctors to:
- Search patients from their Google Form intake sheet
- Record billing codes by voice (AI extracts Tariff + ICD-10 codes)
- Scan hospital patient stickers with the phone camera (AI reads file number, medical aid, membership, etc.)
- Add ward visits via a calendar picker
- Submit billing entries → Google Sheet via Apps Script → auto-generates Billing Log + Collections Summary
- View revenue data (admin-only)
- Look up patient billing history from the sidebar

---

## 2. Stack

| Layer | Technology |
|---|---|
| Server | Node.js 18+ / Express 4 |
| Auth | Supabase Auth + HttpOnly cookie session (`ib_session`) |
| Database | Supabase (Postgres) — `doctors` table only |
| Patient data | Google Sheets API (per-doctor `intake_sheet_id`) |
| Billing submission | Google Apps Script (`doPost` on doctor's sheet) |
| AI | Anthropic Claude `claude-sonnet-4-20250514` |
| Frontend | Vanilla JS (`App` object), Syne + DM Mono fonts |
| PWA | `manifest.json` + `sw.js` (network-first, offline billing queue) |
| Hosting | Render.com (free tier) |

---

## 3. File Structure

```
iconic-billing/
├── server/
│   ├── index.js                  Express entry, cookie-parser, CORS, rate limit
│   ├── middleware/
│   │   └── requireAuth.js        HttpOnly cookie OR Bearer token validation
│   └── routes/
│       ├── auth.js               login, admin-login, logout, /me
│       ├── patients.js           GET /patients (deduped), POST /patients/submit
│       ├── billing.js            extract, scan-sticker, transcribe, submit, stats, revenue
│       └── admin.js              CRUD doctors + Supabase Auth user creation
├── client/
│   ├── index.html                Single-page app, zero onclick= handlers
│   ├── css/main.css              ~2100 lines, all styles + animations
│   ├── js/app.js                 ~1000 lines, App object, event delegation
│   ├── sw.js                     Network-first SW, offline billing queue (IndexedDB)
│   └── manifest.json             PWA manifest (icons need real 192/512px PNGs)
├── README_APPS_SCRIPT.md         ⚠️ CRITICAL — Apps Script code for each doctor's sheet
├── package.json                  Dependencies (no cookie-parser in install — see §9)
└── .env.example                  Env var template
```

---

## 4. Supabase Config

- **URL:** `https://ggdjrtbphjboxbuzyvjt.supabase.co`
- **Anon key:** `sb_publishable_shI3U1_YTmwzrWCGWC7kIg_DKatVSa4`
- **Admin email:** `deklerkdeclan@gmail.com`
- **RLS:** DISABLED on `doctors` table

### Doctors Table Schema
```sql
CREATE TABLE doctors (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  doctor_name          TEXT NOT NULL,
  email                TEXT NOT NULL UNIQUE,
  intake_sheet_id      TEXT,          -- Google Sheet ID (Form Responses + Billing Log)
  intake_tab_name      TEXT DEFAULT 'Form Responses 1',
  apps_script_url      TEXT,          -- deployed Apps Script web app URL
  google_key           TEXT,          -- Google Sheets API key (server-side only)
  anthropic_key        TEXT,          -- per-doctor Anthropic key (fallback to server env)
  collections_sheet_id TEXT           -- optional separate collections sheet
);
```

### Current Doctors
| Doctor | Email | Sheet ID |
|---|---|---|
| Dr SK Hlahla | drskhlahla@icloud.com | `1W0_S0LOd86HLOxguPTTk5uWvB1D1m3okSPJxEY7Tf-U` |
| Dr N Lahouel | nebil.lahouel@gmail.com | — |
| Yolanda van der Westhuizen | vdwyolanda@gmail.com | — |

---

## 5. Environment Variables (Render.com)

```
NODE_ENV=production
PORT=3000
SUPABASE_URL=https://ggdjrtbphjboxbuzyvjt.supabase.co
SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=[secret]
ADMIN_EMAIL=deklerkdeclan@gmail.com
ANTHROPIC_API_KEY=sk-ant-...         ← shared key for all doctors
ALLOWED_ORIGIN=https://iconic-billing.onrender.com
```

---

## 6. API Routes

### Auth (`/api/auth/`)
| Method | Route | Notes |
|---|---|---|
| POST | `/login` | Sets `ib_session` HttpOnly cookie, returns doctor profile |
| POST | `/admin-login` | Admin only (matches `ADMIN_EMAIL`) |
| POST | `/logout` | Clears cookie + invalidates Supabase session |
| GET | `/me` | Session heartbeat — restores session on page load |

### Patients (`/api/patients/`)
| Method | Route | Notes |
|---|---|---|
| GET | `/` | Reads `Form Responses 1` from Google Sheets, **deduplicates by fileNo** |
| POST | `/submit` | Adds sticker-scanned new patient to Form Responses via Apps Script |

### Billing (`/api/billing/`)
| Method | Route | Notes |
|---|---|---|
| POST | `/extract` | AI extracts tariff/ICD-10 from voice transcript text |
| POST | `/scan-sticker` | AI reads hospital patient sticker image (base64, compressed to max 1200px) |
| POST | `/submit` | Sends 1 row to Apps Script. Ward visits compressed into notes field |
| GET | `/stats` | Reads Billing Log directly via Sheets API for dashboard week count |
| GET | `/revenue` | Reads Billing Log for revenue overview (admin use) |

### Admin (`/api/admin/`)
| Method | Route | Notes |
|---|---|---|
| GET | `/doctors` | List all doctors |
| POST | `/doctors` | Create doctor + Supabase Auth user |
| PATCH | `/doctors/:id` | Update doctor config |
| DELETE | `/doctors/:id` | Remove doctor |

---

## 7. Google Sheets / Apps Script Architecture

Each doctor has **one Google Sheet** with three tabs:

| Tab | Purpose |
|---|---|
| `Form Responses 1` | Raw intake data — one row per patient submission. Also where billing entries land via Apps Script `doPost`. |
| `Billing Log` | Auto-generated by `refreshBillingLog()`. Clean formatted view with status dropdowns, colour coding. The app reads this for stats and revenue. |
| `Collections Summary` | Auto-generated by `refreshCollections()`. Ageing analysis and status breakdown. |

### ⚠️ Critical: Apps Script Must Be Updated

Dr Hlahla's Apps Script needs the code from `README_APPS_SCRIPT.md`. Key changes from original:

1. **`doPost` now pre-formats cells as `@STRING@` before `appendRow`** — prevents leading zeros being stripped (e.g. `0190` → `190`)
2. **Accepts `{ rows: [...] }` array** — single billing + ward visits in one call
3. **`doGet?mode=fetch`** — returns Billing Log data for dashboard recent billings

**To update:** Open the sheet → Extensions → Apps Script → replace all code → Deploy → New version.

### Apps Script Column Mapping (Form Responses 1)
```
col 0: timestamp
col 1: fileNo
col 2: patientName
col 3: dateOfService
col 4: fundingType
col 5: medAid
col 6: membNo
col 7: tariff        ← formatted @STRING@ to preserve leading zeros
col 8: icd10         ← formatted @STRING@
col 9: modifier      ← formatted @STRING@
col 10: notes
```

### Billing Log Column Mapping (auto-generated, 0-indexed)
```
col 0:  File No          col 7:  Tariff Code(s)
col 1:  Patient Name     col 8:  ICD-10 Code(s)
col 2:  Funding Type     col 9:  Modifiers
col 3:  Medical Aid      col 10: Amount Billed
col 4:  Plan/Option      col 11: Amount Paid
col 5:  Membership No    col 12: Outstanding (formula)
col 6:  Date of Service  col 14: Status (dropdown)
                         col 15: Notes
```

---

## 8. Frontend Architecture

### App Object Pattern
All logic lives in a single `App` object in `app.js`. No framework.

```js
App.state       // all mutable state
App.el(id)      // shorthand for getElementById
App.init()      // called on DOMContentLoaded — tries /me, restores session or shows login
App.bindAll()   // ALL event listeners registered here, event delegation on containers
```

### Event Delegation
Zero `onclick=` attributes in HTML. All listeners are bound in `App.bindAll()`. Dynamic lists use parent container delegation:
- `#patientResults` → patient item clicks
- `#sidebarSearchResults` → sidebar patient clicks
- `#calGrid` → calendar day toggles
- `#wardSummaryChips` → ward visit remove buttons
- `#billingTabs` → mode switch
- `#adminDoctorTable` → edit button

### Auth Flow
1. Page loads → `App.init()` calls `GET /api/auth/me` with `credentials: 'include'`
2. If session cookie valid → restore doctor profile, load patients, show dashboard
3. If 401 → show login screen
4. Login → `POST /api/auth/login` → server sets `ib_session` HttpOnly cookie
5. Any 401 response anywhere → auto show login (graceful session expiry)

### Voice Recording
```
startRecording()
  → SpeechRecognition (Chrome/Edge only)
  → continuous + interimResults
  → _accFinal accumulates finalized words across restarts
  → silence timeout fires onend → restarts if isRecording=true
  → doctor taps STOP
stopRecording()
  → sets isRecording=false
  → calls rec.stop()
  → rec.stop() triggers onend (all pending audio processed first)
  → onend checks isRecording=false → extracts from _accFinal
  → calls extractFromText() → POST /api/billing/extract → AI returns JSON
  → fillVoiceFields() populates tariff/ICD-10/modifier inline
  → doctor reviews then taps "Review & Confirm →"
```

### Sticker Scanner
```
Doctor taps 📷 → camera opens → photo taken
→ Canvas resize to max 1200px (phone cameras are 12MP+, would exceed API limits)
→ POST /api/billing/scan-sticker with base64 JPEG
→ Claude Vision reads: fileNo, name, medAid, plan, membNo, depCode, idNo, cellNo
→ All fields shown as editable inputs
→ "Use Patient → Start Billing" → merges sticker data with sheet data if match found
```

### Ward Visits
Calendar date picker → tap days to select → enter ward tariff + ICD-10 once → Save. Submitted as a **single billing row** with ward visit dates compressed into the notes field: `Ward visits: 2026-04-07, 2026-04-08 | Tariff: 0190 | ICD-10: S62.3`

### PWA / Service Worker
- **Strategy: Network-first** for all app files
- Cache used only as offline fallback
- On new SW activate: sends `SW_UPDATED` message → app auto-reloads
- Offline billing: `POST /api/billing/submit` queued in IndexedDB, replays on reconnect via Background Sync
- **Icons missing**: `manifest.json` references `/img/icon-192.png` and `/img/icon-512.png` — these don't exist yet so PWA install badge won't show

---

## 9. Known Issues & Pending

### ⚠️ Must Fix Before Going Live

| Issue | Where | Fix |
|---|---|---|
| **Apps Script not updated** | Dr Hlahla's sheet | Update with code from `README_APPS_SCRIPT.md` and redeploy |
| **Leading zeros (0190 → 190)** | Google Sheet | Fixed in new Apps Script — requires redeployment |
| **PWA icons missing** | `/client/img/` | Need `icon-192.png` and `icon-512.png` from Iconic Flow logo |
| **Voice Chrome-only** | `app.js` | SpeechRecognition API not supported in Safari/Firefox — shows alert and falls back to manual |

### ⚠️ Known Limitations

| Limitation | Notes |
|---|---|
| Render free tier cold starts | App sleeps after 15min idle, ~30s wake time |
| Billing Log tab gid unknown | Sheet iframe opens on Billing Log by name (`range=Billing+Log!A1`) but if the tab doesn't exist yet, it falls back to first tab |
| Ward visits in notes field | Compressed into single row — not ideal for billing systems that need one row per service date. Long-term: Apps Script could expand them on receipt |
| `cookie-parser` may need install | If Render doesn't pick it up automatically, `npm install` manually |
| Sticker scanner fails on very dark/blurry photos | Claude Vision accuracy depends on image quality — encourage good lighting |

### Minor Issues
- The sidebar Collections Sheet button only shows if `collections_sheet_id` is set for the doctor
- Revenue data only appears after running "Billing → Refresh All" in the Google Sheet at least once
- Patient list rebuilds every login (no caching) — fine for current scale

---

## 10. Branding

| Item | Value |
|---|---|
| App name | **Iconic Flow™** |
| Company | Iconic Billing (Pty) Ltd |
| Tagline | Medical Billing Portal |
| Logo | Iconic Flow logo (blue feather/quill with "ICONIC FLOW" wordmark) — embedded as base64 in HTML |
| Colour palette | `--accent: #00c2ff`, `--accent2: #0066ff`, `--bg: #080c14`, `--surface: #0e1420` |
| Fonts | Syne (headings/UI), DM Mono (codes/numbers) |

---

## 11. Deployment Process

```bash
# From unzipped iconic-billing folder:
git init
git remote add origin https://github.com/elanadeklerk/iconic-billing.git
git add .
git commit -m "Description of changes"
git push --force origin main
# Render auto-deploys within 2-3 minutes
```

Render build command: `npm install`  
Start command: `node server/index.js`

---

## 12. Adding a New Doctor

1. Open the live app, type `admin` in the email field → admin overlay appears
2. Log in with `deklerkdeclan@gmail.com`
3. Click **+ Add Doctor** and fill in:
   - Name, email, password
   - Google Sheet ID (from sheet URL: `/spreadsheets/d/[ID HERE]/edit`)
   - Apps Script URL (deploy from Extensions → Apps Script in their sheet)
   - Google API Key (from Google Cloud Console, restricted to Sheets API)
   - Anthropic API Key (or leave blank to use server's shared key)
4. Supabase Auth account is created automatically
5. The doctor can log in immediately

---

## 13. Immediate Next Steps

### Priority 1 — Critical (must do before doctors use it)
- [ ] **Update Dr Hlahla's Apps Script** — copy from `README_APPS_SCRIPT.md`, redeploy. This fixes leading zeros (0190→190) and modifier (0009→9) issues
- [ ] **Set Dr Hlahla's intake_sheet_id** in admin panel: `1W0_S0LOd86HLOxguPTTk5uWvB1D1m3okSPJxEY7Tf-U`
- [ ] **Run "Billing → Refresh All"** in Dr Hlahla's sheet after any billing to generate Billing Log and Collections Summary
- [ ] **Create PWA icons** — export Iconic Flow logo at 192×192 and 512×512 PNG, save as `/client/img/icon-192.png` and `/client/img/icon-512.png`

### Priority 2 — Soon
- [ ] **Custom domain** — DNS is being set up via Domains.co.za → Render CNAME
- [ ] **Set up Dr Lahouel and Yolanda** — they need sheets, Apps Scripts, and admin panel entries
- [ ] **Test ward visits end-to-end** — confirm compressed notes row lands correctly in Billing Log
- [ ] **Test sticker scanner** on multiple SA hospital sticker formats — Netcare, Mediclinic, Life Healthcare

### Priority 3 — Future
- [ ] **PWA to Play Store** — use PWABuilder.com once custom domain + icons are in place ($25 Google dev account)
- [ ] **PWA to App Store** — requires Apple dev account ($99/year) + Swift wrapper
- [ ] **Face ID / biometric login** — via Capacitor if going native
- [ ] **Push notifications** — alert doctors when billing goes from "Submitted" to "Paid"
- [ ] **Multi-doctor dashboard** — admin view showing all doctors' billing activity
- [ ] **Tariff code autocomplete** — type "019" and see matching SAMA codes
- [ ] **ICD-10 search** — type diagnosis name and get suggested codes
- [ ] **Offline mode hardening** — test the IndexedDB billing queue in real dead-zone conditions

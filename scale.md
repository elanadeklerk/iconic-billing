# Iconic Billing — Scaling Roadmap

## Target Stack

| Layer | Technology | Purpose |
|---|---|---|
| Framework | Next.js 14 (App Router) | Frontend + backend in one repo |
| UI | React + TypeScript | Component-based UI with type safety |
| Styling | Tailwind CSS | Utility-first, replaces main.css |
| Components | shadcn/ui | Pre-built accessible UI components |
| Icons | Lucide React | Replaces emoji icons |
| Database | Supabase / PostgreSQL | Already in use — no change |
| ORM | Drizzle ORM | Type-safe queries, replaces raw Supabase client |
| Validation | Zod | Schema validation on all API routes |
| Server state | TanStack Query | Replaces manual fetch() calls |
| Client state | Zustand | Replaces App.state object |

---

## Implementation Order — Easiest to Hardest

### Phase 1 — Zero risk, do these first
These changes don't touch the frontend at all and can be done in a day or two.

**1. TypeScript on the server**
- Rename `server/routes/*.js` → `*.ts`
- Add types to `req.body`, `res.json()`, and all function params
- Catches bugs before they reach production
- No user-facing change whatsoever

**2. Zod validation on API routes**
- Add Zod schemas to `/submit`, `/save-sticker`, `/extract`, `/scan-sticker`
- Replaces the manual `required` field checks
- Better error messages, type inference flows through automatically
- Example:
  ```ts
  const submitSchema = z.object({
    fileNo:        z.string().min(1),
    patientName:   z.string().min(1),
    dateOfService: z.string(),
    tariff:        z.string().min(1),
    icd10:         z.string().min(1),
    authNo:        z.string().optional(),
    notes:         z.string().optional(),
    transcript:    z.string().optional(),
  });
  ```

**3. Drizzle ORM**
- Define your Supabase tables as Drizzle schemas (`doctors`, `billing_records`, `sticker_scans`, `patients`)
- Replaces raw `.from('table').select()` calls with typed queries
- Full autocomplete on every column name — no more typos in table names

---

### Phase 2 — Medium effort, high payoff
These improve the frontend but don't require a full rewrite yet.

**4. Next.js project scaffold**
- Create a new `/app` directory alongside the current `/client` and `/server`
- Set up Next.js with TypeScript and Tailwind
- Start building new pages there — dashboard, admin — while the old app still runs
- The two can co-exist during the transition

**5. Zustand store**
- Direct replacement for `App.state`
- Each slice mirrors what's already there: `doctor`, `patients`, `selected`, `wardVisits`, `authNo`, `billingMode`
- Example:
  ```ts
  const useBillingStore = create<BillingState>((set) => ({
    selected:   null,
    wardVisits: [],
    authNo:     '',
    setSelected: (p) => set({ selected: p }),
    clearBilling: () => set({ wardVisits: [], authNo: '' }),
  }));
  ```

**6. TanStack Query**
- Replaces all the manual `API.getPatients()`, `API.getStats()` fetch calls
- Handles loading states, caching, and background refetching automatically
- Doctors stop seeing stale data without manual refreshes

---

### Phase 3 — Heavy lift, do last
Only worth doing once the product is stable and proven.

**7. React frontend**
- Rebuild the billing flow (screens 1→4) as React components
- Voice recording → `useVoiceRecording()` custom hook
- Neural net canvas → `useNeuralNet()` hook with `useEffect` + `useRef`
- Ward visits calendar → React component with proper state
- This is the biggest rewrite and touches everything the doctor sees

**8. shadcn/ui components**
- Replace custom CSS cards, buttons, inputs with shadcn equivalents
- Do this as part of the React rewrite, not before
- Gives you a proper design system with accessibility built in

**9. Full Next.js migration**
- Delete `/client` and `/server` folders
- Everything lives in `/app` — API routes under `app/api/`, pages under `app/(billing)/`
- Single `npm run dev` starts everything

---

## Suggested Starting Point

Start with **Phase 1** this week. It's invisible to users, reduces bugs immediately, and makes Phase 2 and 3 significantly easier because you'll already have typed schemas and Zod validation in place.

```
Week 1–2  →  TypeScript + Zod on server
Week 3–4  →  Drizzle ORM + Next.js scaffold
Week 5+   →  React frontend (billing flow, one screen at a time)
```

---

## What Stays the Same Forever

- Supabase database and all existing tables
- Google Apps Script URL integration
- Anthropic AI calls (sticker scan + code extraction)
- Supabase Auth (just swap to the Next.js Supabase auth helpers)

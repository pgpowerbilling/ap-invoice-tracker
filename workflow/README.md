# P&G Power Co. — Unit Workflow

General Foreman unit sheets → Construction Manager sign-off → billing → invoice, built around the Eversource MASTER Unit Invoice Template.

Open it at `/workflow/` on this repository's GitHub Pages site.

**Flow**
1. **General Foreman** (login role `crew`) fills out the Crew Daily Unit Checklist on a phone or uploads filled sheets: date, crew/lead, AWC, WO #, FWO #, the location, quantities, before and after photos, and notes. They never see prices.
2. **Construction Manager** (login role `gf`) signs off each sheet on the CM sign-off tab, returns it to the field with a note, or holds it. The signature moves the sheet to *Ready to bill*.
3. **Admin** (Jordan, Shayla) does billing and invoicing: builds the invoice from Ready to bill sheets and exports
   - the **Eversource template (.xlsx)**: a copy of the master template with Pole Register, Unit Billing Detail and invoice header filled in, so the template's own formulas produce the Invoice Cover and Final Invoice, and
   - a **P&G invoice PDF** (cover summary + pole/unit detail) from the browser's print dialog.

**Pricing** comes only from the template's Unit Rate Master, by each pole's pricing area (pole setting, or the job default). Amounts are qty × rate with no rounding until the final total, matching the workbook. Anything unpriceable (no pricing area, C&K, pole not on the packet list, sheet on hold) blocks the invoice until fixed.

**Roles**: Admin (everything: logins, jobs, billing, invoicing; Rates is limited to jsmith and skarlowsky), Construction Manager (signs off sheets; no prices), General Foreman (fills out and submits own sheets only; no prices), Viewer. The internal keys `gf` and `crew` are kept so existing logins keep working.

**Saving & security**: same scheme as the AP Invoice Tracker and Project Tracker — AES-256-GCM encrypted data, per-login wrapped keys (PBKDF2-SHA256, 310,000 iterations), saved through the GitHub API with the fine-grained key entered once in Settings.

**Files**
- `index.html` — the app (built from `src/` by `tools/build.mjs`)
- `config.json` — repo settings and wrapped keys per login
- `data/index.enc.json` — jobs, pole lists, rates, logins' profiles, saving key
- `data/docs/*.enc.json` — one encrypted file per unit sheet or invoice
- `data/template-*.enc.json` — the encrypted master template
- `tools/setup.mjs` — one-time setup (first logins). Re-running replaces all workflow data.
- `tools/seed.mjs` — loads a template and a job's pole list into the encrypted data

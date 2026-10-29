# P&G Power Co. — Unit Workflow

Crew daily unit sheets → General Foreman approval → billing approval → invoice, built around the Eversource MASTER Unit Invoice Template.

Open it at `/workflow/` on this repository's GitHub Pages site.

**Flow**
1. **Crew** fills out the Crew Daily Unit Checklist on a phone: date, crew/lead, AWC, WO #, FWO #, the pole from the job's packet list, quantities, and notes. Crews never see prices.
2. **General Foreman** reviews each sheet: *Approve for billing*, *Return to field* (with a note), or *Hold*.
3. **Billing approver** gives final approval: *Approve for invoice*, *Return*, or *Hold*.
4. **Invoice**: billing selects approved sheets for one job (up to the template's pole slots), enters the invoice # and date, and exports
   - the **Eversource template (.xlsx)**: a copy of the master template with Pole Register, Unit Billing Detail and invoice header filled in, so the template's own formulas produce the Invoice Cover and Final Invoice, and
   - a **P&G invoice PDF** (cover summary + pole/unit detail) from the browser's print dialog.

**Pricing** comes only from the template's Unit Rate Master, by each pole's pricing area (pole setting, or the job default). Amounts are qty × rate with no rounding until the final total, matching the workbook. Anything unpriceable (no pricing area, C&K, pole not on the packet list, sheet on hold) blocks the invoice until fixed.

**Roles**: Admin (everything incl. logins and template), Billing approver, General Foreman, Crew, Viewer.

**Saving & security**: same scheme as the AP Invoice Tracker and Project Tracker — AES-256-GCM encrypted data, per-login wrapped keys (PBKDF2-SHA256, 310,000 iterations), saved through the GitHub API with the fine-grained key entered once in Settings.

**Files**
- `index.html` — the app (built from `src/` by `tools/build.mjs`)
- `config.json` — repo settings and wrapped keys per login
- `data/index.enc.json` — jobs, pole lists, rates, logins' profiles, saving key
- `data/docs/*.enc.json` — one encrypted file per unit sheet or invoice
- `data/template-*.enc.json` — the encrypted master template
- `tools/setup.mjs` — one-time setup (first logins). Re-running replaces all workflow data.
- `tools/seed.mjs` — loads a template and a job's pole list into the encrypted data

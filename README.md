# P&G Power Co. — Vendor Invoice Tracker

Tracks vendor invoices (Brothers Hydrovac, TMI, Universal, Cavalier and others) from arrival to payment, with a Net 30 countdown on each one.

**Who does what**
- Jordan Smith (`jsmith`) — marks invoices **Invoiced** (billed to DTE for reimbursement), adds or edits invoices, manages Settings.
- Shayla Karlowsky (`skarlowsky`) and Lindsey Hanson (`lhanson`) — mark invoices **Paid**.

**How invoices get in**
A scheduled task scans Jordan's Outlook each weekday morning and runs `tools/ingest.mjs`, which seals new invoices to the tracker's public key and commits them to `inbox/`. The app merges them the next time anyone signs in. `seen.json` holds one-way hashes so the same invoice is never logged twice.

**Security**
Everything readable (`data.enc.json`, `inbox/*`) is AES-256-GCM encrypted. Each login unwraps the data key with its own password (PBKDF2-SHA256, 310,000 iterations). No names, amounts or passwords are stored in plain text in this repository.

**Timers**
Due date = invoice date + 30 days. Green = more than 7 days left, amber = 7 days or fewer, red = overdue. The timer stops when the invoice is marked Paid.

# P&G Power Co. — Project Tracker

Tracks P&G jobs and every location on them: PO / WO / COH, estimated and actual dates, progress, and each location's tree trim, underground, 40kV, traffic control, hydrovac, Miss Dig and shutdown requirements.

Open it at `/projects/` on this repository's GitHub Pages site.

**Logins and roles**
- **Admin** — everything, including Logins, Settings (GitHub saving key) and deleting jobs.
- **Editor** — add and edit jobs and locations, add locations, archive jobs. Cannot delete jobs or manage logins.
- **Viewer** — read and export only.

Admins add, reset and remove logins from the **Logins** button. Anyone can change their own password. A new login or password works once GitHub Pages has republished (usually a minute or two).

**Saving**
Changes are saved straight to this repository through the GitHub API using a fine-grained token with *Contents: read & write* on this repo (the same key the AP Invoice Tracker uses works). The token is stored encrypted inside the tracker data. Location edits are saved together when you click **Save & close**, move to another location, or close the panel.

**Security**
Everything readable (`data/index.enc.json`, `data/jobs/*.enc.json`) is AES-256-GCM encrypted. Each login unwraps the data key with its own password (PBKDF2-SHA256, 310,000 iterations). Job files have random names and commit messages are generic, so no job names, POs or addresses appear in plain text. Removing a login stops it from signing in going forward. Older versions of `config.json` stay in git history, so a removed person who still knows their old password could decrypt data from that older copy; rotate the data key if that ever matters.

**Files**
- `index.html` — the app (login, overview, job pages, open items, Excel export)
- `config.json` — repo settings and wrapped keys for each login (no names or passwords)
- `data/index.enc.json` — encrypted list of jobs, login profiles and the saving key
- `data/jobs/*.enc.json` — one encrypted file per job, including its change history
- `tools/setup.mjs` — one-time setup that created the first login and imported the active jobs from Weekly Tracker 9. Re-running it replaces all project data.

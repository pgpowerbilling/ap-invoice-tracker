// One-time setup: creates keys, the three logins, and the encrypted starting log.
// Usage: node tools/setup.mjs <seed.json> <secrets-out-dir>
import fs from 'node:fs';
import path from 'node:path';
import { newDek, wrapDek, encJson, newEcdh, userKey, invKey, rand } from '../lib/crypto.mjs';

const [seedPath, secretsDir] = process.argv.slice(2);
if (!seedPath || !secretsDir) { console.error('usage: setup.mjs seed.json secretsDir'); process.exit(1); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const USERS = [
  { username: 'jsmith', name: 'Jordan Smith', role: 'billing' },
  { username: 'skarlowsky', name: 'Shayla Karlowsky', role: 'ap' },
  { username: 'lhanson', name: 'Lindsey Hanson', role: 'ap' },
];
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const genPw = () => [0, 1, 2, 3].map(() => [...rand(5)].map(b => alphabet[b % alphabet.length]).join('')).join('-');

const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const dek = await newDek();
const ecdh = await newEcdh();
const users = {}, profiles = {}, secrets = [];
for (const u of USERS) {
  const pw = genPw();
  const k = await userKey(u.username);
  users[k] = await wrapDek(dek, pw);
  profiles[k] = { username: u.username, name: u.name, role: u.role };
  secrets.push({ ...u, password: pw });
}

const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const now = new Date().toISOString();
const invoices = [], seen = [];
for (const s of seed) {
  const key = await invKey(s.vendor, s.invoiceNo);
  seen.push(key);
  invoices.push({
    id: key.slice(0, 16), vendor: s.vendor, invoiceNo: s.invoiceNo, invoiceDate: s.invoiceDate,
    termsDays: 30, dueDate: addDays(s.invoiceDate, 30), amount: s.amount, location: s.location || '',
    ref: s.ref || '', received: s.received, source: s.source, billingHint: s.billingHint || '', note: s.note || '',
    invoiced: null, paid: null, loggedAt: now, loggedBy: 'Outlook scan (initial backfill)'
  });
}
const data = { version: 1, invoices, audit: [{ at: now, by: 'Setup', action: `Initial backfill: ${invoices.length} invoices logged from Outlook` }],
  privKey: ecdh.priv, ghToken: null, profiles, processedInbox: [] };

const config = { app: 'P&G Power AP Invoice Tracker', version: 1, repo: { owner: 'pgpowerbilling', repo: 'ap-invoice-tracker', branch: 'main' },
  users, pubKey: ecdh.pub };

fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config, null, 1));
fs.writeFileSync(path.join(root, 'data.enc.json'), JSON.stringify(await encJson(dek, data)));
fs.writeFileSync(path.join(root, 'seen.json'), JSON.stringify(seen, null, 0));
fs.mkdirSync(path.join(root, 'inbox'), { recursive: true });
fs.writeFileSync(path.join(root, 'inbox', 'index.json'), '[]');
fs.mkdirSync(secretsDir, { recursive: true });
fs.writeFileSync(path.join(secretsDir, 'logins.json'), JSON.stringify(secrets, null, 2));
console.log(`Setup complete: ${invoices.length} invoices, ${USERS.length} logins. Secrets in ${secretsDir}/logins.json`);

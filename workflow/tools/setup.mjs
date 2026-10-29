// One-time setup for the Unit Workflow: creates the data key, the first admin logins and an empty encrypted index.
// Usage: node workflow/tools/setup.mjs <secrets-out-dir>
// Run once. Re-running replaces ALL workflow data and logins.
import fs from 'node:fs';
import path from 'node:path';
import { newDek, wrapDek, encJson, sha256hex, rand } from '../../lib/crypto.mjs';

const [secretsDir] = process.argv.slice(2);
if (!secretsDir) { console.error('usage: setup.mjs secretsDir'); process.exit(1); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const userKey = (u) => sha256hex('pg-wf:user:' + u.trim().toLowerCase());
const USERS = [
  { username: 'jsmith', name: 'Jordan Smith', role: 'admin' },
  { username: 'skarlowsky', name: 'Shayla Karlowsky', role: 'admin' },
];
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const genPw = () => [0, 1, 2, 3].map(() => [...rand(5)].map(b => alphabet[b % alphabet.length]).join('')).join('-');

const dek = await newDek();
const users = {}, profiles = {}, secrets = [];
for (const u of USERS) {
  const pw = genPw(); const k = await userKey(u.username);
  users[k] = await wrapDek(dek, pw);
  profiles[k] = { username: u.username, name: u.name, role: u.role, crew: '' };
  secrets.push({ ...u, password: pw });
}
fs.rmSync(path.join(root, 'data'), { recursive: true, force: true });
fs.mkdirSync(path.join(root, 'data', 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'docs', '.gitkeep'), '');
const index = { version: 1, profiles, ghToken: null, jobs: [], catalog: [], catalogMeta: null, docs: {}, seq: { sheet: 0 } };
fs.writeFileSync(path.join(root, 'data', 'index.enc.json'), JSON.stringify(await encJson(dek, index)));
const config = { app: 'P&G Power Unit Workflow', version: 1,
  repo: { owner: 'pgpowerbilling', repo: 'ap-invoice-tracker', branch: 'main', base: 'workflow/' }, users };
fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config, null, 1));
fs.mkdirSync(secretsDir, { recursive: true });
fs.writeFileSync(path.join(secretsDir, 'workflow-logins.json'), JSON.stringify(secrets, null, 2));
console.log(`Setup complete: ${USERS.length} login(s). Secrets in ${secretsDir}/workflow-logins.json`);

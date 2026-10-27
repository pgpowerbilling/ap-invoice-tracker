// One-time setup for the Project Tracker: creates the data key, the first login, and the encrypted job files.
// Usage: node projects/tools/setup.mjs <seed-dir-of-job-json> <secrets-out-dir>
// Run once. Re-running replaces ALL project data and logins.
import fs from 'node:fs';
import path from 'node:path';
import { newDek, wrapDek, encJson, sha256hex, rand } from '../../lib/crypto.mjs';

const [seedDir, secretsDir] = process.argv.slice(2);
if (!seedDir || !secretsDir) { console.error('usage: setup.mjs seedDir secretsDir'); process.exit(1); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const userKey = (u) => sha256hex('pg-pt:user:' + u.trim().toLowerCase());
const hex = (n) => [...rand(n)].map(b => b.toString(16).padStart(2, '0')).join('');

const USERS = [{ username: 'jsmith', name: 'Jordan Smith', role: 'admin' }];
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const genPw = () => [0, 1, 2, 3].map(() => [...rand(5)].map(b => alphabet[b % alphabet.length]).join('')).join('-');

const dek = await newDek();
const users = {}, profiles = {}, secrets = [];
for (const u of USERS) {
  const pw = genPw();
  const k = await userKey(u.username);
  users[k] = await wrapDek(dek, pw);
  profiles[k] = { username: u.username, name: u.name, role: u.role };
  secrets.push({ ...u, password: pw });
}

const now = new Date().toISOString();
const jobsIndex = {};
fs.rmSync(path.join(root, 'data'), { recursive: true, force: true });
fs.mkdirSync(path.join(root, 'data', 'jobs'), { recursive: true });
const files = fs.readdirSync(seedDir).filter(f => f.endsWith('.json')).sort();
for (const f of files) {
  const id = f.replace(/\.json$/, '');
  const job = JSON.parse(fs.readFileSync(path.join(seedDir, f), 'utf8'));
  job.createdAt = now; job.updatedAt = now; job.createdBy = 'Import'; job.updatedBy = 'Import';
  job.history = [{ t: now, by: 'Import', text: 'Imported from Weekly Tracker 9 (' + Object.keys(job.locations || {}).length + ' locations)' }];
  const file = hex(12);
  jobsIndex[id] = file;
  fs.writeFileSync(path.join(root, 'data', 'jobs', file + '.enc.json'), JSON.stringify(await encJson(dek, job)));
}
const index = { version: 1, profiles, ghToken: null, jobs: jobsIndex };
fs.writeFileSync(path.join(root, 'data', 'index.enc.json'), JSON.stringify(await encJson(dek, index)));
const config = { app: 'P&G Power Project Tracker', version: 1,
  repo: { owner: 'pgpowerbilling', repo: 'ap-invoice-tracker', branch: 'main', base: 'projects/' }, users };
fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config, null, 1));
fs.mkdirSync(secretsDir, { recursive: true });
fs.writeFileSync(path.join(secretsDir, 'project-logins.json'), JSON.stringify(secrets, null, 2));
console.log(`Setup complete: ${files.length} jobs, ${USERS.length} login(s). Secrets in ${secretsDir}/project-logins.json`);

// Loads the master template (rates + layout) and a job's pole list into the encrypted workflow data.
// Usage: JSZIP=/path/to/jszip node workflow/tools/seed.mjs <username> <password> <template.xlsx> [<job-name> <poles.json>]
// Needs JSZip on disk (npm i jszip) — pass its path in JSZIP. Adds; never removes existing jobs or records.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { sha256hex, unb64, b64, encJson, decJson, rand } from '../../lib/crypto.mjs';
const require = createRequire(import.meta.url);
globalThis.JSZip = require(process.env.JSZIP || 'jszip');
const TMPL = require('../src/tmpl.js');
const [user, pw, tmplPath, jobName, polesPath] = process.argv.slice(2);
if (!tmplPath) { console.error('usage: seed.mjs user password template.xlsx [jobName poles.json]'); process.exit(1); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const subtle = globalThis.crypto.subtle; const te = new TextEncoder();
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const ent = cfg.users[await sha256hex('pg-wf:user:' + user.trim().toLowerCase())];
if (!ent) throw new Error('No such login');
const base = await subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveKey']);
const wk = await subtle.deriveKey({ name: 'PBKDF2', salt: unb64(ent.salt), iterations: ent.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['unwrapKey']);
const dek = await subtle.unwrapKey('raw', unb64(ent.wrapped), wk, { name: 'AES-GCM', iv: unb64(ent.iv) }, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
const idxPath = path.join(root, 'data', 'index.enc.json');
const ix = await decJson(dek, JSON.parse(fs.readFileSync(idxPath, 'utf8')));
const buf = fs.readFileSync(tmplPath); const name = path.basename(tmplPath).replace(/^[0-9a-f]{8}-/, '');
const p = await TMPL.parse(buf);
const file = 'template-' + [...rand(6)].map(b => b.toString(16).padStart(2, '0')).join('') + '.enc.json';
fs.writeFileSync(path.join(root, 'data', file), JSON.stringify(await encJson(dek, { name, b64: b64(buf) })));
const by = (ix.profiles[await sha256hex('pg-wf:user:' + user.trim().toLowerCase())] || {}).name || user; const now = new Date().toISOString();
ix.rates = { areas: p.areas, units: p.units.map(u => ({ key: u.key, workType: u.workType, item: u.item, rates: u.rates })), from: p.from, terms: p.terms, customer: p.customer };
ix.template = { file, name, at: now, by, slots: p.layout.slots, perPole: p.layout.perPole };
(ix.rateLog = ix.rateLog || []).push({ t: now, by, name });
if (jobName) {
  const poles = JSON.parse(fs.readFileSync(polesPath, 'utf8'));
  const id = 'j-' + Date.now().toString(36);
  ix.jobs = ix.jobs || [];
  ix.jobs.push({ id, name: jobName, customer: p.customer || 'Eversource', po: '', wo: '', area: '', desc: 'Loaded from the customer pole packet (' + poles.length + ' poles).', archived: false, createdAt: now, createdBy: by,
    poles: poles.map((x, i) => ({ id: 'p-' + id.slice(2) + '-' + (i + 1), n: x.n, ticket: x.ticket, town: x.town, street: x.street, esPole: x.esPole, vzPole: x.vzPole, pdfPage: String(x.pdfPage), area: x.area || '', dateSet: x.dateSet || '', woJob: '', notes: x.notes || '' })) });
}
fs.writeFileSync(idxPath, JSON.stringify(await encJson(dek, ix)));
console.log('Seeded: ' + p.units.length + ' units × ' + p.areas.length + ' areas, ' + p.layout.slots + ' slots' + (jobName ? '; job "' + jobName + '"' : ''));

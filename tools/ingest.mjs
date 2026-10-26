// Daily scan helper: adds newly found vendor invoices to the tracker without needing any login.
// Each invoice is sealed to the tracker's public key; the app merges them the next time anyone signs in.
// Usage: node tools/ingest.mjs new-invoices.json
//   new-invoices.json = [{vendor, invoiceNo, invoiceDate (YYYY-MM-DD), amount, location, ref, received, source, note?, billingHint?}]
import fs from 'node:fs';
import path from 'node:path';
import { sealToPub, invKey, rand } from '../lib/crypto.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: ingest.mjs new-invoices.json'); process.exit(1); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const seenPath = path.join(root, 'seen.json');
const seen = new Set(JSON.parse(fs.readFileSync(seenPath, 'utf8')));
const idxPath = path.join(root, 'inbox', 'index.json');
const index = JSON.parse(fs.readFileSync(idxPath, 'utf8'));

const required = ['vendor', 'invoiceNo', 'invoiceDate', 'amount', 'received', 'source'];
const items = JSON.parse(fs.readFileSync(file, 'utf8'));
const fresh = [], skipped = [], invalid = [];
for (const it of items) {
  const missing = required.filter(k => it[k] === undefined || it[k] === null || it[k] === '');
  if (missing.length || !/^\d{4}-\d{2}-\d{2}$/.test(it.invoiceDate) || typeof it.amount !== 'number') { invalid.push({ it, missing }); continue; }
  const key = await invKey(it.vendor, it.invoiceNo);
  if (seen.has(key)) { skipped.push(`${it.vendor} #${it.invoiceNo}`); continue; }
  seen.add(key); fresh.push(it);
}
if (fresh.length) {
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Buffer.from(rand(4)).toString('hex')}.json`;
  const sealed = await sealToPub(config.pubKey, { addedAt: new Date().toISOString(), invoices: fresh });
  fs.writeFileSync(path.join(root, 'inbox', name), JSON.stringify(sealed));
  index.push(name);
  fs.writeFileSync(idxPath, JSON.stringify(index));
  fs.writeFileSync(seenPath, JSON.stringify([...seen]));
}
console.log(JSON.stringify({ added: fresh.map(i => `${i.vendor} #${i.invoiceNo}`), alreadyLogged: skipped, invalid }, null, 1));

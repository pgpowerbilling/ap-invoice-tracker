// Builds workflow/index.html from src/shell.html + src/app.js, reusing the Project Tracker's base styles so both apps look the same.
// Usage: node workflow/tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const proj = fs.readFileSync(path.join(root, '..', 'projects', 'index.html'), 'utf8');
const m = /<style>\n([\s\S]*?)<\/style>/.exec(proj);
if (!m) throw new Error('Base styles not found in projects/index.html');
const shell = fs.readFileSync(path.join(root, 'src', 'shell.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const tmpl = fs.readFileSync(path.join(root, 'src', 'tmpl.js'), 'utf8');
const pkg = fs.readFileSync(path.join(root, 'src', 'pkg.js'), 'utf8');
const out = shell.replace('/*@@BASECSS@@*/', () => m[1].trimEnd()).replace('/*@@TMPLJS@@*/', () => tmpl.trimEnd()).replace('/*@@PKGJS@@*/', () => pkg.trimEnd()).replace('/*@@APPJS@@*/', () => app.trimEnd());
fs.writeFileSync(path.join(root, 'index.html'), out);
console.log('Built workflow/index.html (' + out.length + ' bytes)');

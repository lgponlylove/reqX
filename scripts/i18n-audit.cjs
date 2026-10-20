const fs = require('fs'), path = require('path');
const esbuild = require('esbuild');

// Đếm key thật bằng cách bundle+chạy translations.ts (tránh parser tự viết sai)
const out = esbuild.buildSync({
  entryPoints: ['src/i18n/translations.ts'], bundle: true, format: 'cjs', write: false, platform: 'node',
}).outputFiles[0].text;
const mod = { exports: {} };
new Function('module', 'exports', out)(mod, mod.exports);
const translations = mod.exports.translations;

function flat(obj, pre = '') {
  const r = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') Object.assign(r, flat(v, pre ? pre + '.' + k : k));
    else r[pre ? pre + '.' + k : k] = v;
  }
  return r;
}
const vi = flat(translations.vi), en = flat(translations.en);

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(e.name) && !p.includes(path.join('src', 'i18n')) && !p.includes('__tests__')) files.push(p);
  }
})('src');

const used = new Map();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bt\.([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+)/g)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(f);
  }
}
const missVi = [], missEn = [];
for (const [k, fset] of used) {
  const f = [...fset][0];
  if (!(k in vi)) missVi.push(k + '   <- ' + f);
  if (!(k in en)) missEn.push(k + '   <- ' + f);
}
console.log('key t.* dùng trong code:', used.size, '| từ điển vi:', Object.keys(vi).length, '| en:', Object.keys(en).length);
console.log('DÙNG NHƯNG THIẾU TRONG vi:', missVi.length);
missVi.slice(0, 40).forEach((x) => console.log('   VI-MISS', x));
console.log('DÙNG NHƯNG THIẾU TRONG en:', missEn.length);
missEn.slice(0, 40).forEach((x) => console.log('   EN-MISS', x));

const phBad = [];
for (const [k, fset] of used) {
  const v = vi[k];
  if (typeof v !== 'string') continue;
  const toks = [...v.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);
  if (!toks.length) continue;
  for (const f of fset) {
    const s = fs.readFileSync(f, 'utf8');
    const lines = s.split('\n').filter((l) => l.includes('t.' + k));
    for (const t of toks) {
      if (!lines.some((l) => l.includes('{' + t + '}'))) {
        phBad.push(k + ' có {' + t + '} nhưng không thấy .replace ở ' + path.basename(f));
      }
    }
  }
}
console.log('Placeholder {x} không được thay:', phBad.length);
phBad.slice(0, 25).forEach((x) => console.log('   PH', x));

const vk = Object.keys(vi), ek = Object.keys(en);
console.log('key chỉ có ở vi (thiếu en):', vk.filter((k) => !ek.includes(k)).length, vk.filter((k) => !ek.includes(k)).slice(0, 12));
console.log('key chỉ có ở en (thiếu vi):', ek.filter((k) => !vk.includes(k)).length, ek.filter((k) => !vk.includes(k)).slice(0, 12));

// key có trong từ điển nhưng code chưa dùng lần nào
const unused = vk.filter((k) => !used.has(k) && !s2(k));
function s2(k) {
  // cho phép dùng qua biến trung gian như i18n.dock[...]
  return [...used.keys()].some((u) => u.split('.')[0] === k.split('.')[0] && u.split('.')[1] === k.split('.')[1]);
}
console.log('key định nghĩa mà chưa thấy dùng trực tiếp:', vk.filter((k) => !used.has(k)).length, '/', vk.length);

// 静的チェック（npm run check）: manifest の参照・構文・MV3 の制約・バージョンの整合を確認する。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension');
const errors = [];
const err = (m) => errors.push(m);
const exists = (rel) => fs.existsSync(path.join(ext, rel));

const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));

// 1) manifest が参照するファイルが存在する
const refs = new Set();
for (const cs of manifest.content_scripts || []) for (const f of [...(cs.js || []), ...(cs.css || [])]) refs.add(f);
refs.add(manifest.background.service_worker);
if (manifest.options_page) refs.add(manifest.options_page);
Object.values(manifest.icons || {}).forEach((f) => refs.add(f));
for (const r of manifest.declarative_net_request?.rule_resources || []) refs.add(r.path);
for (const f of refs) if (!exists(f)) err(`manifest が参照するファイルがありません: ${f}`);

// 2) JS の構文チェック（クラシックスクリプトとして）と MV3 で禁止されるコード
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (d.name === '_metadata' ? [] : walk(path.join(dir, d.name))) : [path.join(dir, d.name)]));
const files = walk(ext);
for (const f of files.filter((x) => x.endsWith('.js'))) {
  const code = fs.readFileSync(f, 'utf8');
  try {
    new vm.Script(code, { filename: path.relative(root, f) });
  } catch (e) {
    err(`構文エラー: ${path.relative(root, f)}: ${e.message}`);
  }
  if (/\beval\s*\(|new\s+Function\s*\(/.test(code)) err(`eval / new Function は使えません: ${path.relative(root, f)}`);
  if (/<script[^>]+src=["']https?:/i.test(code) || /importScripts\(\s*["']https?:/.test(code)) err(`リモートコードは読み込めません: ${path.relative(root, f)}`);
}

// 3) JSON（ルール）の整合: id の重複がない
const seen = new Map();
for (const r of manifest.declarative_net_request?.rule_resources || []) {
  const rules = JSON.parse(fs.readFileSync(path.join(ext, r.path), 'utf8'));
  for (const rule of rules) {
    if (seen.has(rule.id)) err(`DNR ルール id が重複: ${rule.id}（${seen.get(rule.id)} と ${r.path}）`);
    seen.set(rule.id, r.path);
    const re = rule.condition?.regexFilter;
    if (re) {
      try {
        new RegExp(re);
      } catch (e) {
        err(`regexFilter が不正: ${r.path} #${rule.id}`);
      }
    }
  }
}

// 4) HTML が参照するローカルのスクリプト・CSS が存在する
for (const f of files.filter((x) => x.endsWith('.html'))) {
  const html = fs.readFileSync(f, 'utf8');
  for (const m of html.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/g)) {
    const u = m[1];
    if (/^(https?:|data:|#)/.test(u)) {
      if (/^https?:/.test(u) && /<script/.test(m[0])) err(`リモートスクリプト: ${path.relative(root, f)} → ${u}`);
      continue;
    }
    const target = path.resolve(path.dirname(f), u);
    if (!fs.existsSync(target)) err(`HTML の参照先がありません: ${path.relative(root, f)} → ${u}`);
  }
}

// 5) バージョンの整合（manifest / package.json / SV.VERSION）
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const svSrc = fs.readFileSync(path.join(ext, 'common', 'sv.js'), 'utf8');
const svVersion = /SV\.VERSION\s*=\s*'([^']+)'/.exec(svSrc)?.[1];
if (manifest.version !== pkg.version) err(`バージョン不一致: manifest ${manifest.version} / package.json ${pkg.version}`);
if (manifest.version !== svVersion) err(`バージョン不一致: manifest ${manifest.version} / sv.js ${svVersion}`);

// 6) 権限は最小限（想定外の追加を検知する）
const allowedPerms = new Set(['declarativeNetRequest', 'storage']);
for (const p of manifest.permissions || []) if (!allowedPerms.has(p)) err(`想定外の権限: ${p}（追加する場合は docs/SPEC.md の権限方針を更新してください）`);
for (const h of manifest.host_permissions || []) if (!/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be|tver\.jp)\//.test(h)) err(`想定外のホスト権限: ${h}`);

if (errors.length) {
  console.error('✗ チェックに失敗しました\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log(`✓ OK（JS ${files.filter((f) => f.endsWith('.js')).length} 件、HTML ${files.filter((f) => f.endsWith('.html')).length} 件、DNR ルール ${seen.size} 件、権限 ${(manifest.permissions || []).join(', ')}）`);

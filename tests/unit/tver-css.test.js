'use strict';
// tver.css / watch.css の回帰テスト。
//  - 性能（docs/NOTES.md の「ビルボードのラグ」）: `html:has(nav:focus-within) main` と `.keen-slider__slide:has(a:focus)::after` は、約 8,000 要素の実サイトで
//    フォーカスの移動・class の切り替えのたびに 100〜140ms のスタイル再計算（キー 1 回あたり 3 回 ≒ 330ms）を起こした。
//    根（html/body）や スライダーのスライドを基点にした :has() は書かない（兄弟セレクタ・要素自身の疑似要素で書く）。
//  - /tv にはアニメーションが一切ない（docs/SPEC.md 9.2）: トランジション・アニメーションは付けない（切るための none / 0s だけ）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'sites', 'tver', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const FILES = { 'tver.css': read('tver.css'), 'watch.css': read('watch.css') };

const rulesOf = (css) => {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ selectors: m[1].split(',').map((s) => s.trim()), body: m[2] });
  return out;
};

for (const [name, css] of Object.entries(FILES)) {
  test(`${name}: html / body / スライダーのスライドを基点にした :has() を使わない`, () => {
    const bad = rulesOf(css)
      .flatMap((r) => r.selectors)
      .filter((s) => /:has\(/.test(s) && (/^(html|body)\b[^ ]*:has\(/.test(s) || /keen-slider__slide[^ ]*:has\(/.test(s)));
    assert.deepEqual(bad, []);
  });
}

test('watch.css: トランジション・アニメーションを付けない（切る none / 0s だけ。/tv の視聴画面にもない）', () => {
  const bad = [];
  for (const r of rulesOf(FILES['watch.css'])) {
    for (const m of r.body.matchAll(/(?:^|;)\s*(transition|animation)(?:-[a-z-]+)?\s*:\s*([^;]+)/g)) {
      const v = m[2].replace(/!important/, '').trim();
      if (!/^(none|0s)$/.test(v)) bad.push(`${r.selectors[0]} { ${m[1]}: ${v} }`);
    }
  }
  assert.deepEqual(bad, []);
});

test('watch.css: 操作の判断に使う属性（html[data-sv-ui] / data-sv-focus）と、watch.js が付けるクラスだけを前提にする', () => {
  const css = FILES['watch.css'];
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'sites', 'tver', 'watch.js'), 'utf8');
  // CSS が参照する html のクラス（sv-watch, sv-ended, sv-ad, sv-live, sv-loading, sv-leaving）は、すべて watch.js が付ける
  const used = new Set([...css.matchAll(/html\.(sv-[a-z]+)/g)].map((m) => m[1]));
  for (const c of used) assert.ok(js.includes(`'${c}'`), `watch.js が ${c} を付けない`);
  for (const a of ['data-sv-ui', 'data-sv-focus']) {
    assert.ok(css.includes(a) && js.includes(a), `${a} が CSS と JS の両方にある`);
  }
});

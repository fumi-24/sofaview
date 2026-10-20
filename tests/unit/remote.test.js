const test = require('node:test');
const assert = require('node:assert/strict');
require('../../extension/common/sv.js');
const remote = require('../../extension/common/remote.js');

// YouTube /tv が dpadCommand で出すイベント（実測）: 合成・key なし・keyCode のみ
const ev = (o) => ({ isTrusted: false, key: undefined, keyCode: 38, ...o });

test('YouTube /tv の dpadCommand のイベントを論理名にする', () => {
  assert.equal(remote.nameFromYoutube(ev({ keyCode: 38 })), 'UP');
  assert.equal(remote.nameFromYoutube(ev({ keyCode: 40 })), 'DOWN');
  assert.equal(remote.nameFromYoutube(ev({ keyCode: 37 })), 'LEFT');
  assert.equal(remote.nameFromYoutube(ev({ keyCode: 39 })), 'RIGHT');
  assert.equal(remote.nameFromYoutube(ev({ keyCode: 13 })), 'ENTER');
  assert.equal(remote.nameFromYoutube(ev({ keyCode: 27 })), 'BACK');
});

test('実際のキーボード（isTrusted）・key を持つ合成イベント・修飾キー・対象外のキーは無視する', () => {
  assert.equal(remote.nameFromYoutube(ev({ isTrusted: true })), null);
  assert.equal(remote.nameFromYoutube(ev({ key: 'ArrowUp' })), null);
  assert.equal(remote.nameFromYoutube(ev({ ctrlKey: true })), null);
  assert.equal(remote.nameFromYoutube(ev({ keyCode: 65 })), null);
  assert.equal(remote.nameFromYoutube(null), null);
});

/* ============================================================
 * versions.js — 歌詞+基本情報のスナップショット（バージョン管理）
 *   ※ 音声・動画はバージョンに含まれない。
 *   - VersionLib.snapshot(song, note) : 現在の曲から版を作成・保存
 *   - VersionLib.diffLines(oldText, newText) : 行単位の簡易差分
 * ============================================================ */
(function (global) {
  'use strict';

  async function snapshot(song, note) {
    const v = {
      id: DB.uid('v_'),
      songId: song.id,
      createdAt: new Date().toISOString(),
      title: song.title,
      status: song.status,
      tags: Array.isArray(song.tags) ? song.tags.slice() : [],
      lyrics: song.lyrics || '',
      note: note || '',
    };
    await DB.Versions.put(v);
    return v;
  }

  // LCS ベースの行単位差分
  function diffLines(oldText, newText) {
    const a = (oldText || '').split('\n');
    const b = (newText || '').split('\n');
    const n = a.length, m = b.length;
    // LCS テーブル
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++; }
      else { out.push({ type: 'add', text: b[j] }); j++; }
    }
    while (i < n) { out.push({ type: 'del', text: a[i] }); i++; }
    while (j < m) { out.push({ type: 'add', text: b[j] }); j++; }
    return out;
  }

  global.VersionLib = { snapshot, diffLines };
})(window);

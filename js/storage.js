/* ============================================================
 * storage.js — ストレージ使用量の実測と種別内訳
 *   navigator.storage.estimate() で実測（無料・通信なし）。
 *   非対応時は保存済みサイズ合計を表示し、上限は「不明」とする。
 * ============================================================ */
(function (global) {
  'use strict';

  function fmtBytes(n) {
    if (n == null || isNaN(n)) return '—';
    if (n < 1024) return n + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v)) + ' ' + units[i];
  }

  // 保存済みデータを走査して種別ごとの内訳を算出
  async function breakdown() {
    const [media, songs, versions] = await Promise.all([
      DB.Media.all(), DB.Songs.all(), DB.Versions.all(),
    ]);
    let video = 0, audio = 0;
    for (const m of media) {
      const size = m.size || (m.blob ? m.blob.size : 0);
      if (m.kind === 'video') video += size; else audio += size;
    }
    // 歌詞・メタはテキストのバイト数で概算
    let lyrics = 0;
    const encLen = (s) => (s ? new Blob([s]).size : 0);
    for (const s of songs) {
      lyrics += encLen(s.lyrics) + encLen(s.title) + encLen((s.tags || []).join(',')) + encLen(s.status);
    }
    for (const v of versions) {
      lyrics += encLen(v.lyrics) + encLen(v.title) + encLen((v.tags || []).join(',')) + encLen(v.note);
    }
    return { video, audio, lyrics, storedTotal: video + audio + lyrics };
  }

  // ブラウザ実測（quota/usage）。非対応なら supported:false
  async function estimate() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        return { supported: true, usage: est.usage || 0, quota: est.quota || 0 };
      } catch (e) {
        return { supported: false };
      }
    }
    return { supported: false };
  }

  // 永続化要求（ブラウザに削除されにくくする）
  async function requestPersist() {
    if (navigator.storage && navigator.storage.persist) {
      try {
        const already = await (navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false));
        if (already) return true;
        return await navigator.storage.persist();
      } catch (e) { return false; }
    }
    return false;
  }

  async function summary() {
    const [bd, est] = await Promise.all([breakdown(), estimate()]);
    return { ...bd, ...est };
  }

  global.StorageInfo = { fmtBytes, breakdown, estimate, requestPersist, summary };
})(window);

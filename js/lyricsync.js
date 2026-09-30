/* ============================================================
 * lyricsync.js — 歌詞のトークン化とカラオケ補間（依存ゼロ・純関数）
 *   - LyricSync.tokenizeLyrics(lyrics) -> { rows, tokens }
 *       rows: 描画用（{type:'label',text} または {type:'lyric', segs:[{text,space,gindex?}]}）
 *       tokens: 同期対象の語（フラット）[{text}]。times[] と1:1対応。
 *   - LyricSync.charStateAt(tokens, times, duration, elapsed) -> number[]（各語の塗り文字数）
 *   - LyricSync.validate(sync, lyrics) -> boolean（歌詞変更検知）
 *   ※ [ラベル]のみの行は見出し（非同期）。歌詞行はインラインコード [C] を除去し空白で語分割。
 * ============================================================ */
(function (global) {
  'use strict';

  function isLabel(line) { return /^\s*\[[^\]]+\]\s*$/.test(line); }
  function stripChords(line) { return line.replace(/\[[^\]]+\]/g, ''); }

  function tokenizeLyrics(lyrics) {
    const lines = (lyrics || '').split('\n');
    const rows = []; const tokens = [];
    lines.forEach(line => {
      if (isLabel(line)) { rows.push({ type: 'label', text: line.trim() }); return; }
      const cleaned = stripChords(line);
      const segs = [];
      cleaned.split(/(\s+)/).forEach(pt => {
        if (pt === '') return;
        if (/^\s+$/.test(pt)) { segs.push({ text: pt, space: true }); }
        else { const gindex = tokens.length; tokens.push({ text: pt }); segs.push({ text: pt, space: false, gindex }); }
      });
      rows.push({ type: 'lyric', segs });
    });
    return { rows, tokens };
  }

  function charsSungFor(i, tokens, times, duration, elapsed) {
    const start = times[i];
    if (start == null) return 0;
    const len = tokens[i].text.length;
    if (elapsed <= start) return 0;
    let end = (i + 1 < times.length && times[i + 1] != null) ? times[i + 1] : duration;
    if (end == null || end <= start) return len; // 計測不能→開始済みなら全塗り
    if (elapsed >= end) return len;
    return Math.min(len, Math.floor((elapsed - start) / (end - start) * len + 1e-9));
  }

  function charStateAt(tokens, times, duration, elapsed) {
    const fill = new Array(tokens.length);
    for (let i = 0; i < tokens.length; i++) fill[i] = charsSungFor(i, tokens, times, duration, elapsed);
    return fill;
  }

  function validate(sync, lyrics) {
    if (!sync || !Array.isArray(sync.tokens) || !Array.isArray(sync.times)) return false;
    const { tokens } = tokenizeLyrics(lyrics);
    if (tokens.length !== sync.tokens.length || sync.times.length !== sync.tokens.length) return false;
    for (let i = 0; i < tokens.length; i++) if (tokens[i].text !== sync.tokens[i]) return false;
    return tokens.length > 0;
  }

  global.LyricSync = { tokenizeLyrics, charStateAt, validate, isLabel, stripChords };
})(window);

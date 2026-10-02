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
    const rows = []; const tokens = []; const chordAnchors = [];
    lines.forEach(line => {
      if (isLabel(line)) { rows.push({ type: 'label', text: line.trim() }); return; }
      const segs = [];
      // インラインコードを抽出しつつ「直後の語（トークン）」に紐づける
      const re = /\[([^\]]+)\]/g; let pos = 0, m; const pieces = [];
      while ((m = re.exec(line)) !== null) { pieces.push({ t: 'text', v: line.slice(pos, m.index) }); pieces.push({ t: 'chord', v: m[1] }); pos = m.index + m[0].length; }
      pieces.push({ t: 'text', v: line.slice(pos) });
      pieces.forEach(pc => {
        if (pc.t === 'chord') { chordAnchors.push({ chord: pc.v, tokenIndex: tokens.length }); return; }
        pc.v.split(/(\s+)/).forEach(sub => {
          if (sub === '') return;
          if (/^\s+$/.test(sub)) { segs.push({ text: sub, space: true }); }
          else { const gindex = tokens.length; tokens.push({ text: sub }); segs.push({ text: sub, space: false, gindex }); }
        });
      });
      rows.push({ type: 'lyric', segs });
    });
    return { rows, tokens, chordAnchors };
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

  // --- コード変化アンカー方式（曲同期） ---
  // 歌詞を「掃引対象の文字列」に展開。rows(描画用)・totalChars・anchors(インラインコード位置) を返す。
  function flattenChars(lyrics) {
    const lines = (lyrics || '').split('\n');
    const rows = []; const anchors = []; let g = 0;
    lines.forEach(line => {
      if (isLabel(line)) { rows.push({ type: 'label', text: line.trim() }); return; }
      const segs = [];
      const re = /\[([^\]]+)\]/g; let pos = 0, m; const pieces = [];
      while ((m = re.exec(line)) !== null) { pieces.push({ t: 'text', v: line.slice(pos, m.index) }); pieces.push({ t: 'chord', v: m[1] }); pos = m.index + m[0].length; }
      pieces.push({ t: 'text', v: line.slice(pos) });
      pieces.forEach(pc => {
        if (pc.t === 'chord') { anchors.push({ chord: pc.v, g: g }); return; }
        for (const ch of pc.v) { segs.push({ g: g, ch: ch }); g++; }
      });
      rows.push({ type: 'lyric', segs });
    });
    return { rows, totalChars: g, anchors };
  }

  // 文字 g の「歌われる時刻(秒)」を、アンカー秒を文字位置で線形補間して求める
  function charTime(g, anchors, times, duration, totalChars) {
    if (!anchors.length) return (g / Math.max(1, totalChars)) * duration;
    if (g < anchors[0].g) { const b = anchors[0].g; return (times[0]) * ((g - 0) / Math.max(1, b - 0)); }
    let k = 0;
    for (let i = 0; i < anchors.length; i++) { if (g >= anchors[i].g) k = i; else break; }
    const segStart = times[k];
    const segEnd = (k + 1 < anchors.length) ? times[k + 1] : duration;
    const a = anchors[k].g;
    const b = (k + 1 < anchors.length) ? anchors[k + 1].g : totalChars;
    if (b <= a) return segStart;
    return segStart + (segEnd - segStart) * ((g - a) / (b - a));
  }
  // 全文字の歌唱時刻配列（再生前に1回計算して使い回す）
  function computeCharTimes(totalChars, anchors, times, duration) {
    const ct = new Array(totalChars);
    for (let g = 0; g < totalChars; g++) ct[g] = charTime(g, anchors, times, duration, totalChars);
    return ct;
  }
  // 歌詞変更検知：現在のアンカー(コード列・位置)が sync と一致するか
  function validateAnchors(sync, lyrics) {
    if (!sync || !Array.isArray(sync.chords) || !Array.isArray(sync.times) || !Array.isArray(sync.positions)) return false;
    const { anchors } = flattenChars(lyrics);
    if (anchors.length !== sync.chords.length || sync.times.length !== sync.chords.length || sync.positions.length !== sync.chords.length) return false;
    for (let i = 0; i < anchors.length; i++) { if (anchors[i].chord !== sync.chords[i] || anchors[i].g !== sync.positions[i]) return false; }
    return anchors.length > 0;
  }

  global.LyricSync = { tokenizeLyrics, charStateAt, validate, isLabel, stripChords, flattenChars, computeCharTimes, validateAnchors };
})(window);

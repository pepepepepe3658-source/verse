/* ============================================================
 * chords.js — コード理論ユーティリティ（依存ゼロ）
 *   - ChordLib.parse(sym)         : "Cmaj7" 等を解析
 *   - ChordLib.freqs(sym, base)   : 構成音の周波数配列（A4=440平均律）
 *   - ChordLib.transpose(sym, n, preferFlat) : 半音移調して表記を返す
 *   - ChordLib.preferFlatForKey(tonicPc)     : キーに応じ♭優先か
 *   - ChordLib.spell(pc, preferFlat)         : 音名表記
 *   - ChordLib.QUALITIES / ROOTS             : 入力パレット用
 *   - ChordLib.defaultProgression() / ensure(song)
 *   ※ 主要＋軽めのテンションに対応。未知シンボルはそのまま表示・再生スキップ。
 * ============================================================ */
(function (global) {
  'use strict';

  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  // クオリティ定義（suffix=表示, intervals=ルートからの半音, aliases=解析用の別表記）
  // ※ m と M は大文字小文字を区別する（m=マイナー, M/maj=メジャー）
  const QUALITIES = [
    { suffix: '',      label: 'major',  intervals: [0, 4, 7],        aliases: ['maj', 'M'] },
    { suffix: 'm',     label: 'minor',  intervals: [0, 3, 7],        aliases: ['min', '-'] },
    { suffix: '7',     label: '7',      intervals: [0, 4, 7, 10],    aliases: ['dom7'] },
    { suffix: 'm7',    label: 'm7',     intervals: [0, 3, 7, 10],    aliases: ['min7', '-7'] },
    { suffix: 'maj7',  label: 'maj7',   intervals: [0, 4, 7, 11],    aliases: ['M7', 'major7'] },
    { suffix: '6',     label: '6',      intervals: [0, 4, 7, 9],     aliases: [] },
    { suffix: 'm6',    label: 'm6',     intervals: [0, 3, 7, 9],     aliases: ['min6'] },
    { suffix: 'sus4',  label: 'sus4',   intervals: [0, 5, 7],        aliases: ['sus'] },
    { suffix: 'sus2',  label: 'sus2',   intervals: [0, 2, 7],        aliases: [] },
    { suffix: '7sus4', label: '7sus4',  intervals: [0, 5, 7, 10],    aliases: ['7sus'] },
    { suffix: 'dim',   label: 'dim',    intervals: [0, 3, 6],        aliases: ['o'] },
    { suffix: 'dim7',  label: 'dim7',   intervals: [0, 3, 6, 9],     aliases: ['o7'] },
    { suffix: 'm7b5',  label: 'm7b5',   intervals: [0, 3, 6, 10],    aliases: ['m7-5'] },
    { suffix: 'aug',   label: 'aug',    intervals: [0, 4, 8],        aliases: ['+', 'aug5'] },
    { suffix: 'add9',  label: 'add9',   intervals: [0, 4, 7, 14],    aliases: ['add2'] },
    { suffix: 'madd9', label: 'madd9',  intervals: [0, 3, 7, 14],    aliases: ['madd2'] },
    { suffix: '9',     label: '9',      intervals: [0, 4, 7, 10, 14], aliases: [] },
    { suffix: 'm9',    label: 'm9',     intervals: [0, 3, 7, 10, 14], aliases: ['min9'] },
    { suffix: 'maj9',  label: 'maj9',   intervals: [0, 4, 7, 11, 14], aliases: ['M9'] },
    { suffix: '69',    label: '6/9',    intervals: [0, 4, 7, 9, 14], aliases: ['6/9'] },
  ];

  const ROOTS = SHARP.slice(); // パレットのルート候補（表示はSHARP、必要に応じ移調で♭化）

  function accToDelta(a) {
    if (a === '#' || a === '♯') return 1;
    if (a === 'b' || a === '♭') return -1;
    return 0;
  }

  function readRoot(str) {
    const m = str.match(/^([A-Ga-g])([#b♯♭]?)/);
    if (!m) return null;
    let pc = LETTER_PC[m[1].toUpperCase()];
    pc = (pc + accToDelta(m[2]) + 12) % 12;
    return { pc, len: m[0].length };
  }

  function findQuality(rest) {
    for (const q of QUALITIES) {
      if (rest === q.suffix) return q;
      for (const a of q.aliases) if (rest === a) return q;
    }
    return null;
  }

  // "Cmaj7/G" 等を解析。失敗時 null。
  function parse(sym) {
    if (typeof sym !== 'string') return null;
    const s = sym.trim();
    if (!s) return null;
    const r = readRoot(s);
    if (!r) return null;
    let rest = s.slice(r.len);

    let bassPc = null;
    const slash = rest.indexOf('/');
    if (slash >= 0) {
      const b = readRoot(rest.slice(slash + 1));
      if (b) bassPc = b.pc;
      rest = rest.slice(0, slash);
    }
    const q = findQuality(rest);
    if (!q) return null; // 未知のクオリティ
    return { rootPc: r.pc, quality: q, suffix: q.suffix, bassPc };
  }

  function spell(pc, preferFlat) {
    pc = ((pc % 12) + 12) % 12;
    return (preferFlat ? FLAT : SHARP)[pc];
  }

  // 曲のキー（主音pc）に応じて♭優先か判定（F,Bb,Eb,Ab,Db 系は♭）
  function preferFlatForKey(tonicPc) {
    return [5, 10, 3, 8, 1].indexOf(((tonicPc % 12) + 12) % 12) >= 0;
  }

  // 半音移調して表記文字列を返す（解析不能ならそのまま返す）
  function transpose(sym, semi, preferFlat) {
    const p = parse(sym);
    if (!p) return sym;
    const nr = (p.rootPc + semi) % 12;
    let out = spell(nr, preferFlat) + p.suffix;
    if (p.bassPc != null) out += '/' + spell((p.bassPc + semi) % 12, preferFlat);
    return out;
  }

  function noteToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // 構成音のピッチクラス配列
  function pcs(sym) {
    const p = parse(sym);
    if (!p) return null;
    return p.quality.intervals.map(i => (p.rootPc + i) % 12);
  }

  // 構成音の周波数配列。base=ルートの基準MIDI（既定48=C3）。bassは1oct下。
  function freqs(sym, base) {
    const p = parse(sym);
    if (!p) return [];
    const rootMidi = (base == null ? 48 : base) + p.rootPc;
    const out = p.quality.intervals.map(i => noteToFreq(rootMidi + i));
    if (p.bassPc != null) out.unshift(noteToFreq(rootMidi - 12 + ((p.bassPc - p.rootPc + 12) % 12)));
    return out;
  }

  function isValid(sym) { return parse(sym) != null; }

  function defaultProgression() {
    return { tempo: 90, beatsPerBar: 4, beatUnit: 4, capo: 0, transpose: 0, style: 'block', loop: false, sections: [] };
  }

  // song.chords を既定値で補完（後方互換）
  function ensure(song) {
    const d = defaultProgression();
    if (!song.chords || typeof song.chords !== 'object') { song.chords = d; return song.chords; }
    const c = song.chords;
    for (const k in d) if (c[k] == null) c[k] = d[k];
    if (!Array.isArray(c.sections)) c.sections = [];
    return c;
  }

  // 進行中の最初の解析可能コードの主音pc（表記♯♭の自動判定に使用）
  function tonicPc(chords) {
    for (const s of (chords.sections || [])) {
      for (const bar of (s.bars || [])) {
        for (const sym of (bar.chords || [])) {
          const p = parse(sym);
          if (p) return p.rootPc;
        }
      }
    }
    return 0;
  }

  global.ChordLib = {
    parse, pcs, freqs, transpose, spell, preferFlatForKey, noteToFreq, isValid,
    defaultProgression, ensure, tonicPc,
    QUALITIES, ROOTS, SHARP, FLAT,
  };
})(window);

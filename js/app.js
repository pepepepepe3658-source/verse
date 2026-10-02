/* ============================================================
 * app.js — 画面制御・一覧/詳細/検索・各種操作の統括
 * ============================================================ */
(function () {
  'use strict';

  const STATUSES = ['アイデア', '作詞中', '作曲中', 'デモ', '完成'];
  const SECTION_HINT = '[Intro] [Aメロ] [Bメロ] [サビ] [2番] [ラスサビ]';

  const state = {
    songs: [],
    selectedId: null,
    filterStatus: '',   // '' = すべて
    query: '',
  };

  let activePlayers = [];  // 破棄管理

  // ---- DOM 参照 ----
  const $ = (id) => document.getElementById(id);
  const songListEl = $('songList');
  const listEmptyEl = $('listEmpty');
  const detailEmptyEl = $('detailEmpty');
  const detailBodyEl = $('detailBody');
  const searchInput = $('searchInput');
  const statusFilterEl = $('statusFilter');

  // ---- ユーティリティ ----
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === 'class') node.className = props[k];
      else if (k === 'text') node.textContent = props[k];
      else if (k === 'html') node.innerHTML = props[k];
      else if (k.startsWith('on') && typeof props[k] === 'function') node.addEventListener(k.slice(2), props[k]);
      else if (k === 'hidden') { if (props[k]) node.hidden = true; }
      else if (props[k] != null) node.setAttribute(k, props[k]);
    }
    if (children) (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function parseTags(str) {
    return String(str || '').split(/[,、\s]+/).map(t => t.trim()).filter(Boolean);
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function destroyPlayers() {
    activePlayers.forEach(p => { try { p.destroy(); } catch (e) {} });
    activePlayers = [];
  }

  // ==========================================================
  // モーダル
  // ==========================================================
  function openModal(title, contentNode, footerNodes) {
    $('modalTitle').textContent = title;
    const c = $('modalContent'); c.innerHTML = ''; c.appendChild(contentNode);
    const f = $('modalFooter'); f.innerHTML = '';
    (footerNodes || []).forEach(n => f.appendChild(n));
    $('modalOverlay').hidden = false;
  }
  function closeModal() { if (window.Karaoke) { try { Karaoke.stop(); } catch (e) {} } $('modalOverlay').hidden = true; $('modalContent').innerHTML = ''; }
  $('modalClose').addEventListener('click', closeModal);
  $('modalOverlay').addEventListener('click', (e) => { if (e.target === $('modalOverlay')) closeModal(); });

  // 確認ダイアログ
  function confirmDialog(message, okLabel, danger) {
    return new Promise((resolve) => {
      const body = el('div', {}, [el('p', { text: message, style: 'margin:0 0 4px' })]);
      const cancel = el('button', { class: 'btn', text: 'キャンセル', onclick: () => { closeModal(); resolve(false); } });
      const ok = el('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), text: okLabel || 'OK', onclick: () => { closeModal(); resolve(true); } });
      openModal('確認', body, [cancel, ok]);
    });
  }

  // ==========================================================
  // 一覧
  // ==========================================================
  function renderStatusFilter() {
    statusFilterEl.innerHTML = '';
    const mk = (label, val) => el('button', {
      class: 'chip', 'aria-pressed': state.filterStatus === val ? 'true' : 'false',
      text: label, onclick: () => { state.filterStatus = val; renderStatusFilter(); renderList(); }
    });
    statusFilterEl.appendChild(mk('すべて', ''));
    STATUSES.forEach(s => statusFilterEl.appendChild(mk(s, s)));
  }

  function filteredSongs() {
    const q = state.query.trim().toLowerCase();
    return state.songs
      .filter(s => !state.filterStatus || s.status === state.filterStatus)
      .filter(s => {
        if (!q) return true;
        const hay = [s.title, s.lyrics, s.status, (s.tags || []).join(' '), chordSymbolsText(s)].join('\n').toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  function renderList() {
    const items = filteredSongs();
    songListEl.innerHTML = '';
    listEmptyEl.hidden = items.length > 0 || state.songs.length === 0;
    if (state.songs.length === 0) { listEmptyEl.hidden = false; listEmptyEl.textContent = '曲がありません。「＋ 新規」から追加してください。'; }
    else if (items.length === 0) { listEmptyEl.hidden = false; listEmptyEl.textContent = '該当する曲がありません。'; }

    for (const s of items) {
      const tags = (s.tags || []).slice(0, 4).map(t => el('span', { class: 'tag', text: '#' + t }));
      const item = el('li', {
        class: 'song-item', 'aria-selected': s.id === state.selectedId ? 'true' : 'false',
        role: 'button', tabindex: '0',
        onclick: () => selectSong(s.id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSong(s.id); } },
      }, [
        el('div', { class: 'si-title' }, [
          el('span', { text: s.title || '(無題)' }),
        ]),
        el('div', { class: 'si-meta' }, [
          el('span', { class: 'badge badge-status', text: s.status || '—' }),
          el('span', { class: 'tag-list' }, tags),
          el('span', { text: '更新 ' + fmtDate(s.updatedAt) }),
        ]),
      ]);
      songListEl.appendChild(item);
    }
  }

  // ==========================================================
  // 曲選択・詳細表示
  // ==========================================================
  async function selectSong(id) {
    state.selectedId = id;
    document.body.classList.add('detail-open');
    $('btnBack').hidden = false;
    renderList();
    await renderDetail();
  }

  function backToList() {
    document.body.classList.remove('detail-open');
    $('btnBack').hidden = true;
  }
  $('btnBack').addEventListener('click', backToList);

  async function renderDetail() {
    destroyPlayers();
    if (window.AudioEngine) { AudioEngine.stop(); chordPlaying = false; }
    const song = state.songs.find(s => s.id === state.selectedId);
    if (!song) {
      detailEmptyEl.hidden = false; detailBodyEl.hidden = true; detailBodyEl.innerHTML = '';
      return;
    }
    detailEmptyEl.hidden = true; detailBodyEl.hidden = false;
    detailBodyEl.innerHTML = '';

    // --- ヘッダ ---
    const header = el('div', { class: 'detail-header' }, [
      el('h2', { class: 'detail-title', text: song.title || '(無題)' }),
      el('div', { class: 'detail-actions' }, [
        el('button', { class: 'btn btn-sm', text: '歌本', title: '歌詞とコードをまとめて表示', onclick: () => openSongbook(song) }),
        el('button', { class: 'btn btn-sm', text: '編集', onclick: () => openSongForm(song) }),
        el('button', { class: 'btn btn-sm btn-danger', text: '削除', onclick: () => deleteSong(song) }),
      ]),
    ]);
    const sub = el('div', { class: 'detail-sub' }, [
      el('span', {}, [el('span', { class: 'badge badge-status', text: song.status || '—' })]),
      el('span', { text: '作成 ' + fmtDate(song.createdAt) }),
      el('span', { text: '更新 ' + fmtDate(song.updatedAt) }),
    ]);
    detailBodyEl.append(header, sub);

    // タグ
    if ((song.tags || []).length) {
      detailBodyEl.appendChild(el('div', { class: 'tag-list', style: 'margin-bottom:16px' },
        song.tags.map(t => el('span', { class: 'tag', text: '#' + t }))));
    }

    // --- 歌詞 ---
    detailBodyEl.appendChild(sectionLyrics(song));
    // --- コード進行 ---
    detailBodyEl.appendChild(sectionChords(song));
    // --- ボイスメモ（音声） ---
    detailBodyEl.appendChild(await sectionMedia(song, 'audio'));
    // --- 動画 ---
    detailBodyEl.appendChild(await sectionMedia(song, 'video'));
    // --- バージョン ---
    detailBodyEl.appendChild(await sectionVersions(song));
  }

  // インラインコード（[C]等）を取り除く。行全体が[ラベル]の見出し行はそのまま。
  function stripInlineChords(line) {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) return line; // セクション見出し
    return line.replace(/\[[^\]]+\]/g, '');
  }
  function hasInlineChords(lyrics) {
    return (lyrics || '').split('\n').some(l => !/^\s*\[[^\]]+\]\s*$/.test(l) && /\[[^\]]+\]/.test(l));
  }

  function sectionLyrics(song) {
    const body = el('div', { class: 'section-body' });
    const view = el('div', { class: 'lyrics-view' });
    const text = song.lyrics || '';
    if (!text.trim()) {
      view.appendChild(el('span', { class: 'lyrics-empty', text: '歌詞は未入力です。「編集」から入力できます。' }));
    } else {
      const lines = text.split('\n');
      for (const line of lines) {
        if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
          view.appendChild(el('span', { class: 'lyrics-section-label', text: line.trim() }));
          view.appendChild(document.createTextNode('\n'));
        } else {
          // 歌詞ビューはコードを外したクリーンな歌詞を表示（コードは「歌本」で表示）
          view.appendChild(document.createTextNode(stripInlineChords(line) + '\n'));
        }
      }
    }
    body.appendChild(view);
    if (hasInlineChords(text)) body.appendChild(el('div', { class: 'notice', style: 'margin-top:10px', text: '※ 埋め込んだコード（[C]等）は「歌本」表示で歌詞の上に表示されます。' }));
    return section('歌詞', [
      el('button', { class: 'btn btn-sm', text: 'コード譜', title: 'コードを埋め込んで編集', onclick: () => openChordSheetEditor(song) }),
      el('button', { class: 'btn btn-sm', text: '編集', onclick: () => openSongForm(song) }),
    ], body);
  }

  async function sectionMedia(song, kind) {
    const title = kind === 'audio' ? 'ボイスメモ（音声）' : '動画';
    // 音声は accept フィルタを付けない（iOS Safari では accept 指定により
    // ファイルアプリ内の音声=.m4a 等がグレーアウトして選べなくなるため）。
    // → すべてのファイルを選択可能にし、選択後にコード側で音声として保存する。
    const accept = kind === 'audio' ? null : 'video/*';
    const fileInput = el('input', { type: 'file', accept, multiple: 'multiple', style: 'display:none' });
    fileInput.addEventListener('change', async () => {
      if (!fileInput.files.length) return;
      try {
        await MediaLib.saveFiles(song.id, Array.from(fileInput.files), kind);
        toast('保存しました');
        await renderDetail();
        refreshStorageBadge();
      } catch (e) {
        handleSaveError(e);
      }
      fileInput.value = '';
    });
    const addBtn = el('button', { class: 'btn btn-sm', text: '＋ アップロード', onclick: () => fileInput.click() });
    const headActions = [addBtn];
    if (kind === 'audio' && window.Recorder && Recorder.isSupported()) {
      headActions.unshift(el('button', { class: 'btn btn-sm', text: '● 録音', onclick: () => recordIntoSong(song) }));
    }

    const body = el('div', { class: 'section-body' });
    body.appendChild(fileInput);
    if (kind === 'audio') {
      body.appendChild(el('div', { class: 'notice', style: 'margin-bottom:12px', text: 'iPhoneのボイスメモは、ボイスメモアプリで「共有 →「"ファイル"に保存」」で端末に保存してから、ここで選択してください。' }));
    }
    const media = (await DB.Media.bySong(song.id)).filter(m => m.kind === kind)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    if (!media.length) {
      body.appendChild(el('p', { class: 'media-empty', text: kind === 'audio' ? '音声はまだありません。' : '動画はまだありません。' }));
    } else {
      const list = el('div', { class: 'media-list' });
      for (const m of media) list.appendChild(mediaItem(m, song));
      body.appendChild(list);
    }
    return section(title, headActions, body);
  }

  // 録音モーダル（録音開始→停止で {blob,mime} を onDone に渡す）
  function openRecorder(onDone) {
    if (!window.Recorder || !Recorder.isSupported()) { toast('このブラウザは録音に非対応です'); return; }
    const dot = el('span', { class: 'rec-dot' });
    const timeEl = el('span', { class: 'rec-time', text: '0:00' });
    const status = el('div', { class: 'rec-status', text: 'マイクを準備中…（許可が必要です）' });
    const stopBtn = el('button', { class: 'btn btn-primary', text: '■ 停止して保存', disabled: 'disabled' });
    const cancelBtn = el('button', { class: 'btn', text: 'キャンセル' });
    let done = false;
    cancelBtn.addEventListener('click', () => { if (!done) Recorder.cancel(); closeModal(); });
    stopBtn.addEventListener('click', async () => {
      if (done) return; done = true;
      try { const r = await Recorder.stop(); closeModal(); onDone(r); }
      catch (e) { closeModal(); toast('録音の保存に失敗しました'); }
    });
    const body = el('div', { class: 'rec-body' }, [el('div', { class: 'rec-line' }, [dot, timeEl]), status]);
    openModal('録音', body, [cancelBtn, stopBtn]);
    Recorder.start((sec) => { timeEl.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); })
      .then(() => { status.textContent = '録音中… 「停止して保存」で保存します'; stopBtn.disabled = false; dot.classList.add('on'); })
      .catch(() => { status.textContent = 'マイクを使用できませんでした（権限を確認してください）'; });
  }

  function recordIntoSong(song) {
    openRecorder(async ({ blob, mime }) => {
      try { await MediaLib.saveRecording(song.id, blob, mime); toast('録音を保存しました'); await renderDetail(); refreshStorageBadge(); }
      catch (e) { handleSaveError(e); }
    });
  }

  // 歌本ビュー：歌詞を[..]で分割し、各ブロックに名前一致するコード行＋歌詞を合成表示（読み取り専用）
  function parseLyricBlocks(lyrics) {
    const lines = (lyrics || '').split('\n');
    const blocks = []; let cur = null;
    lines.forEach(raw => {
      const t = raw.trim();
      if (/^\[[^\]]+\]$/.test(t)) { cur = { label: t, lines: [] }; blocks.push(cur); }
      else { if (!cur) { cur = { label: '', lines: [] }; blocks.push(cur); } cur.lines.push(raw); }
    });
    return blocks;
  }
  function chordLineFor(sec) {
    const parts = (sec.bars || []).map(b => {
      const chs = (b.chords || []);
      return chs.length ? chs.map(sym => displayNameSec(sec, sym)).join(' ') : '－';
    });
    return el('div', { class: 'sb-chords', text: parts.length ? '｜' + parts.join('｜') + '｜' : '（コードなし）' });
  }
  // "[C]あの日[G]見た" → [{chord:'',text:''},{chord:'C',text:'あの日'},{chord:'G',text:'見た'}]
  function parseInlineChords(line) {
    const re = /\[([^\]]+)\]/g;
    const tokens = []; let pos = 0, m;
    while ((m = re.exec(line)) !== null) { tokens.push(line.slice(pos, m.index)); tokens.push({ c: m[1] }); pos = m.index + m[0].length; }
    tokens.push(line.slice(pos));
    const out = [{ chord: '', text: tokens[0] }];
    for (let i = 1; i < tokens.length; i += 2) out.push({ chord: tokens[i].c, text: tokens[i + 1] || '' });
    return out;
  }
  // 歌詞1行を「文字の上にコード」で描画（コードは各テキスト断片の先頭に乗る）
  function renderChordLine(line) {
    const segs = parseInlineChords(line);
    const wrap = el('div', { class: 'cp-line' });
    let any = false;
    segs.forEach(s => {
      if (!s.chord && !s.text) return;
      any = true;
      wrap.appendChild(el('span', { class: 'cp-chunk' }, [
        el('span', { class: 'cp-chord', text: s.chord || '' }),
        el('span', { class: 'cp-text', text: s.text || '' }),
      ]));
    });
    if (!any) wrap.appendChild(el('span', { class: 'cp-chunk' }, [el('span', { class: 'cp-chord' }), el('span', { class: 'cp-text', text: ' ' })]));
    return wrap;
  }
  // 歌詞＋コードを1つの「コード譜」DOMに描画（歌本ビュー・エディタプレビュー共用）
  function buildSheet(lyricsStr, song, container, forEditor) {
    const c = song.chords;
    const blocks = parseLyricBlocks(lyricsStr);
    const usedSecs = new Set();
    blocks.forEach(bl => {
      if (bl.label) container.appendChild(el('div', { class: 'sb-label', text: bl.label }));
      const inlineInBlock = bl.lines.some(l => /\[[^\]]+\]/.test(l));
      if (!inlineInBlock && bl.label) {
        const sec = c.sections.find(s => s.name === bl.label);
        if (sec) { usedSecs.add(sec); container.appendChild(chordLineFor(sec)); }
      }
      bl.lines.forEach(l => {
        if (/\[[^\]]+\]/.test(l)) container.appendChild(renderChordLine(l));
        else container.appendChild(el('div', { class: 'sb-lyric', text: l || ' ' }));
      });
    });
    if (!forEditor) {
      c.sections.forEach(sec => {
        if (!usedSecs.has(sec) && sec.name) { container.appendChild(el('div', { class: 'sb-label', text: sec.name })); container.appendChild(chordLineFor(sec)); }
      });
    }
  }
  function openSongbook(song) {
    ChordLib.ensure(song);
    const c = song.chords;
    const container = el('div', { class: 'songbook' });
    buildSheet(song.lyrics, song, container, false);
    if (!(song.lyrics || '').trim() && !c.sections.length) {
      container.appendChild(el('p', { class: 'media-empty', text: '歌詞・コードがまだありません。' }));
    }
    const key = ChordLib.estimateKey(c);
    const head = key ? el('div', { class: 'sb-key', text: '推定キー：' + key.majorName + ' / ' + key.minorName } ) : null;
    const wrap = el('div', {}, [head, container]);
    const footer = [
      el('button', { class: 'btn', text: '▶ カラオケ', onclick: () => openKaraoke(song) }),
      el('button', { class: 'btn', text: '✎ コード譜を編集', onclick: () => openChordSheetEditor(song) }),
      el('button', { class: 'btn btn-primary', text: '閉じる', onclick: closeModal }),
    ];
    openModal('歌本ビュー（' + (song.title || '(無題)') + '）', wrap, footer);
  }

  // ==========================================================
  // カラオケ同期（コード変化タップ・1文字スイープ）
  // ==========================================================
  async function openKaraoke(song) {
    ChordLib.ensure(song);
    const audios = (await DB.Media.bySong(song.id)).filter(m => m.kind === 'audio');
    const { rows, totalChars, anchors } = LyricSync.flattenChars(song.lyrics);
    // 文字位置 g → コード（アンカー。表示用）
    const chordAtG = {};
    anchors.forEach(a => { (chordAtG[a.g] = chordAtG[a.g] || []).push(a.chord); });

    // 歌詞表示（1文字=1span。アンカー位置の上にコード名）
    const disp = el('div', { class: 'kk-display' });
    const charSpanByG = new Array(totalChars);
    rows.forEach(row => {
      if (row.type === 'label') { disp.appendChild(el('div', { class: 'kk-label', text: row.text })); return; }
      const line = el('div', { class: 'kk-line' });
      row.segs.forEach(seg => {
        const cs = el('span', { class: 'kk-char', text: seg.ch, 'data-g': seg.g });
        charSpanByG[seg.g] = cs;
        if (chordAtG[seg.g]) {
          const chunk = el('span', { class: 'kk-chunk' }, [el('span', { class: 'kk-wchord', text: chordAtG[seg.g].join(' ') }), cs]);
          line.appendChild(chunk);
        } else { line.appendChild(cs); }
      });
      if (!row.segs.length) line.appendChild(document.createTextNode(' '));
      disp.appendChild(line);
    });

    // 音源：伴奏なし（コードのみ）＋ 保存済み音声
    const srcSel = el('select', { class: 'chord-sel' });
    srcSel.appendChild(el('option', { value: 'none', text: '伴奏なし（コードのみ鳴らす）' }));
    audios.forEach(m => srcSel.appendChild(el('option', { value: 'media:' + m.id, text: '音声: ' + m.name })));
    if (song.sync && song.sync.source) { const has = [...srcSel.options].some(o => o.value === song.sync.source); if (has) srcSel.value = song.sync.source; }

    const status = el('div', { class: 'kk-status' });
    const controls = el('div', { class: 'kk-controls' });
    const countEl = el('div', { class: 'kk-count', hidden: true });

    function applyByTime(ct, elapsed) {
      for (let g = 0; g < totalChars; g++) {
        const s = charSpanByG[g]; if (!s) continue;
        const sung = ct[g] <= elapsed;
        if (s._sung !== sung) { s.classList.toggle('sung', sung); s._sung = sung; }
      }
    }
    function clearFill() { for (let g = 0; g < totalChars; g++) { const s = charSpanByG[g]; if (s && s._sung) { s.classList.remove('sung'); s._sung = false; } } }
    function clearCue() { disp.querySelectorAll('.kk-char.cue').forEach(n => n.classList.remove('cue')); }
    function scrollToG(g) { const s = charSpanByG[g]; if (!s) return; const dr = disp.getBoundingClientRect(), sr = s.getBoundingClientRect(); disp.scrollTop += (sr.top - dr.top) - dr.height / 2 + sr.height / 2; }
    function cueAnchor(k) { clearCue(); const a = anchors[k]; if (!a) return; const s = charSpanByG[a.g]; if (s) { s.classList.add('cue'); scrollToG(a.g); } }
    function showCount(n) { countEl.hidden = false; countEl.textContent = n > 0 ? String(n) : 'START'; }
    function hideCount() { countEl.hidden = true; }

    async function getDuration(source, forRecord) {
      if (source === 'none') { if (forRecord) return 0; const t = (song.sync && song.sync.times) || []; return (song.sync && song.sync.duration) || ((t[t.length - 1] || 0) + 1); }
      const m = audios.find(x => 'media:' + x.id === source);
      return m ? await Karaoke.audioDuration(m.blob) : 0;
    }
    function playOpts(source, extra) {
      if (source === 'none') return Object.assign({ mode: 'chords', chordList: [] }, extra); // 無音クロックのみ
      const m = audios.find(x => 'media:' + x.id === source);
      return Object.assign({ mode: 'audio', blob: m.blob }, extra);
    }
    function saveSync() {
      song.updatedAt = new Date().toISOString();
      DB.Songs.put(song).then(() => { const i = state.songs.findIndex(x => x.id === song.id); if (i >= 0) state.songs[i] = song; });
    }

    function renderIdle() {
      Karaoke.stop(); controls.innerHTML = ''; clearCue(); clearFill(); hideCount();
      const valid = LyricSync.validateAnchors(song.sync, song.lyrics) &&
        (song.sync.source === 'none' || audios.some(x => 'media:' + x.id === song.sync.source));
      if (!anchors.length) {
        status.textContent = 'このカラオケは「歌詞に埋め込んだコード」を使います。先に「コード譜」でコードを配置してください。';
        return;
      }
      controls.append(el('div', { class: 'field', style: 'margin-bottom:8px' }, [el('label', { text: '音源' }), srcSel]));
      controls.append(el('div', { class: 'kk-btnrow' }, [
        el('button', { class: 'btn btn-primary', text: '● 同期する（タップ記録）', onclick: () => beginRecord(0, false) }),
        el('button', { class: 'btn', text: '▶ 再生', disabled: valid ? null : 'disabled', onclick: startPlay }),
        el('button', { class: 'btn', text: '✎ 編集', disabled: valid ? null : 'disabled', onclick: openSyncEditor }),
      ]));
      status.textContent = valid ? '同期済みです。「▶ 再生」で曲として再生、「✎ 編集」で微調整できます。'
        : 'まだ同期していません。「● 同期する」→カウント後、コードが変わる瞬間にタップしてください。';
    }

    // 記録（fromIndex から。single=true なら1点だけ）
    async function beginRecord(fromIndex, single) {
      if (!anchors.length) { toast('先に歌詞へコードを配置してください（コード譜）'); return; }
      const source = (song.sync && song.sync.source) ? song.sync.source : srcSel.value;
      const duration = await getDuration(source, true);
      const base = (song.sync && Array.isArray(song.sync.times)) ? song.sync.times.slice() : [];
      while (base.length < anchors.length) base.push(base.length > 0 ? base[base.length - 1] : 0);
      let idx = fromIndex;

      controls.innerHTML = ''; clearFill();
      const tapBtn = el('button', { class: 'btn btn-primary kk-tap', text: 'タップ（コードが変わる瞬間）', disabled: 'disabled' });
      const backBtn = el('button', { class: 'btn', text: '1つ戻る', disabled: 'disabled' });
      const saveBtn = el('button', { class: 'btn', text: '保存', disabled: 'disabled' });
      const abortBtn = el('button', { class: 'btn btn-danger', text: '中止' });
      controls.append(el('div', { class: 'kk-btnrow' }, [tapBtn]), el('div', { class: 'kk-btnrow' }, [backBtn, saveBtn, abortBtn]));
      cueAnchor(idx);

      let ci = null;
      function doSave() {
        Karaoke.stop(); hideCount();
        song.sync = { source, duration: (source === 'none' ? ((base[anchors.length - 1] || 0) + 1) : duration) || ((base[anchors.length - 1] || 0) + 1), chords: anchors.map(a => a.chord), positions: anchors.map(a => a.g), times: base.slice(0, anchors.length) };
        saveSync(); toast('同期を保存しました'); renderIdle();
      }
      abortBtn.addEventListener('click', () => { if (ci) ci.cancel(); Karaoke.stop(); hideCount(); renderIdle(); });
      saveBtn.addEventListener('click', doSave);
      backBtn.addEventListener('click', () => { if (idx > fromIndex) { idx--; cueAnchor(idx); status.textContent = `記録中… ${idx}/${anchors.length}`; } });
      tapBtn.addEventListener('click', () => {
        if (idx >= anchors.length) return;
        base[idx] = Karaoke.currentTime(); idx++;
        if (single) { doSave(); return; }
        if (idx < anchors.length) { cueAnchor(idx); status.textContent = `記録中… ${idx}/${anchors.length}`; }
        else { clearCue(); status.textContent = `全${anchors.length}個を記録。「保存」で確定`; }
      });

      status.textContent = 'カウント…';
      ci = Karaoke.countIn({
        count: 3, intervalMs: 600, onTick: (k) => showCount(k),
        onDone: () => {
          hideCount();
          tapBtn.disabled = false; backBtn.disabled = false; saveBtn.disabled = false;
          status.textContent = single ? 'このコードの変化点でタップ' : '再生中… コードが変わる瞬間にタップ';
          Karaoke.play(playOpts(source, { duration, onTime: () => {}, onEnd: () => { if (!single) status.textContent = '音源終了。保存できます'; } }));
        }
      });
    }

    async function startPlay() {
      if (!LyricSync.validateAnchors(song.sync, song.lyrics)) { toast('歌詞／コードが変わっています。録り直してください'); return; }
      const source = song.sync.source;
      if (source !== 'none' && !audios.find(x => 'media:' + x.id === source)) { toast('同期した音源が見つかりません。録り直してください'); return; }
      controls.innerHTML = '';
      controls.append(el('div', { class: 'kk-btnrow' }, [el('button', { class: 'btn btn-danger', text: '■ 停止', onclick: () => { Karaoke.stop(); renderIdle(); } })]));
      status.textContent = '再生中…'; clearFill();
      const duration = song.sync.duration || await getDuration(source, false);
      const ct = LyricSync.computeCharTimes(totalChars, anchors, song.sync.times, duration);
      const chordEvents = anchors.map((a, i) => ({ freqs: ChordLib.freqs(a.chord), at: song.sync.times[i], dur: ((i + 1 < anchors.length ? song.sync.times[i + 1] : duration) - song.sync.times[i]) })).filter(e => e.freqs.length && e.dur > 0);
      let lastG = -1;
      Karaoke.play(playOpts(source, {
        duration, chordEvents,
        onTime: (t) => {
          applyByTime(ct, t);
          let cur = -1; for (let g = 0; g < totalChars; g++) { if (ct[g] <= t) cur = g; else break; }
          if (cur >= 0 && cur !== lastG) { lastG = cur; scrollToG(cur); }
        },
        onEnd: () => { applyByTime(ct, duration + 1); renderIdle(); },
      }));
    }

    function openSyncEditor() {
      Karaoke.stop(); controls.innerHTML = ''; clearCue(); clearFill();
      const list = el('div', { class: 'kk-editlist' });
      anchors.forEach((a, i) => {
        const timeInput = el('input', { type: 'number', step: '0.05', min: '0', class: 'chord-num', value: String(Math.round((song.sync.times[i] || 0) * 100) / 100) });
        // 秒は常に昇順を保つ（隣接値でクランプ）。順序が崩れると補間・発音が乱れるため。
        const clampTime = () => { const t = song.sync.times; let v = Math.max(0, t[i] || 0); if (i > 0) v = Math.max(v, t[i - 1]); if (i < t.length - 1) v = Math.min(v, t[i + 1]); t[i] = Math.round(v * 1000) / 1000; };
        const sync2 = () => { clampTime(); timeInput.value = String(Math.round((song.sync.times[i] || 0) * 100) / 100); saveSync(); };
        timeInput.addEventListener('change', () => { let v = parseFloat(timeInput.value); if (isNaN(v) || v < 0) v = 0; song.sync.times[i] = v; sync2(); });
        const minus = el('button', { class: 'btn btn-sm', text: '−', onclick: () => { song.sync.times[i] = (song.sync.times[i] || 0) - 0.05; sync2(); } });
        const plus = el('button', { class: 'btn btn-sm', text: '＋', onclick: () => { song.sync.times[i] = (song.sync.times[i] || 0) + 0.05; sync2(); } });
        list.append(el('div', { class: 'kk-editrow' }, [
          el('span', { class: 'kk-editchord', text: a.chord }),
          minus, timeInput, el('span', { class: 'chord-suf', text: '秒' }), plus,
          el('button', { class: 'btn btn-sm', text: 'ここだけ録り直し', onclick: () => beginRecord(i, true) }),
          el('button', { class: 'btn btn-sm', text: 'ここから録り直し', onclick: () => beginRecord(i, false) }),
        ]));
      });
      controls.append(list, el('div', { class: 'kk-btnrow' }, [el('button', { class: 'btn btn-primary', text: '完了', onclick: renderIdle })]));
      status.textContent = '各コードの秒を微調整（−／＋／数値）、または部分的に録り直しできます。';
    }

    renderIdle();
    const wrap = el('div', {}, [el('div', { class: 'kk-status-wrap' }, [status]), countEl, controls, disp]);
    openModal('カラオケ（' + (song.title || '(無題)') + '）', wrap, [el('button', { class: 'btn btn-primary', text: '閉じる', onclick: closeModal })]);
  }

  // コード譜編集：歌詞に [C] を埋め込む専用エディタ（ライブプレビュー付き）
  function openChordSheetEditor(song) {
    const ta = el('textarea', { class: 'chord-input cp-editor', placeholder: '[C]あの日[G]見た夕焼けが…\n\n行全体が [Aメロ] だけの行はセクション見出しになります。' });
    ta.value = song.lyrics || '';
    const preview = el('div', { class: 'cp-preview songbook' });
    const renderPreview = () => { preview.innerHTML = ''; buildSheet(ta.value, song, preview, true); };
    ta.addEventListener('input', renderPreview);
    const body = el('div', {}, [
      el('div', { class: 'hint', text: '歌詞の中に [C] のようにコードを書くと、歌本表示で歌詞の上にコードが乗ります（例：[C]あの日[G]見た）。' }),
      el('div', { style: 'margin-bottom:8px' }, [el('button', { class: 'btn btn-sm', text: '♪ コード進行のコードを歌詞に割り当てる', onclick: () => openChordAssign(song) })]),
      el('div', { class: 'field' }, [el('label', { text: 'コード譜（歌詞＋コード）' }), ta]),
      el('label', { class: 'chord-pal-label', text: 'プレビュー' }), preview,
    ]);
    const cancel = el('button', { class: 'btn', text: 'キャンセル', onclick: closeModal });
    const save = el('button', {
      class: 'btn btn-primary', text: '保存',
      onclick: async () => {
        song.lyrics = ta.value; song.updatedAt = new Date().toISOString();
        await DB.Songs.put(song);
        const i = state.songs.findIndex(x => x.id === song.id); if (i >= 0) state.songs[i] = song;
        closeModal(); renderList(); await renderDetail(); toast('保存しました');
      }
    });
    openModal('コード譜編集', body, [cancel, save]);
    renderPreview();
    setTimeout(() => ta.focus(), 30);
  }

  // コード進行のコードを、歌詞の文字をタップして順に割り当てる（結果はインライン[C]として保存）
  function flattenProgressionChords(song) {
    const out = [];
    (song.chords.sections || []).forEach(sec => (sec.bars || []).forEach(b => (b.chords || []).forEach(sym => out.push(displayNameSec(sec, sym)))));
    return out;
  }
  function openChordAssign(song) {
    ChordLib.ensure(song);
    const chords = flattenProgressionChords(song);
    if (!chords.length) { toast('コード進行にコードがありません。先にコード進行を作成してください'); return; }
    const baseLines = (song.lyrics || '').split('\n').map(l => LyricSync.isLabel(l) ? l : LyricSync.stripChords(l));
    if (!baseLines.some(l => !LyricSync.isLabel(l) && l.trim())) { toast('歌詞がありません。先に歌詞を入力してください'); return; }

    let curIndex = 0; const placements = []; // {li, ci, chord}
    const status = el('div', { class: 'kk-status' });
    const disp = el('div', { class: 'ca-display' });

    function updateStatus() {
      status.textContent = curIndex < chords.length
        ? `次に置くコード：${chords[curIndex]}（${curIndex + 1}/${chords.length}）— 歌詞の文字をタップ`
        : `全${chords.length}個を配置しました。「完了」で保存します。`;
    }
    function render() {
      disp.innerHTML = '';
      baseLines.forEach((line, li) => {
        if (LyricSync.isLabel(line)) { disp.appendChild(el('div', { class: 'kk-label', text: line.trim() })); return; }
        const lineEl = el('div', { class: 'ca-line' });
        const chars = [...line];
        for (let ci = 0; ci <= chars.length; ci++) {
          placements.filter(p => p.li === li && p.ci === ci).forEach(p => lineEl.appendChild(el('span', { class: 'ca-mark', text: p.chord })));
          if (ci < chars.length) {
            const cs = el('span', { class: 'ca-char', text: chars[ci] });
            cs.addEventListener('click', () => placeAt(li, ci));
            lineEl.appendChild(cs);
          }
        }
        if (!chars.length) { const cs = el('span', { class: 'ca-char ca-empty', text: '␣' }); cs.addEventListener('click', () => placeAt(li, 0)); lineEl.appendChild(cs); }
        disp.appendChild(lineEl);
      });
      updateStatus();
    }
    function placeAt(li, ci) {
      if (curIndex >= chords.length) { toast('すべてのコードを配置しました'); return; }
      placements.push({ li, ci, chord: chords[curIndex] }); curIndex++; render();
    }

    const cancel = el('button', { class: 'btn', text: 'キャンセル', onclick: closeModal });
    const undo = el('button', { class: 'btn', text: '1つ戻る', onclick: () => { if (placements.length) { placements.pop(); curIndex--; render(); } } });
    const reset = el('button', { class: 'btn', text: 'やり直し', onclick: () => { placements.length = 0; curIndex = 0; render(); } });
    const done = el('button', {
      class: 'btn btn-primary', text: '完了',
      onclick: async () => {
        const lines2 = baseLines.map((line, li) => {
          if (LyricSync.isLabel(line)) return line;
          const parts = [...line];
          placements.filter(p => p.li === li).sort((a, b) => b.ci - a.ci).forEach(p => parts.splice(p.ci, 0, '[' + p.chord + ']'));
          return parts.join('');
        });
        song.lyrics = lines2.join('\n'); song.updatedAt = new Date().toISOString();
        await DB.Songs.put(song);
        const idx = state.songs.findIndex(x => x.id === song.id); if (idx >= 0) state.songs[idx] = song;
        closeModal(); renderList(); await renderDetail(); toast('コードを割り当てました');
      }
    });

    const body = el('div', {}, [
      el('div', { class: 'hint', text: 'コード進行のコードを、歌詞の文字をタップして順に置きます（そのコードは次に置くコードの直前の文字まで有効）。※歌詞に既にあった埋め込みコードは置き換わります。' }),
      el('div', { class: 'kk-status-wrap' }, [status]),
      disp,
    ]);
    render();
    openModal('コード進行から割り当て', body, [cancel, undo, reset, done]);
  }

  function mediaItem(m, song) {
    const wrap = el('div', { class: 'media-item' });
    const playerWrap = el('div', { class: 'media-player-wrap', hidden: true });
    let player = null;

    const toggle = () => {
      if (player) {
        player.destroy();
        activePlayers = activePlayers.filter(p => p !== player);
        player = null;
        playerWrap.innerHTML = ''; playerWrap.hidden = true;
      } else {
        player = MediaLib.createPlayer(m);
        activePlayers.push(player);
        playerWrap.appendChild(player.el); playerWrap.hidden = false;
      }
    };

    const head = el('div', { class: 'media-item-head', onclick: toggle }, [
      el('span', { class: 'media-icon', text: m.kind === 'audio' ? '♪' : '▶' }),
      el('div', { class: 'media-info' }, [
        el('div', { class: 'media-name', text: m.name }),
        el('div', { class: 'media-sub', text: StorageInfo.fmtBytes(m.size || (m.blob ? m.blob.size : 0)) + ' ・ ' + fmtDate(m.createdAt) }),
      ]),
      el('div', { class: 'media-item-actions' }, [
        el('button', {
          class: 'btn btn-sm btn-danger', text: '削除',
          onclick: async (e) => {
            e.stopPropagation();
            const ok = await confirmDialog('この' + (m.kind === 'audio' ? '音声' : '動画') + 'を削除しますか？', '削除', true);
            if (!ok) return;
            if (player) { player.destroy(); activePlayers = activePlayers.filter(p => p !== player); }
            await DB.Media.delete(m.id);
            toast('削除しました');
            await renderDetail();
            refreshStorageBadge();
          }
        }),
      ]),
    ]);
    wrap.append(head, playerWrap);
    return wrap;
  }

  async function sectionVersions(song) {
    const body = el('div', { class: 'section-body' });
    body.appendChild(el('div', { class: 'notice', text: '※ バージョンには歌詞・基本情報（曲名・ステータス・タグ）・コード進行が保存されます。音声・動画は含まれません。' }));

    const versions = (await DB.Versions.bySong(song.id))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    if (!versions.length) {
      body.appendChild(el('p', { class: 'media-empty', text: 'バージョンはまだありません。' }));
    } else {
      const list = el('div', { class: 'version-list' });
      versions.forEach((v, idx) => {
        list.appendChild(el('div', { class: 'version-item' }, [
          el('div', { class: 'v-head' }, [
            el('div', {}, [
              el('div', { class: 'v-date', text: fmtDate(v.createdAt) + (idx === 0 ? '（最新の版）' : '') }),
              el('div', { class: 'v-note', text: v.note ? '📝 ' + v.note : '' }),
            ]),
            el('div', { class: 'v-actions' }, [
              el('button', { class: 'btn btn-sm', text: '差分', onclick: () => showDiff(song, v) }),
              el('button', { class: 'btn btn-sm', text: '内容', onclick: () => showVersionContent(v) }),
              el('button', { class: 'btn btn-sm', text: '復元', onclick: () => restoreVersion(song, v) }),
              el('button', { class: 'btn btn-sm btn-danger', text: '削除', onclick: () => deleteVersion(song, v) }),
            ]),
          ]),
        ]));
      });
      body.appendChild(list);
    }

    const saveBtn = el('button', { class: 'btn btn-sm btn-primary', text: 'この版を保存', onclick: () => saveVersion(song) });
    return section('バージョン管理', [saveBtn], body);
  }

  function section(title, headActions, bodyNode) {
    return el('div', { class: 'section' }, [
      el('div', { class: 'section-head' }, [
        el('h3', { text: title }),
        el('div', { class: 'head-actions' }, headActions || []),
      ]),
      bodyNode,
    ]);
  }

  // ==========================================================
  // コード進行（セクション単位設定・コピー/複製・全曲/個別再生）
  // ==========================================================
  const TIME_SIGS = [
    { label: '4/4', n: 4, d: 4 }, { label: '3/4', n: 3, d: 4 },
    { label: '2/4', n: 2, d: 4 }, { label: '6/8', n: 6, d: 8 },
  ];
  const CHORD_STYLES = [
    { v: 'block', label: 'ブロック' }, { v: 'strum', label: 'ストラム' }, { v: 'arpeggio', label: 'アルペジオ' },
  ];
  const SETTING_KEYS = ['tempo', 'beatsPerBar', 'beatUnit', 'capo', 'transpose', 'style', 'loop'];
  let chordPlaying = false;
  let activePlayBtn = null;         // 現在再生中のボタン
  let settingsClipboard = null;     // 設定コピー用クリップボード
  const openSettings = new Set();   // 開いているセクション設定パネルのindex

  function pickSettings(t) { const o = {}; SETTING_KEYS.forEach(k => o[k] = t[k]); return o; }
  function assignSettings(t, s) { SETTING_KEYS.forEach(k => { if (s[k] != null) t[k] = s[k]; }); }
  function newSection(c, name) { return Object.assign({ name: name, bars: [{ chords: [] }] }, pickSettings(c.defaults)); }

  function chordSymbolsText(song) {
    const c = song.chords;
    if (!c || !Array.isArray(c.sections)) return '';
    const out = [];
    c.sections.forEach(s => (s.bars || []).forEach(b => (b.chords || []).forEach(sym => out.push(sym))));
    return out.join(' ');
  }
  function preferFlatOfSection(sec) { return ChordLib.preferFlatForKey(ChordLib.tonicPcOf(sec) + (sec.transpose || 0)); }
  function displayNameSec(sec, sym) { const tr = sec.transpose || 0; return tr === 0 ? sym : ChordLib.transpose(sym, tr, preferFlatOfSection(sec)); }
  function shapeNameSec(sec, sym) { return ChordLib.transpose(displayNameSec(sec, sym), -(sec.capo || 0), preferFlatOfSection(sec)); }
  function fmtSemi(n) { return n > 0 ? '＋' + n : n < 0 ? '−' + Math.abs(n) : '±0'; }

  async function saveChords(song) {
    song.updatedAt = new Date().toISOString();
    await DB.Songs.put(song);
    const i = state.songs.findIndex(x => x.id === song.id);
    if (i >= 0) state.songs[i] = song;
    renderList();
  }

  function fieldInline(label, control, suffix) {
    return el('div', { class: 'chord-field' }, [
      el('label', { text: label }), control, suffix ? el('span', { class: 'chord-suf', text: suffix }) : null,
    ]);
  }

  function sectionChords(song) {
    ChordLib.ensure(song);
    const body = el('div', { class: 'section-body' });
    const playBtn = el('button', { class: 'btn btn-sm btn-primary', text: '▶ 再生' });
    playBtn._label = '▶ 再生';
    playBtn.addEventListener('click', () => toggleChordPlay(song, body, playBtn));
    const importBtn = el('button', { class: 'btn btn-sm', text: '歌詞から取込', onclick: () => importSectionsFromLyrics(song, body) });
    renderChordBody(song, body);
    return section('コード進行', [importBtn, playBtn], body);
  }

  // 設定コントロール（上部の既定値バー / 各セクションの設定パネル で共用）
  function buildSettingsControls(song, target, body, o) {
    o = o || {};
    const bpm = el('input', { type: 'number', min: '20', max: '300', value: String(target.tempo || 90), class: 'chord-num', 'aria-label': 'テンポBPM' });
    bpm.addEventListener('change', async () => { let v = parseInt(bpm.value, 10); if (isNaN(v)) v = 90; target.tempo = Math.max(20, Math.min(300, v)); bpm.value = String(target.tempo); await saveChords(song); });

    const ts = el('select', { class: 'chord-sel', 'aria-label': '拍子' });
    TIME_SIGS.forEach(t => ts.appendChild(el('option', { value: t.label, text: t.label, selected: (target.beatsPerBar === t.n && target.beatUnit === t.d) ? 'selected' : null })));
    ts.addEventListener('change', async () => { const t = TIME_SIGS.find(x => x.label === ts.value); if (t) { target.beatsPerBar = t.n; target.beatUnit = t.d; } await saveChords(song); });

    const capo = el('select', { class: 'chord-sel', 'aria-label': 'カポ' });
    for (let k = 0; k <= 11; k++) capo.appendChild(el('option', { value: String(k), text: k === 0 ? 'カポ なし' : 'カポ ' + k, selected: (target.capo === k) ? 'selected' : null }));
    capo.addEventListener('change', async () => { target.capo = parseInt(capo.value, 10) || 0; await saveChords(song); if (!o.isDefaults) renderChordBody(song, body); });

    const trReadout = el('span', { class: 'chord-tr-val', text: fmtSemi(target.transpose || 0) });
    const trMinus = el('button', { class: 'btn btn-sm', text: '−', onclick: async () => { target.transpose = Math.max(-11, (target.transpose || 0) - 1); await saveChords(song); if (!o.isDefaults) renderChordBody(song, body); else trReadout.textContent = fmtSemi(target.transpose); } });
    const trPlus = el('button', { class: 'btn btn-sm', text: '＋', onclick: async () => { target.transpose = Math.min(11, (target.transpose || 0) + 1); await saveChords(song); if (!o.isDefaults) renderChordBody(song, body); else trReadout.textContent = fmtSemi(target.transpose); } });

    const st = el('select', { class: 'chord-sel', 'aria-label': '再生スタイル' });
    CHORD_STYLES.forEach(s => st.appendChild(el('option', { value: s.v, text: s.label, selected: (target.style === s.v) ? 'selected' : null })));
    st.addEventListener('change', async () => { target.style = st.value; await saveChords(song); });

    const loopCb = el('input', { type: 'checkbox' });
    loopCb.checked = !!target.loop;
    loopCb.addEventListener('change', async () => { target.loop = loopCb.checked; await saveChords(song); });
    const loop = el('label', { class: 'chord-loop', title: 'このセクションを単独再生するときに繰り返します' }, [loopCb, el('span', { text: 'ループ' })]);

    const wrap = el('div', { class: 'chord-settings' }, [
      fieldInline('テンポ', bpm, 'BPM'),
      fieldInline('拍子', ts),
      fieldInline('カポ', capo),
      fieldInline('移調', el('span', { class: 'chord-tr' }, [trMinus, trReadout, trPlus])),
      fieldInline('スタイル', st),
      loop,
    ]);

    if (!o.isDefaults) {
      if ((target.capo || 0) > 0) wrap.appendChild(el('div', { class: 'chord-hint', text: `カポ${target.capo}：各コードの下段が「押さえるコード」（上段＝実際の響き）` }));
      const copyBtn = el('button', { class: 'btn btn-sm', text: '設定をコピー', onclick: () => { settingsClipboard = pickSettings(target); toast('設定をコピーしました'); } });
      const pasteBtn = el('button', { class: 'btn btn-sm', text: '設定を貼り付け', onclick: async () => { if (!settingsClipboard) { toast('コピーされた設定がありません'); return; } assignSettings(target, settingsClipboard); await saveChords(song); renderChordBody(song, body); toast('設定を貼り付けました'); } });
      const allBtn = el('button', { class: 'btn btn-sm', text: 'この設定を全セクションに適用', onclick: async () => { const src = pickSettings(target); song.chords.sections.forEach(s => assignSettings(s, src)); await saveChords(song); renderChordBody(song, body); toast('全セクションに適用しました'); } });
      wrap.appendChild(el('div', { class: 'chord-copyrow' }, [copyBtn, pasteBtn, allBtn]));
    }
    return wrap;
  }

  function renderChordBody(song, body) {
    if (window.AudioEngine) AudioEngine.stop();
    const c = song.chords;
    body.innerHTML = '';

    // 上部：新規セクションの既定値 ＋ 全セクションに適用
    const defWrap = el('div', { class: 'chord-defaults' }, [
      el('div', { class: 'chord-defaults-head' }, [
        el('span', { class: 'chord-defaults-label', text: '新規セクションの既定値' }),
        el('button', { class: 'btn btn-sm', text: '既定値を全セクションに適用', onclick: async () => { const src = pickSettings(c.defaults); c.sections.forEach(s => assignSettings(s, src)); await saveChords(song); renderChordBody(song, body); toast('既定値を全セクションに適用しました'); } }),
      ]),
      buildSettingsControls(song, c.defaults, body, { isDefaults: true }),
    ]);
    body.appendChild(defWrap);

    // 推定キー
    const key = ChordLib.estimateKey(c);
    if (key) body.appendChild(el('div', { class: 'chord-key', text: '推定キー：' + key.majorName + ' メジャー / ' + key.minorName.replace(/m$/, '') + ' マイナー' }));

    if (!c.sections.length) {
      body.appendChild(el('p', { class: 'media-empty', text: 'コード進行はまだありません。「歌詞から取込」または「＋ セクション」で追加してください。' }));
    }
    c.sections.forEach((sec, si) => body.appendChild(renderChordSection(song, sec, si, body)));

    body.appendChild(el('div', { style: 'margin-top:10px' }, [
      el('button', { class: 'btn btn-sm', text: '＋ セクション', onclick: async () => { openSettings.clear(); c.sections.push(newSection(c, '新しいセクション')); await saveChords(song); renderChordBody(song, body); } }),
    ]));
  }

  function renderChordSection(song, sec, si, body) {
    const c = song.chords;
    const open = openSettings.has(si);

    const secPlay = el('button', { class: 'btn btn-sm', text: '▶', title: 'このセクションを再生' });
    secPlay._label = '▶';
    secPlay.addEventListener('click', () => toggleSectionPlay(song, si, body, secPlay));

    const gear = el('button', { class: 'btn btn-sm' + (open ? ' btn-primary' : ''), text: '⚙ 設定', onclick: () => { if (openSettings.has(si)) openSettings.delete(si); else openSettings.add(si); renderChordBody(song, body); } });

    const head = el('div', { class: 'chord-section-head' }, [
      el('span', { class: 'chord-section-name', text: sec.name || '（無名）', title: 'クリックで名称変更', onclick: () => renameChordSection(song, sec, body) }),
      el('div', { class: 'chord-section-actions' }, [
        secPlay, gear,
        el('button', { class: 'btn btn-sm', text: '＋小節', onclick: async () => { sec.bars = sec.bars || []; sec.bars.push({ chords: [] }); await saveChords(song); renderChordBody(song, body); } }),
        el('button', { class: 'btn btn-sm', text: '↑', onclick: async () => { if (si > 0) { const t = c.sections[si - 1]; c.sections[si - 1] = c.sections[si]; c.sections[si] = t; openSettings.clear(); await saveChords(song); renderChordBody(song, body); } } }),
        el('button', { class: 'btn btn-sm', text: '↓', onclick: async () => { if (si < c.sections.length - 1) { const t = c.sections[si + 1]; c.sections[si + 1] = c.sections[si]; c.sections[si] = t; openSettings.clear(); await saveChords(song); renderChordBody(song, body); } } }),
        el('button', { class: 'btn btn-sm', text: '複製', title: 'このセクションをコード込みで複製', onclick: async () => { const copy = JSON.parse(JSON.stringify(c.sections[si])); copy.name = (copy.name || '') + ' (コピー)'; c.sections.splice(si + 1, 0, copy); openSettings.clear(); await saveChords(song); renderChordBody(song, body); toast('セクションを複製しました'); } }),
        el('button', { class: 'btn btn-sm btn-danger', text: '×', onclick: async () => { const ok = await confirmDialog('このセクションを削除しますか？', '削除', true); if (!ok) return; c.sections.splice(si, 1); openSettings.clear(); await saveChords(song); renderChordBody(song, body); } }),
      ]),
    ]);

    const nodes = [head];
    if (open) nodes.push(buildSettingsControls(song, sec, body, { isDefaults: false, si }));
    const grid = el('div', { class: 'bar-grid' });
    (sec.bars || []).forEach((b, bi) => grid.appendChild(renderChordBar(song, sec, si, b, bi, body)));
    nodes.push(grid);
    return el('div', { class: 'chord-section' }, nodes);
  }

  function renderChordBar(song, sec, si, bar, bi, body) {
    const chips = el('div', { class: 'bar-chips' });
    (bar.chords || []).forEach((sym, ci) => {
      const valid = ChordLib.isValid(sym);
      const chip = el('div', { class: 'chord-chip' + (valid ? '' : ' invalid'), 'data-si': si, 'data-bi': bi, 'data-ci': ci, title: valid ? '' : '未知のコード（再生されません）' });
      chip.appendChild(el('span', { class: 'cc-name', text: displayNameSec(sec, sym) }));
      if ((sec.capo || 0) > 0) chip.appendChild(el('span', { class: 'cc-shape', text: shapeNameSec(sec, sym) }));
      chip.addEventListener('click', () => editChord(song, sec, bar, ci, body));
      const del = el('button', { class: 'cc-del', text: '×', 'aria-label': 'コード削除' });
      del.addEventListener('click', async (e) => { e.stopPropagation(); bar.chords.splice(ci, 1); await saveChords(song); renderChordBody(song, body); });
      chip.appendChild(del);
      chips.appendChild(chip);
    });
    const add = el('button', { class: 'bar-add', text: '＋', 'aria-label': 'コード追加', onclick: () => addChord(song, sec, bar, body) });
    const barDel = el('button', { class: 'bar-del', text: '小節を削除', onclick: async () => { sec.bars.splice(bi, 1); await saveChords(song); renderChordBody(song, body); } });
    return el('div', { class: 'bar-box' }, [
      el('div', { class: 'bar-top' }, [el('span', { class: 'bar-no', text: String(bi + 1) }), barDel]),
      chips,
      el('div', { class: 'bar-tools' }, [add]),
    ]);
  }

  // 表示中の名前（移調適用後）で入力し、保存時に生データ（transpose=0基準）へ逆変換して整合させる
  function chordToRaw(sec, v) { const tr = sec.transpose || 0; return tr === 0 ? v : ChordLib.transpose(v, -tr, false); }
  function addChord(song, sec, bar, body) {
    openChordPicker('コードを追加', '', (v) => { bar.chords = bar.chords || []; bar.chords.push(chordToRaw(sec, v)); saveChords(song).then(() => renderChordBody(song, body)); });
  }
  function editChord(song, sec, bar, ci, body) {
    openChordPicker('コードを編集', displayNameSec(sec, bar.chords[ci]), (v) => { bar.chords[ci] = chordToRaw(sec, v); saveChords(song).then(() => renderChordBody(song, body)); });
  }

  function renameChordSection(song, sec, body) {
    const input = el('input', { type: 'text', class: 'chord-input', value: sec.name || '' });
    const cancel = el('button', { class: 'btn', text: 'キャンセル', onclick: closeModal });
    const ok = el('button', { class: 'btn btn-primary', text: '決定', onclick: async () => { sec.name = input.value.trim() || '（無名）'; closeModal(); await saveChords(song); renderChordBody(song, body); } });
    openModal('セクション名の変更', el('div', { class: 'field' }, [el('label', { text: 'セクション名' }), input]), [cancel, ok]);
    setTimeout(() => input.focus(), 30);
  }

  function openChordPicker(title, initial, onOk) {
    let accidental = /^[A-G]b/.test(initial || '') ? 'flat' : 'sharp';
    let curRoot = 'C', curSuffix = '', curBass = '';
    const p0 = ChordLib.parse(initial || '');
    if (p0) {
      curRoot = ChordLib.spell(p0.rootPc, accidental === 'flat');
      curSuffix = p0.suffix;
      if (p0.bassPc != null) curBass = ChordLib.spell(p0.bassPc, accidental === 'flat');
    }

    const text = el('input', { type: 'text', value: initial || '', placeholder: '例: C, Am, G7, Cmaj7, Fsus4', class: 'chord-input' });
    const preview = el('div', { class: 'chord-preview' });
    const bigPrev = el('div', { class: 'chord-bigpreview' });
    const rootRow = el('div', { class: 'palette' });
    const qualWrap = el('div', { class: 'qual-palette' });
    const bassSel = el('select', { class: 'chord-sel' });

    const rootNames = () => (accidental === 'flat' ? ChordLib.FLAT : ChordLib.SHARP);

    function updatePreview() {
      const v = text.value.trim();
      const ok = v ? ChordLib.isValid(v) : false;
      bigPrev.textContent = v || '—';
      bigPrev.className = 'chord-bigpreview' + (v && !ok ? ' invalid' : '');
      preview.textContent = v ? (ok ? '✓ 有効なコード' : '⚠ 未知のコード（そのまま表示・再生はスキップ）') : '';
    }
    function buildRoots() {
      rootRow.innerHTML = '';
      rootNames().forEach(r => rootRow.appendChild(el('button', { class: 'btn btn-sm pal' + (r === curRoot ? ' active' : ''), text: r, onclick: () => { curRoot = r; compose(); } })));
    }
    function buildQuals() {
      qualWrap.innerHTML = '';
      ChordLib.QUALITY_CATS.forEach(([cat, label]) => {
        const items = ChordLib.QUALITIES.filter(q => q.cat === cat);
        if (!items.length) return;
        qualWrap.appendChild(el('div', { class: 'pal-cat', text: label }));
        const row = el('div', { class: 'palette' });
        items.forEach(q => row.appendChild(el('button', { class: 'btn btn-sm pal' + (q.suffix === curSuffix ? ' active' : ''), text: q.suffix || 'maj', onclick: () => { curSuffix = q.suffix; compose(); } })));
        qualWrap.appendChild(row);
      });
    }
    function buildBass() {
      bassSel.innerHTML = '';
      bassSel.appendChild(el('option', { value: '', text: '（分数なし）', selected: curBass === '' ? 'selected' : null }));
      rootNames().forEach(n => bassSel.appendChild(el('option', { value: n, text: '/ ' + n, selected: n === curBass ? 'selected' : null })));
    }
    bassSel.addEventListener('change', () => { curBass = bassSel.value; compose(); });

    function compose() { text.value = curRoot + curSuffix + (curBass ? '/' + curBass : ''); buildRoots(); buildQuals(); buildBass(); updatePreview(); }
    text.addEventListener('input', updatePreview);

    const toggle = el('button', { class: 'btn btn-sm', text: accidental === 'flat' ? '♭表記' : '♯表記', title: '♯/♭ 切替' });
    toggle.addEventListener('click', () => {
      accidental = accidental === 'flat' ? 'sharp' : 'flat';
      toggle.textContent = accidental === 'flat' ? '♭表記' : '♯表記';
      const pr = ChordLib.parse(curRoot); if (pr) curRoot = ChordLib.spell(pr.rootPc, accidental === 'flat');
      if (curBass) { const pb = ChordLib.parse(curBass); if (pb) curBass = ChordLib.spell(pb.rootPc, accidental === 'flat'); }
      compose();
    });

    buildRoots(); buildQuals(); buildBass(); updatePreview();

    const bodyEl = el('div', {}, [
      bigPrev,
      el('div', { class: 'field' }, [el('label', { text: 'コード（直接入力も可）' }), text, preview]),
      el('div', { class: 'chord-pal-head' }, [el('label', { class: 'chord-pal-label', text: 'ルート' }), toggle]),
      rootRow,
      el('label', { class: 'chord-pal-label', text: '種類' }), qualWrap,
      el('div', { class: 'field' }, [el('label', { text: 'オンベース（分数コード）' }), bassSel]),
    ]);
    const cancel = el('button', { class: 'btn', text: 'キャンセル', onclick: closeModal });
    const ok = el('button', { class: 'btn btn-primary', text: '決定', onclick: () => { const v = text.value.trim(); if (!v) { toast('コードを入力してください'); return; } closeModal(); onOk(v); } });
    openModal(title, bodyEl, [cancel, ok]);
    setTimeout(() => text.focus(), 30);
  }

  async function importSectionsFromLyrics(song, body) {
    const c = song.chords;
    const labels = (song.lyrics || '').split('\n').map(l => l.trim()).filter(l => /^\[[^\]]+\]$/.test(l));
    if (!labels.length) {
      if (!c.sections.length) { c.sections.push(newSection(c, '進行')); await saveChords(song); renderChordBody(song, body); toast('セクションを1つ作成しました'); }
      else { toast('歌詞にセクション記法（[...]）が見つかりません'); }
      return;
    }
    let added = 0;
    labels.forEach(lb => { if (!c.sections.some(s => s.name === lb)) { c.sections.push(newSection(c, lb)); added++; } });
    await saveChords(song); renderChordBody(song, body);
    toast(added ? `${added}個のセクションを追加しました` : '追加するセクションはありませんでした');
  }

  // 1セクションを再生アイテム列へ（tempo/style/transpose はセクション設定）
  function sectionToItems(s, si, list) {
    const bpb = s.beatsPerBar || 4; const tr = s.transpose || 0;
    (s.bars || []).forEach((b, bi) => {
      const chs = (b.chords || []);
      if (!chs.length) { list.push({ freqs: [], beats: bpb, tempo: s.tempo, style: s.style, ref: { si, bi, ci: -1 } }); }
      else { const per = bpb / chs.length; chs.forEach((sym, ci) => { const sounded = tr === 0 ? sym : ChordLib.transpose(sym, tr, false); list.push({ freqs: ChordLib.freqs(sounded), beats: per, tempo: s.tempo, style: s.style, ref: { si, bi, ci } }); }); }
    });
  }
  function buildChordList(song) { const list = []; (song.chords.sections || []).forEach((s, si) => sectionToItems(s, si, list)); return list; }
  function buildSectionList(song, si) { const list = []; sectionToItems(song.chords.sections[si], si, list); return list; }

  function playList(song, body, list, opts, btn) {
    if (!window.AudioEngine || !AudioEngine.isSupported()) { toast('このブラウザは音声再生に非対応です'); return; }
    if (!list.some(x => x.freqs.length)) { toast('再生できるコードがありません'); return; }
    const clearHL = () => body.querySelectorAll('.chord-chip.playing').forEach(n => n.classList.remove('playing'));
    const started = AudioEngine.play(list, Object.assign({
      onStep: (i) => {
        clearHL();
        if (i < 0) return;
        const ref = list[i].ref; if (!ref || ref.ci < 0) return;
        const chip = body.querySelector(`.chord-chip[data-si="${ref.si}"][data-bi="${ref.bi}"][data-ci="${ref.ci}"]`);
        if (chip) chip.classList.add('playing');
      },
      onEnd: () => { chordPlaying = false; if (activePlayBtn) activePlayBtn.textContent = activePlayBtn._label || '▶ 再生'; activePlayBtn = null; clearHL(); },
    }, opts));
    if (started) { chordPlaying = true; activePlayBtn = btn; btn.textContent = btn._label === '▶' ? '■' : '■ 停止'; }
  }

  function toggleChordPlay(song, body, playBtn) {
    if (chordPlaying && activePlayBtn === playBtn) { AudioEngine.stop(); return; }
    playList(song, body, buildChordList(song), { loop: false }, playBtn);
  }
  function toggleSectionPlay(song, si, body, btn) {
    if (chordPlaying && activePlayBtn === btn) { AudioEngine.stop(); return; }
    const s = song.chords.sections[si];
    playList(song, body, buildSectionList(song, si), { loop: !!s.loop }, btn);
  }

  // ==========================================================
  // 曲の追加・編集フォーム
  // ==========================================================
  function openSongForm(existing) {
    const isEdit = !!existing;
    const s = existing || { title: '', status: STATUSES[0], tags: [], lyrics: '' };

    const titleInput = el('input', { type: 'text', value: s.title || '', placeholder: '曲名' });
    const statusSel = el('select');
    STATUSES.forEach(st => statusSel.appendChild(el('option', { value: st, text: st, selected: st === s.status ? 'selected' : null })));
    const tagsInput = el('input', { type: 'text', value: (s.tags || []).join(', '), placeholder: '例: バラード, 夏, 2024' });
    const lyricsInput = el('textarea', { placeholder: 'セクション記法が使えます:\n' + SECTION_HINT + '\n\n[Aメロ]\n歌詞をここに...' });
    lyricsInput.value = s.lyrics || '';

    const form = el('div', {}, [
      el('div', { class: 'field' }, [el('label', { text: '曲名' }), titleInput]),
      el('div', { class: 'form-row' }, [
        el('div', { class: 'field' }, [el('label', { text: 'ステータス' }), statusSel]),
        el('div', { class: 'field' }, [el('label', { text: 'タグ（カンマ区切り）' }), tagsInput]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: '歌詞' }), lyricsInput,
        el('div', { class: 'hint', text: 'セクションは ' + SECTION_HINT + ' のように [ ] で囲んだ行で表せます。' }),
      ]),
    ]);

    const cancel = el('button', { class: 'btn', text: 'キャンセル', onclick: closeModal });
    const save = el('button', {
      class: 'btn btn-primary', text: '保存',
      onclick: async () => {
        const title = titleInput.value.trim();
        if (!title) { toast('曲名を入力してください'); titleInput.focus(); return; }
        const now = new Date().toISOString();
        try {
          if (isEdit) {
            const updated = { ...existing, title, status: statusSel.value, tags: parseTags(tagsInput.value), lyrics: lyricsInput.value, updatedAt: now };
            await DB.Songs.put(updated);
          } else {
            const created = { id: DB.uid('s_'), title, status: statusSel.value, tags: parseTags(tagsInput.value), lyrics: lyricsInput.value, createdAt: now, updatedAt: now };
            await DB.Songs.put(created);
            state.selectedId = created.id;
          }
          closeModal();
          await reload();
          if (!isEdit) { document.body.classList.add('detail-open'); $('btnBack').hidden = false; }
          await renderDetail();
          toast(isEdit ? '更新しました' : '追加しました');
          refreshStorageBadge();
        } catch (e) { handleSaveError(e); }
      }
    });
    openModal(isEdit ? '曲を編集' : '新規の曲', form, [cancel, save]);
    setTimeout(() => titleInput.focus(), 30);
  }

  async function deleteSong(song) {
    const ok = await confirmDialog(`「${song.title || '(無題)'}」を削除します。紐づく音声・動画・バージョンもすべて削除されます。よろしいですか？`, '削除する', true);
    if (!ok) return;
    destroyPlayers();
    await DB.deleteSongCascade(song.id);
    state.selectedId = null;
    backToList();
    await reload();
    await renderDetail();
    toast('削除しました');
    refreshStorageBadge();
  }

  // ==========================================================
  // バージョン操作
  // ==========================================================
  async function saveVersion(song) {
    const noteInput = el('input', { type: 'text', placeholder: '例: サビを修正 / 1番完成 など' });
    const body = el('div', {}, [
      el('div', { class: 'notice', text: '現在の歌詞・基本情報・コード進行を1つの版として保存します。音声・動画は含まれません。' }),
      el('div', { class: 'field' }, [el('label', { text: 'メモ（任意）' }), noteInput]),
    ]);
    const cancel = el('button', { class: 'btn', text: 'キャンセル', onclick: closeModal });
    const ok = el('button', {
      class: 'btn btn-primary', text: '保存',
      onclick: async () => {
        await VersionLib.snapshot(song, noteInput.value.trim());
        closeModal();
        await renderDetail();
        toast('この版を保存しました');
        refreshStorageBadge();
      }
    });
    openModal('この版を保存', body, [cancel, ok]);
    setTimeout(() => noteInput.focus(), 30);
  }

  function showDiff(song, v) {
    const diff = VersionLib.diffLines(v.lyrics || '', song.lyrics || '');
    const box = el('div', { class: 'diff' });
    diff.forEach(d => {
      const cls = d.type === 'add' ? 'd-add' : d.type === 'del' ? 'd-del' : 'd-same';
      const prefix = d.type === 'add' ? '＋ ' : d.type === 'del' ? '－ ' : '　 ';
      box.appendChild(el('span', { class: cls, text: prefix + (d.text || ' ') }));
    });
    const body = el('div', {}, [
      el('div', { class: 'notice', text: `この版（${fmtDate(v.createdAt)}）→ 現在 の歌詞の差分です。＋=現在追加 / －=版から削除。` }),
      box,
    ]);
    openModal('歌詞の差分', body, [el('button', { class: 'btn btn-primary', text: '閉じる', onclick: closeModal })]);
  }

  function showVersionContent(v) {
    const body = el('div', {}, [
      el('div', { class: 'detail-sub', style: 'margin-bottom:12px' }, [
        el('span', { class: 'badge badge-status', text: v.status || '—' }),
        el('span', { text: '保存 ' + fmtDate(v.createdAt) }),
      ]),
      el('div', { class: 'field' }, [el('label', { text: '曲名' }), el('div', { text: v.title || '(無題)' })]),
      (v.tags || []).length ? el('div', { class: 'tag-list', style: 'margin-bottom:12px' }, v.tags.map(t => el('span', { class: 'tag', text: '#' + t }))) : null,
      el('label', { text: '歌詞', style: 'font-size:12px;color:var(--c-text-2)' }),
      el('div', { class: 'lyrics-view', style: 'margin-top:6px' , text: v.lyrics || '(空)' }),
    ]);
    const chordText = versionChordText(v.chords);
    if (chordText) {
      body.appendChild(el('label', { text: 'コード進行', style: 'font-size:12px;color:var(--c-text-2);display:block;margin-top:12px' }));
      body.appendChild(el('div', { class: 'diff', style: 'margin-top:6px', text: chordText }));
    }
    openModal('版の内容', body, [el('button', { class: 'btn btn-primary', text: '閉じる', onclick: closeModal })]);
  }

  // 版に保存されたコード進行をテキスト化（セクションごとに |C G|Am F| 形式）
  function versionChordText(c) {
    if (!c || !Array.isArray(c.sections) || !c.sections.length) return '';
    const lines = [];
    c.sections.forEach(s => {
      const bars = (s.bars || []).map(b => (b.chords && b.chords.length) ? b.chords.join(' ') : '－').join(' | ');
      lines.push((s.name || '（無名）') + '  ｜' + bars + '｜');
    });
    return lines.join('\n');
  }

  async function restoreVersion(song, v) {
    const ok = await confirmDialog('この版の歌詞・基本情報・コード進行を現在の曲に復元します。現在の内容は上書きされます（先に「この版を保存」で退避できます）。よろしいですか？', '復元する');
    if (!ok) return;
    const updated = { ...song, title: v.title, status: v.status, tags: (v.tags || []).slice(), lyrics: v.lyrics, updatedAt: new Date().toISOString() };
    if (v.chords) updated.chords = JSON.parse(JSON.stringify(v.chords));
    await DB.Songs.put(updated);
    await reload();
    await renderDetail();
    toast('復元しました');
  }

  async function deleteVersion(song, v) {
    const ok = await confirmDialog('この版を削除しますか？', '削除', true);
    if (!ok) return;
    await DB.Versions.delete(v.id);
    await renderDetail();
    toast('削除しました');
    refreshStorageBadge();
  }

  // ==========================================================
  // ストレージ表示
  // ==========================================================
  async function openStorageModal() {
    const body = el('div', {}, [el('p', { class: 'progress', text: '計測中…' })]);
    openModal('ストレージ使用量', body, [el('button', { class: 'btn btn-primary', text: '閉じる', onclick: closeModal })]);
    const info = await StorageInfo.summary();
    body.innerHTML = '';

    const totalUsed = info.supported ? info.usage : info.storedTotal;
    const quotaText = info.supported && info.quota
      ? StorageInfo.fmtBytes(info.quota)
      : '不明';

    body.appendChild(el('div', { class: 'storage-total', text: StorageInfo.fmtBytes(totalUsed) + ' / ' + (info.supported ? '上限 ' + quotaText : '上限不明') }));

    // バー（内訳の相対比。上限が分かる場合は上限比、不明なら内訳合計比）
    const denom = (info.supported && info.quota) ? info.quota : Math.max(info.storedTotal, 1);
    const pct = (n) => Math.max(0, Math.min(100, (n / denom) * 100));
    const bar = el('div', { class: 'storage-bar' }, [
      el('div', { class: 'storage-seg video', style: `width:${pct(info.video)}%` }),
      el('div', { class: 'storage-seg audio', style: `width:${pct(info.audio)}%` }),
      el('div', { class: 'storage-seg lyrics', style: `width:${pct(info.lyrics)}%` }),
    ]);
    body.appendChild(bar);

    const legend = el('div', { class: 'storage-legend' }, [
      legendRow('video', '動画', info.video),
      legendRow('audio', '音声', info.audio),
      legendRow('lyrics', '歌詞・情報', info.lyrics),
    ]);
    body.appendChild(legend);

    if (!info.supported) {
      body.appendChild(el('div', { class: 'notice', style: 'margin-top:14px', text: 'このブラウザは容量上限の取得に非対応のため、保存済みデータのサイズ合計のみ表示しています。' }));
    } else {
      const used = info.usage || 0, quota = info.quota || 0;
      const usedPct = quota ? Math.round((used / quota) * 100) : 0;
      body.appendChild(el('div', { class: 'notice', style: 'margin-top:14px', text: `使用率 約${usedPct}%。ブラウザ全体の推定使用量/上限のため、他サイト分も含む場合があります。容量超過時は保存できません。` }));
    }
    // 永続化状態
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
    body.appendChild(el('div', { class: 'notice', style: 'margin-top:10px', text: persisted ? 'このデータは永続化済み（ブラウザに自動削除されにくい状態）です。' : 'データは永続化されていません。ブラウザの空き容量逼迫時に削除される可能性があります。定期的なバックアップを推奨します。' }));
  }

  function legendRow(cls, name, bytes) {
    return el('div', { class: 'row' }, [
      el('span', { class: 'legend-swatch ' + cls }),
      el('span', { class: 'legend-name', text: name }),
      el('span', { class: 'legend-val', text: StorageInfo.fmtBytes(bytes) }),
    ]);
  }

  async function refreshStorageBadge() { /* 予備: 今後バッジ表示する場合の更新フック */ }

  // ==========================================================
  // データ管理（バックアップ/復元）
  // ==========================================================
  function openDataModal() {
    const restoreInput = el('input', { type: 'file', accept: '.zip,application/zip', style: 'display:none' });
    restoreInput.addEventListener('change', async () => {
      if (!restoreInput.files.length) return;
      const file = restoreInput.files[0];
      restoreInput.value = '';
      await promptRestore(file);
    });

    const body = el('div', { class: 'data-actions' }, [
      el('button', { class: 'btn', text: '⬇ データをバックアップ（ZIP）', onclick: confirmBackup }),
      el('button', { class: 'btn', text: '⬆ バックアップを復元（ZIP）', onclick: () => restoreInput.click() }),
      restoreInput,
      el('div', { class: 'notice', text: '歌詞・音声・動画・バージョンをすべて1つのZIPにまとめて保存/復元します。ファイルは端末内で処理され、外部に送信されません。' }),
    ]);
    openModal('データ管理', body, [el('button', { class: 'btn btn-primary', text: '閉じる', onclick: closeModal })]);
  }

  // バックアップ実行前の確認ダイアログ
  async function confirmBackup() {
    // バックアップ対象が1件もない場合は、その旨を表示して中断する
    const [songs, media, versions] = await Promise.all([DB.Songs.all(), DB.Media.all(), DB.Versions.all()]);
    if (songs.length === 0 && media.length === 0 && versions.length === 0) {
      const emptyBody = el('div', {}, [
        el('p', { text: 'バックアップ対象のデータがありません。', style: 'margin-top:0' }),
        el('div', { class: 'notice', text: '曲を追加してからバックアップを実行してください。' }),
      ]);
      openModal('バックアップ', emptyBody, [el('button', { class: 'btn btn-primary', text: '閉じる', onclick: closeModal })]);
      return;
    }
    const body = el('div', {}, [
      el('p', { text: '歌詞・音声・動画・バージョンをすべて1つのZIPファイルにまとめてダウンロードします。よろしいですか？', style: 'margin-top:0' }),
      el('div', { class: 'notice', text: 'ファイルは端末内で処理され、外部には送信されません。データ量が多い場合は作成に時間がかかることがあります。' }),
    ]);
    const cancel = el('button', { class: 'btn', text: 'キャンセル', onclick: closeModal });
    const ok = el('button', { class: 'btn btn-primary', text: '作成してダウンロード', onclick: doBackup });
    openModal('バックアップの作成', body, [cancel, ok]);
  }

  async function doBackup() {
    const c = $('modalContent');
    c.innerHTML = '';
    const prog = el('div', { class: 'progress', text: 'バックアップZIPを作成中…' });
    c.appendChild(prog);
    $('modalFooter').innerHTML = '';
    try {
      const size = await Backup.downloadBackup();
      prog.textContent = 'バックアップを作成しました（' + StorageInfo.fmtBytes(size) + '）。ダウンロードを確認してください。';
      toast('バックアップを作成しました');
    } catch (e) {
      prog.textContent = 'バックアップに失敗しました: ' + (e && e.message ? e.message : e);
    }
    $('modalFooter').appendChild(el('button', { class: 'btn btn-primary', text: '閉じる', onclick: closeModal }));
  }

  async function promptRestore(file) {
    const body = el('div', {}, [
      el('p', { text: `「${file.name}」から復元します。方法を選択してください。`, style: 'margin-top:0' }),
      el('div', { class: 'notice', text: '「置き換え」は現在の全データを消してから復元します。「追記」は現在のデータを残し、同じIDのものは上書きします。' }),
    ]);
    const cancel = el('button', { class: 'btn', text: 'キャンセル', onclick: closeModal });
    const merge = el('button', { class: 'btn', text: '追記で復元', onclick: () => runRestore(file, 'merge') });
    const replace = el('button', { class: 'btn btn-danger', text: '置き換えで復元', onclick: () => runRestore(file, 'replace') });
    openModal('バックアップを復元', body, [cancel, merge, replace]);
  }

  async function runRestore(file, mode) {
    const c = $('modalContent');
    c.innerHTML = '';
    const prog = el('div', { class: 'progress', text: '復元中…' });
    c.appendChild(prog);
    $('modalFooter').innerHTML = '';
    try {
      const res = await Backup.restore(file, mode);
      destroyPlayers();
      state.selectedId = null;
      backToList();
      await reload();
      await renderDetail();
      let msg = `復元しました。曲 ${res.songs} 件 / 音声・動画 ${res.media} 件 / バージョン ${res.versions} 件。`;
      if (res.missing) msg += ` （メディア ${res.missing} 件はZIP内に本体が見つからず復元できませんでした）`;
      prog.textContent = msg;
      $('modalFooter').appendChild(el('button', { class: 'btn btn-primary', text: '閉じる', onclick: closeModal }));
      toast('復元しました');
      refreshStorageBadge();
    } catch (e) {
      prog.textContent = '復元に失敗しました: ' + (e && e.message ? e.message : e);
      $('modalFooter').appendChild(el('button', { class: 'btn btn-primary', text: '閉じる', onclick: closeModal }));
    }
  }

  // ==========================================================
  // 保存エラー処理
  // ==========================================================
  function handleSaveError(e) {
    console.error(e);
    if (e && (e.name === 'QuotaExceededError' || (e.message && /quota/i.test(e.message)))) {
      toast('保存容量が不足しています。不要なファイルを削除するかバックアップしてください。');
    } else {
      toast('保存に失敗しました: ' + (e && e.message ? e.message : e));
    }
  }

  // ==========================================================
  // 初期化
  // ==========================================================
  async function reload() {
    state.songs = await DB.Songs.all();
    renderList();
  }

  // ==========================================================
  // クイックキャプチャ（録音＋メモ → 新規曲を自動作成）
  // ==========================================================
  function openQuickCapture() {
    const memo = el('textarea', { class: 'chord-input qc-memo', placeholder: '思いついた歌詞・アイデアをメモ…' });
    let recorded = null;
    let recording = false;
    const recSupported = !!(window.Recorder && Recorder.isSupported());
    const recStatus = el('span', { class: 'qc-rec-status', text: recSupported ? '' : '（このブラウザは録音に非対応）' });
    // クイックキャプチャは共有モーダル上で動くため、別モーダルを開かずインラインで録音する
    const recBtn = el('button', { class: 'btn btn-sm', text: '● 録音', disabled: recSupported ? null : 'disabled' });
    recBtn.addEventListener('click', async () => {
      if (!recSupported) return;
      if (!recording) {
        try {
          await Recorder.start((sec) => { recStatus.textContent = '録音中… ' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); });
          recording = true; recBtn.textContent = '■ 停止';
        } catch (e) { recStatus.textContent = 'マイクを使用できませんでした（権限を確認してください）'; }
      } else {
        try { recorded = await Recorder.stop(); recording = false; recBtn.textContent = '● 録り直す'; recStatus.textContent = '録音あり（保存時に追加されます）'; }
        catch (e) { recording = false; recBtn.textContent = '● 録音'; recStatus.textContent = '録音の保存に失敗しました'; }
      }
    });
    const body = el('div', {}, [
      el('div', { class: 'field' }, [el('label', { text: 'メモ（歌詞・アイデア）' }), memo]),
      el('div', { class: 'qc-rec' }, [recBtn, recStatus]),
      el('div', { class: 'hint', text: '保存すると「無題（日付）」の新しい曲として作成されます。あとで曲名や情報を整理できます。' }),
    ]);
    const cancel = el('button', { class: 'btn', text: 'キャンセル', onclick: () => { if (recording) Recorder.cancel(); closeModal(); } });
    const save = el('button', {
      class: 'btn btn-primary', text: '保存',
      onclick: async () => {
        if (recording) { toast('録音を停止してから保存してください'); return; }
        const text = memo.value.trim();
        if (!text && !recorded) { toast('メモを入力するか録音してください'); return; }
        const now = new Date(); const p = (n) => String(n).padStart(2, '0');
        const title = '無題 ' + now.getFullYear() + '/' + p(now.getMonth() + 1) + '/' + p(now.getDate()) + ' ' + p(now.getHours()) + ':' + p(now.getMinutes());
        const iso = now.toISOString();
        const created = { id: DB.uid('s_'), title, status: STATUSES[0], tags: [], lyrics: text, createdAt: iso, updatedAt: iso };
        try {
          await DB.Songs.put(created);
          if (recorded) await MediaLib.saveRecording(created.id, recorded.blob, recorded.mime);
          closeModal();
          state.selectedId = created.id;
          await reload();
          document.body.classList.add('detail-open'); $('btnBack').hidden = false;
          await renderDetail();
          toast('保存しました');
          refreshStorageBadge();
        } catch (e) { handleSaveError(e); }
      }
    });
    openModal('クイックキャプチャ', body, [cancel, save]);
    setTimeout(() => memo.focus(), 30);
  }

  // ==========================================================
  // 使い方ガイド（アプリ内ヘルプ）
  // ==========================================================
  function openHelp() {
    const sec = (title, lines) => el('div', { class: 'help-sec' }, [
      el('h3', { class: 'help-h', text: title }),
      el('ul', { class: 'help-ul' }, lines.map(t => el('li', { text: t }))),
    ]);
    const body = el('div', { class: 'help-body' }, [
      el('p', { class: 'help-lead', text: 'Verse は歌詞・コード・ボイスメモ・動画を1曲ごとに管理する、無料・オフライン・端末内保存のアプリです。歌詞からでもコードからでも自由に作れます。' }),
      sec('曲の管理', [
        '「＋ 新規」で曲を追加。曲名・ステータス（アイデア〜完成）・タグ・歌詞を入力。',
        '詳細画面の「編集」「削除」で変更。削除は音声・動画・バージョンも一緒に消えます。',
        '一覧上部の検索で、曲名・歌詞・タグ・ステータス・コード名を横断検索。',
      ]),
      sec('歌詞', [
        '「編集」で入力。行に [Aメロ] [サビ] などと書くと見出しになります。',
      ]),
      sec('コード譜（歌詞の上にコード）', [
        '歌詞セクションの「コード譜」で、歌詞に [C]あの日[G]見た のようにコードを埋め込みます。',
        '「♪ コード進行のコードを歌詞に割り当てる」→ 歌詞の文字をタップして「このコードはこの文字まで」を指定できます。',
        '歌本ビューで、歌詞の上にコードが並びます。',
      ]),
      sec('コード進行', [
        '小節の「＋」→ ルート×種類のパレットでコード入力（♯/♭切替・オンベース・直接入力も可）。',
        '各セクションの「⚙ 設定」でテンポ/拍子/カポ/移調/スタイル(ブロック/ストラム/アルペジオ)/ループをセクション別に設定。',
        '設定のコピー/貼り付け・全体適用・セクション複製が可能。',
        '「▶ 再生」で全曲、各セクションの「▶」でそのセクションだけ再生。推定キーも自動表示。',
        '移調 −1＝半音下げ、+1＝半音上げ。カポ設定時はコード下段に「押さえるコード」を表示。',
      ]),
      sec('歌本ビュー', [
        '詳細の「歌本」で、歌詞＋コードをまとめて表示（読み取り用）。ここから「カラオケ」「コード譜編集」も開けます。',
      ]),
      sec('カラオケ（曲として再生）', [
        '前提：歌詞にコードを配置しておく（コード譜）。',
        '歌本→「▶ カラオケ」→ 音源（伴奏なし/保存音声）を選び「● 同期する」。',
        'カウント（3・2・1）の後、コードが変わる瞬間にタップしてタイミングを記録。',
        '「▶ 再生」で、記録どおりコードが鳴り歌詞が1文字ずつ進みます。',
        '「✎ 編集」で各コードの秒を微調整（−/＋/数値）、部分的に録り直しできます（最初からやり直し不要）。',
      ]),
      sec('ボイスメモ・動画・録音', [
        '音声/動画は「＋ アップロード」で追加。音声は「● 録音」でアプリ内録音も可能。',
        'ファイルをタップするとプレイヤー（再生・シーク）が開きます。',
      ]),
      sec('クイックキャプチャ（⚡）', [
        'ヘッダの ⚡ から、メモ＋その場録音を「無題（日付）」の新しい曲として即保存。',
      ]),
      sec('バージョン管理', [
        '「この版を保存」で歌詞・基本情報・コード進行のスナップショットを保存。差分表示・復元が可能（音声・動画は含みません）。',
      ]),
      sec('バックアップ・容量', [
        'データは端末内のみ。⋯「データ管理」から ZIP でバックアップ/復元。機種変更もこれで移行。',
        '▦ でストレージ使用量（動画/音声/歌詞の内訳）を表示。こまめなバックアップ推奨。',
      ]),
      sec('iPhone での注意', [
        '音は「▶」タップで鳴ります。消音（マナー）スイッチで鳴らないことがあります。',
        'iPhoneのボイスメモは「共有→ファイルに保存」後にアップロードしてください。',
        '最新機能が出ないときはアプリを開き直すと更新されます。',
      ]),
    ]);
    openModal('使い方ガイド', body, [el('button', { class: 'btn btn-primary', text: '閉じる', onclick: closeModal })]);
  }

  function bindGlobal() {
    searchInput.addEventListener('input', () => { state.query = searchInput.value; renderList(); });
    $('btnHelp').addEventListener('click', openHelp);
    $('btnNew').addEventListener('click', () => openSongForm(null));
    $('btnQuick').addEventListener('click', openQuickCapture);
    $('btnStorage').addEventListener('click', openStorageModal);
    $('btnData').addEventListener('click', openDataModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modalOverlay').hidden) closeModal(); });
  }

  async function init() {
    renderStatusFilter();
    bindGlobal();
    try {
      await DB.open();
      await reload();
      StorageInfo.requestPersist();  // 永続化を要求（失敗しても続行）
    } catch (e) {
      console.error(e);
      toast('データベースの初期化に失敗しました: ' + (e && e.message ? e.message : e));
    }
    // Service Worker 登録（PWA）
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW登録失敗:', err));
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();

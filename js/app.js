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
  function closeModal() { $('modalOverlay').hidden = true; $('modalContent').innerHTML = ''; }
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
        const hay = [s.title, s.lyrics, s.status, (s.tags || []).join(' ')].join('\n').toLowerCase();
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
    // --- ボイスメモ（音声） ---
    detailBodyEl.appendChild(await sectionMedia(song, 'audio'));
    // --- 動画 ---
    detailBodyEl.appendChild(await sectionMedia(song, 'video'));
    // --- バージョン ---
    detailBodyEl.appendChild(await sectionVersions(song));
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
        if (/^\s*\[.+\]\s*$/.test(line)) {
          view.appendChild(el('span', { class: 'lyrics-section-label', text: line.trim() }));
          view.appendChild(document.createTextNode('\n'));
        } else {
          view.appendChild(document.createTextNode(line + '\n'));
        }
      }
    }
    body.appendChild(view);
    return section('歌詞', [el('button', { class: 'btn btn-sm', text: '編集', onclick: () => openSongForm(song) })], body);
  }

  async function sectionMedia(song, kind) {
    const title = kind === 'audio' ? 'ボイスメモ（音声）' : '動画';
    const accept = kind === 'audio' ? 'audio/*' : 'video/*';
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

    const body = el('div', { class: 'section-body' });
    body.appendChild(fileInput);
    const media = (await DB.Media.bySong(song.id)).filter(m => m.kind === kind)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    if (!media.length) {
      body.appendChild(el('p', { class: 'media-empty', text: kind === 'audio' ? '音声はまだありません。' : '動画はまだありません。' }));
    } else {
      const list = el('div', { class: 'media-list' });
      for (const m of media) list.appendChild(mediaItem(m, song));
      body.appendChild(list);
    }
    return section(title, [addBtn], body);
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
    body.appendChild(el('div', { class: 'notice', text: '※ バージョンには歌詞と基本情報（曲名・ステータス・タグ）のみ保存されます。音声・動画は含まれません。' }));

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
      el('div', { class: 'notice', text: '現在の歌詞と基本情報を1つの版として保存します。音声・動画は含まれません。' }),
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
    openModal('版の内容', body, [el('button', { class: 'btn btn-primary', text: '閉じる', onclick: closeModal })]);
  }

  async function restoreVersion(song, v) {
    const ok = await confirmDialog('この版の歌詞・基本情報を現在の曲に復元します。現在の内容は上書きされます（先に「この版を保存」で退避できます）。よろしいですか？', '復元する');
    if (!ok) return;
    const updated = { ...song, title: v.title, status: v.status, tags: (v.tags || []).slice(), lyrics: v.lyrics, updatedAt: new Date().toISOString() };
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

  function bindGlobal() {
    searchInput.addEventListener('input', () => { state.query = searchInput.value; renderList(); });
    $('btnNew').addEventListener('click', () => openSongForm(null));
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

/* ============================================================
 * media.js — メディアのアップロード保存 & カスタムプレイヤー
 *   - MediaLib.saveFiles(songId, fileList, kind) : File を Blob として保存
 *   - MediaLib.createPlayer(mediaRecord) : シークバー付きプレイヤー要素を返す
 *   Object URL は生成→破棄を管理し、リークを防ぐ。
 * ============================================================ */
(function (global) {
  'use strict';

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  // 拡張子推定（バックアップ時のファイル名に使用）
  function extFromMime(mime, fallbackName) {
    const map = {
      'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
      'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg',
      'audio/webm': 'weba', 'audio/flac': 'flac',
      'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
      'video/x-matroska': 'mkv', 'video/ogg': 'ogv', 'video/3gpp': '3gp',
    };
    if (map[mime]) return map[mime];
    if (fallbackName && fallbackName.includes('.')) return fallbackName.split('.').pop().toLowerCase();
    return 'bin';
  }

  // File[] を保存
  async function saveFiles(songId, files, kind) {
    const saved = [];
    for (const file of files) {
      const rec = {
        id: DB.uid('m_'),
        songId,
        kind,                       // 'audio' | 'video'
        name: file.name || (kind === 'audio' ? '音声' : '動画'),
        mime: file.type || (kind === 'audio' ? 'audio/mpeg' : 'video/mp4'),
        size: file.size,
        blob: file,                 // File は Blob のサブクラス。そのまま保存可
        createdAt: new Date().toISOString(),
      };
      await DB.Media.put(rec);
      saved.push(rec);
    }
    return saved;
  }

  /**
   * カスタムプレイヤー要素を生成。
   * @param {object} rec media レコード（blob を含む）
   * @returns {{el:HTMLElement, destroy:()=>void}}
   */
  function createPlayer(rec) {
    const url = URL.createObjectURL(rec.blob);
    const wrap = document.createElement('div');
    wrap.className = 'player';

    const isVideo = rec.kind === 'video';
    const mediaEl = document.createElement(isVideo ? 'video' : 'audio');
    mediaEl.src = url;
    mediaEl.preload = 'metadata';
    mediaEl.playsInline = true;
    if (isVideo) wrap.appendChild(mediaEl);

    const controls = document.createElement('div');
    controls.className = 'player-controls';

    const playBtn = document.createElement('button');
    playBtn.className = 'btn icon-btn player-play';
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', '再生');

    const seek = document.createElement('input');
    seek.type = 'range';
    seek.className = 'player-seek';
    seek.min = '0'; seek.max = '1000'; seek.value = '0'; seek.step = '1';
    seek.setAttribute('aria-label', 'シークバー');

    const time = document.createElement('span');
    time.className = 'player-time';
    time.textContent = '0:00 / 0:00';

    controls.append(playBtn, seek, time);
    wrap.appendChild(controls);

    let seeking = false;

    function updateTime() {
      const cur = mediaEl.currentTime || 0;
      const dur = mediaEl.duration || 0;
      time.textContent = fmtTime(cur) + ' / ' + fmtTime(dur);
      if (!seeking && dur > 0) seek.value = String(Math.round((cur / dur) * 1000));
    }

    playBtn.addEventListener('click', () => {
      if (mediaEl.paused) mediaEl.play(); else mediaEl.pause();
    });
    mediaEl.addEventListener('play', () => { playBtn.textContent = '⏸'; playBtn.setAttribute('aria-label', '一時停止'); });
    mediaEl.addEventListener('pause', () => { playBtn.textContent = '▶'; playBtn.setAttribute('aria-label', '再生'); });
    mediaEl.addEventListener('loadedmetadata', updateTime);
    mediaEl.addEventListener('timeupdate', updateTime);
    mediaEl.addEventListener('ended', () => { playBtn.textContent = '▶'; });

    seek.addEventListener('input', () => { seeking = true; });
    seek.addEventListener('change', () => {
      const dur = mediaEl.duration || 0;
      if (dur > 0) mediaEl.currentTime = (Number(seek.value) / 1000) * dur;
      seeking = false;
    });

    function destroy() {
      try { mediaEl.pause(); } catch (e) {}
      mediaEl.removeAttribute('src');
      try { mediaEl.load(); } catch (e) {}
      URL.revokeObjectURL(url);
    }

    return { el: wrap, destroy };
  }

  global.MediaLib = { saveFiles, createPlayer, fmtTime, extFromMime };
})(window);

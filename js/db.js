/* ============================================================
 * db.js — IndexedDB ラッパ
 *   DB名: verse / version 1
 *   stores:
 *     songs    (keyPath id)                 曲の基本情報・歌詞
 *     media    (keyPath id, index by_song)  音声/動画のBlob本体
 *     versions (keyPath id, index by_song)  歌詞+基本情報のスナップショット
 * ============================================================ */
(function (global) {
  'use strict';

  const DB_NAME = 'verse';
  const DB_VERSION = 1;
  let _dbPromise = null;

  function open() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = req.result;
        if (!db.objectStoreNames.contains('songs')) {
          db.createObjectStore('songs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('media')) {
          const s = db.createObjectStore('media', { keyPath: 'id' });
          s.createIndex('by_song', 'songId', { unique: false });
        }
        if (!db.objectStoreNames.contains('versions')) {
          const s = db.createObjectStore('versions', { keyPath: 'id' });
          s.createIndex('by_song', 'songId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  function tx(store, mode) {
    return open().then((db) => {
      const t = db.transaction(store, mode);
      return { t, store: t.objectStore(store) };
    });
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ---- 汎用 ----
  async function getAll(store) {
    const { store: os } = await tx(store, 'readonly');
    return reqToPromise(os.getAll());
  }
  async function get(store, id) {
    const { store: os } = await tx(store, 'readonly');
    return reqToPromise(os.get(id));
  }
  async function put(store, value) {
    const { t, store: os } = await tx(store, 'readwrite');
    os.put(value);
    return txDone(t).then(() => value);
  }
  async function del(store, id) {
    const { t, store: os } = await tx(store, 'readwrite');
    os.delete(id);
    return txDone(t);
  }
  async function getByIndex(store, indexName, key) {
    const { store: os } = await tx(store, 'readonly');
    return reqToPromise(os.index(indexName).getAll(key));
  }

  function txDone(t) {
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transaction aborted'));
    });
  }

  // ---- ID生成 ----
  function uid(prefix) {
    const rnd = (crypto && crypto.getRandomValues)
      ? Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, '0')).join('')
      : Math.random().toString(16).slice(2);
    return (prefix || '') + Date.now().toString(36) + '-' + rnd;
  }

  // ---- Songs ----
  const Songs = {
    all: () => getAll('songs'),
    get: (id) => get('songs', id),
    put: (song) => put('songs', song),
    delete: (id) => del('songs', id),
  };

  // ---- Media ----
  const Media = {
    all: () => getAll('media'),
    get: (id) => get('media', id),
    put: (m) => put('media', m),
    delete: (id) => del('media', id),
    bySong: (songId) => getByIndex('media', 'by_song', songId),
  };

  // ---- Versions ----
  const Versions = {
    all: () => getAll('versions'),
    get: (id) => get('versions', id),
    put: (v) => put('versions', v),
    delete: (id) => del('versions', id),
    bySong: (songId) => getByIndex('versions', 'by_song', songId),
  };

  // ---- 曲まるごと削除（media/versionsも） ----
  async function deleteSongCascade(songId) {
    const [media, versions] = await Promise.all([Media.bySong(songId), Versions.bySong(songId)]);
    const db = await open();
    const t = db.transaction(['songs', 'media', 'versions'], 'readwrite');
    t.objectStore('songs').delete(songId);
    media.forEach(m => t.objectStore('media').delete(m.id));
    versions.forEach(v => t.objectStore('versions').delete(v.id));
    return txDone(t);
  }

  // ---- 全消去（復元時の上書き用） ----
  async function clearAll() {
    const db = await open();
    const t = db.transaction(['songs', 'media', 'versions'], 'readwrite');
    t.objectStore('songs').clear();
    t.objectStore('media').clear();
    t.objectStore('versions').clear();
    return txDone(t);
  }

  global.DB = {
    open, Songs, Media, Versions,
    deleteSongCascade, clearAll, uid,
  };
})(window);

/* ============================================================
 * backup.js — バックアップ / 復元（自前ZIPを使用）
 *   ZIP構造:
 *     manifest.json          全テキストデータ + メディアのメタ情報
 *     media/<mediaId>.<ext>  各メディアのBlob本体
 *   ※ 歌詞・音声・動画をまとめて1つのZIPに格納する。
 * ============================================================ */
(function (global) {
  'use strict';

  const MANIFEST_VERSION = 1;

  // すべてのデータを ZIP にまとめて Blob を返す
  async function exportAll() {
    const [songs, versions, media] = await Promise.all([
      DB.Songs.all(), DB.Versions.all(), DB.Media.all(),
    ]);

    const entries = [];
    const mediaMeta = [];

    for (const m of media) {
      const ext = MediaLib.extFromMime(m.mime, m.name);
      const file = 'media/' + m.id + '.' + ext;
      mediaMeta.push({
        id: m.id, songId: m.songId, kind: m.kind, name: m.name,
        mime: m.mime, size: m.size, createdAt: m.createdAt, file,
      });
      entries.push({ name: file, data: m.blob });
    }

    const manifest = {
      app: 'Verse',
      manifestVersion: MANIFEST_VERSION,
      exportedAt: new Date().toISOString(),
      songs,
      versions,
      media: mediaMeta,
    };
    entries.unshift({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });

    return SongZip.create(entries);
  }

  // ZIP をダウンロードさせる
  async function downloadBackup() {
    const blob = await exportAll();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Verse_backup_${stamp}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return blob.size;
  }

  // ZIP を解析して {manifest, mediaBlobs: Map<file, Blob>} を返す
  async function parseBackup(zipBlob) {
    const entries = await SongZip.read(zipBlob);
    const map = new Map();
    let manifest = null;
    for (const e of entries) {
      if (e.name === 'manifest.json') {
        manifest = JSON.parse(e.text());
      } else {
        map.set(e.name, e);
      }
    }
    if (!manifest) throw new Error('manifest.json が見つかりません（Verseのバックアップではない可能性）');
    return { manifest, entries: map };
  }

  /**
   * 復元を実行
   * @param {Blob} zipBlob
   * @param {'replace'|'merge'} mode  replace=全消去して置換 / merge=追記（IDが同じものは上書き）
   */
  async function restore(zipBlob, mode) {
    const { manifest, entries } = await parseBackup(zipBlob);
    if (mode === 'replace') await DB.clearAll();

    // songs
    for (const s of (manifest.songs || [])) await DB.Songs.put(s);
    // versions
    for (const v of (manifest.versions || [])) await DB.Versions.put(v);
    // media
    let restoredMedia = 0, missing = 0;
    for (const mm of (manifest.media || [])) {
      const e = entries.get(mm.file);
      if (!e) { missing++; continue; }
      const rec = {
        id: mm.id, songId: mm.songId, kind: mm.kind, name: mm.name,
        mime: mm.mime, size: mm.size, createdAt: mm.createdAt,
        blob: e.blob(mm.mime),
      };
      await DB.Media.put(rec);
      restoredMedia++;
    }
    return {
      songs: (manifest.songs || []).length,
      versions: (manifest.versions || []).length,
      media: restoredMedia,
      missing,
    };
  }

  global.Backup = { exportAll, downloadBackup, parseBackup, restore };
})(window);

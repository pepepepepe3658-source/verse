/* ============================================================
 * zip.js — 依存ゼロの自前 ZIP (store / 無圧縮) 実装
 *   - SongZip.create(entries) -> Promise<Blob>   ZIP生成
 *   - SongZip.read(blob)       -> Promise<entries[]> ZIP展開
 *   entry: { name: string, data: Uint8Array | Blob | string }
 *   読込結果 entry: { name, data: Uint8Array, text():string, blob():Blob }
 *
 * 仕様: PKWARE APPNOTE の Local File Header + Central Directory + EOCD。
 * 圧縮メソッドは 0 (store)。ファイル名は UTF-8 (汎用フラグ bit11=1)。
 * ============================================================ */
(function (global) {
  'use strict';

  // ---- CRC32 ----
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  async function toUint8(data) {
    if (data instanceof Uint8Array) return data;
    if (typeof data === 'string') return enc.encode(data);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    throw new Error('Unsupported ZIP entry data type');
  }

  // DOS 時刻 (現在時刻を使用)
  function dosTime(d) {
    const t = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F);
    return t & 0xFFFF;
  }
  function dosDate(d) {
    const dt = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
    return dt & 0xFFFF;
  }

  /**
   * ZIP を生成して Blob を返す
   * @param {{name:string, data:(Uint8Array|Blob|string)}[]} entries
   * @returns {Promise<Blob>}
   */
  async function create(entries) {
    const now = new Date();
    const time = dosTime(now);
    const date = dosDate(now);
    const parts = [];        // Blobにまとめるための配列
    const central = [];      // セントラルディレクトリ用レコード
    let offset = 0;          // 現在のオフセット

    for (const e of entries) {
      const nameBytes = enc.encode(e.name);
      const dataBytes = await toUint8(e.data);
      const crc = crc32(dataBytes);
      const size = dataBytes.length;

      // --- Local File Header (30 + name) ---
      const lfh = new DataView(new ArrayBuffer(30));
      lfh.setUint32(0, 0x04034b50, true);   // signature
      lfh.setUint16(4, 20, true);           // version needed
      lfh.setUint16(6, 0x0800, true);       // flags: bit11 = UTF-8
      lfh.setUint16(8, 0, true);            // method = store
      lfh.setUint16(10, time, true);
      lfh.setUint16(12, date, true);
      lfh.setUint32(14, crc, true);
      lfh.setUint32(18, size, true);        // compressed size
      lfh.setUint32(22, size, true);        // uncompressed size
      lfh.setUint16(26, nameBytes.length, true);
      lfh.setUint16(28, 0, true);           // extra length

      const localOffset = offset;
      parts.push(new Uint8Array(lfh.buffer), nameBytes, dataBytes);
      offset += 30 + nameBytes.length + size;

      // --- Central Directory record (46 + name) ---
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);            // version made by
      cd.setUint16(6, 20, true);            // version needed
      cd.setUint16(8, 0x0800, true);        // flags UTF-8
      cd.setUint16(10, 0, true);            // method
      cd.setUint16(12, time, true);
      cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, size, true);
      cd.setUint32(24, size, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint16(30, 0, true);            // extra len
      cd.setUint16(32, 0, true);            // comment len
      cd.setUint16(34, 0, true);            // disk number
      cd.setUint16(36, 0, true);            // internal attrs
      cd.setUint32(38, 0, true);            // external attrs
      cd.setUint32(42, localOffset, true);  // offset of local header
      central.push(new Uint8Array(cd.buffer), nameBytes);
    }

    // --- Central Directory 全体を連結してサイズ算出 ---
    const cdStart = offset;
    let cdSize = 0;
    for (const p of central) cdSize += p.length;

    // --- EOCD (22) ---
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);             // disk
    eocd.setUint16(6, 0, true);             // cd start disk
    eocd.setUint16(8, entries.length, true);
    eocd.setUint16(10, entries.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, cdStart, true);
    eocd.setUint16(20, 0, true);            // comment len

    const blobParts = [...parts, ...central, new Uint8Array(eocd.buffer)];
    return new Blob(blobParts, { type: 'application/zip' });
  }

  /**
   * ZIP を展開する
   * @param {Blob|ArrayBuffer|Uint8Array} input
   * @returns {Promise<{name:string,data:Uint8Array,text:()=>string,blob:(type?:string)=>Blob}[]>}
   */
  async function read(input) {
    let bytes;
    if (input instanceof Uint8Array) bytes = input;
    else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
    else if (input instanceof Blob) bytes = new Uint8Array(await input.arrayBuffer());
    else throw new Error('Unsupported ZIP input');

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // EOCD を末尾から探索
    let eocdPos = -1;
    const minPos = Math.max(0, bytes.length - 22 - 65535);
    for (let i = bytes.length - 22; i >= minPos; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocdPos = i; break; }
    }
    if (eocdPos < 0) throw new Error('ZIPのEOCDが見つかりません（壊れたファイルの可能性）');

    const total = view.getUint16(eocdPos + 10, true);
    let cdPos = view.getUint32(eocdPos + 16, true);

    const entries = [];
    for (let n = 0; n < total; n++) {
      if (view.getUint32(cdPos, true) !== 0x02014b50) throw new Error('セントラルディレクトリが不正です');
      const method = view.getUint16(cdPos + 10, true);
      const compSize = view.getUint32(cdPos + 20, true);
      const nameLen = view.getUint16(cdPos + 28, true);
      const extraLen = view.getUint16(cdPos + 30, true);
      const commentLen = view.getUint16(cdPos + 32, true);
      const localOffset = view.getUint32(cdPos + 42, true);
      const name = dec.decode(bytes.subarray(cdPos + 46, cdPos + 46 + nameLen));

      if (method !== 0) throw new Error('未対応の圧縮方式です（store のみ対応）: ' + name);

      // Local header からデータ位置を算出
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const data = bytes.subarray(dataStart, dataStart + compSize);

      entries.push({
        name,
        data,
        text() { return dec.decode(this.data); },
        blob(type) { return new Blob([this.data], type ? { type } : undefined); }
      });

      cdPos += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  global.SongZip = { create, read, crc32 };
})(window);

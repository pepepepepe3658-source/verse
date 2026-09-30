/* ============================================================
 * recorder.js — MediaRecorder による録音ラッパ（依存ゼロ・ローカル・通信なし）
 *   - Recorder.isSupported()
 *   - Recorder.start(onTick)  マイク取得→録音開始。onTick(sec) を約0.25秒ごとに呼ぶ
 *   - Recorder.stop() -> Promise<{blob, mime}>
 *   - Recorder.cancel()  破棄
 *   ※ マイク使用には画面操作起点＋権限許可が必要（iOSは14.3+で対応）。
 * ============================================================ */
(function (global) {
  'use strict';

  let rec = null, chunks = [], stream = null, timer = null, startTs = 0;

  function isSupported() {
    return !!(global.navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && global.MediaRecorder);
  }

  function pickMime() {
    const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'];
    if (global.MediaRecorder && MediaRecorder.isTypeSupported) {
      for (const m of cands) if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return ''; // ブラウザ既定に任せる
  }

  function cleanup() {
    if (timer) { clearInterval(timer); timer = null; }
    if (stream) { stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} }); stream = null; }
    rec = null; chunks = [];
  }

  async function start(onTick) {
    if (!isSupported()) throw new Error('録音に非対応のブラウザです');
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = pickMime();
    rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.start();
    startTs = Date.now();
    if (onTick) { timer = setInterval(() => onTick(Math.floor((Date.now() - startTs) / 1000)), 250); }
    return rec.mimeType || mime || 'audio/webm';
  }

  function stop() {
    return new Promise((resolve, reject) => {
      if (!rec) { reject(new Error('録音していません')); return; }
      const mime = rec.mimeType || 'audio/webm';
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: mime });
        cleanup();
        resolve({ blob: blob, mime: mime });
      };
      try { rec.stop(); } catch (e) { cleanup(); reject(e); }
    });
  }

  function cancel() {
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) {}
    cleanup();
  }

  function isRecording() { return !!(rec && rec.state === 'recording'); }

  global.Recorder = { isSupported, start, stop, cancel, isRecording };
})(window);

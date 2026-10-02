/* ============================================================
 * karaoke.js — カラオケ用の再生クロック（依存ゼロ・ローカル）
 *   Karaoke.play({ mode:'chords'|'audio', chordList, blob, duration, onTime, onEnd })
 *     - mode='audio': Blob から <audio> を生成し currentTime を rAF で通知
 *     - mode='chords': AudioEngine で合成音を鳴らし performance.now() 基準で経過秒を通知
 *   Karaoke.stop() / Karaoke.currentTime() / Karaoke.isRunning()
 *   Karaoke.audioDuration(blob) -> Promise<number>（音声の長さ取得）
 * ============================================================ */
(function (global) {
  'use strict';

  let audioEl = null, raf = null, running = false, mode = null, startPerf = 0, dur = 0, onTimeCb = null, onEndCb = null, objUrl = null, chordHandle = null;

  function clearRaf() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

  function stop() {
    running = false;
    clearRaf();
    if (audioEl) { try { audioEl.pause(); } catch (e) {} audioEl.onended = null; audioEl = null; }
    if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
    if (chordHandle) { try { chordHandle.stop(); } catch (e) {} chordHandle = null; }
    if (mode === 'chords' && global.AudioEngine) { try { AudioEngine.stop(); } catch (e) {} }
    mode = null;
  }

  function finish() {
    if (!running) return;
    const cb = onEndCb;
    if (onTimeCb && dur) onTimeCb(dur);
    stop();
    if (cb) cb();
  }

  function loop() {
    if (!running) return;
    const t = currentTime();
    if (onTimeCb) onTimeCb(t);
    if (mode === 'chords' && dur && t >= dur) { finish(); return; }
    raf = requestAnimationFrame(loop);
  }

  function currentTime() {
    if (mode === 'audio' && audioEl) return audioEl.currentTime || 0;
    if (mode === 'chords') return (performance.now() - startPerf) / 1000;
    return 0;
  }

  async function play(opts) {
    stop();
    onTimeCb = opts.onTime || null; onEndCb = opts.onEnd || null; dur = opts.duration || 0;
    running = true;
    // コード譜のコード伴奏（絶対時刻）を同時スケジュール
    if (opts.chordEvents && opts.chordEvents.length && global.AudioEngine && AudioEngine.playTimed) {
      chordHandle = AudioEngine.playTimed(opts.chordEvents);
    }
    if (opts.mode === 'chords') {
      mode = 'chords';
      startPerf = performance.now();
      if (global.AudioEngine && opts.chordList && opts.chordList.length) AudioEngine.play(opts.chordList, { loop: false });
      raf = requestAnimationFrame(loop);
    } else {
      mode = 'audio';
      objUrl = URL.createObjectURL(opts.blob);
      audioEl = new Audio();
      audioEl.src = objUrl;
      audioEl.onended = () => finish();
      try { await audioEl.play(); } catch (e) { /* 自動再生制限。ユーザー操作起点で呼ぶこと */ }
      raf = requestAnimationFrame(loop);
    }
  }

  function audioDuration(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const a = new Audio();
      a.preload = 'metadata';
      a.onloadedmetadata = () => { const d = a.duration; URL.revokeObjectURL(url); resolve(isFinite(d) ? d : 0); };
      a.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
      a.src = url;
    });
  }

  function isRunning() { return running; }

  // カウントイン：3・2・1 を onTick で通知しつつクリック音を鳴らし、完了で onDone
  function clickTick() { if (global.AudioEngine && AudioEngine.playTimed) { try { AudioEngine.playTimed([{ freqs: [1000], at: 0, dur: 0.05 }]); } catch (e) {} } }
  function countIn(opts) {
    opts = opts || {};
    const n = opts.count || 3, iv = opts.intervalMs || 600;
    let i = n, timer = null, cancelled = false;
    function step() {
      if (cancelled) return;
      if (i <= 0) { if (opts.onDone) opts.onDone(); return; }
      if (opts.onTick) opts.onTick(i);
      clickTick();
      i--;
      timer = setTimeout(step, iv);
    }
    step();
    return { cancel() { cancelled = true; if (timer) clearTimeout(timer); } };
  }

  global.Karaoke = { play, stop, currentTime, isRunning, audioDuration, countIn };
})(window);

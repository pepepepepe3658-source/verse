/* ============================================================
 * audio.js — Web Audio による合成音（電子音）再生エンジン（依存ゼロ・無料・通信なし）
 *   - AudioEngine.play(chordList, opts) : 進行を再生（block/strum/arpeggio・ループ・ハイライト）
 *   - AudioEngine.stop()
 *   - AudioEngine.renderOffline(chordList, opts) : テスト用にOfflineでレンダリング
 *   chordList: [{ freqs:number[], beats:number, ref:any }]  freqs空=休符
 *   opts: { tempo, style:'block'|'strum'|'arpeggio', loop, onStep(index|-1), onEnd }
 *   ※ AudioContextは初回のユーザー操作時に生成/resume（iOSの自動再生制限対策）。
 * ============================================================ */
(function (global) {
  'use strict';

  let ctx = null;
  let active = null; // { oscillators:[], timeouts:[], stopped:false }

  function ensureCtx() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function isSupported() {
    return !!(global.AudioContext || global.webkitAudioContext);
  }

  // 1音を指定コンテキスト/時刻に鳴らす（エンベロープでクリック音防止）
  function scheduleNote(context, master, freq, when, dur) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const peak = 0.22, end = when + dur;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.012);
    gain.gain.setValueAtTime(peak, Math.max(when + 0.012, end - 0.08));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(master);
    osc.start(when);
    osc.stop(end + 0.02);
    return osc;
  }

  // chordList を context に流し込む（online/offline共用）。返り値: 総秒数と各stepの開始秒。
  //   tempo/style はアイテム単位（item.tempo/item.style）を優先し、無ければ opts を使用。
  function scheduleInto(context, master, chordList, opts, startAt) {
    const defTempo = opts.tempo || 90;
    const defStyle = opts.style || 'block';
    let t = startAt;
    const steps = [];
    const oscs = [];
    for (let i = 0; i < chordList.length; i++) {
      const item = chordList[i];
      const tempo = Math.max(20, Math.min(300, item.tempo || defTempo));
      const beatDur = 60 / tempo;
      const style = item.style || defStyle;
      const dur = Math.max(0.05, (item.beats || 1) * beatDur);
      steps.push(t);
      const freqs = item.freqs || [];
      if (freqs.length) {
        if (style === 'arpeggio') {
          const step = dur / freqs.length;
          freqs.forEach((f, k) => oscs.push(scheduleNote(context, master, f, t + k * step, Math.max(step * 1.1, 0.12))));
        } else if (style === 'strum') {
          const spread = Math.min(0.035, dur / (freqs.length + 1));
          freqs.forEach((f, k) => oscs.push(scheduleNote(context, master, f, t + k * spread, dur - k * spread)));
        } else { // block
          freqs.forEach(f => oscs.push(scheduleNote(context, master, f, t, dur)));
        }
      }
      t += dur;
    }
    return { total: t - startAt, steps, oscs };
  }

  function stop() {
    if (active) {
      active.stopped = true;
      active.timeouts.forEach(id => clearTimeout(id));
      active.oscillators.forEach(o => { try { o.stop(); } catch (e) {} });
      if (typeof active.onEnd === 'function') { const cb = active.onEnd; active.onEnd = null; cb(); }
      active = null;
    }
  }

  // 実再生。onStepでハイライト、onEndで終了通知。loop対応。
  function play(chordList, opts) {
    opts = opts || {};
    const context = ensureCtx();
    if (!context) { if (opts.onError) opts.onError('no-audio'); return false; }
    stop();

    const master = context.createGain();
    master.gain.value = 0.9;
    master.connect(context.destination);

    const startAt = context.currentTime + 0.06;
    const sched = scheduleInto(context, master, chordList, opts, startAt);

    const session = { oscillators: sched.oscs, timeouts: [], stopped: false, onEnd: opts.onEnd || null };
    active = session;

    // UIハイライト（audioContext時刻に合わせてsetTimeout）
    sched.steps.forEach((absTime, i) => {
      const delayMs = Math.max(0, (absTime - context.currentTime) * 1000);
      const id = setTimeout(() => { if (!session.stopped && opts.onStep) opts.onStep(i); }, delayMs);
      session.timeouts.push(id);
    });

    const endMs = Math.max(0, (startAt + sched.total - context.currentTime) * 1000);
    const endId = setTimeout(() => {
      if (session.stopped) return;
      if (opts.loop) {
        // ループ：現在セッションを閉じずに再スケジュール
        if (opts.onStep) opts.onStep(-1);
        play(chordList, opts);
      } else {
        if (opts.onStep) opts.onStep(-1);
        const cb = session.onEnd; session.onEnd = null;
        active = null;
        if (typeof cb === 'function') cb();
      }
    }, endMs + 30);
    session.timeouts.push(endId);
    return true;
  }

  // テスト用：OfflineAudioContextでレンダリングしてAudioBufferを返す
  async function renderOffline(chordList, opts) {
    opts = opts || {};
    const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!OAC) throw new Error('OfflineAudioContext 非対応');
    const defTempo = opts.tempo || 90;
    let seconds = 0.5;
    chordList.forEach(c => { const tempo = c.tempo || defTempo; seconds += (c.beats || 1) * (60 / tempo); });
    seconds = Math.max(0.5, seconds);
    const sr = 44100;
    const octx = new OAC(1, Math.ceil(seconds * sr), sr);
    const master = octx.createGain();
    master.gain.value = 0.9;
    master.connect(octx.destination);
    const sched = scheduleInto(octx, master, chordList, opts, 0);
    const buf = await octx.startRendering();
    return { buffer: buf, steps: sched.steps, noteCount: sched.oscs.length };
  }

  global.AudioEngine = { play, stop, renderOffline, isSupported, ensureCtx };
})(window);

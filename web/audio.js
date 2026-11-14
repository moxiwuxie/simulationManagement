/* 小店模拟器 · 程序化音频模块
 * 全部声音由 Web Audio API 实时合成，不依赖外部音频文件，也不发网络请求。
 * - BGM：C 大调四小节循环，木琴旋律 + 低音 + 轻垫底
 * - 环境音：风声、鸟鸣
 * - 音效：收银、议价、拒绝、开门、结算、操作轻响
 * 浏览器要求先有用户手势才能出声，因此首次点击或按键时才真正启动。
 * 开关状态写入 localStorage，刷新后保持。
 */
window.StallAudio = (() => {
  const STORAGE_KEY = "stall.muted";
  const BPM = 72;
  const BEAT = 60 / BPM;
  const BAR = BEAT * 4;

  const PROGRESSION = [
    { root: 130.81, pad: [261.63, 329.63, 392.0, 493.88] }, // Cmaj7
    { root: 110.0, pad: [261.63, 329.63, 440.0] },          // Am7
    { root: 87.31, pad: [261.63, 349.23, 440.0, 523.25] },  // Fmaj7
    { root: 98.0, pad: [293.66, 392.0, 493.88] },           // G6
  ];

  const MELODY = [
    [523.25, null, 659.25, 783.99],
    [440.0, 523.25, null, 659.25],
    [523.25, 659.25, 783.99, null],
    [587.33, 493.88, 392.0, 587.33],
  ];

  let ctx = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;
  let ambBus = null;
  let noiseBuffer = null;

  let muted = readMuted();
  let unlocked = false;
  let ambienceWanted = false;
  let windSource = null;
  let windGain = null;
  let birdTimer = null;

  const music = { timer: null, nextTime: 0, bar: 0 };

  function readMuted() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch (err) {
      return false;
    }
  }

  function storeMuted(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch (err) {
      /* 隐私模式下忽略 */
    }
  }

  function ensureContext() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);

    musicBus = ctx.createGain();
    musicBus.gain.value = 0.5;
    musicBus.connect(master);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);

    ambBus = ctx.createGain();
    ambBus.gain.value = 0.7;
    ambBus.connect(master);
    return true;
  }

  function ready() {
    return !!ctx && unlocked && !muted && ctx.state === "running";
  }

  function envelope(at, peak, attack, release) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
    return gain;
  }

  function tone({ freq, at, dur = 0.4, gain = 0.08, type = "sine", bus = null, attack = 0.01, glide = 0 }) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const env = envelope(at, gain, attack, dur);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide, at + dur);
    osc.connect(env);
    env.connect(bus || musicBus);
    osc.start(at);
    osc.stop(at + attack + dur + 0.05);
  }

  function pluck(freq, at, gain = 0.07) {
    if (!ctx) return;
    const body = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const harmonic = ctx.createGain();
    const env = envelope(at, gain, 0.008, 0.55);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 3400;

    body.type = "sine";
    body.frequency.value = freq;
    overtone.type = "triangle";
    overtone.frequency.value = freq * 2.002;
    harmonic.gain.value = 0.16;

    body.connect(env);
    overtone.connect(harmonic);
    harmonic.connect(env);
    env.connect(lowpass);
    lowpass.connect(musicBus);

    body.start(at);
    overtone.start(at);
    body.stop(at + 0.7);
    overtone.stop(at + 0.7);
  }

  function pad(freq, at, dur, gain) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.6);
    env.gain.linearRampToValueAtTime(0.0001, at + dur);
    osc.connect(env);
    env.connect(musicBus);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  function getNoise() {
    if (noiseBuffer) return noiseBuffer;
    const length = Math.floor(ctx.sampleRate * 2);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return noiseBuffer;
  }

  function noiseBurst({ at, dur = 0.08, gain = 0.05, type = "bandpass", freq = 1200, q = 0.8, bus = null }) {
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;

    const env = envelope(at, gain, 0.004, dur);
    src.connect(filter);
    filter.connect(env);
    env.connect(bus || sfxBus);
    src.start(at);
    src.stop(at + dur + 0.05);
  }

  /* ---------------- BGM ---------------- */
  function scheduleBar(bar, when) {
    const chord = PROGRESSION[bar % PROGRESSION.length];
    const melody = MELODY[bar % MELODY.length];

    tone({ freq: chord.root, at: when, dur: BEAT * 1.6, gain: 0.1, type: "sine" });
    tone({ freq: chord.root * 1.5, at: when + BEAT * 2, dur: BEAT * 1.2, gain: 0.06, type: "sine" });
    chord.pad.forEach((freq, index) => pad(freq / 2, when + index * 0.02, BAR, 0.014));

    melody.forEach((freq, beat) => {
      if (!freq) return;
      pluck(freq, when + beat * BEAT);
    });

    [1, 3].forEach((beat) => {
      noiseBurst({
        at: when + beat * BEAT + BEAT / 2,
        dur: 0.05,
        gain: 0.012,
        type: "highpass",
        freq: 5200,
        bus: musicBus,
      });
    });
  }

  function startMusic() {
    if (!ctx || music.timer) return;
    music.nextTime = ctx.currentTime + 0.12;
    const pump = () => {
      if (!ctx || ctx.state !== "running") return;
      if (music.nextTime < ctx.currentTime - 0.4) music.nextTime = ctx.currentTime + 0.1;
      while (music.nextTime < ctx.currentTime + 0.7) {
        scheduleBar(music.bar, music.nextTime);
        music.bar += 1;
        music.nextTime += BAR;
      }
    };
    pump();
    music.timer = setInterval(pump, 200);
  }

  function stopMusic() {
    if (music.timer) clearInterval(music.timer);
    music.timer = null;
  }

  /* ---------------- 环境音 ---------------- */
  function startAmbience() {
    if (!ctx || !unlocked || muted || windSource) return;
    windSource = ctx.createBufferSource();
    windSource.buffer = getNoise();
    windSource.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 420;
    filter.Q.value = 0.6;

    windGain = ctx.createGain();
    windGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    windGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 1.2);

    windSource.connect(filter);
    filter.connect(windGain);
    windGain.connect(ambBus);
    windSource.start();
    scheduleBird();
  }

  function stopAmbience() {
    if (birdTimer) {
      clearTimeout(birdTimer);
      birdTimer = null;
    }
    if (!windSource) return;
    const source = windSource;
    const gain = windGain;
    windSource = null;
    windGain = null;
    if (gain) gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25);
    setTimeout(() => {
      try {
        source.stop();
      } catch (err) {
        /* 已停止 */
      }
    }, 900);
  }

  function scheduleBird() {
    clearTimeout(birdTimer);
    birdTimer = setTimeout(() => {
      if (ready() && ambienceWanted) chirp();
      if (ambienceWanted) scheduleBird();
    }, 3200 + Math.random() * 5200);
  }

  function chirp() {
    const base = 1700 + Math.random() * 900;
    const at = ctx.currentTime + 0.05;
    const notes = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < notes; i += 1) {
      tone({
        freq: base * (0.94 + Math.random() * 0.12),
        at: at + i * 0.09,
        dur: 0.07,
        gain: 0.03,
        type: "sine",
        bus: ambBus,
        attack: 0.005,
        glide: base * 1.18,
      });
    }
  }

  /* ---------------- 音效 ---------------- */
  function cash() {
    if (!ready()) return;
    const t = ctx.currentTime + 0.01;
    noiseBurst({ at: t, dur: 0.07, gain: 0.05, type: "lowpass", freq: 620 });
    tone({ freq: 1568, at: t + 0.05, dur: 0.42, gain: 0.11, type: "sine", bus: sfxBus });
    tone({ freq: 2093, at: t + 0.07, dur: 0.36, gain: 0.06, type: "sine", bus: sfxBus });
    [0, 0.09, 0.17].forEach((offset, index) => {
      tone({
        freq: 2400 + index * 340,
        at: t + 0.16 + offset,
        dur: 0.1,
        gain: 0.035,
        type: "triangle",
        bus: sfxBus,
      });
    });
  }

  function bargain() {
    if (!ready()) return;
    const t = ctx.currentTime + 0.01;
    tone({ freq: 587.33, at: t, dur: 0.16, gain: 0.045, type: "triangle", bus: sfxBus });
    tone({ freq: 783.99, at: t + 0.14, dur: 0.22, gain: 0.045, type: "triangle", bus: sfxBus });
  }

  function decline() {
    if (!ready()) return;
    const t = ctx.currentTime + 0.01;
    tone({ freq: 392.0, at: t, dur: 0.16, gain: 0.04, type: "sine", bus: sfxBus });
    tone({ freq: 293.66, at: t + 0.13, dur: 0.22, gain: 0.04, type: "sine", bus: sfxBus });
  }

  function tap() {
    if (!ready()) return;
    noiseBurst({
      at: ctx.currentTime + 0.005,
      dur: 0.045,
      gain: 0.045,
      type: "bandpass",
      freq: 1400,
      q: 1.2,
    });
  }

  function openShop() {
    if (!ready()) return;
    const t = ctx.currentTime + 0.01;
    noiseBurst({ at: t, dur: 0.5, gain: 0.05, type: "bandpass", freq: 900, q: 0.5 });
    [392.0, 523.25, 659.25].forEach((freq, index) => {
      tone({ freq, at: t + 0.08 + index * 0.11, dur: 0.5, gain: 0.07, type: "triangle", bus: sfxBus });
    });
  }

  function settle() {
    if (!ready()) return;
    const t = ctx.currentTime + 0.02;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
      tone({ freq, at: t + index * 0.1, dur: 0.65, gain: 0.06, type: "sine", bus: sfxBus });
      tone({ freq: freq * 2, at: t + index * 0.1, dur: 0.35, gain: 0.02, type: "sine", bus: sfxBus });
    });
  }

  /* ---------------- 生命周期 ---------------- */
  function setAmbience(on) {
    ambienceWanted = !!on;
    if (ambienceWanted) startAmbience();
    else stopAmbience();
  }

  function apply() {
    if (!ensureContext()) return;
    const active = unlocked && !muted;
    master.gain.setTargetAtTime(active ? 1 : 0, ctx.currentTime, 0.08);
    if (active) {
      if (ctx.state === "suspended") ctx.resume();
      startMusic();
      if (ambienceWanted) startAmbience();
    } else {
      stopMusic();
      stopAmbience();
    }
    syncButton();
  }

  function unlock() {
    if (!ensureContext()) return;
    unlocked = true;
    apply();
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("touchstart", unlock);
    document.removeEventListener("keydown", unlock);
  }

  function setEnabled(on) {
    muted = !on;
    storeMuted(muted);
    if (!ctx) {
      if (on) unlock();
      else syncButton();
      return;
    }
    if (on && ctx.state === "suspended") ctx.resume();
    apply();
  }

  function syncButton() {
    const btn = document.getElementById("soundToggle");
    if (!btn) return;
    const on = !muted;
    btn.textContent = on ? "声音 · 开" : "声音 · 关";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", on ? "关闭声音" : "开启声音");
  }

  function init() {
    syncButton();
    const btn = document.getElementById("soundToggle");
    if (btn) {
      btn.addEventListener("click", () => setEnabled(muted));
    }
    document.addEventListener("pointerdown", unlock, { passive: true });
    document.addEventListener("touchstart", unlock, { passive: true });
    document.addEventListener("keydown", unlock);

    document.addEventListener("visibilitychange", () => {
      if (!ctx) return;
      if (document.hidden) {
        ctx.suspend();
      } else if (unlocked && !muted) {
        ctx.resume();
        music.nextTime = ctx.currentTime + 0.12;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return {
    unlock,
    setEnabled,
    setAmbience,
    cash,
    bargain,
    decline,
    tap,
    openShop,
    settle,
    isEnabled: () => !muted,
  };
})();

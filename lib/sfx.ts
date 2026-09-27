"use client";
// Procedural sound effects (Web Audio) + per-agent speech synthesis. No assets.

let ctx: AudioContext | null = null;
function ac() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = "square", gain = 0.04, slideTo?: number, delay = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, gain = 0.05, filterFreq = 800) {
  const a = ac();
  if (!a) return;
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(filterFreq, a.currentTime);
  f.frequency.exponentialRampToValueAtTime(80, a.currentTime + dur);
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  enabled: true,
  blip() { if (this.enabled) tone(880, 0.06, "square", 0.025); },
  type() { if (this.enabled) tone(1400 + Math.random() * 400, 0.02, "square", 0.012); },
  send() { if (this.enabled) { tone(520, 0.05, "triangle", 0.04); tone(780, 0.07, "triangle", 0.04, undefined, 0.05); } },
  whisper() { if (this.enabled) tone(300, 0.35, "sine", 0.04, 180); },
  evidence() { if (this.enabled) [660, 880, 660, 990].forEach((f, i) => tone(f, 0.07, "square", 0.03, undefined, i * 0.08)); },
  alarm() { if (this.enabled) [0, 0.45, 0.9].forEach((d) => tone(440, 0.4, "sawtooth", 0.035, 880, d)); },
  vote() { if (this.enabled) tone(200, 0.12, "square", 0.05, 120); },
  boot() { if (this.enabled) tone(60, 1.2, "sawtooth", 0.05, 240); },
  glitch() { if (this.enabled) { noise(0.25, 0.06, 3000); tone(90, 0.2, "square", 0.04, 40); } },
  eject() { if (this.enabled) { noise(2.4, 0.12, 2400); tone(120, 2.2, "sawtooth", 0.05, 30); } },
  win() { if (this.enabled) [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, "triangle", 0.05, undefined, i * 0.15)); },
  lose() { if (this.enabled) [392, 330, 262, 196].forEach((f, i) => tone(f, 0.4, "sawtooth", 0.04, undefined, i * 0.2)); },
};

// ─── Voices ──────────────────────────────────────────────────

export const voice = {
  enabled: false,
  speak(text: string, opts: { pitch: number; rate: number; index: number }): Promise<void> {
    if (!this.enabled || typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      const u = new SpeechSynthesisUtterance(text.replace(/[*_#>]/g, ""));
      const en = synth.getVoices().filter((v) => v.lang.startsWith("en"));
      if (en.length) u.voice = en[opts.index % en.length];
      u.pitch = opts.pitch;
      u.rate = opts.rate;
      u.volume = 0.9;
      const done = () => resolve();
      u.onend = done;
      u.onerror = done;
      setTimeout(done, 14000); // never block the game on a stuck utterance
      synth.speak(u);
    });
  },
  stop() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  },
};

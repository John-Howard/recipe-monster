let ctx;
const KEY = 'rm-sounds';

export function soundsOn() {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

export function setSoundsOn(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {}
}

function audio() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(c, { type = 'sine', f0, f1 = f0, at = 0, dur = 0.1, vol = 0.2, vibrato = 0, lowpass = 0 }) {
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (lowpass) {
    const f = c.createBiquadFilter();
    f.frequency.value = lowpass;
    o.connect(f);
    node = f;
  }
  node.connect(g).connect(c.destination);
  if (vibrato) {
    const l = c.createOscillator();
    const lg = c.createGain();
    l.frequency.value = 9;
    lg.gain.value = vibrato;
    l.connect(lg).connect(o.frequency);
    l.start(t);
    l.stop(t + dur);
  }
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(c, { at = 0, dur = 0.06, vol = 0.12, freq = 900 }) {
  const t = c.currentTime + at;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  src.buffer = buf;
  f.type = 'bandpass';
  f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

const chompBlip = (c, at, f) => {
  tone(c, { type: 'square', f0: f, f1: f * 0.5, at, dur: 0.14, vol: 0.18, lowpass: 700 });
  noise(c, { at, dur: 0.07, vol: 0.1 });
};

const SOUNDS = {
  unlock() {},
  spin(c, ms = 1200) {
    for (let i = 0; i * 0.07 < ms / 1000; i++) {
      tone(c, { type: 'square', f0: 500 + i * 12, f1: 350 + i * 12, at: i * 0.07, dur: 0.03, vol: 0.06 });
    }
  },
  land(c) {
    const f = 600 * (1 + Math.random() * 0.3);
    tone(c, { type: 'triangle', f0: f, f1: f * 1.5, dur: 0.09, vol: 0.18 });
  },
  reroll(c) {
    tone(c, { type: 'square', f0: 300, f1: 600, dur: 0.12, vol: 0.1 });
  },
  chomp(c) {
    [0, 0.2, 0.4].forEach((at, i) => chompBlip(c, at, 220 - i * 20));
    tone(c, { type: 'sine', f0: 200, f1: 240, at: 0.65, dur: 0.6, vol: 0.2, vibrato: 8 });
  },
  burp(c) {
    tone(c, { type: 'sawtooth', f0: 130, f1: 70, dur: 0.5, vol: 0.25, vibrato: 14, lowpass: 400 });
    tone(c, { type: 'triangle', f0: 800, f1: 1400, at: 0.55, dur: 0.12, vol: 0.15 });
  },
  chirp(c) {
    tone(c, { type: 'triangle', f0: 700, f1: 1200, dur: 0.1, vol: 0.15 });
  },
};

export function play(name, ...args) {
  if (!soundsOn()) return;
  try { SOUNDS[name]?.(audio(), ...args); } catch {}
}

export function initSoundToggle(btn) {
  const draw = () => {
    const on = soundsOn();
    btn.textContent = on ? '🔊' : '🔇';
    btn.setAttribute('aria-pressed', String(on));
  };
  btn.title = 'Monster sounds on/off';
  btn.setAttribute('aria-label', 'Monster sounds on/off');
  draw();
  btn.onclick = () => {
    setSoundsOn(!soundsOn());
    draw();
    play('chirp');
  };
}

// PULSE — procedural WebAudio beat engine. Zero audio assets: every sound is
// synthesized from oscillators + a shared noise buffer. The whole point is
// no licensing trap (the anti-Supernatural story starts here).

export class AudioEngine {
  constructor() {
    this.ready = false;
  }

  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    // Gentle glue compressor so kick + bass + impact don't clip on Quest speakers.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    // 1s of white noise, reused by hats and impacts.
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ready = true;
  }

  now() { return this.ctx.currentTime; }

  // Four-on-the-floor kick: sine pitch-drop 160 -> 42 Hz.
  kick(t) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    g.gain.setValueAtTime(0.95, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.3);
  }

  // Offbeat hi-hat: highpassed noise tick.
  hat(t, open = false) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; s.loop = true;
    f.type = 'highpass'; f.frequency.value = 7500;
    const dur = open ? 0.16 : 0.05;
    g.gain.setValueAtTime(open ? 0.20 : 0.26, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  // Simple synth bass pluck: saw -> lowpass sweep. freq in Hz.
  bass(t, freq) {
    const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(340, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 0.25);
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.35);
  }

  // Punch landing: noise crack + low thump. This is the money sound —
  // it has to feel like the hit CONNECTED.
  impact(t) {
    const c = this.ctx;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; s.loop = true;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1900, t);
    f.frequency.exponentialRampToValueAtTime(280, t + 0.10);
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + 0.2);
    const o = c.createOscillator(), g2 = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
    g2.gain.setValueAtTime(0.8, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g2); g2.connect(this.master);
    o.start(t); o.stop(t + 0.2);
  }

  // UI blip (count-in, select confirm).
  blip(t, freq = 880, dur = 0.09, vol = 0.22) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // One groove beat: kick on the beat, hat on the offbeat, bass walks
  // a 4-beat A-minor-ish pattern. beatIdx counts from round start.
  grooveBeat(t, beatIdx, beatDur) {
    this.kick(t);
    this.hat(t + beatDur / 2);
    const seq = [55, 55, 65.41, 49]; // A1 A1 C2 G1
    this.bass(t, seq[beatIdx % 4]);
  }
}

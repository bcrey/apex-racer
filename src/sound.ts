// Synthesised race audio: engine, tyre squeal, grass rumble, countdown beeps
// and lap chimes, all made with Web Audio so there are no files to load.
// Browsers only let audio start from a user gesture, so nothing plays until
// unlock() is called from one (the Start Engines button).

const MUTED_STORAGE_KEY = 'apex-racer:muted';
const MASTER_VOLUME = 0.35;
/** How quickly the engine and effects follow the car, in seconds. */
const RESPONSE = 0.06;

export type EngineState = {
  /** 0 at rest, 1 at top speed. */
  speedRatio: number;
  throttle: boolean;
  /** 0 to 1: how hard the tyres are sliding on tarmac. */
  skid: number;
  /** 0 to 1: how hard the car is churning through grass. */
  rumble: number;
  /** False before the race and after a crash: engine off. */
  running: boolean;
};

function loadMuted() {
  try {
    return window.localStorage.getItem(MUTED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

type Nodes = {
  master: GainNode;
  engineLow: OscillatorNode;
  engineHigh: OscillatorNode;
  engineFilter: BiquadFilterNode;
  engineGain: GainNode;
  squealTone: OscillatorNode;
  squealFilter: BiquadFilterNode;
  squealGain: GainNode;
  rumbleGain: GainNode;
};

export class RaceSound {
  muted = loadMuted();
  /** False silences everything without touching the saved mute choice (V1 has no sound). */
  private enabled = true;
  private ctx: AudioContext | null = null;
  private nodes: Nodes | null = null;
  private noise: AudioBuffer | null = null;

  /** Call from a click or key press. Safe to call more than once. */
  unlock() {
    if (!this.ctx) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      try {
        this.ctx = new Context();
        this.build(this.ctx);
      } catch (error) {
        console.warn('Audio unavailable', error);
        this.ctx = null;
        return;
      }
    }
    void this.ctx.resume().catch(() => {});
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    try {
      window.localStorage.setItem(MUTED_STORAGE_KEY, muted ? '1' : '0');
    } catch {
      // Blocked storage: the choice just won't persist
    }
    this.applyVolume();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.applyVolume();
  }

  private get volume() {
    return this.enabled && !this.muted ? MASTER_VOLUME : 0;
  }

  private applyVolume() {
    if (this.ctx && this.nodes) {
      this.nodes.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
    }
  }

  /** Pause the audio clock while the page is hidden. */
  setPageVisible(visible: boolean) {
    if (!this.ctx) return;
    void (visible ? this.ctx.resume() : this.ctx.suspend()).catch(() => {});
  }

  /** Called every frame with the car's state. */
  update(state: EngineState) {
    const { ctx, nodes } = this;
    if (!ctx || !nodes || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const speed = Math.min(1, Math.max(0, state.speedRatio));
    const throttle = state.throttle ? 1 : 0;

    // Two detuned oscillators an octave apart read as an engine; pitch follows
    // speed, and the throttle opens the filter for a harder note
    const pitch = 46 + speed * 104 + throttle * 6;
    nodes.engineLow.frequency.setTargetAtTime(pitch, now, RESPONSE);
    nodes.engineHigh.frequency.setTargetAtTime(pitch * 2.01, now, RESPONSE);
    nodes.engineFilter.frequency.setTargetAtTime(280 + speed * 1300 + throttle * 450, now, RESPONSE);
    nodes.engineGain.gain.setTargetAtTime(state.running ? 0.12 + speed * 0.08 + throttle * 0.06 : 0, now, 0.12);

    const skid = state.running ? Math.min(1, Math.max(0, state.skid)) : 0;
    nodes.squealGain.gain.setTargetAtTime(skid * 0.1, now, 0.05);
    nodes.squealTone.frequency.setTargetAtTime(900 + speed * 350, now, 0.1);

    const rumble = state.running ? Math.min(1, Math.max(0, state.rumble)) : 0;
    nodes.rumbleGain.gain.setTargetAtTime(rumble * 0.55, now, 0.08);
  }

  /** Countdown lights: a low beep for 3, 2, 1 and a high one for GO. */
  countdownBeep(go: boolean) {
    this.tone(go ? 880 : 440, go ? 0.45 : 0.18, 'square', 0.16);
  }

  /** A rising arpeggio when a lap ends; brighter for a personal best. */
  lapChime(personalBest: boolean) {
    const notes = personalBest ? [659, 784, 988, 1319] : [523, 659];
    notes.forEach((freq, i) => this.tone(freq, 0.22, 'triangle', 0.18, i * 0.09));
  }

  /** A low thud for a lap that did not count. */
  invalidLap() {
    this.tone(196, 0.3, 'sawtooth', 0.12);
  }

  /** A quick rising whoosh as the car leaves a ramp. */
  jump() {
    const { ctx, nodes } = this;
    if (!ctx || !nodes) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.25);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain).connect(nodes.master);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  /** A thump on touchdown; `strength` 0..1 from how hard the car came down. */
  land(strength: number) {
    const { ctx, nodes, noise } = this;
    if (!ctx || !nodes || !noise) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(60, now + 0.25);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25 + 0.5 * Math.min(1, Math.max(0, strength)), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    source.connect(filter).connect(gain).connect(nodes.master);
    source.start(now);
    source.stop(now + 0.35);
  }

  crash() {
    const { ctx, nodes, noise } = this;
    if (!ctx || !nodes || !noise) return;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 1.2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.9, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.3);
    source.connect(filter).connect(gain).connect(nodes.master);
    source.start();
    source.stop(ctx.currentTime + 1.4);
  }

  private tone(freq: number, duration: number, type: OscillatorType, volume: number, delay = 0) {
    const { ctx, nodes } = this;
    if (!ctx || !nodes) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(nodes.master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  private build(ctx: AudioContext) {
    const master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(ctx.destination);

    // Two seconds of white noise, looped, feeds the squeal and the rumble
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;
    const loopNoise = () => {
      const source = ctx.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      source.start();
      return source;
    };

    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.Q.value = 4;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineFilter.connect(engineGain).connect(master);
    const engineLow = ctx.createOscillator();
    engineLow.type = 'sawtooth';
    const engineHigh = ctx.createOscillator();
    engineHigh.type = 'square';
    const highMix = ctx.createGain();
    highMix.gain.value = 0.35;
    engineLow.connect(engineFilter);
    engineHigh.connect(highMix).connect(engineFilter);
    engineLow.start();
    engineHigh.start();

    // Squeal: a wobbling tone plus a band of noise
    const squealGain = ctx.createGain();
    squealGain.gain.value = 0;
    squealGain.connect(master);
    const squealFilter = ctx.createBiquadFilter();
    squealFilter.type = 'bandpass';
    squealFilter.frequency.value = 2400;
    squealFilter.Q.value = 3;
    loopNoise().connect(squealFilter).connect(squealGain);
    const squealTone = ctx.createOscillator();
    squealTone.type = 'triangle';
    squealTone.frequency.value = 1000;
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 9;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 45;
    wobble.connect(wobbleDepth).connect(squealTone.frequency);
    const toneMix = ctx.createGain();
    toneMix.gain.value = 0.5;
    squealTone.connect(toneMix).connect(squealGain);
    squealTone.start();
    wobble.start();

    // Grass: low filtered noise
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleGain.connect(master);
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 220;
    loopNoise().connect(rumbleFilter).connect(rumbleGain);

    this.nodes = { master, engineLow, engineHigh, engineFilter, engineGain, squealTone, squealFilter, squealGain, rumbleGain };
  }
}

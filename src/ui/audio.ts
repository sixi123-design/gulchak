import type { DigSession } from '../sim/session';

/**
 * Web Audio로 합성하는 장비 소리 (오디오 파일 없음, 저가 폰에서도 가벼움)
 *  - 엔진: rpm에 따라 높낮이·크기, 부하가 걸리면 낮게 깔림
 *  - 유압: 움직이는 만큼 '쉬익' 흐르는 소리
 *  - 릴리프 밸브: 실린더 끝(끝까지 오므림 등)에서 레버를 계속 밀 때 '끼이익' 고음
 *  - 흙: 버킷에서 쏟아지는 '쏴아' + 땅에 떨어지는 '우르르·투둑'
 *  - 덜컹, 호각
 */
export interface SoundLevels {
  ambOn: boolean;
  amb: number;
  sfxOn: boolean;
  sfx: number;
}

export class MachineSound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engA!: OscillatorNode;
  private engB!: OscillatorNode;
  private engGain!: GainNode;
  private engFilter!: BiquadFilterNode;
  private hydGain!: GainNode;
  private hydFilter!: BiquadFilterNode;
  private relGain!: GainNode;
  private relTone!: OscillatorNode;
  private relFilter!: BiquadFilterNode;
  private pourGain!: GainNode;
  private landGain!: GainNode;
  private landFilter!: BiquadFilterNode;
  private lastTick = 0;
  /** 환경음(엔진·유압·릴리프·흙) / 효과음(덜컹·호각·투둑) 버스 */
  private amb!: GainNode;
  private sfx!: GainNode;
  muted = false;
  levels: SoundLevels = { ambOn: true, amb: 0.8, sfxOn: true, sfx: 0.8 };

  /** 사용자 조작(터치·클릭) 안에서 호출해야 소리가 켜진다 */
  start() {
    if (this.ctx) {
      this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    this.amb = ctx.createGain();
    this.sfx = ctx.createGain();
    this.amb.connect(this.master);
    this.sfx.connect(this.master);
    this.applyLevels();

    // 엔진: 낮은 톱니파 2개(살짝 어긋나게) → 저역 통과
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 380;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engA = ctx.createOscillator();
    this.engA.type = 'sawtooth';
    this.engB = ctx.createOscillator();
    this.engB.type = 'square';
    this.engA.connect(this.engFilter);
    this.engB.connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.amb);
    this.engA.start();
    this.engB.start();

    // 백색 잡음 버퍼 (유압·릴리프 공용)
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const mkNoise = () => {
      const n = ctx.createBufferSource();
      n.buffer = noise;
      n.loop = true;
      n.start();
      return n;
    };
    // 유압 흐름: 중역 잡음
    this.hydFilter = ctx.createBiquadFilter();
    this.hydFilter.type = 'bandpass';
    this.hydFilter.frequency.value = 700;
    this.hydFilter.Q.value = 0.8;
    this.hydGain = ctx.createGain();
    this.hydGain.gain.value = 0;
    mkNoise().connect(this.hydFilter).connect(this.hydGain).connect(this.amb);
    // 릴리프 밸브: 좁은 대역 고음 잡음 + 떨리는 고음
    this.relFilter = ctx.createBiquadFilter();
    this.relFilter.type = 'bandpass';
    this.relFilter.frequency.value = 2600;
    this.relFilter.Q.value = 9;
    this.relGain = ctx.createGain();
    this.relGain.gain.value = 0;
    mkNoise().connect(this.relFilter).connect(this.relGain);
    this.relTone = ctx.createOscillator();
    this.relTone.type = 'triangle';
    this.relTone.frequency.value = 1450;
    const relToneGain = ctx.createGain();
    relToneGain.gain.value = 0.35;
    this.relTone.connect(relToneGain).connect(this.relGain);
    this.relTone.start();
    this.relGain.connect(this.amb);
    // 흙 쏟아짐: 모래가 미끄러지는 중고역 잡음
    const pourF = ctx.createBiquadFilter();
    pourF.type = 'bandpass';
    pourF.frequency.value = 1100;
    pourF.Q.value = 0.6;
    this.pourGain = ctx.createGain();
    this.pourGain.gain.value = 0;
    mkNoise().connect(pourF).connect(this.pourGain).connect(this.amb);
    // 흙 떨어짐: 낮게 깔리는 '우르르'
    this.landFilter = ctx.createBiquadFilter();
    this.landFilter.type = 'lowpass';
    this.landFilter.frequency.value = 320;
    this.landFilter.Q.value = 1.2;
    this.landGain = ctx.createGain();
    this.landGain.gain.value = 0;
    mkNoise().connect(this.landFilter).connect(this.landGain).connect(this.amb);
  }

  setLevels(l: Partial<SoundLevels>) {
    Object.assign(this.levels, l);
    this.applyLevels();
  }
  private applyLevels() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const l = this.levels;
    // 같은 순간에 여러 번 바꿔도 마지막 값이 적용되게 예약을 지우고 다시 건다
    for (const [g, v] of [
      [this.amb, l.ambOn ? l.amb * 1.25 : 0],
      [this.sfx, l.sfxOn ? l.sfx * 1.25 : 0],
    ] as const) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.setTargetAtTime(v, t, 0.05);
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** 매 프레임: 세션 상태를 소리에 반영 */
  update(s: DigSession) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const on = s.engineOn && s.phase !== 'precheck';
    const rpm = Math.max(0, Math.min(1, s.rpm));
    const load = Math.min(2, s.engineLoad + s.reliefLevel * 0.6);
    // 엔진: 공회전 약 25Hz → 최대 약 45Hz, 부하가 걸리면 몇 Hz 처짐
    const f = 25 + 20 * rpm - 4 * Math.min(load, 1.5);
    this.engA.frequency.setTargetAtTime(f, t, 0.08);
    this.engB.frequency.setTargetAtTime(f * 2.02, t, 0.08);
    this.engFilter.frequency.setTargetAtTime(260 + 260 * rpm + 120 * Math.min(load, 1.5), t, 0.1);
    this.engGain.gain.setTargetAtTime(on ? 0.1 + 0.07 * rpm + 0.05 * Math.min(load, 1.5) : 0, t, 0.12);
    // 유압 흐름
    const flow = Math.min(1.5, s.motionLevel);
    this.hydGain.gain.setTargetAtTime(on ? 0.05 * flow * (0.5 + rpm) : 0, t, 0.06);
    this.hydFilter.frequency.setTargetAtTime(500 + 500 * rpm, t, 0.1);
    // 릴리프 밸브
    const r = on ? s.reliefLevel : 0;
    this.relGain.gain.setTargetAtTime(0.1 * r * (0.6 + 0.4 * rpm), t, 0.04);
    this.relTone.frequency.setTargetAtTime(1300 + 400 * rpm + Math.sin(t * 37) * 25, t, 0.02);
    // 흙: 덤프 한 번(약 0.8m³/s)이 1에 가깝게. 매 프레임 흔들어 '자글자글'한 결을 냄
    const pour = Math.sqrt(Math.min(1.5, s.pourRate / 0.8));
    const land = Math.sqrt(Math.min(1.5, s.landRate / 0.8));
    const grit = 0.65 + Math.random() * 0.35;
    this.pourGain.gain.setTargetAtTime(0.16 * pour * grit, t, 0.03);
    this.landGain.gain.setTargetAtTime(0.42 * land * (0.55 + Math.random() * 0.45), t, 0.025);
    this.landFilter.frequency.setTargetAtTime(240 + 160 * land, t, 0.05);
    // 조금씩 떨어질 때(흘림)는 '투둑' 소리로 들리게
    if (s.landRate > 0.004 && s.landRate < 0.12 && t - this.lastTick > 0.07 + Math.random() * 0.12) {
      this.lastTick = t;
      this.tick(Math.min(1, s.landRate / 0.06));
    }
  }

  /** 흙덩이 하나가 툭 떨어지는 짧은 소리 */
  private tick(strength: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(140 + Math.random() * 90, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06 + 0.12 * strength, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.1);
  }

  /** 덜컹: 짧고 낮은 쿵 */
  thump(strength = 1) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * Math.min(1, strength), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** 호각: 시작은 길게 한 번, 실격은 짧게 두 번 */
  whistle(kind: 'start' | 'fail') {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const blasts = kind === 'start' ? [[0, 0.7]] : [[0, 0.18], [0.26, 0.18]];
    for (const [s0, len] of blasts) {
      const t = ctx.currentTime + s0;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(2900, t);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 28;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 70;
      lfo.connect(lfoGain).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.setValueAtTime(0.18, t + len - 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(this.sfx);
      o.start(t);
      lfo.start(t);
      o.stop(t + len + 0.02);
      lfo.stop(t + len + 0.02);
    }
  }
}

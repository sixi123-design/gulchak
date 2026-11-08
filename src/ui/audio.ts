import type { DigSession } from '../sim/session';

/**
 * Web Audio로 합성하는 장비 소리 (오디오 파일 없음, 저가 폰에서도 가벼움)
 *  - 엔진: rpm에 따라 높낮이·크기, 부하가 걸리면 낮게 깔림
 *  - 유압: 움직이는 만큼 '쉬익' 흐르는 소리
 *  - 릴리프 밸브: 실린더 끝(끝까지 오므림 등)에서 레버를 계속 밀 때 '끼이익' 고음
 *  - 덜컹, 호각
 */
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
  muted = false;

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
    this.engFilter.connect(this.engGain).connect(this.master);
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
    mkNoise().connect(this.hydFilter).connect(this.hydGain).connect(this.master);
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
    this.relGain.connect(this.master);
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
    o.connect(g).connect(this.master);
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
      o.connect(g).connect(this.master);
      o.start(t);
      lfo.start(t);
      o.stop(t + len + 0.02);
      lfo.stop(t + len + 0.02);
    }
  }
}

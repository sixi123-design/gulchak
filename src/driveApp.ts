/**
 * 코스운전(주행) 화면·조작: 세션 + 코스 바닥 + 장비 + 왼쪽 사이드미러 + 카메라 + HUD.
 * main.ts가 종목이 '주행'일 때 굴착 대신 이것을 돌린다.
 */
import * as THREE from 'three';
import { MACHINE } from './config/machine';
import type { ModeFlags } from './core/ruleEngine';
import { CourseView } from './render/courseView';
import { ExcavatorView, type MachineStyleKey } from './render/excavatorView';
import { SideMirror } from './render/mirror';
import { buildSite } from './sim/site';
import { DriveSession, type Gear } from './sim/drive/driveSession';

export const TRAVEL = { boom: -0.1, arm: -2.6, bucket: -2.25 };
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const STAGE_TEXT: Record<string, string> = {
  READY: '출발 대기',
  GO: '전진',
  ARRIVE: '도착 · 정차 후 후진',
  BACK: '후진',
  FINISH: '주차',
  DONE: '끝',
};

export class DriveApp {
  readonly s: DriveSession;
  readonly exc: ExcavatorView;
  readonly course: CourseView;
  private mirror: SideMirror | null = null;
  private frameN = 0;
  private gaze = new THREE.Vector3();
  private gazeInit = false;

  constructor(
    readonly world: THREE.Group,
    readonly renderer: THREE.WebGLRenderer,
    flags: ModeFlags,
    style: MachineStyleKey,
  ) {
    // 기종별 핸들 바퀴 수·조향각 공식 수치가 없어 세 기종 같은 값 (DRIVE_PARAMS)
    const m = MACHINE;
    this.s = new DriveSession(m, flags);
    this.course = new CourseView(this.s.c, buildSite(MACHINE), flags.key === 'exam');
    this.exc = new ExcavatorView(m, style);
    this.exc.setDriveCab(true);
    // 주행 자세: 암·버킷을 오므리고 붐을 낮춰 앞이 보이게
    this.exc.setTravelPose(TRAVEL.boom, TRAVEL.arm, TRAVEL.bucket);
    world.add(this.course.group, this.exc.root);
    this.syncMachine();
    this.mirror = new SideMirror(renderer, this.exc);
    this.bindUi();
  }

  private bindUi() {
    for (const b of document.querySelectorAll<HTMLButtonElement>('#gear-box [data-gear]')) {
      b.onclick = () => this.s.setGear(b.dataset.gear as Gear);
    }
    $('btn-park').onclick = () => this.s.setParking(!this.s.parking);
    $('btn-swlock').onclick = () => this.s.setSwingLock(!this.s.swingLock);
  }

  /** 스틱 입력: 왼쪽 좌우 = 핸들, 오른쪽 위 = 가속, 아래 = 브레이크 */
  setSticks(lx: number, _ly: number, _rx: number, ry: number) {
    this.s.input = { steer: -lx, accel: Math.max(0, ry), brake: Math.max(0, -ry) };
  }
  /** 화면 핸들·페달 + 키보드 */
  setControls(steerRate: number, accel: number, brake: number, wheelDelta: number) {
    this.s.input = { steer: steerRate, accel, brake, wheelDelta };
  }

  step(dt: number) {
    this.s.step(dt);
  }

  private syncMachine() {
    const s = this.s;
    const c = s.center;
    this.exc.setDrive(c.x, c.z, s.heading, s.steer, s.roll);
    this.exc.setSteeringWheel(s.wheelAngle); // 운전석 핸들도 화면 핸들과 같은 각
    this.exc.setDash({ gear: s.gear, parking: s.parking, swingLock: s.swingLock });
  }

  /** 화면 갱신 (매 렌더 프레임) */
  sync(scene: THREE.Scene) {
    this.syncMachine();
    this.frameN++;
    this.mirror?.update(scene, this.frameN);
  }

  /** 카메라: 운전석(앞을 보며 조향 쪽으로 살짝) / 뒤 위 */
  /** 왼쪽 앞바퀴 내려다보기 (버튼으로 켜고 끔) */
  lookWheel = false;
  private lw = 0;
  /** 왼쪽 사이드미러 가까이 보기 (고개 돌려 미러에 눈을 맞춤) */
  lookMirror = false;
  private lm = 0;
  private tmpM = new THREE.Vector3();
  camera(cam: THREE.PerspectiveCamera, mode: string, eyeDy: number, dt: number, lookOverride: THREE.Vector3 | null = null) {
    const s = this.s;
    const f = s.fwd;
    this.exc.setCabView(mode === 'cab');
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    if (mode === 'cab') {
      this.exc.root.updateMatrixWorld(true);
      this.exc.eyeWorld(pos, eyeDy);
      // 진행 방향(후진이면 앞을 보되 왼쪽으로 더 돌아봄)과 조향 방향 사이
      const h = s.heading - s.steer * 0.6 - (s.gear === 'R' ? 0.35 : 0.12);
      look.set(pos.x + Math.cos(h) * 8, 0.2, pos.z + Math.sin(h) * 8);
      // 바퀴 보기: 문을 열고 몸을 내밀어 왼쪽 앞바퀴와 선을 내려다봄 (0.3초에 부드럽게 전환)
      this.lw += ((this.lookWheel ? 1 : 0) - this.lw) * (1 - Math.exp(-dt * 10));
      this.lm += ((this.lookMirror ? 1 : 0) - this.lm) * (1 - Math.exp(-dt * 10));
      if (this.lm > 0.001) {
        // 미러 보기: 미러를 화면 가운데로, 시야를 좁혀 크게
        this.exc.mirrorFace.getWorldPosition(this.tmpM);
        look.lerp(this.tmpM, this.lm);
      }
      if (this.lw > 0.001) {
        const l = s.left;
        const w = s.wheelCenters()[0];
        const k = this.lw;
        pos.x += (l.x * 0.95 + f.x * 0.3) * k;
        pos.z += (l.z * 0.95 + f.z * 0.3) * k;
        pos.y += 0.15 * k;
        look.lerp(new THREE.Vector3(w.x + l.x * 0.5, 0, w.z + l.z * 0.5), k);
      }
      // 실제 시험 시작 전: 왼쪽 창 너머 감독관을 봄
      if (lookOverride) look.lerp(lookOverride, 0.7).setY(0.4);
      if (!this.gazeInit) {
        this.gaze.copy(look);
        this.gazeInit = true;
      }
      this.gaze.lerp(look, this.lw > 0.001 || this.lm > 0.001 ? 1 : 1 - Math.exp(-dt * (lookOverride ? 3 : 4)));
      look.copy(this.gaze);
      const fov0 = cam.aspect >= 1 ? THREE.MathUtils.clamp((2 * Math.atan(Math.tan((46 * Math.PI) / 180) / cam.aspect) * 180) / Math.PI, 48, 62) : 85;
      const fov = fov0 + (20 - fov0) * this.lm;
      if (Math.abs(cam.fov - fov) > 0.1) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
      cam.position.copy(pos);
    } else {
      const c = s.center;
      pos.set(c.x - f.x * 9 + 2, 9, c.z - f.z * 9);
      look.set(c.x + f.x * 4, 0, c.z + f.z * 4);
      if (Math.abs(cam.fov - 55) > 0.1) {
        cam.fov = 55;
        cam.updateProjectionMatrix();
      }
      cam.position.lerp(pos, 1 - Math.exp(-dt * 4));
    }
    cam.lookAt(look);
  }

  /** HUD: 남은 시간, 단계, 기어·주차·고정 버튼 상태, 조향 표시 */
  hud() {
    const s = this.s;
    const tm = $('timer');
    tm.hidden = s.flags.key === 'tutorial';
    if (s.flags.timeLimit) {
      const remain = (s.stage === 'READY' ? s.p.startLimit - s.t : s.p.timeLimit - s.taskT);
      const a = Math.abs(Math.ceil(remain));
      tm.textContent = `${remain < 0 ? '+' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
      tm.className = 'timer' + (remain < 0 ? ' over' : remain < 20 ? ' warn' : '');
    } else {
      const a = Math.floor(s.stage === 'READY' ? 0 : s.taskT);
      tm.textContent = `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
      tm.className = 'timer';
    }
    const st = $('drive-stage');
    st.textContent = s.stage === 'GO' && s.stopped ? '정지 확인 · 전진' : STAGE_TEXT[s.stage];
    for (const b of document.querySelectorAll<HTMLElement>('#gear-box [data-gear]')) b.classList.toggle('on', b.dataset.gear === s.gear);
    $('btn-park').classList.toggle('on', s.parking);
    $('btn-swlock').classList.toggle('on', s.swingLock);
    const deg = Math.round((s.steer * 180) / Math.PI);
    const atEnd = Math.abs(s.steer) >= s.p.maxSteer - 1e-4;
    $('steer-deg').textContent = deg === 0 ? '0°' : `${deg > 0 ? '◀' : ''}${atEnd ? '끝' : Math.abs(deg) + '°'}${deg < 0 ? '▶' : ''}`;
    ($('steer-ind').querySelector('svg') as SVGElement).style.transform = `rotate(${-s.steer * s.p.steerRatio * (180 / Math.PI) * 0.25}deg)`;
    const gd = $('guide');
    gd.textContent = s.flags.guide ? this.guide() : '';
    gd.hidden = !gd.textContent;
  }

  guide() {
    const s = this.s;
    switch (s.stage) {
      case 'READY':
        return s.parking ? '주차브레이크 풀기 → F → 가속' : s.gear !== 'F' ? 'F 기어' : '가속해 출발';
      case 'GO':
        if (!s.stopped) return s.inStopZone() ? '브레이크로 정지' : '왼쪽 선과 70~80cm 유지 · 왼쪽 앞바퀴를 정지선 사이에';
        return '뒷바퀴가 도착선을 넘을 때까지';
      case 'ARRIVE':
        return s.speed !== 0 ? '넘자마자 브레이크로 정차' : s.gear !== 'R' ? 'R 기어' : '핸들 오른쪽 끝까지 감고 후진';
      case 'BACK':
        return '사이드미러 보며 후진 · 앞바퀴가 출발선을 넘을 때까지';
      case 'FINISH':
        return '앞바퀴를 주차구역에 · 정차 후 주차브레이크';
      default:
        return '';
    }
  }

  /** 엔진음용 (굴착 세션과 같은 필드 이름) */
  soundState() {
    const s = this.s;
    const a = s.input.accel;
    return {
      engineOn: true,
      phase: 'working',
      rpm: 0.12 + 0.55 * a,
      engineLoad: a * (s.parking ? 0.9 : 0.4),
      reliefLevel: 0,
      motionLevel: Math.abs(s.speed) / 2.5,
      pourRate: 0,
      landRate: 0,
    };
  }

  dispose() {
    this.exc.disposeCache();
    this.mirror?.dispose();
    this.mirror = null;
  }
}

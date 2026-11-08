import * as THREE from 'three';
import { MACHINE } from './config/machine';
import rulesJson from './config/rules.json';
import { PRACTICE, type Violation } from './core/ruleEngine';
import { ExcavatorView } from './render/excavatorView';
import { FxView, SiteView, SoilView } from './render/siteView';
import { DigSession, type RulesFile } from './sim/session';
import { ik } from './sim/kinematics';
import { Joystick, Keys } from './ui/joystick';

const RULES = rulesJson as unknown as RulesFile;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const debug = new URLSearchParams(location.search).has('debug');

// ---------- 렌더러 ----------
const canvas = $<HTMLCanvasElement>('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'default' });
let dprCap = 1.25;
const applySize = () => {
  renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfeeff, 28, 70);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 150);
scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8a70, 1.4));
const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
sunLight.position.set(-6, 14, 9);
scene.add(sunLight);

// ---------- 세션과 뷰 ----------
let session: DigSession;
let exc: ExcavatorView;
let soilView: SoilView;
let fx: FxView;
let world = new THREE.Group();
scene.add(world);

function disposeTree(o: THREE.Object3D) {
  const seen = new Set<unknown>();
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.geometry && !seen.has(m.geometry)) {
      seen.add(m.geometry);
      m.geometry.dispose();
    }
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      const map = (mat as THREE.MeshBasicMaterial).map;
      if (map && !seen.has(map)) {
        seen.add(map);
        map.dispose();
      }
      // 툰·외곽선 재질은 공유 캐시라 해제하지 않는다 (MeshToon, BackSide 외곽선)
      if (!(mat instanceof THREE.MeshToonMaterial) && mat.side !== THREE.BackSide && !seen.has(mat)) {
        seen.add(mat);
        mat.dispose();
      }
    }
  });
}

function newSession() {
  scene.remove(world);
  disposeTree(world);
  world = new THREE.Group();
  scene.add(world);
  session = new DigSession(MACHINE, RULES, PRACTICE);
  exc = new ExcavatorView(MACHINE);
  soilView = new SoilView(session.soil.grids);
  fx = new FxView();
  world.add(new SiteView(session.site, session.soil.grids).group, exc.root, ...soilView.meshes, fx.particles, fx.bucketShadow, fx.machineShadow);
  session.onViolation(showToast);
  session.onFinish(showResult);
  // 점검 화면 초기화
  setCheck('ck-belt', false);
  setCheck('ck-lever', false);
  $<HTMLInputElement>('rpm2').value = '30';
  $<HTMLInputElement>('rpm').value = '30';
  syncPrecheck();
  $('precheck').hidden = false;
  $('result').hidden = true;
  $('toasts').innerHTML = '';
  (window as unknown as { __exc: unknown }).__exc = { session, camera, ik: (r: number, y: number, k: number) => ik(MACHINE, r, y, k), setCam: (m: CamMode) => (camMode = m) };
}

// ---------- 카메라 ----------
type CamMode = 'chase' | 'cab' | 'overview' | 'free';
const CAM_LABEL: Record<CamMode, string> = { chase: '시점: 뒤', cab: '시점: 운전석', overview: '시점: 전체', free: '시점: 자유' };
let camMode: CamMode = 'chase';
const camPos = new THREE.Vector3(0, 12, 14);
const camLook = new THREE.Vector3();
function updateCamera(dt: number) {
  if (camMode === 'free') return; // 디버그: 외부에서 카메라 직접 지정
  const s = session;
  const ψ = s.pose.swing;
  const fwd = new THREE.Vector3(Math.cos(ψ), 0, Math.sin(ψ));
  const lat = new THREE.Vector3(-Math.sin(ψ), 0, Math.cos(ψ));
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  if (camMode === 'chase') {
    // 오른쪽 뒤 높은 곳: 운전석·B 폴이 시야를 가리지 않게
    pos.copy(fwd).multiplyScalar(-6.5).addScaledVector(lat, 5.2).setY(10.5);
    look.copy(fwd).multiplyScalar(5.2).setY(-0.6);
  } else if (camMode === 'cab') {
    // 운전석 앞유리 위치 (운전석은 붐 왼쪽 = -lat)
    pos.copy(fwd).multiplyScalar(0.9).addScaledVector(lat, -0.7).setY(3.0);
    look.copy(fwd).multiplyScalar(7).addScaledVector(lat, -0.2).setY(-0.4);
  } else {
    pos.set(0, 15, -9.5);
    look.set(0, 0, 1.2);
  }
  exc.setCabView(camMode === 'cab');
  const k = camMode === 'cab' ? 1 : 1 - Math.exp(-dt * 6);
  camPos.lerp(pos, k);
  camLook.lerp(look, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

// ---------- HUD ----------
const left = new Joystick($('stick-l'));
const right = new Joystick($('stick-r'));
const keys = new Keys();

function setCheck(id: string, on: boolean) {
  $(id).classList.toggle('on', on);
}
function syncPrecheck() {
  const rpm = Number($<HTMLInputElement>('rpm2').value) / 100;
  session.rpm = rpm;
  $<HTMLInputElement>('rpm').value = String(Math.round(rpm * 100));
  $('ck-rpm-dot').parentElement!.classList.toggle('on', rpm >= 0.6);
}
$('ck-belt').onclick = () => {
  session.belt = !session.belt;
  setCheck('ck-belt', session.belt);
};
$('ck-lever').onclick = () => {
  session.leverUnlocked = !session.leverUnlocked;
  setCheck('ck-lever', session.leverUnlocked);
};
$('rpm2').oninput = syncPrecheck;
$('rpm').oninput = () => {
  session.rpm = Number($<HTMLInputElement>('rpm').value) / 100;
};
$('btn-ready').onclick = () => {
  session.ready();
  $('precheck').hidden = true;
  const f = $('ready-flash');
  f.hidden = false;
  setTimeout(() => (f.hidden = true), 1100);
};
$('btn-lever').onclick = () => {
  session.leverUnlocked = !session.leverUnlocked;
};
$('btn-engine').onclick = () => session.restartEngine();
$('btn-end').onclick = () => session.abandon();
$('btn-retry').onclick = () => newSession();
$('btn-rotate-ok').onclick = () => document.body.classList.add('portrait-ok');
$('btn-cam').onclick = () => {
  const order: CamMode[] = ['chase', 'cab', 'overview'];
  camMode = order[(order.indexOf(camMode) + 1) % order.length];
  $('btn-cam').textContent = CAM_LABEL[camMode];
};
$('btn-cam').textContent = CAM_LABEL[camMode];

function showToast(v: Violation) {
  const el = document.createElement('div');
  const dq = v.kind === 'disqualify';
  el.className = 'toast' + (dq ? '' : ' warn');
  el.innerHTML = `<b>${dq ? `실전이었다면 실격! · ${v.basis}` : '주의'}</b>${v.detail}`;
  const box = $('toasts');
  box.prepend(el);
  while (box.children.length > 3) box.lastElementChild!.remove();
  setTimeout(() => el.remove(), 3500);
  if (dq && navigator.vibrate) navigator.vibrate(120);
}

let lastDig = -1;
function updateHud() {
  const s = session;
  const remain = s.params.digTimeLimitSec - s.t;
  const tm = $('timer');
  const a = Math.abs(Math.ceil(remain));
  tm.textContent = `${remain < 0 ? '+' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
  tm.className = 'timer' + (remain < 0 ? ' over' : remain < 30 ? ' warn' : '');
  $('dig').textContent = `${s.digCount}/${s.params.minDigCount}`;
  $('chip-dig').classList.toggle('done', s.digCount >= s.params.minDigCount);
  if (s.digCount !== lastDig) {
    if (lastDig >= 0) {
      $('chip-dig').classList.remove('pop');
      void $('chip-dig').offsetWidth;
      $('chip-dig').classList.add('pop');
    }
    lastDig = s.digCount;
  }
  $('dump').textContent = String(s.dumpCount);
  $('loadbar').style.width = `${Math.min(100, (s.load / s.heapedCap) * 100)}%`;
  $('guide').textContent = s.flags.guide ? s.guide() : '';
  const lv = $('btn-lever');
  lv.textContent = s.leverUnlocked ? '안전레버 해제됨' : '안전레버 잠김';
  lv.classList.toggle('on', s.leverUnlocked);
  $('btn-engine').hidden = s.engineOn;
  const ring = $('endring');
  const p = s.endProgress;
  ring.style.opacity = p > 0 ? '1' : '0';
  ring.style.borderColor = `rgba(47,210,122,${0.3 + p * 0.7})`;
  ring.style.transform = `scale(${1 + p * 0.3})`;
}

function showResult() {
  const s = session;
  const r = s.result();
  const sum = s.engine.summary();
  const dq = sum.filter((x) => x.kind === 'disqualify');
  const warn = sum.filter((x) => x.kind === 'warning');
  const stamp = $('stamp');
  stamp.className = 'stamp ' + (dq.length || s.abandoned ? 'fail' : 'pass');
  stamp.textContent = s.abandoned ? '중도 종료' : dq.length ? `실격 사유 ${dq.length}` : '실격 없음';
  $('res-title').textContent = s.abandoned
    ? '중도 종료 (실전이라면 기권)'
    : dq.length
      ? '실전이었다면 실격이에요'
      : '실격 없이 완주!';
  const dqList = $('res-dq');
  dqList.innerHTML = dq.length
    ? dq
        .map((d) => `<li class="dq"><b>${d.basis} · ${d.title}</b><small>${d.details.slice(0, 3).join(' / ')}${d.count > 1 ? ` (${d.count}회)` : ''}</small></li>`)
        .join('')
    : '<li class="ok"><b>공개문제 실격 항목에 해당 없음</b><small>세부 점수는 공개되지 않아 합격 여부는 판정하지 않습니다</small></li>';
  for (const w of warn) dqList.innerHTML += `<li><b>주의 · ${w.title}</b><small>${w.count}회</small></li>`;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const fl = r.flatness;
  const items = [
    ['작업 시간', `${Math.floor(r.elapsed / 60)}분 ${Math.round(r.elapsed % 60)}초 (제한 4분)`],
    ['유효 굴착 / 덤프', `${r.digCount}회 / ${r.dumpCount}회`],
    ['흙량 (평적 = 100%)', r.loadRatios.length ? `평균 ${pct(avg(r.loadRatios))} · 최저 ${pct(Math.min(...r.loadRatios))}` : '기록 없음'],
    ['굴착 위치 오차', r.positionErrors.length ? `평균 ${Math.round(avg(r.positionErrors) * 100)}cm` : '기록 없음'],
    ['연결동작 비율', pct(r.connectedRatio)],
    ['평탄도 (C 구덩이)', fl ? `기준면 편차 ${Math.round(fl.meanDev * 100)}cm · 높낮이 ${Math.round(fl.range * 100)}cm` : '-'],
    ['구덩이 밖 흙', fl ? `${(fl.outsideVol * 1000).toFixed(0)}L` : '-'],
    ['바닥 충격', `${r.impacts}회`],
    ['시작 전 점검', `벨트 ${r.precheck.belt ? '✔' : '✘'} · 안전레버 ${r.precheck.lever ? '✔' : '✘'} · RPM ${r.precheck.rpm ? '✔' : '✘'}`],
  ];
  $('res-metrics').innerHTML = items.map(([k, v]) => `<li><b>${k}</b>${v}</li>`).join('');
  setTimeout(() => ($('result').hidden = false), 600);
}

// ---------- 루프 (고정 60Hz 시뮬레이션) ----------
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();
let frameAvg = 16;
let slowT = 0;
const perf = $('perf');
perf.hidden = !debug;

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frameAvg = frameAvg * 0.95 + dt * 1000 * 0.05;
  session.input = {
    lx: clamp1(left.x + keys.lx),
    ly: clamp1(left.y + keys.ly),
    rx: clamp1(right.x + keys.rx),
    ry: clamp1(right.y + keys.ry),
  };
  acc += dt;
  let n = 0;
  // 밀린 시간을 버리지 않고 따라잡는다 (저사양에서도 제한시간이 실제 시간과 일치)
  acc = Math.min(acc, 0.5);
  while (acc >= STEP && n < 30) {
    session.step(STEP);
    acc -= STEP;
    n++;
  }
  exc.sync(session);
  soilView.sync();
  fx.sync(session);
  updateCamera(dt);
  updateHud();
  renderer.render(scene, camera);
  // 느리면 해상도를 낮춤
  if (frameAvg > 38) slowT += dt;
  else slowT = Math.max(0, slowT - dt);
  if (slowT > 2 && dprCap > 0.75) {
    dprCap = Math.max(0.75, dprCap - 0.25);
    applySize();
    slowT = 0;
  }
  if (debug) {
    const info = renderer.info.render;
    perf.textContent = `fps ${(1000 / frameAvg).toFixed(0)}  dpr ${renderer.getPixelRatio().toFixed(2)}\nsim ${session.simMs.toFixed(2)}ms  draw ${info.calls}  tri ${info.triangles}\n장부오차 ${session.ledgerError().toExponential(1)}`;
  }
  requestAnimationFrame(frame);
}
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

newSession();
applySize();
addEventListener('resize', applySize);
requestAnimationFrame(frame);

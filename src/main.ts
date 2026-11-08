import * as THREE from 'three';
import { MACHINE } from './config/machine';
import rulesJson from './config/rules.json';
import sitesJson from './config/sites.json';
import { MODES, type ModeKey, type Violation } from './core/ruleEngine';
import { isLocked } from './core/entitlement';
import { ExcavatorView, type MachineStyleKey } from './render/excavatorView';
import { FxView, SiteView, SoilView } from './render/siteView';
import { DigSession, type DigEntry, type RulesFile } from './sim/session';
import { LESSONS, Tutor } from './sim/tutorial';
import { ik } from './sim/kinematics';
import { Joystick, Keys } from './ui/joystick';
import { MachineSound, type SoundLevels } from './ui/audio';
import { ICON } from './ui/icons';

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
const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 150);
scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8a70, 1.4));
const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
sunLight.position.set(-6, 14, 9);
scene.add(sunLight);

// ---------- 세션과 뷰 ----------
let session: DigSession;
let exc: ExcavatorView;
let soilView: SoilView;
let siteView: SiteView;
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

// 장비 유형 (시험장 주력 3계열의 색 조합) — 선택은 기억
let styleKey: MachineStyleKey = 'A';
try {
  const v = localStorage.getItem('exc-style');
  if (v === 'A' || v === 'B' || v === 'C') styleKey = v;
} catch {
  /* 저장소 사용 불가 */
}
// 모드: 자유 연습 / 시험 연습 / 실제 시험 — 선택은 기억
let modeKey: ModeKey = 'free';
try {
  const v = localStorage.getItem('exc-mode');
  if ((v === 'tutorial' || v === 'free' || v === 'practice' || v === 'exam') && !isLocked(v)) modeKey = v;
} catch {
  /* 저장소 사용 불가 */
}
const MODE_INFO: Record<ModeKey, { label: string; tier: string; cls: string; stars: string; start: string }> = {
  tutorial: { label: '배우기', tier: '입문', cls: 'tier-learn', stars: '🔰', start: '스테이지 고르기' },
  free: { label: '자유 연습', tier: '연습', cls: 'tier-free', stars: '★', start: '시작' },
  practice: { label: '시험 연습', tier: '실전 대비', cls: 'tier-mid', stars: '★★', start: '도전' },
  exam: { label: '실제 시험', tier: '실전', cls: 'tier-boss', stars: '★★★', start: '도전!' },
};
function renderModePicker() {
  const box = $('mode-pick');
  box.innerHTML = '';
  for (const k of ['tutorial', 'free', 'practice', 'exam'] as const) {
    const b = document.createElement('button');
    const locked = isLocked(k);
    const mi = MODE_INFO[k];
    b.className = `modebtn ${mi.cls}` + (k === modeKey ? ' on' : '') + (locked ? ' locked' : '');
    b.innerHTML = `${locked ? `<span class="lock">${ICON.lock}</span>` : ''}<span class="tier">${mi.tier}</span><b>${mi.label}</b><span class="stars">${mi.stars}</span>`;
    b.onclick = () => {
      if (locked) {
        $('paywall').hidden = false;
        return;
      }
      if (modeKey === k) return;
      modeKey = k;
      try {
        localStorage.setItem('exc-mode', k);
      } catch {
        /* 무시 */
      }
      newSession();
    };
    box.appendChild(b);
  }
  const rb = $('btn-ready');
  rb.textContent = MODE_INFO[modeKey].start;
  rb.className = 'btn big go' + (modeKey === 'practice' ? ' mid' : modeKey === 'exam' ? ' boss' : '');
}

// ---------- 설정: 소리 · 굴착기 · 좌석 높이 ----------
const save = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 저장소 사용 불가 */
  }
};
const load = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

// 좌석 높이: 키에 맞춘 대략적인 눈높이 (앉은 눈높이 ≈ 키의 45%, 기준 172cm)
const H_MIN = 150;
const H_MAX = 195;
let heightCm = 170;
{
  const v = Number(load('exc-height'));
  if (v >= H_MIN && v <= H_MAX) heightCm = Math.round(v / 5) * 5;
}
const eyeOffset = () => (heightCm - 172) * 0.0045;
function syncRuler() {
  const f = (heightCm - H_MIN) / (H_MAX - H_MIN);
  $('ruler-fill').style.height = `${f * 100}%`;
  $('height-val').textContent = `${heightCm}cm`;
}
{
  const ruler = $('ruler');
  const setFromY = (y: number) => {
    const r = ruler.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (r.bottom - y) / r.height));
    heightCm = H_MIN + Math.round((f * (H_MAX - H_MIN)) / 5) * 5; // 5cm 단위
    save('exc-height', String(heightCm));
    syncRuler();
  };
  let drag = false;
  ruler.onpointerdown = (e) => {
    drag = true;
    try {
      ruler.setPointerCapture(e.pointerId);
    } catch {
      /* 무시 */
    }
    setFromY(e.clientY);
  };
  ruler.onpointermove = (e) => {
    if (drag) setFromY(e.clientY);
  };
  ruler.onpointerup = ruler.onpointercancel = () => (drag = false);
}

// 소리: 엔진음 / 환경음 / 효과음
const levels: SoundLevels = { engOn: true, eng: 0.8, ambOn: true, amb: 0.8, sfxOn: true, sfx: 0.8 };
try {
  Object.assign(levels, JSON.parse(load('exc-audio') ?? '{}'));
} catch {
  /* 무시 */
}
const SOUND_KEYS = ['eng', 'amb', 'sfx'] as const;
function syncSoundUi() {
  for (const k of SOUND_KEYS) {
    $<HTMLInputElement>(`vol-${k}`).value = String(Math.round(levels[k] * 100));
    const on = levels[`${k}On`];
    const b = $(`mute-${k}`);
    b.innerHTML = on ? ICON.sound : ICON.muted;
    b.classList.toggle('off', !on);
  }
}
const applySound = () => {
  sound.setLevels(levels);
  save('exc-audio', JSON.stringify(levels));
  syncSoundUi();
};
for (const k of SOUND_KEYS) {
  $<HTMLInputElement>(`vol-${k}`).oninput = (e) => {
    levels[k] = Number((e.target as HTMLInputElement).value) / 100;
    levels[`${k}On`] = true;
    applySound();
  };
  $(`mute-${k}`).onclick = () => {
    levels[`${k}On`] = !levels[`${k}On`];
    applySound();
  };
}

// 굴착기: 시험장 검색 / 가까운 시험장 / 직접 선택 (출처: 큐넷 시험장별 기종 현황)
interface TestSite {
  region: string;
  name: string;
  machine: string;
  style: MachineStyleKey;
  lat: number;
  lng: number;
}
const SITES = sitesJson as TestSite[];
const STYLE_NAME: Record<MachineStyleKey, string> = { A: '현대 계열', B: '두산 계열', C: '볼보 계열' };
let siteName = load('exc-site') ?? '';
const curSite = () => SITES.find((x) => x.name === siteName) ?? null;
if (curSite()) styleKey = curSite()!.style;
// 초성 검색: '경기 광주' ← 'ㄱㄱㄱㅈ'
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const cho = (t: string) =>
  [...t]
    .map((c) => {
      const k = c.charCodeAt(0) - 0xac00;
      return k >= 0 && k < 11172 ? CHO[Math.floor(k / 588)] : c;
    })
    .join('');
const norm = (t: string) => t.toLowerCase().replace(/[\s\-·()]/g, '');
const SITE_KEYS = SITES.map((x) => {
  const t = norm(`${x.region}${x.name}${x.machine}`);
  return { t, c: cho(t) };
});
/** 가까운 순 정렬용 거리(km). 위치는 이 기기 안에서만 쓰고 어디에도 보내지 않음 */
let nearKm: number[] | null = null;
function setMachine(style: MachineStyleKey, site: string) {
  siteName = site;
  save('exc-site', site);
  save('exc-style', style);
  if (styleKey !== style) {
    styleKey = style;
    rebuildMachine();
  }
  renderMachineUi();
}
function renderMachineUi() {
  const cs = curSite();
  $('site-cur').innerHTML = cs ? `<b>${cs.name}</b> · ${cs.machine}` : '';
  const pick = $('machine-pick');
  pick.innerHTML = '';
  for (const k of ['A', 'B', 'C'] as const) {
    const b = document.createElement('button');
    b.className = 'pickbtn' + (!cs && styleKey === k ? ' on' : '');
    b.textContent = STYLE_NAME[k];
    b.onclick = () => setMachine(k, '');
    pick.appendChild(b);
  }
  const q = norm($<HTMLInputElement>('site-q').value);
  let hits = SITES.map((x, i) => ({ x, i })).filter(({ i }) => !q || SITE_KEYS[i].t.includes(q) || SITE_KEYS[i].c.includes(q));
  if (nearKm && !q) hits = hits.sort((p, r) => nearKm![p.i] - nearKm![r.i]).slice(0, 10);
  else if (!q) hits.sort((p, r) => Number(r.x.name === siteName) - Number(p.x.name === siteName));
  const list = $('site-list');
  list.innerHTML = '';
  for (const { x, i } of hits) {
    const b = document.createElement('button');
    b.className = 'site-row' + (x.name === siteName ? ' on' : '');
    const km = nearKm ? `<em>${Math.round(nearKm[i])}km</em>` : '';
    b.innerHTML = `${km}<b>${x.region}</b> ${x.name}<small>${x.machine}</small>`;
    b.onclick = () => {
      $<HTMLInputElement>('site-q').value = '';
      setMachine(x.style, x.name);
    };
    list.appendChild(b);
  }
  if (!hits.length) list.innerHTML = '<p class="site-none">없음</p>';
}
$<HTMLInputElement>('site-q').oninput = () => renderMachineUi();
$('btn-near').onclick = () => {
  const btn = $<HTMLButtonElement>('btn-near');
  if (!navigator.geolocation) {
    btn.textContent = '위치 사용 불가';
    return;
  }
  btn.textContent = '찾는 중…';
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const { latitude: la, longitude: lo } = p.coords;
      const rad = Math.PI / 180;
      nearKm = SITES.map((x) => {
        const dLa = (x.lat - la) * rad;
        const dLo = (x.lng - lo) * rad;
        const h = Math.sin(dLa / 2) ** 2 + Math.cos(la * rad) * Math.cos(x.lat * rad) * Math.sin(dLo / 2) ** 2;
        return 2 * 6371 * Math.asin(Math.sqrt(h));
      });
      $<HTMLInputElement>('site-q').value = '';
      btn.innerHTML = `${ICON.pin} 가까운 순`;
      renderMachineUi();
    },
    () => {
      btn.textContent = '위치 권한 없음';
    },
    { maximumAge: 600000, timeout: 10000 },
  );
};

// 탭 · 열기/닫기
let camBeforeSeat: CamMode | null = null;
function showTab(tab: string) {
  for (const b of document.querySelectorAll<HTMLElement>('#settings [data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const p of document.querySelectorAll<HTMLElement>('#settings [data-pane]')) p.hidden = p.dataset.pane !== tab;
  // 좌석 높이: 뒤의 운전석 화면을 보면서 맞추도록 창을 옆으로 비킴
  $('settings').classList.toggle('seat', tab === 'seat');
  if (tab === 'seat') {
    if (camBeforeSeat === null) camBeforeSeat = camMode;
    camMode = 'cab';
    syncRuler();
  } else if (camBeforeSeat !== null) {
    camMode = camBeforeSeat;
    camBeforeSeat = null;
  }
  save('exc-settab', tab);
}
for (const b of document.querySelectorAll<HTMLElement>('#settings [data-tab]')) b.onclick = () => showTab(b.dataset.tab!);
const openSettings = () => {
  syncSoundUi();
  renderMachineUi();
  syncRuler();
  $('settings').hidden = false;
  showTab(load('exc-settab') ?? 'machine');
};
$('btn-paywall-close').onclick = () => ($('paywall').hidden = true);
$('btn-settings').onclick = openSettings;
$('btn-settings2').onclick = openSettings;
$('btn-settings-ok').onclick = () => {
  showTab('machine');
  $('settings').hidden = true;
};

function rebuildMachine() {
  if (!exc) return;
  world.remove(exc.root);
  disposeTree(exc.root);
  exc = new ExcavatorView(MACHINE, styleKey);
  world.add(exc.root);
  (window as unknown as { __exc: { exc: ExcavatorView } }).__exc.exc = exc;
}

function newSession(autoEnd?: boolean) {
  scene.remove(world);
  disposeTree(world);
  world = new THREE.Group();
  scene.add(world);
  session = new DigSession(MACHINE, RULES, modeKey === 'tutorial' ? { ...MODES.tutorial, autoEnd: !!autoEnd } : MODES[modeKey]);
  tutor = null;
  renderMission();
  exc = new ExcavatorView(MACHINE, styleKey);
  soilView = new SoilView(session.soil.grids);
  fx = new FxView();
  siteView = new SiteView(session.site, session.soil.grids);
  if (session.flags.feedback) siteView.addDigGuide(session.site, session.digTarget.rho, MACHINE.bucketWidth, session.params.digPosTolGood);
  world.add(siteView.group, exc.root, ...soilView.meshes, fx.particles, fx.dust, fx.bucketShadow, fx.machineShadow);
  session.onViolation(showToast);
  session.onFinish(showResult);
  session.onViolation((v) => v.kind === 'disqualify' && onLessonFail(v));
  session.onDigEntry(showEntry);
  // 점검 화면 초기화
  // 안전벨트·안전레버·RPM은 준비된 것으로 본다
  session.belt = true;
  session.leverUnlocked = true;
  session.rpm = 0.8;
  $('precheck').hidden = false;
  renderModePicker();
  $('result').hidden = true;
  $('toasts').innerHTML = '';
  (window as unknown as { __exc: unknown }).__exc = { session, camera, exc, sound, ik: (r: number, y: number, k: number) => ik(MACHINE, r, y, k), setCam: (m: CamMode) => (camMode = m) };
}

// ---------- 카메라 ----------
type CamMode = 'chase' | 'cab' | 'overview' | 'free';
const CAM_LABEL: Record<CamMode, string> = { chase: '시점: 뒤', cab: '시점: 운전석', overview: '시점: 전체', free: '시점: 자유' };
let camMode: CamMode = 'cab'; // 실제 시험처럼 운전석 시점이 기본
const gaze = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 12, 14);
const camLook = new THREE.Vector3();
function updateCamera(dt: number) {
  exc.setCabView(camMode === 'cab');
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
    // 운전석 눈 (붐 왼쪽, 지면에서 약 2.6m). 차체 흔들림을 그대로 받는다
    exc.root.updateMatrixWorld(true);
    exc.eyeWorld(pos, eyeOffset());
    // 시선: 정면 아래(구덩이 쪽)와 버킷 사이 — 사람이 버킷을 눈으로 좇는 것처럼
    const ahead = tmpV.copy(fwd).multiplyScalar(6.2).addScaledVector(lat, -0.3).setY(-0.6);
    exc.bucketWorld(look);
    look.lerp(ahead, 0.45);
    gaze.lerp(look, 1 - Math.exp(-dt * 5));
    look.copy(gaze);
  } else {
    pos.set(0, 15, -9.5);
    look.set(0, 0, 1.2);
  }
  exc.setCabView(camMode === 'cab');
  for (const l of siteView.labels) l.visible = camMode !== 'cab';
  // 화각: 운전석은 넓게(가로 약 95°), 세로 화면이면 더 넓힘
  const wantFov = camMode === 'cab' ? (camera.aspect >= 1 ? 62 : 85) : 55;
  if (Math.abs(camera.fov - wantFov) > 0.1) {
    camera.fov = wantFov;
    camera.updateProjectionMatrix();
  }
  const k = camMode === 'cab' ? 1 : 1 - Math.exp(-dt * 6);
  camPos.lerp(pos, k);
  camLook.lerp(look, k);
  camera.position.copy(camPos);
  // 충격 시 카메라 떨림 (운전석 시점은 더 크게)
  const j = Math.min(0.6, s.lastJolt) * (camMode === 'cab' ? 0.25 : 0.4);
  if (j > 0.005) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * j, (Math.random() - 0.5) * j, (Math.random() - 0.5) * j));
  camera.lookAt(camLook);
}


// ---------- 배우기: 스테이지 맵 → 미션 → CLEAR ----------
let tutor: Tutor | null = null;
let lessonIdx = -1;
const loadCleared = (): string[] => {
  try {
    return JSON.parse(load('exc-tut') ?? '[]');
  } catch {
    return [];
  }
};
function renderLessonMap() {
  const done = new Set(loadCleared());
  const next = LESSONS.findIndex((l) => !done.has(l.id));
  const box = $('stage-map');
  box.innerHTML = '';
  LESSONS.forEach((l, i) => {
    const b = document.createElement('button');
    b.className = 'stage' + (done.has(l.id) ? ' cleared' : '') + (i === next ? ' next' : '');
    b.innerHTML = `<span class="st-num">${i + 1}</span><span class="st-icon">${l.icon}</span><b>${l.title}</b>`;
    b.onclick = () => startLesson(i);
    box.appendChild(b);
  });
  $('stage-count').textContent = `${done.size}/${LESSONS.length}`;
}
function openLessonMap() {
  renderLessonMap();
  $('precheck').hidden = true;
  $('lessons').hidden = false;
}
$('btn-lessons-back').onclick = () => {
  $('lessons').hidden = true;
  $('precheck').hidden = false;
};
function startLesson(i: number) {
  lessonIdx = i;
  const L = LESSONS[i];
  newSession(L.autoEnd);
  $('precheck').hidden = true;
  $('lessons').hidden = true;
  $('clear').hidden = true;
  if (matchMedia('(pointer: coarse)').matches) goFullscreen();
  sound.start();
  session.ready();
  tutor = new Tutor(L, session);
  renderMission(true);
}
function renderMission(intro = false) {
  const m = $('mission');
  if (!tutor) {
    m.hidden = true;
    for (const el of document.querySelectorAll('.lab')) el.classList.remove('hint');
    return;
  }
  const st = tutor.current;
  const n = tutor.lesson.steps.length;
  m.hidden = false;
  $('m-head').innerHTML = `<span class="m-step">STEP ${lessonIdx + 1}</span>${tutor.lesson.icon} ${tutor.lesson.title}`;
  $('m-text').textContent = st ? st.text : '';
  $('m-pips').innerHTML = Array.from({ length: n }, (_, k) => `<i class="${k < tutor!.step ? 'ok' : k === tutor!.step ? 'now' : ''}"></i>`).join('');
  // 다음 단계 문구가 튀어 들어오게
  const t = $('m-text');
  t.classList.remove('pop');
  void t.offsetWidth;
  t.classList.add('pop');
  if (intro) {
    m.classList.remove('intro');
    void m.offsetWidth;
    m.classList.add('intro');
  }
  const want = new Set(st?.labels ?? []);
  for (const el of document.querySelectorAll('.lab')) el.classList.toggle('hint', want.has(el.textContent ?? ''));
}
function onLessonClear() {
  const L = tutor!.lesson;
  const done = new Set(loadCleared());
  done.add(L.id);
  save('exc-tut', JSON.stringify([...done]));
  renderMission();
  $('mission').hidden = true;
  for (const el of document.querySelectorAll('.lab')) el.classList.remove('hint');
  $('clear-title').textContent = `${L.icon} ${L.title}`;
  const last = lessonIdx >= LESSONS.length - 1;
  $('btn-clear-next').hidden = last;
  $('btn-clear-exam').hidden = !last;
  const c = $('clear');
  c.hidden = true;
  void c.offsetWidth;
  c.hidden = false;
  sound.jingle();
  if (navigator.vibrate) navigator.vibrate([30, 40, 30, 40, 80]);
}
function onLessonFail(v: Violation) {
  if (!tutor || tutor.cleared) return;
  $('fail-detail').textContent = v.detail;
  $('mission').hidden = true;
  $('fail').hidden = false;
}
$('btn-clear-next').onclick = () => startLesson(lessonIdx + 1);
$('btn-clear-map').onclick = () => {
  $('clear').hidden = true;
  tutor = null;
  newSession();
  openLessonMap();
};
$('btn-clear-exam').onclick = () => {
  $('clear').hidden = true;
  tutor = null;
  modeKey = 'free';
  save('exc-mode', modeKey);
  newSession();
};
$('btn-fail-retry').onclick = () => {
  $('fail').hidden = true;
  startLesson(lessonIdx);
};
$('btn-fail-map').onclick = () => {
  $('fail').hidden = true;
  tutor = null;
  newSession();
  openLessonMap();
};

// ---------- HUD ----------
const sound = new MachineSound();
try {
  sound.muted = localStorage.getItem('exc-mute') === '1';
} catch {
  /* 무시 */
}
sound.setLevels(levels);
const left = new Joystick($('stick-l'));
const right = new Joystick($('stick-r'));
const keys = new Keys();

async function goFullscreen() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (o?.lock) await o.lock('landscape');
  } catch {
    /* 아이폰 Safari 등 미지원: 홈 화면에 추가 안내 */
  }
}
$('btn-fs').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else goFullscreen();
};
const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = (navigator as Navigator & { standalone?: boolean }).standalone || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
if (isIOS && !standalone) $('fs-hint').hidden = false;
if (matchMedia('(pointer: coarse)').matches) $('pc-hint').hidden = true;
if (!document.documentElement.requestFullscreen) $('btn-fs').hidden = true;
function beginWork() {
  setTimeout(() => sound.whistle('start'), 300);
  session.ready();
  const f = $('ready-flash');
  f.hidden = false;
  setTimeout(() => (f.hidden = true), 1100);
}
$('btn-ready').onclick = () => {
  if (session.flags.key === 'tutorial') return openLessonMap();
  if (matchMedia('(pointer: coarse)').matches) goFullscreen();
  sound.start(); // 휴대폰은 화면을 누른 순간에만 소리를 켤 수 있음
  $('precheck').hidden = true;
  const k = session.flags.key;
  if (k === 'free') return beginWork();
  // 등장 연출: 시험 연습(긴장) / 실제 시험(최고 긴장)
  const boss = k === 'exam';
  const bi = $('boss-intro');
  bi.className = boss ? 'boss' : 'mid';
  $('bi-tag').textContent = MODE_INFO[k].tier;
  $('bi-title').textContent = MODE_INFO[k].label;
  $('bi-sub').textContent = boss ? '4:00 · 실격하면 끝' : '4:00';
  // 애니메이션을 처음부터 다시 재생
  bi.hidden = true;
  void bi.offsetWidth;
  bi.hidden = false;
  sound.bossIntro(boss);
  if (boss && navigator.vibrate) navigator.vibrate([60, 120, 200]);
  setTimeout(() => {
    bi.hidden = true;
    beginWork();
  }, boss ? 2400 : 1600);
};
$('btn-engine').onclick = () => session.restartEngine();
// 그만하기: 실수로 끝나지 않게 길게 눌러야(0.6초) 작동
{
  const end = $('btn-end');
  let holdT = 0;
  const cancel = () => {
    clearTimeout(holdT);
    end.classList.remove('holding');
  };
  end.onpointerdown = (e) => {
    e.preventDefault();
    end.classList.add('holding');
    holdT = window.setTimeout(() => {
      end.classList.remove('holding');
      session.abandon();
    }, 600);
  };
  end.onpointerup = end.onpointerleave = end.onpointercancel = cancel;
}
$('btn-settings').innerHTML = ICON.gear;
$('btn-settings2').innerHTML = ICON.gear;
$('btn-fs').innerHTML = ICON.expand;
$('btn-near').innerHTML = `${ICON.pin} 가까운 곳`;
$('btn-retry').onclick = () => newSession();
$('btn-rotate-ok').onclick = () => document.body.classList.add('portrait-ok');
$('btn-cam').onclick = () => {
  const order: CamMode[] = ['cab', 'chase', 'overview'];
  camMode = order[(order.indexOf(camMode) + 1) % order.length];
  $('btn-cam').textContent = CAM_LABEL[camMode];
};
$('btn-cam').textContent = CAM_LABEL[camMode];

const muteBtn = $('btn-mute');
const syncMute = () => (muteBtn.innerHTML = sound.muted ? ICON.muted : ICON.sound);
syncMute();
muteBtn.onclick = () => {
  sound.start();
  sound.setMuted(!sound.muted);
  try {
    localStorage.setItem('exc-mute', sound.muted ? '1' : '0');
  } catch {
    /* 무시 */
  }
  syncMute();
};

function showToast(v: Violation) {
  if (v.kind === 'disqualify') sound.whistle('fail');
  if (v.id === 'W-JOLT' || v.id === 'W-IMPACT') sound.thump(0.8);
  if (v.kind === 'warning' && !session.flags.feedback) return; // 실제 시험: 경고 알림 없음
  const el = document.createElement('div');
  const dq = v.kind === 'disqualify';
  el.className = 'toast' + (dq ? '' : ' warn');
  el.innerHTML = `<b>${dq ? `실격 · ${v.basis}` : '주의'}</b>${v.detail}`;
  const box = $('toasts');
  box.prepend(el);
  while (box.children.length > 3) box.lastElementChild!.remove();
  setTimeout(() => el.remove(), 3500);
  if (navigator.vibrate) {
    if (dq) navigator.vibrate(120);
    else if (v.id === 'W-JOLT' && performance.now() - lastBuzz > 400) {
      lastBuzz = performance.now();
      navigator.vibrate([40, 30, 25]); // 덜컹
    }
  }
}

/** 첫 삽 위치 피드백: 목표(ⓑ선 안쪽 30cm, 중심) 대비 앞뒤·좌우 */
function showEntry(e: DigEntry) {
  if (!session.flags.feedback) return;
  const cm = (v: number) => Math.round(Math.abs(v) * 100);
  const fb = Math.abs(e.dr) < 0.02 ? '앞뒤 정확' : e.dr > 0 ? `ⓑ선 쪽 ${cm(e.dr)}cm` : `장비 쪽 ${cm(e.dr)}cm`;
  const lr = Math.abs(e.dl) < 0.02 ? '좌우 정확' : `${e.dl > 0 ? 'B 쪽' : 'B 반대쪽'} ${cm(e.dl)}cm`;
  const head = e.grade === 'good' ? '위치 좋음 👍' : e.grade === 'ok' ? '위치 조금 벗어남' : '위치 많이 벗어남';
  const el = document.createElement('div');
  el.className = 'toast entry ' + e.grade;
  el.innerHTML = `<b>${head}</b>${fb} · ${lr}`;
  const box = $('toasts');
  box.prepend(el);
  while (box.children.length > 3) box.lastElementChild!.remove();
  setTimeout(() => el.remove(), 3500);
}

let lastDig = -1;
function updateHud() {
  const s = session;
  const tm = $('timer');
  tm.hidden = s.flags.key === 'tutorial';
  if (s.flags.timeLimit) {
    const remain = s.params.digTimeLimitSec - s.t;
    const a = Math.abs(Math.ceil(remain));
    tm.textContent = `${remain < 0 ? '+' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
    tm.className = 'timer' + (remain < 0 ? ' over' : remain < 30 ? ' warn' : '');
  } else {
    // 자유 연습: 경과 시간
    const a = Math.floor(s.t);
    tm.textContent = `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
    tm.className = 'timer';
  }
  $('dig').textContent = `${s.digCount}/${s.params.minDigCount}`;
  $('chip-dig').classList.toggle('done', s.digCount >= s.params.minDigCount);
  if (s.digCount !== lastDig) {
    if (lastDig >= 0 && s.flags.feedback && s.packRatios.length) {
      // 끝까지 담겼는지 알려줌
      const pr = s.packRatios[s.packRatios.length - 1];
      const el = document.createElement('div');
      el.className = 'toast entry ' + (pr >= 0.6 ? 'good' : pr >= 0.4 ? 'ok' : 'bad');
      el.innerHTML = pr >= 0.6 ? `<b>끝까지 담김 ${Math.round(pr * 100)}% 👍</b>` : `<b>앞쪽에만 담김 (안쪽 ${Math.round(pr * 100)}%)</b>당기며 오므려 안쪽까지 밀어 넣기`;
      $('toasts').prepend(el);
      setTimeout(() => el.remove(), 3500);
    }
    if (lastDig >= 0) {
      $('chip-dig').classList.remove('pop');
      void $('chip-dig').offsetWidth;
      $('chip-dig').classList.add('pop');
    }
    lastDig = s.digCount;
  }
  $('dump').textContent = String(s.dumpCount);
  $('loadbar').style.width = `${Math.min(100, (s.load / s.heapedCap) * 100)}%`;
  const gd = $('guide');
  gd.textContent = s.flags.guide ? s.guide() : '';
  gd.hidden = !gd.textContent;
  $('btn-engine').hidden = s.engineOn;
  // 엔진 부하: 눈금(2/3) = 엔진 힘의 100%
  const lb = $('loadbar2');
  lb.style.width = `${Math.min(100, (s.engineLoad / 1.5) * 100)}%`;
  lb.parentElement!.classList.toggle('hot', s.engineLoad > 1);
  const ring = $('endring');
  const p = s.endProgress;
  ring.style.opacity = p > 0 && s.flags.feedback ? '1' : '0';
  ring.style.borderColor = `rgba(47,210,122,${0.3 + p * 0.7})`;
  ring.style.transform = `scale(${1 + p * 0.3})`;
}

function showResult() {
  const s = session;
  if (s.flags.key === 'tutorial') {
    // 배우기: 결과표 대신 미션 판정(마무리 미션은 종료가 곧 성공), 그만하기는 스테이지 맵으로
    if (tutor && !s.abandoned) return;
    tutor = null;
    newSession();
    openLessonMap();
    return;
  }
  const r = s.result();
  const sum = s.engine.summary();
  const dq = sum.filter((x) => x.kind === 'disqualify');
  const warn = sum.filter((x) => x.kind === 'warning');
  const stamp = $('stamp');
  stamp.className = 'stamp ' + (dq.length || s.abandoned ? 'fail' : 'pass');
  const mode = s.flags.key;
  stamp.textContent = s.abandoned ? (mode === 'exam' ? '기권' : '종료') : dq.length ? (mode === 'exam' ? '실격' : `실격 사유 ${dq.length}`) : '실격 없음';
  stamp.hidden = mode === 'free' && !dq.length;
  $('res-title').textContent =
    mode === 'free'
      ? '자유 연습 끝'
      : s.abandoned
        ? mode === 'exam' ? '기권 (실격)' : '중도 종료'
        : dq.length
          ? mode === 'exam' ? '실격' : '실전이면 실격'
          : '실격 없이 완주!';
  const dqList = $('res-dq');
  dqList.innerHTML =
    (dq.length
      ? dq.map((d) => `<li class="dq"><b>${d.basis} ${d.title}</b>${d.count > 1 ? `<small>${d.count}회</small>` : ''}</li>`).join('')
      : '<li class="ok"><b>실격 항목 없음</b></li>') +
    (warn.length ? `<li><b>주의</b><small>${warn.map((w) => `${w.title} ${w.count}`).join(' · ')}</small></li>` : '') ;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const cmOf = (v: number) => `${Math.round(v * 100)}cm`;
  const fl = r.flattenVol > 0 ? r.flatness : null; // 평탄작업을 안 했으면 표시 안 함
  const load = avg(r.loadRatios);
  const dr = avg(r.entries.map((e) => Math.abs(e.dr)));
  const dl = avg(r.entries.map((e) => Math.abs(e.dl)));
  const pack = avg(r.packRatios);
  // [항목, 값, 문제 있음]
  const items: [string, string, boolean][] = [
    ['시간', `${Math.floor(r.elapsed / 60)}:${String(Math.round(r.elapsed % 60)).padStart(2, '0')} / 4:00`, r.elapsed > 240],
    ['굴착 · 덤프', `${r.digCount} · ${r.dumpCount}회`, mode !== 'free' && r.digCount < 4],
    ['흙량 (평적 100%)', r.loadRatios.length ? `${pct(load)} (최저 ${pct(Math.min(...r.loadRatios))})` : '-', r.loadRatios.length > 0 && load < 0.8],
    ['위치 오차 앞뒤 · 좌우', r.entries.length ? `${cmOf(dr)} · ${cmOf(dl)}` : '-', dr > 0.15 || dl > 0.15],
    ['안쪽까지 담김', r.packRatios.length ? pct(pack) : '-', r.packRatios.length > 0 && pack < 0.6],
    ['운반 중 흘림', `${Math.round(r.carrySpill * 1000)}L`, r.carrySpill > 0.02],
    ['평탄 편차', fl ? cmOf(fl.meanDev) : '-', !!fl && fl.meanDev > 0.1],
    ['이빨로 밀어 평탄', r.flattenOpenRatio > 0 || fl ? pct(r.flattenOpenRatio) : '-', !!fl && r.flattenOpenRatio < 0.5],
    ['충격 · 덜컹', `${r.impacts} · ${r.jolts}회`, r.impacts + r.jolts > 0],
  ];
  $('res-metrics').innerHTML = items.map(([k, v, bad]) => `<li class="row${bad ? ' bad' : ''}"><span>${k}</span><b>${v}</b></li>`).join('');
  $('res-cols').classList.toggle('single', !dq.length && !warn.length);
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
  // 키보드는 켜짐/꺼짐뿐이라 서서히 오르내리게 (초당 4: 갑자기 떼면 약하게 덜컹)
  const ramp = (cur: number, target: number) => cur + Math.max(-dt * 4, Math.min(dt * 4, target - cur));
  kb.lx = ramp(kb.lx, keys.lx);
  kb.ly = ramp(kb.ly, keys.ly);
  kb.rx = ramp(kb.rx, keys.rx);
  kb.ry = ramp(kb.ry, keys.ry);
  session.input = {
    lx: curveSwing(clamp1(left.x + kb.lx)),
    ly: curve(clamp1(left.y + kb.ly)),
    rx: curve(clamp1(right.x + kb.rx)),
    ry: curve(clamp1(right.y + kb.ry)),
  };
  acc += dt;
  if (!$('settings').hidden) acc = 0; // 설정 중에는 일시정지
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
  sound.update(session);
  if (tutor && tutor.update()) {
    if (tutor.cleared) onLessonClear();
    else {
      sound.ding();
      renderMission();
    }
  }
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
/** 레버 감도 곡선: 조금 기울이면 아주 천천히 (미세 조작) */
const curve = (v: number) => Math.sign(v) * Math.abs(v) ** 2.2;
// 선회는 조금 밀면 아주 천천히(미세 조정), 끝까지 밀어야 최고 속도
const curveSwing = (v: number) => Math.sign(v) * Math.abs(v) ** 3;
const kb = { lx: 0, ly: 0, rx: 0, ry: 0 };
let lastBuzz = 0;

newSession();
applySize();
addEventListener('resize', applySize);
requestAnimationFrame(frame);

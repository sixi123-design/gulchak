import * as THREE from 'three';
import { MACHINE } from './config/machine';
import rulesJson from './config/rules.json';
import sitesJson from './config/sites.json';
import { MODES, type ModeKey, type Violation } from './core/ruleEngine';
import { isLocked, redeem } from './core/entitlement';
import { bumpRuns, loadRuns, todayKey } from './core/practiceLog';
import { ExcavatorView, type LookKey, type MachineStyleKey } from './render/excavatorView';
import { FxView, SiteView, SoilView } from './render/siteView';
import { DigSession, type DigEntry, type RulesFile, type Sticks } from './sim/session';
import { TIERS, tierProgress, Tutor } from './sim/tutorial';
import { DIG_COURSE } from './sim/leverSchool';
import { SpotMark } from './render/spotMark';
import { TipTrail } from './render/tipTrail';
import { ik, toWorld } from './sim/kinematics';
import { gaugeLevel, Joystick, KEY_ACTIONS, keyName, Keys } from './ui/joystick';
import { Pedal, SteeringWheel } from './ui/driveControls';
import { MachineSound, type SoundLevels } from './ui/audio';
import { cssVars, INTRO_KEY, loadNum, loadRaw, loadSeen, loadStep, markSeen, pickTab, saveRaw, saveStep, STEPS, wantIntro, WHY_KEY } from './ui/prefs';
import { buzz, buzzOn, setBuzz } from './ui/buzz';
import { Q, current as qNow, markRendererAa, pick as qPick, tick as qTick, type QLevel } from './ui/quality';
import { ICON } from './ui/icons';
import { ExaminerView } from './render/examinerView';
import { EXAM_SKY, paintExamSite } from './render/examSite';
import { EXAM_TIMES, examLook, SEASONS, seasonOfMonth, type ExamTime, type Season } from './render/examLook';
import { DriveApp } from './driveApp';
import { DRIVE_LESSONS } from './sim/drive/driveTutorial';
import { fixTip } from './sim/fixTips';
import type { Lesson } from './sim/tutorial';
import { Intro } from './ui/intro';
import { StartStage } from './ui/startStage';
import { playPass } from './ui/passFx';
import { installPatterns } from './ui/patterns';
import { Pad } from './ui/gamepad';
// 합격·완료 연출용 증서 무늬: 첫 화면을 늦추지 않게 한가할 때 미리 그려 둠
(window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1200)))(() => installPatterns());
import { renderScore } from './ui/scoreView';
import { scoreDig, scoreDrive, type Score } from './sim/score';

const RULES = rulesJson as unknown as RulesFile;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const loadPct = $('loadpct');
const debug = new URLSearchParams(location.search).has('debug');

// ---------- 렌더러 ----------
const canvas = $<HTMLCanvasElement>('view');
/** 화질: 자동이면 '보통'에서 시작해 프레임을 보고 오르내리고, 고른 값이 있으면 고정 (상태는 ui/quality) */
// 안티에일리어싱은 WebGL 컨텍스트 생성 옵션이라 켜고 끄면 다음에 켤 때부터 적용된다
const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q[qNow().level].aa, alpha: true, powerPreference: 'default' });
markRendererAa(Q[qNow().level].aa);
if (debug) (window as unknown as { __r: unknown }).__r = renderer;
let dprCap = Q[qNow().level].dprCap;
let sizeW = 0;
let sizeH = 0;
let sizeDpr = 0;
/**
 * 그리는 크기를 실제 화면(캔버스) 크기에 맞춤. 휴대폰을 돌리면 resize가 크기가 바뀌기 전에 오기도 해서
 * 캔버스 크기 변화(ResizeObserver)로도 다시 맞춤 (안 그러면 세로 크기로 그린 그림이 가로로 늘어남)
 */
const applySize = () => {
  const w = canvas.clientWidth || innerWidth;
  const h = canvas.clientHeight || innerHeight;
  const dpr = Math.min(devicePixelRatio, dprCap);
  if (w === sizeW && h === sizeH && dpr === sizeDpr) return;
  sizeW = w;
  sizeH = h;
  sizeDpr = dpr;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};
/** 화질 단계가 바뀌면 해상도를 다시 맞춘다 */
function applyQuality(lv: QLevel) {
  dprCap = Q[lv].dprCap;
  applySize();
}

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfeeff, 28, 70);
const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 150);
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x9a8a70, 1.4);
scene.add(hemiLight);
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
let trail: TipTrail | null = null;
/** 땅에 놓는 "여기를 파세요" 표식 (단계가 자리를 정해 준다) */
let spot: SpotMark | null = null;
/** 레버 익히기의 튜토리얼 공간 색 (바닥·먼 안개). 회색이 아니라 한 톤 */
const TUTOR_FLOOR = 0xd7e3ec;
const TUTOR_SKY = 0xeaf3f8;
/**
 * 흙 주변 다진 바닥. 튜토리얼에서는 바닥색과 **같게** 둔다 —
 * 흙 둘레에 네모난 판이 떠 보여서 어디까지가 흙인지 헷갈린다.
 */
const TUTOR_GROUND = TUTOR_FLOOR;
/** 바닥 실격선 (원래 거의 검정 0x1d1b2e). 바닥이 밝으니 흰색은 안 보여 회색으로 */
const TUTOR_LINE = 0x8d97a0;
/** 잘했다·잘못했다 연출: 미션이 센 값이 늘어난 만큼만 재생한다 */
let fxOk = 0;
/** '좋아요 ✓'를 띄워 두는 시각 (그 뒤 다음 지시) */
let passUntil = 0;
const PASS_MS = 900;
let fxBad = 0;
function playDrillFx(kind: 'ok' | 'bad') {
  const box = $('drill');
  box.classList.remove('ok', 'bad');
  void box.offsetWidth; // 같은 연출을 다시 재생
  box.classList.add(kind);
  const fxEl = $('drill-fx');
  // 원형으로 퍼지는 띠 + (잘했으면) 꽃가루. DOM·CSS만 쓴다 (새 렌더 패스 없음)
  // 흩어질 자리는 여기서 계산한다 (CSS cos()·sin()은 낡은 크롬에 없어 가만히 있게 된다)
  const bits =
    kind === 'ok'
      ? Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2;
          return `<i class="dr-bit" style="--dx:${(Math.cos(a) * 42).toFixed(1)}vmin;--dy:${(Math.sin(a) * 34 + 12).toFixed(1)}vmin;--i:${i}"></i>`;
        }).join('')
      : '';
  fxEl.innerHTML = `<i class="dr-ring ${kind}"></i>${bits}`;
  if (kind === 'ok') {
    sound.ding();
    buzz(30);
  } else {
    sound.thump(0.5);
    buzz([25, 40, 25]);
  }
}
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
/** 다음 세션을 튜토리얼 공간으로 만들까 (레버 익히기) */
let tutorLook = false;
try {
  const v = localStorage.getItem('exc-style');
  if (v === 'A' || v === 'B' || v === 'C') styleKey = v;
} catch {
  /* 저장소 사용 불가 */
}
// 모드: 자유 연습 / 연습 시험 / 실제 시험 — 선택은 기억
// 종목: 굴착 / 주행(코스운전) — 선택은 기억
type KindKey = 'dig' | 'drive';
let kindKey: KindKey = 'dig';
try {
  if (localStorage.getItem('exc-kind') === 'drive') kindKey = 'drive';
} catch {
  /* 저장소 사용 불가 */
}
let drive: DriveApp | null = null;
let modeKey: ModeKey = 'free';
try {
  const v = localStorage.getItem('exc-mode');
  if ((v === 'tutorial' || v === 'free' || v === 'practice' || v === 'exam') && !isLocked(v)) modeKey = v;
} catch {
  /* 저장소 사용 불가 */
}
const MODE_INFO: Record<ModeKey, { label: string; cls: string; start: string; icon: keyof typeof ICON }> = {
  tutorial: { label: '배우기', cls: 'tier-learn', start: '스테이지 고르기', icon: 'mLearn' },
  free: { label: '자유 연습', cls: 'tier-free', start: '시작', icon: 'mFree' },
  practice: { label: '연습 시험', cls: 'tier-mid', start: '도전', icon: 'mPractice' },
  exam: { label: '실제 시험', cls: 'tier-boss', start: '도전!', icon: 'mExam' },
};
// 테스트 결제: 구매하면 그 모드 1판만 열림 (판이 끝나면 다시 결제 유도)
let testPass: ModeKey | null = null;
let payFor: ModeKey | null = null;
const needPay = (k: ModeKey) => isLocked(k) && testPass !== k;
function openPaywall(k: ModeKey) {
  // 미션 화면을 떠나는 길: 한 톤 배경을 거둔다 (성공 카드 뒤에서는 남겨 두었다)
  document.body.classList.remove('flat-bg');
  payFor = k;
  // 누른 모드를 앞에 (이용권은 두 모드 모두)
  const other: ModeKey = k === 'exam' ? 'practice' : 'exam';
  $('pw-title').textContent = `${MODE_INFO[k].label} · ${MODE_INFO[other].label} 열기`;
  const runs = loadRuns(todayKey());
  const pr = $('pw-runs');
  pr.hidden = runs.total < 3;
  pr.textContent = `지금까지 ${runs.total}판 연습했어요`;
  $('paywall').hidden = false;
}
// ----- 시작 페이지 카드 스티커 (CSS: .mb-badge). 유료 모드도 잠김 표시 없이: 누를 때 결제 -----
function modeBadge(k: ModeKey) {
  let t = '';
  if (k === 'tutorial') {
    // 목록의 '다음' 표시와 같은 번호: 아직 안 깬 첫 미션의 자리
    const LS = curLessons();
    const done = new Set(loadCleared());
    const next = LS.findIndex((l) => !done.has(l.id));
    const n = LS.filter((l) => done.has(l.id)).length;
    t = n === 0 ? '처음이면 여기부터' : next < 0 ? '복습하기' : `이어서 ${next + 1}단계`;
  } else if (k === 'free') t = '시간 제한 없음';
  else if (k === 'practice') t = '안내·피드백 포함';
  else if (k === 'exam') t = '실제 시험 조건';
  return t ? `<i class="mb-badge">${t}</i>` : '';
}
function renderModePicker() {
  const box = $('mode-pick');
  box.innerHTML = '';
  for (const k of ['tutorial', 'free', 'practice', 'exam'] as const) {
    const b = document.createElement('button');
    const mi = MODE_INFO[k];
    b.className = `modebtn ${mi.cls}` + (k === modeKey ? ' on' : '') + (needPay(k) ? ' pay' : '');
    b.innerHTML = `${ICON[mi.icon]}<b>${mi.label}</b>` + modeBadge(k);
    b.onclick = () => {
      // 카드를 누르면 바로 시작 (유료 모드는 결제 먼저)
      if (needPay(k)) return openPaywall(k);
      sound.start();
      sound.select();
      if (modeKey !== k) {
        modeKey = k;
        try {
          localStorage.setItem('exc-mode', k);
        } catch {
          /* 무시 */
        }
        newSession();
      }
      startMode();
    };
    box.appendChild(b);
  }
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

// 실제 시험 시각·계절: 해 위치·빛 색·하늘·나무 색 (화면만, 판정과 무관)
// 시간 기본 점심, 계절 기본 기기 날짜
// 직접 고르기에서 고른 값 (현재 시간이면 쓰지 않음)
let lookNow = load('exc-looknow') !== '0';
let examTime: ExamTime = (EXAM_TIMES.find((t) => t.key === load('exc-examtime'))?.key ?? 'pm') as ExamTime;
let examSeason: Season = (SEASONS.find((t) => t.key === load('exc-season'))?.key ?? seasonOfMonth(new Date().getMonth())) as Season;
function applySceneLook() {
  const fog = scene.fog as THREE.Fog;
  if (modeKey === 'exam') {
    const L = lookNow ? examLook('pm', 'auto') : examLook(examTime, examSeason);
    sunLight.position.copy(L.sunDir).multiplyScalar(17);
    sunLight.color.copy(L.sunColor);
    sunLight.intensity = L.sunI;
    hemiLight.color.copy(L.hemiSky);
    hemiLight.groundColor.copy(L.hemiGround);
    hemiLight.intensity = L.hemiI;
    fog.color.copy(L.skyHorizon);
    fog.near = EXAM_SKY.fogNear;
    fog.far = EXAM_SKY.fogFar;
    paintExamSite(scene, L);
  } else {
    sunLight.position.set(-6, 14, 9);
    sunLight.color.setHex(0xffffff);
    sunLight.intensity = 1.6;
    hemiLight.color.setHex(0xffffff);
    hemiLight.groundColor.setHex(0x9a8a70);
    hemiLight.intensity = 1.4;
    fog.color.setHex(0xcfeeff);
    fog.near = 28;
    fog.far = 70;
  }
}
function renderExamLookUi() {
  const el = $('exam-look');
  const d = new Date();
  const lab = (k: string, arr: { key: string; label: string }[]) => arr.find((x) => x.key === k)!.label;
  const hourOf = (t: ExamTime) => EXAM_TIMES.find((x) => x.key === t)!.hour;
  const tl = (t: ExamTime) => `${lab(t, EXAM_TIMES)} ${hourOf(t) > 12 ? hourOf(t) - 12 : hourOf(t)}시`;
  const nowSub = `${d.getMonth() + 1}월 ${d.getDate()}일 · ${lab(seasonOfMonth(d.getMonth()), SEASONS)} · ${tl('pm')}`;
  const chips = (items: { key: string; label: string }[], cur: string, cls: string) =>
    items.map((it) => `<button class="lk-chip${it.key === cur ? ' on' : ''}" data-${cls}="${it.key}">${it.label}</button>`).join('');
  el.innerHTML = `
    <button class="lk-card${lookNow ? ' on' : ''}" data-mode="now">
      <i class="lk-radio"></i><span class="lk-t">현재 시간<em>기본</em></span><span class="lk-s">${nowSub}</span>
    </button>
    <div class="lk-card lk-custom${lookNow ? '' : ' on'}">
      <button class="lk-head" data-mode="custom">
        <i class="lk-radio"></i><span class="lk-t">직접 고르기</span>
        <span class="lk-s">${lookNow ? '계절·아침/점심' : `${lab(examSeason, SEASONS)} · ${tl(examTime)}`}</span><b class="lk-arrow">›</b>
      </button>
      ${lookNow ? '' : `<div class="lk-body">
        <p class="lk-label">계절</p><div class="lk-row s4">${chips(SEASONS, examSeason, 'season')}</div>
        <p class="lk-label">시간 <small>입실 12:30 · 8:30</small></p>
        <div class="lk-row s2">${chips(EXAM_TIMES.map((t) => ({ key: t.key, label: tl(t.key) })), examTime, 'time')}</div>
      </div>`}
    </div>`;
  el.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => (b.onclick = () => {
    lookNow = b.dataset.mode === 'now';
    save('exc-looknow', lookNow ? '1' : '0');
    renderExamLookUi();
    applySceneLook();
  }));
  el.querySelectorAll<HTMLElement>('[data-season],[data-time]').forEach((b) => (b.onclick = () => {
    if (b.dataset.season) save('exc-season', (examSeason = b.dataset.season as Season));
    if (b.dataset.time) save('exc-examtime', (examTime = b.dataset.time as ExamTime));
    renderExamLookUi();
    applySceneLook();
  }));
}

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
// 전체 음량 (0~1). 음소거와 따로 기억한다
let volAll = loadNum('exc-vol-all', 1, 0, 1);
const SOUND_KEYS = ['eng', 'amb', 'sfx'] as const;
function syncSoundUi() {
  const all = $('mute-all');
  all.innerHTML = sound.muted ? ICON.muted : ICON.sound;
  all.classList.toggle('off', sound.muted);
  $<HTMLInputElement>('vol-all').value = String(Math.round(volAll * 100));
  $('settings').classList.toggle('all-off', sound.muted);
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
$('mute-all').onclick = () => {
  sound.start();
  sound.setMuted(!sound.muted);
  save('exc-mute', sound.muted ? '1' : '0');
  syncSoundUi();
};
$<HTMLInputElement>('vol-all').oninput = (e) => {
  sound.start();
  volAll = Number((e.target as HTMLInputElement).value) / 100;
  sound.setMaster(volAll);
  saveRaw('exc-vol-all', String(volAll));
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
// 기종 버튼은 중립 이름 (제조사 이름은 시험장 목록의 사실 안내에만)
const STYLE_NAME: Record<MachineStyleKey, string> = { A: 'A형 · 노랑/남색', B: 'B형 · 주황', C: 'C형 · 노랑/검은 붐' };
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
// 설정 > 굴착기 모델: 고른 모델을 한 번 그려 사진처럼 보여줌 (같은 렌더러 · 계열별 캐시)
const thumbCache = new Map<MachineStyleKey, string>();
function machineThumb(k: MachineStyleKey): string {
  const hit = thumbCache.get(k);
  if (hit) return hit;
  const W = 480;
  const H = 270;
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x9a8a70, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-4, 10, 8);
  sc.add(sun);
  const v = new ExcavatorView(MACHINE, k);
  v.setDrive(0, 0, 0, 0, 0);
  const fake = {
    pose: { swing: 0, boom: 0.35, arm: -0.6, bucket: 0.4 },
    rock: { pitch: 0, pitchV: 0, roll: 0, rollV: 0 },
    lift: 0, load: 0, loadBack: 0, backCap: 1, m: MACHINE,
  };
  v.sync(fake as unknown as DigSession);
  sc.add(v.root);
  const box = new THREE.Box3().setFromObject(v.root);
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() / 2;
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
  cam.position.copy(c).add(new THREE.Vector3(0.55, 0.32, 0.78).normalize().multiplyScalar(r / Math.sin((15 * Math.PI) / 180) * 0.62));
  cam.lookAt(c);
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const prev = renderer.getRenderTarget();
  const clear = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearAlpha(0);
  renderer.clear();
  renderer.render(sc, cam);
  const px = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
  renderer.setRenderTarget(prev);
  renderer.setClearAlpha(clear);
  rt.dispose();
  v.disposeCache();
  disposeTree(v.root);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const img = cv.getContext('2d')!.createImageData(W, H);
  for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  cv.getContext('2d')!.putImageData(img, 0, 0);
  const url = cv.toDataURL('image/png');
  thumbCache.set(k, url);
  return url;
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
  const im = $<HTMLImageElement>('machine-img');
  im.src = machineThumb(styleKey);
  im.alt = STYLE_NAME[styleKey];
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
      $('site-pop').hidden = true;
      setMachine(x.style, x.name);
    };
    list.appendChild(b);
  }
  if (!hits.length) list.innerHTML = '<p class="site-none">없음</p>';
}
$<HTMLInputElement>('site-q').oninput = () => renderMachineUi();
// 시험장 검색: 누르면 검색 팝업 + 목록
function openSitePop(focus: boolean) {
  renderMachineUi();
  $('site-pop').hidden = false;
  $('site-list').scrollTop = 0;
  if (focus) $<HTMLInputElement>('site-q').focus();
}
$('btn-site-search').onclick = () => openSitePop(true);
$('btn-site-close').innerHTML = ICON.close;
$('btn-site-close').onclick = () => {
  $<HTMLInputElement>('site-q').value = '';
  $('site-pop').hidden = true;
  $('btn-site-search').focus();
};
// 휴대폰 키보드가 올라오면 보이는 높이에 맞춰 팝업을 줄임 (목록만 스크롤)
{
  const vv = window.visualViewport;
  const fit = () => document.documentElement.style.setProperty('--vvh', `${vv ? vv.height : innerHeight}px`);
  vv?.addEventListener('resize', fit);
  fit();
}
$('btn-near').onclick = () => {
  const btn = $<HTMLButtonElement>('btn-near');
  if (!navigator.geolocation) {
    btn.textContent = '위치 사용 불가';
    return;
  }
  // 이미 위치를 알면 바로 가까운 순 목록
  if (nearKm) {
    $<HTMLInputElement>('site-q').value = '';
    return openSitePop(false);
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
      btn.innerHTML = `${ICON.pin} 가까운 곳`;
      openSitePop(false);
    },
    () => {
      btn.textContent = '위치 권한 없음';
    },
    { maximumAge: 600000, timeout: 10000 },
  );
};

// 설정 > 화면·조작: 크기 · 레버 여백 · 화질 · 레버 글자 · 진동 (값은 prefs 한 곳)
function applyUiSize() {
  for (const [k, v] of Object.entries(cssVars())) document.documentElement.style.setProperty(k, v);
}
/** 칩 한 줄 그리기 */
function chipRow(id: string, labels: readonly string[], cur: number, pick: (i: number) => void) {
  const el = $(id);
  el.innerHTML = labels.map((l, i) => `<button class="lk-chip${i === cur ? ' on' : ''}" data-i="${i}">${l}</button>`).join('');
  el.querySelectorAll<HTMLElement>('[data-i]').forEach((b) => (b.onclick = () => pick(Number(b.dataset.i))));
}
function renderViewPrefs() {
  for (const k of ['btn', 'txt', 'stick', 'edge'] as const)
    chipRow(`z-${k}`, STEPS[k].label, loadStep(k), (i) => {
      saveStep(k, i);
      applyUiSize();
      renderViewPrefs();
    });
  // 화질: 자동 + 3단
  const q = qNow();
  chipRow('q-row', ['자동', Q[0].label, Q[1].label, Q[2].label], q.pref === 'auto' ? 0 : q.pref + 1, (i) => {
    applyQuality(qPick(i));
    $('q-note').hidden = !qNow().aaChanged;
    renderViewPrefs();
  });
  chipRow('z-labels', ['켜기', '끄기'], labelsOn ? 0 : 1, (i) => {
    labelsOn = i === 0;
    save('exc-labels', labelsOn ? '1' : '0');
    syncLabels();
    renderViewPrefs();
  });
  chipRow('buzz-row', ['켜기', '끄기'], buzzOn() ? 0 : 1, (i) => {
    setBuzz(i === 0);
    if (i === 0) buzz(20);
    renderViewPrefs();
  });
}
applyUiSize();

// 설정 > 시험장: 배운 내용 초기화 (한 번 더 눌러야 지워진다)
{
  const b = $('btn-reset-tut');
  const label = '배운 내용 초기화';
  let armed = false;
  let t = 0;
  const disarm = () => {
    armed = false;
    b.textContent = label;
    b.classList.remove('danger');
  };
  b.onclick = () => {
    clearTimeout(t);
    if (!armed) {
      armed = true;
      b.textContent = '정말 지울까요?';
      b.classList.add('danger');
      t = window.setTimeout(disarm, 4000);
      return;
    }
    save('exc-tut', '[]');
    disarm();
    b.textContent = '지웠어요';
    t = window.setTimeout(disarm, 1500);
    // 설정 뒤에 떠 있던 배우기 목록·시작 화면 뱃지도 같이 되돌린다
    renderMission();
    renderLessonMap();
    renderModePicker();
  };
}



// 탭 · 열기/닫기
/** 지금 있는 탭 (옛 버전이 저장한 'sound'·'seat'가 남아 있을 수 있다) */
const SET_TABS = ['keys', 'view', 'sound', 'machine'] as const;
let camBeforeSeat: CamMode | null = null;
// 좌석 높이는 따로 들어가는 화면: 들어올 때의 탭·키를 기억 → [취소]는 되돌리고 나감
let seatFrom = 'view';
let heightBefore = 170;
function showTab(tab: string) {
  if (tab === 'seat' && !$('settings').classList.contains('seat')) {
    seatFrom = pickTab(load('exc-settab'), SET_TABS, 'view');
    heightBefore = heightCm;
  }
  for (const b of document.querySelectorAll<HTMLElement>('#settings [data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const p of document.querySelectorAll<HTMLElement>('#settings [data-pane]')) p.hidden = p.dataset.pane !== tab;
  // 좌석 높이: 뒤의 운전석 화면을 보면서 맞추도록 창을 옆으로 비킴
  $('settings').classList.toggle('seat', tab === 'seat');
  $('btn-keys-reset').hidden = tab !== 'keys' || matchMedia('(pointer: coarse)').matches;
  if (tab === 'seat') {
    if (camBeforeSeat === null) camBeforeSeat = camMode;
    camMode = 'cab';
    syncRuler();
  } else if (camBeforeSeat !== null) {
    camMode = camBeforeSeat;
    camBeforeSeat = null;
  }
  $('btn-seat-cancel').hidden = tab !== 'seat';
  if (tab !== 'seat') save('exc-settab', tab);
}
for (const b of document.querySelectorAll<HTMLElement>('#settings [data-tab]')) b.onclick = () => showTab(b.dataset.tab!);
$('btn-seat-go').onclick = () => showTab('seat');
const openSettings = () => {
  syncSoundUi();
  renderMachineUi();
  renderExamLookUi();
  syncRuler();
  $('settings').hidden = false;
  const t = pickTab(load('exc-settab'), SET_TABS, 'keys');
  renderPadUi();
  renderViewPrefs();
  $('q-note').hidden = !qNow().aaChanged;
  showTab(t);
};
$('btn-paywall-close').onclick = () => ($('paywall').hidden = true);
$('btn-settings').onclick = openSettings;
$('btn-settings2').onclick = openSettings;
$('btn-seat-cancel').onclick = () => {
  heightCm = heightBefore;
  save('exc-height', String(heightCm));
  syncRuler();
  showTab(seatFrom);
};
$('btn-settings-ok').onclick = () => {
  if ($('settings').classList.contains('seat')) return showTab(seatFrom);
  keys.cancelRebind();
  // 탭은 그대로 둔다: 방금 보던 자리에서 다시 열리게
  $('settings').hidden = true;
};

/** 날 앞 흙더미가 화면에 올라간 지형 높이 위에 놓이도록 연결 */
function wireSoilShown() {
  if (!exc || !soilView) return;
  const sv = soilView;
  exc.soilShown = (g) => sv.shownOf(g);
}

function rebuildMachine() {
  if (drive) return newSession();
  if (!exc) return;
  world.remove(exc.root);
  exc.disposeCache();
  disposeTree(exc.root);
  exc = new ExcavatorView(MACHINE, look);
  wireSoilShown();
  world.add(exc.root);
  (window as unknown as { __exc: { exc: ExcavatorView } }).__exc.exc = exc;
}

let examiners: ExaminerView | null = null;
/** 실격 연출 중 카메라 (null이면 평소 카메라) */
let cine: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
let dqShown = false;
let dqPlaying = false;
const END_LABEL: Record<ModeKey, string> = { tutorial: '목록', free: '그만하기', practice: '그만하기', exam: '기권' };
/** 스틱 글자: 굴착(레버) / 주행(핸들·페달) */
const STICK_LABELS: Record<KindKey, [string, string, string, string, string, string, string, string]> = {
  dig: ['암 펴기', '암 당기기', '선회&nbsp;◀', '▶&nbsp;선회', '붐 내림', '붐 올림', '버킷 오므림', '버킷 펴기'],
  drive: ['', '', '핸들&nbsp;◀', '▶&nbsp;핸들', '가속', '브레이크', '', ''],
};
function setStickLabels(k: KindKey) {
  const L = STICK_LABELS[k];
  const put = (id: string, i: number) => {
    const st = $(id);
    (['up', 'down', 'lt', 'rt'] as const).forEach((c, j) => {
      const el = st.querySelector<HTMLElement>(`.lab.${c}`);
      if (el) {
        el.innerHTML = L[i + j];
        el.hidden = !L[i + j];
      }
    });
  };
  put('stick-l', 0);
  put('stick-r', 4);
}
/** 이번 세션에 쓸 장비 겉모습. 레버 익히기는 'T'(검정 없는 밝은 버전) */
let look: LookKey = 'A';
function newSession(autoEnd?: boolean) {
  // 배우기 화면 상태(퀴즈·시작 점검)는 새 판마다 지운다 — 중간에 나가도 레버·점검판이 숨은 채 남지 않게
  document.body.classList.remove('quiz-on', 'check-lesson', 'flat-bg');
  look = tutorLook ? 'T' : styleKey;
  $('btn-lookwheel').classList.remove('on');
  $('btn-lookmirror').classList.remove('on');
  $('btn-lookfront').classList.add('on');
  drive?.dispose();
  drive = null;
  exc?.disposeCache();
  // 이빨 경로 선·땅 표식은 world에 붙어 있으니 world를 버리기 전에 정리한다
  trail?.dispose();
  trail = null;
  spot?.dispose();
  spot = null;
  scene.remove(world);
  disposeTree(world);
  world = new THREE.Group();
  scene.add(world);
  trail = new TipTrail();
  world.add(trail.object);
  spot = new SpotMark();
  world.add(spot.object);
  session = new DigSession(MACHINE, RULES, modeKey === 'tutorial' ? { ...MODES.tutorial, autoEnd: !!autoEnd } : MODES[modeKey]);
  // 시험·연습: 마지막 자세(버킷 끝까지 펴서 내려놓기) 그대로 A 흙 위에서 시작 (배우기는 단계마다 자세를 따로 잡음)
  if (modeKey !== 'tutorial') {
    const A = session.site.stations[0];
    session.restOnSoil(Math.PI, (A.pitIn + A.pitOut) / 2 + 0.4);
  }
  tutor = null;
  renderMission();
  exc = new ExcavatorView(MACHINE, look);
  soilView = new SoilView(session.soil.grids);
  wireSoilShown();
  fx = new FxView();
  siteView = new SiteView(session.site, session.soil.grids, modeKey === 'exam');
  // 실제 시험: 하늘 돔 색에 맞춘 먼 안개. 다른 모드는 기본값으로
  applySceneLook();
  document.body.dataset.kind = kindKey;
  setStickLabels(kindKey);
  if (kindKey === 'drive') {
    // 주행: 굴착 세션은 화면 밖에 두고(모드 정보용) 코스·장비·미러를 띄움
    drive = new DriveApp(world, renderer, MODES[modeKey], styleKey);
    applySceneLook();
    drive.s.onViolation(showToast);
    drive.s.onViolation((v) => v.kind === 'disqualify' && onLessonFail(v));
    drive.s.onFinish(showDriveResult);
    tutor = null;
    examiners = null;
    if (modeKey === 'exam') {
      drive.s.belt = false;
      drive.s.leverUnlocked = false;
      drive.s.rpm = 0.3;
      // 출발 감독관: 주차구역 왼쪽, 출발선 뒤 (코스·주행로 밖)에서 운전석을 봄
      const c = drive.s.c;
      examiners = new ExaminerView([[c.startMid.x + c.width / 2 + 3.2, c.startMid.z - 1.2]]);
      world.add(examiners.group);
      drive.exc.root.updateMatrixWorld(true);
      examiners.face(0, drive.exc.eyeWorld(new THREE.Vector3(), eyeOffset()));
    }
    resetExamCheck();
    cine = null;
    dqShown = false;
    dqPlaying = false;
    $('dq-banner').hidden = true;
    document.body.dataset.mode = modeKey;
    camMode = 'cab';
    $('btn-end').textContent = END_LABEL[modeKey];
    $('btn-end').classList.toggle('danger', modeKey !== 'tutorial');
    $('precheck').hidden = false;
    renderModePicker();
    $('result').hidden = true;
    $('toasts').innerHTML = '';
    $('mission').hidden = true;
    (window as unknown as { __exc: unknown }).__exc = { drive, camera, sound, setCam: (m: CamMode) => (camMode = m) };
    return;
  }
  if (session.flags.feedback) siteView.addDigGuide(session.site, session.digTarget.rho, MACHINE.bucketWidth, session.params.digPosTolGood);
  if (session.flags.feedback) siteView.addFlatGuide(session.site);
  world.add(siteView.group, exc.root, ...soilView.meshes, fx.particles, fx.dust, fx.bucketShadow, fx.machineShadow);
  // 실제 시험: 감독관 3명 (A쪽 · B 통과구역 뒤 · C쪽 = 시간 담당)
  examiners = null;
  cine = null;
  dqShown = false;
  dqPlaying = false;
  $('dq-banner').hidden = true;
  if (modeKey === 'exam') {
    const [A, Cst] = session.site.stations;
    examiners = new ExaminerView([
      [-(A.zoneOut + 2.6), -4.6],
      [-2.4, session.site.B.rF + 2.6],
      [Cst.zoneOut + 2.6, -4.6],
      START_SPOT_DIG,
    ]);
    world.add(examiners.group);
    // 출발 감독관은 처음부터 운전석(나)을 보고 서 있음: 손 드는 걸 봐야 하니까
    exc.sync(session);
    exc.root.updateMatrixWorld(true);
    examiners.face(3, exc.eyeWorld(new THREE.Vector3(), eyeOffset()));
  }
  session.onViolation(showToast);
  session.onFinish(showResult);
  session.onViolation((v) => v.kind === 'disqualify' && !tutor?.lesson.noFail && onLessonFail(v));
  session.onDigEntry(showEntry);
  // 점검 화면 초기화
  // 안전벨트·안전레버·RPM은 준비된 것으로 본다
  // 실제 시험은 직접 점검: 안전벨트 풀림 · 안전레버 잠김 · RPM 저속으로 시작
  const selfCheck = modeKey === 'exam';
  session.belt = !selfCheck;
  session.leverUnlocked = !selfCheck;
  session.rpm = selfCheck ? 0.3 : 0.8;
  resetExamCheck();
  // 모드별로 보일 것·숨길 것은 CSS(body[data-mode])에서. 실제 시험은 운전석 시점 고정
  document.body.dataset.mode = modeKey;
  if (modeKey === 'exam') camMode = 'cab';
  $('btn-end').textContent = END_LABEL[modeKey];
  $('btn-end').classList.toggle('danger', modeKey !== 'tutorial');
  $('precheck').hidden = false;
  renderModePicker();
  $('result').hidden = true;
  $('toasts').innerHTML = '';
  warmToasts();
  warmShaders();
  // 흙덩이·흙 알갱이 예열은 시작 0.5초 뒤 (시작 직후 몇 프레임 안에 그리면 효과가 남지 않음: 30ms 뒤 예열은 실패, 0.4·1.2초 뒤는 성공)
  warmPending = performance.now() + 500;
  warmFxPending = performance.now() + 900;
  (window as unknown as { __exc: unknown }).__exc = { session, camera, scene, exc, sound, soilView, fx, ik: (r: number, y: number, k: number) => ik(MACHINE, r, y, k), setCam: (m: CamMode) => (camMode = m) };
}

// ---------- 카메라 ----------
type CamMode = 'chase' | 'cab' | 'overview' | 'free';
let camMode: CamMode = 'cab'; // 실제 시험처럼 운전석 시점이 기본
const gaze = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 12, 14);
const camLook = new THREE.Vector3();
/** 옆 시점: 버킷 옆으로 이만큼 (m, 운전석 반대쪽) */
const SIDE_LAT = 6;
/** 옆 시점에서 운전석으로 돌아오는 남은 시간 (초) */
let sideBack = 0;
function updateCamera(dt: number) {
  if (cine) {
    exc.setCabView(false);
    for (const l of siteView.labels) l.visible = false;
    if (Math.abs(camera.fov - 50) > 0.1) {
      camera.fov = 50;
      camera.updateProjectionMatrix();
    }
    const k = 1 - Math.exp(-dt * 4);
    camPos.lerp(cine.pos, k);
    camLook.lerp(cine.look, k);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    return;
  }
  // 시범의 각도 토막: 옆에서 버킷을 보여 준다 (운전석에서는 버킷 바닥 각이 안 보인다 — 유저 검토).
  // 서서히 옮겨 가고, 끝나면 서서히 운전석으로 돌아온다. 실습은 운전석 그대로
  if (tutor && !tutor.cleared && tutor.current?.side && tutor.demoState() !== 'user' && camMode === 'cab') {
    exc.setCabView(false);
    for (const l of siteView.labels) l.visible = false;
    if (Math.abs(camera.fov - 50) > 0.1) {
      camera.fov = 50;
      camera.updateProjectionMatrix();
    }
    const ψ = session.pose.swing;
    const fwd = tmpV.set(Math.cos(ψ), 0, Math.sin(ψ));
    const lat = new THREE.Vector3(-Math.sin(ψ), 0, Math.cos(ψ));
    const b = new THREE.Vector3();
    exc.bucketWorld(b);
    const pos = b.clone().addScaledVector(lat, SIDE_LAT).addScaledVector(fwd, -1.2).setY(Math.max(0.6, b.y + 0.6));
    const look = b.clone().addScaledVector(fwd, -0.6).setY(Math.max(-0.4, b.y - 0.2));
    const k = 1 - Math.exp(-dt * 2.5);
    camPos.lerp(pos, k);
    camLook.lerp(look, k);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    sideBack = 0.9;
    return;
  }
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
    // 감독관 쪽으로 돌아봄: 감독관이 화면 왼쪽 위(점검 버튼 위)에 오게
    if (examLookAt) look.lerp(examLookAt, 0.7).setY(1.4);
    gaze.lerp(look, 1 - Math.exp(-dt * (examLookAt ? 3 : 5)));
    look.copy(gaze);
  } else {
    pos.set(0, 15, -9.5);
    look.set(0, 0, 1.2);
  }
  // 운전석 안에서 **시선만** 내려 땅을 보여 준다 (차 밖으로 나가지 않는다).
  // 1.5초: 0.2초 내려가고, 1.0초 머물고, 0.3초 올라온다. 화면을 누르면 즉시 끝난다.
  if (peekT > 0) {
    peekT = Math.max(0, peekT - dt);
    const done = PEEK_SEC - peekT;
    const amt = done < 0.2 ? done / 0.2 : peekT < 0.3 ? peekT / 0.3 : 1;
    look.y -= PEEK_DROP * amt;
  }
  exc.setCabView(camMode === 'cab');
  for (const l of siteView.labels) l.visible = camMode !== 'cab';
  // 화각: 운전석은 넓게(가로 약 95°), 세로 화면이면 더 넓힘
  // 운전석: 가로 시야 약 90° (사람이 앞유리로 보는 범위). 화면 비율마다 세로 화각을 맞춤
  const cabFov = camera.aspect >= 1 ? THREE.MathUtils.clamp((2 * Math.atan(Math.tan((46 * Math.PI) / 180) / camera.aspect) * 180) / Math.PI, 48, 62) : 72;
  const wantFov = camMode === 'cab' ? cabFov : 55;
  if (Math.abs(camera.fov - wantFov) > 0.1) {
    camera.fov = wantFov;
    camera.updateProjectionMatrix();
  }
  // 옆 시점에서 돌아올 때는 서서히 (뚝 끊기면 어디를 보는지 놓친다)
  sideBack = Math.max(0, sideBack - dt);
  const k = camMode === 'cab' && sideBack <= 0 ? 1 : 1 - Math.exp(-dt * 6);
  camPos.lerp(pos, k);
  camLook.lerp(look, k);
  camera.position.copy(camPos);
  // 충격 시 카메라 떨림 (운전석 시점은 더 크게)
  const j = Math.min(0.6, s.lastJolt) * (camMode === 'cab' ? 0.25 : 0.4);
  if (j > 0.005) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * j, (Math.random() - 0.5) * j, (Math.random() - 0.5) * j));
  // 부하 떨림: 엔진이 힘들수록 차체가 부르르 (운전석에서 크게 느껴짐)
  if (s.engineOn && s.phase === 'working') {
    const over = Math.max(0, s.engineLoad - 0.5);
    // + 흙을 가르는 동안 약한 떨림 (흙이 버티는 느낌)
    const dig = Math.min(0.006, s.effortRate * 0.012);
    const a = Math.min(0.045, over * over * 0.03 + dig) * (camMode === 'cab' ? 1 : 0.5);
    if (a > 0.001) {
      const tt = performance.now() / 1000;
      camera.position.y += Math.sin(tt * 71) * a;
      camera.position.x += Math.sin(tt * 53 + 1.3) * a * 0.6;
    }
  }
  camera.lookAt(camLook);
}


// ---------- 배우기: 스테이지 맵 → 미션 → CLEAR ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tutor: Tutor<any> | null = null;
/** 운전석에서 시선을 내려 땅을 보는 연출 */
const PEEK_SEC = 1.5;
const PEEK_DROP = 2.6;
let peekT = 0;
/** 시선 내리기를 단계마다 한 번만 */
let peekStep = -1;
/** 땅을 한 번 보여 준다 (운전석 안에서 시선만 내린다) */
function peekGround() {
  peekT = PEEK_SEC;
}
/** 화면을 누르면 건너뛴다 */
addEventListener('pointerdown', () => (peekT = 0), true);
/** 지금 종목의 배우기 미션 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// 굴착 배우기: 기본기 과정이 먼저, 그 뒤가 기존 기초·숙련
const DIG_LESSONS: Lesson<any>[] = DIG_COURSE;
const curLessons = (): Lesson<any>[] => (kindKey === 'drive' ? DRIVE_LESSONS : DIG_LESSONS);
// ?debug: 브라우저 자동 플레이 검증용으로 상태를 읽게 함 (입력은 실제 화면 레버·키·포인터로 넣는다)
if (debug)
  (window as unknown as { __app: unknown }).__app = {
    get tutor() {
      return tutor;
    },
    get session() {
      return session;
    },
    get drive() {
      return drive;
    },
    get kind() {
      return kindKey;
    },
    lessons: () => curLessons().map((l) => l.id),
    /** 검토용 스크린샷: 미션 i 시작 / 지금 미션의 단계 n으로 건너뛰기 (화면도 다시 그린다) */
    start: (i: number) => startLesson(i),
    jump: (n: number) => {
      if (!tutor) return;
      tutor.step = n;
      (tutor as unknown as { enter(): void }).enter();
      renderMission();
    },
  };
let lessonIdx = -1;
const loadCleared = (): string[] => {
  try {
    return JSON.parse(load('exc-tut') ?? '[]');
  } catch {
    return [];
  }
};
/** 미션별 최고 별 (없으면 빈 객체) */
const loadBest = (): Record<string, number> => {
  try {
    return JSON.parse(load('exc-tut-best') ?? '{}') ?? {};
  } catch {
    return {};
  }
};
function renderLessonMap() {
  const best = loadBest();
  const LS = curLessons();
  const done = new Set(loadCleared().filter((id) => LS.some((l) => l.id === id)));
  const next = LS.findIndex((l) => !done.has(l.id));
  const box = $('stage-map');
  box.innerHTML = '';
  box.classList.remove('leaving');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 누르면 목록이 짧게 빠지고 미션 시작 (0.16초)
  const pick = (b: HTMLElement, i: number) => () => {
    if (box.classList.contains('leaving')) return;
    if (reduced) return startLesson(i);
    box.classList.add('leaving');
    b.classList.add('picked');
    setTimeout(() => startLesson(i), 160);
  };
  const tiered = LS.some((l) => l.tier);
  box.classList.toggle('tiers', tiered);
  $('stage-count').hidden = tiered;
  $('stage-count').textContent = `${done.size}/${LS.length}`;
  if (tiered) {
    // 칸마다 진행도, 깬 건 ✓, 다음은 짙게. 순서·부제·가로 전체 여부는 TIERS가 정한다
    TIERS.forEach(({ key: tier, sub, wide }, c) => {
      const items = LS.map((l, i) => ({ l, i })).filter((x) => x.l.tier === tier);
      const { n, of } = tierProgress(LS, done, tier);
      if (of === 0) return; // 미션이 없는 칸은 그리지 않는다
      const col = document.createElement('div');
      col.className = 'tier-col' + (wide ? ' wide' : '');
      col.style.setProperty('--c', String(c));
      col.innerHTML = `<div class="tier-head" style="--p:${n / of}"><b>${tier}</b><span>${sub}</span><i>${reduced ? n : 0}/${of}</i></div>`;
      // 진행도 숫자: 막대가 차는 동안 0부터 올라감
      if (!reduced && n > 0) {
        const el = col.querySelector('.tier-head i')!;
        for (let k = 1; k <= n; k++) setTimeout(() => (el.textContent = `${k}/${of}`), 140 + c * 70 + (520 * k) / n);
      }
      items.forEach(({ l, i }, r) => {
        const b = document.createElement('button');
        b.className = 'lrow' + (done.has(l.id) ? ' cleared' : '') + (i === next ? ' next' : '');
        b.style.setProperty('--r', String(r));
        const num = done.has(l.id) ? '<svg viewBox="0 0 16 16" aria-label="완료"><path pathLength="1" d="M3.2 8.6l3.1 3L12.9 4.6"/></svg>' : i + 1;
        const st = best[l.id] ? `<span class="lr-stars" aria-label="최고 별 ${best[l.id]}개">${'★'.repeat(best[l.id])}${'☆'.repeat(3 - best[l.id])}</span>` : '';
        b.innerHTML = `<span class="lr-num">${num}</span><span class="lr-icon">${ICON[l.icon]}</span><b>${l.title}</b>${st}${i === next ? '<i class="lr-sweep"></i><em>다음</em>' : ''}`;
        b.onclick = pick(b, i);
        col.appendChild(b);
      });
      box.appendChild(col);
    });
    return;
  }
  LS.forEach((l, i) => {
    const b = document.createElement('button');
    b.className = 'stage' + (done.has(l.id) ? ' cleared' : '') + (i === next ? ' next' : '');
    b.style.setProperty('--r', String(i));
    b.innerHTML = `<span class="st-num">${i + 1}</span><span class="st-icon">${ICON[l.icon]}</span><b>${l.title}</b>`;
    b.onclick = pick(b, i);
    box.appendChild(b);
  });
}
function openLessonMap() {
  // 미션 화면을 떠나는 길: 한 톤 배경을 거둔다 (성공 카드 뒤에서는 남겨 두었다)
  document.body.classList.remove('flat-bg');
  renderLessonMap();
  // 뒤 배경: 굴착기 선 그림이 천천히 한 사이클씩 판다 (장식, 한 번만 넣음)
  if (!document.querySelector('#lessons .lm-deco')) {
    $('lessons').insertAdjacentHTML(
      'afterbegin',
      `<svg class="lm-deco" viewBox="0 0 240 150" aria-hidden="true"><path class="lm-ground" d="M4 143H236"/><rect x="118" y="119" width="104" height="22" rx="11"/><circle cx="131" cy="130" r="5"/><circle cx="209" cy="130" r="5"/><path d="M116 116V93h34V70h26l7 23h41v23z"/><path d="M155 76h17l4 13h-21z"/><g class="lm-boom"><path d="M136 100L82 44l9-6 56 52z"/><circle cx="140" cy="96" r="3"/><g class="lm-arm"><path d="M80 42l-26 66 8 3 25-66z"/><circle cx="82" cy="45" r="3"/><g class="lm-bkt"><path d="M57 110l-15 1q-6 15 6 22l16-9z"/></g></g></g></svg>`,
    );
  }
  $('precheck').hidden = true;
  $('lessons').hidden = false;
}
$('btn-lessons-back').onclick = () => {
  $('lessons').hidden = true;
  $('precheck').hidden = false;
};
/** 성공하면 잠깐 뒤 같은 미션을 자동으로 다시 (빠져나올 땐 '목록') */
let againTimer = 0;
let streak = 0;
/** 안내 단계: 0 레버까지 안내 · 1 목표 문구만 · 2 안내 없음 (같은 미션을 성공할 때마다 줄여 감) */
let guideLv = 0;
const GUIDE_TAG = ['', '목표만', '안내 없이'];
/**
 * 이론 카드. 처음 보는 미션이면 미션 대신 이걸 먼저 띄운다.
 * 미션 중 '왜?'로 다시 볼 때는 본 것으로 적지 않고, 닫으면 미션으로 돌아간다.
 */
let whyAfter: (() => void) | null = null;
let whyBack: (() => void) | null = null;
function openWhy(L: Lesson<any>, after: () => void, back?: () => void) {
  // 끝난 미션에서 다음 미션 카드로 갈 때만 한 톤 배경을 거둔다 (미션 중 '왜?'는 그대로 돌아온다)
  if (!tutor || tutor.cleared) document.body.classList.remove('flat-bg');
  if (!L.why) return after();
  $('why-title').textContent = L.why.title;
  $('why-art').innerHTML = ICON[L.icon];
  $('why-text').innerHTML = L.why.lines.map((t) => `<p>${t}</p>`).join('');
  $('lessons').hidden = true;
  $('clear').hidden = true;
  whyAfter = after;
  whyBack = back ?? null;
  $('btn-why-back').hidden = !back;
  $('why').hidden = false;
}
$('btn-why-go').onclick = () => {
  $('why').hidden = true;
  const f = whyAfter;
  whyAfter = null;
  whyBack = null;
  f?.();
};
$('btn-why-back').onclick = () => {
  $('why').hidden = true;
  const f = whyBack;
  whyAfter = null;
  whyBack = null;
  f?.();
};
$('btn-why').onclick = () => {
  if (!tutor?.lesson.why) return;
  // 미션 중 다시 보기: '해보기'도 '뒤로'도 미션으로 돌아간다 (본 것으로 적지 않는다)
  openWhy(
    tutor.lesson,
    () => {},
    () => {},
  );
};
/**
 * 미션 시작. `demo`가 false면 시범을 건너뛰고 실습부터 — 반복·다시는 연습하려고 누른다.
 * 시범은 처음 한 번만 자동으로, 그 뒤로는 '▶ 시범'·'시범 다시 보기'로 원할 때만 (기획 검토)
 */
function startLesson(i: number, again = false, lv = 0, demo = true) {
  const L0 = curLessons()[i];
  // 처음 보는 미션은 이론 카드를 먼저 (반복할 때는 건너뜀)
  if (!again && L0?.why && !loadSeen(WHY_KEY).includes(L0.id)) {
    // 읽고 '해보기'를 누른 뒤에 본 것으로 적는다 (카드만 보고 나가면 다음에 또 보여 준다)
    return openWhy(
      L0,
      () => {
        markSeen(WHY_KEY, L0.id);
        beginLesson(i, again, lv, demo);
      },
      openLessonMap,
    );
  }
  beginLesson(i, again, lv, demo);
}
/** 같은 미션에서 막혀 처음으로 되돌아간 횟수 (시범을 권할 때 쓴다) */
let stuckN = 0;
function beginLesson(i: number, again = false, lv = 0, demo = true) {
  clearTimeout(againTimer);
  tutorLook = !!curLessons()[i]?.flat;
  guideLv = lv;
  if (!again || i !== lessonIdx) streak = 0;
  lessonIdx = i;
  const L = curLessons()[i];
  newSession(L.autoEnd);
  $('precheck').hidden = true;
  $('lessons').hidden = true;
  $('clear').hidden = true;
  if (matchMedia('(pointer: coarse)').matches) goFullscreen();
  sound.start();
  // 튜토리얼 공간: 펜스·건물·폴·줄·표시선을 비우고 바닥·하늘을 한 색으로.
  // 화면 전체에 필터를 걸어 회색으로 만들던 것을 버렸다 (장비·흙까지 탈색되고 비용도 든다)
  document.body.classList.toggle('flat-bg', !!L.flat);
  // 시작 점검: 점검판이 가운데 아래를 쓰니 지시문은 위로
  document.body.classList.toggle('check-lesson', !!L.check);
  if (L.flat) {
    siteView.bare(TUTOR_FLOOR, TUTOR_LINE);
    soilView.setGround(TUTOR_GROUND);
    (scene.fog as THREE.Fog).color.setHex(TUTOR_SKY);
  }
  fxOk = 0;
  fxBad = 0;
  passUntil = 0;
  readStep = -1;
  if (drive) {
    drive.s.ready();
    tutor = new Tutor(L, drive.s);
  } else {
    session.ready();
    tutor = new Tutor(L, session);
  }
  if (!again || demo) stuckN = 0;
  if (!demo) tutor.skipDemo();
  renderMission(true);
}
/** 미션 도움 게이지: 막대(얼마나 왔나) 또는 바늘+목표 구간(각도 맞추기) */
const meterEl = $('m-meter');
/** 지금 조작이 맞는지: 이 단계 레버를 움직이면 '좋아요', 다른 레버면 '그 레버 아니에요' */
const LAB_AXIS: Record<string, [keyof Sticks, 1 | -1]> = Object.fromEntries(
  KEY_ACTIONS.map((a) => [a.label, [a.id.slice(0, 2) as keyof Sticks, a.id.endsWith('+') ? 1 : -1]]),
);
let sayState = '';
let sayKind = '';
let sayCoach = '';
/** 단계가 바뀔 때 이미 잡고 있던 레버: 한 번 놓기 전까지는 '틀림'으로 안 봄 */
const heldAtStep = new Set<keyof Sticks>();
let sayStep = -1;
function updateSay() {
  const el = $('m-say');
  if (guideLv >= 1) {
    // 안내 줄임: 레버 깜빡임·맞음/틀림 말풍선 없음
    setHints([]);
    if (sayState !== 'off') {
      sayState = 'off';
      el.textContent = '';
      el.className = 'm-say';
      for (const c of ['good', 'bad', 'next', 'coach']) $('mission').classList.remove(c);
    }
    return;
  }
  const st = tutor && !tutor.cleared ? tutor.current : null;
  const coach = tutor && !tutor.cleared ? tutor.coach : null;
  const labels = coach?.labels ?? st?.labels;
  setHints(labels ?? []);
  let state = '';
  let text = '';
  if (labels?.length) {
    const want = labels.map((l) => LAB_AXIS[l]).filter(Boolean);
    const inp = session.input;
    const TH = 0.25;
    if (tutor!.step !== sayStep) {
      sayStep = tutor!.step;
      heldAtStep.clear();
      for (const ax of ['lx', 'ly', 'rx', 'ry'] as const) if (Math.abs(inp[ax]) > TH) heldAtStep.add(ax);
    }
    for (const ax of heldAtStep) if (Math.abs(inp[ax]) <= TH) heldAtStep.delete(ax);
    const good = want.some(([ax, sg]) => inp[ax] * sg > TH);
    const wrong = (['lx', 'ly', 'rx', 'ry'] as const).some((ax) => Math.abs(inp[ax]) > TH && !heldAtStep.has(ax) && !want.some(([a, sg]) => a === ax && inp[ax] * sg > 0));
    // 앞 단계 레버를 아직 잡고 있음: 단계가 바뀌었으니 다른 레버로 (틀림은 아님)
    const stale = [...heldAtStep].some((ax) => !want.some(([a, sg]) => a === ax && inp[ax] * sg > 0));
    if (coach) {
      // 바로잡을 것: 원인 → 지금 할 레버 (맞는 레버를 쓰면 '좋아요')
      state = good ? 'good' : 'coach';
      text = good ? `${coach.msg} · 좋아요` : coach.msg;
    } else if (wrong) {
      state = 'bad';
      text = `그 레버 아니에요 → ${labels.join(' · ')}`;
    } else if (stale && !good) {
      state = 'next';
      text = `다음! 손 떼고 → ${labels.join(' · ')}`;
    } else if (good) {
      state = 'good';
      text = '좋아요, 계속';
    }
  }
  if (state + text === sayState) return;
  // 틀린 레버를 처음 잡은 순간 / 새 바로잡기 안내가 뜬 순간만 소리 (계속 잡고 있어도 반복 안 함)
  if (state === 'bad' && sayKind !== 'bad') {
    sound.wrong();
    buzz(15);
  } else if (state === 'coach' && text !== sayCoach) sound.cue();
  sayKind = state;
  if (state === 'coach') sayCoach = text;
  sayState = state + text;
  el.textContent = text;
  el.className = 'm-say ' + state;
  $('mission').classList.toggle('good', state === 'good');
  $('mission').classList.toggle('bad', state === 'bad');
  $('mission').classList.toggle('next', state === 'next');
  $('mission').classList.toggle('coach', state === 'coach');
}
/** 깜빡여 줄 레버 라벨 (바로잡을 것이 있으면 그 레버) */
let hintKey = '';
function setHints(labels: string[]) {
  const key = labels.join('|');
  if (key === hintKey) return;
  hintKey = key;
  const want = new Set(labels);
  // 라벨이 두 줄로 접히면 textContent에 줄바꿈이 들어간다 (버킷 / 펴기).
  // 공백을 한 칸으로 눌러 비교하지 않으면 그 라벨은 영영 반짝이지 않는다
  const flat = (t: string) => t.replace(/\s+/g, ' ').trim();
  for (const el of document.querySelectorAll('.lab')) el.classList.toggle('hint', want.has(flat(el.textContent ?? '')));
}
/** 처음 배우는 레버: 그 부위를 깜빡 강조하고 조이스틱 위까지 선으로 이어 줌 (2초) */
type Part = 'boom' | 'arm' | 'bucket';
const PART_OF = (l: string): Part | null => (l.startsWith('붐') ? 'boom' : l.startsWith('암') ? 'arm' : l.startsWith('버킷') ? 'bucket' : null);
/** 지금 지시가 가리키는 부품 (없으면 null) */
const stepPart = (): Part | null => {
  for (const l of tutor?.current?.labels ?? []) {
    const p = PART_OF(l);
    if (p) return p;
  }
  return null;
};
/** 부품을 움직이는 레버 축 (3칸 표시가 어느 레버를 볼지) */
const PART_AXIS: Record<Part, 'ly' | 'ry' | 'rx'> = { boom: 'ry', arm: 'ly', bucket: 'rx' };
/** 이름표 → 그 레버를 미는 방향 (부품 줄: 깜빡이는 이름표를 **전부** 같은 말로 풀어 준다) */
const LABEL_WAY: Record<string, string> = {
  '붐 올림': '오른쪽 레버 ↓',
  '붐 내림': '오른쪽 레버 ↑',
  '버킷 펴기': '오른쪽 레버 →',
  '버킷 오므림': '오른쪽 레버 ←',
  '암 당기기': '왼쪽 레버 ↓',
  '암 펴기': '왼쪽 레버 ↑',
};
/**
 * 지시문이 **버킷을 가리지 않게** 자리를 옮긴다.
 *
 * 버킷은 조작에 따라 화면을 오르내린다. 고정된 자리는 언젠가 반드시 겹친다.
 * 버킷이 글자 띠에 들어오면 반대쪽으로 비켜 주되, 0.4초에 걸쳐 미끄러지듯 옮겨
 * 읽는 중에 글자가 튀지 않게 한다.
 */
// 아래 자리는 버킷 게이지(화면 66% 부근)를 건드리지 않는 선까지만 내려간다
const DRILL_SPOT = { high: 0.18, low: 0.48 };
let drillTop = DRILL_SPOT.low;
/** 가려졌을 때 옮겨 갈 자리 (가려지지 않으면 그대로 둔다 — 글자가 왔다 갔다 하면 더 어지럽다) */
let drillWant = DRILL_SPOT.low;
/** 이번 프레임에 손이 레버를 민 깊이 (0~1). 시범 중에도 잰다 */
let userPush = 0;
const bucketV = new THREE.Vector3();
let dodgeT = performance.now();
function dodgeBucket() {
  const box = $('drill');
  const now = performance.now();
  const dt = Math.min(0.1, (now - dodgeT) / 1000);
  dodgeT = now;
  if (box.hidden) return;
  exc.bucketWorld(bucketV.set(0.55, -0.1, 0));
  bucketV.project(camera);
  const by = (1 - bucketV.y) / 2; // 0 = 화면 위
  const h = box.getBoundingClientRect().height / Math.max(1, innerHeight);
  const mid = (top: number) => top + h / 2;
  // 지금 글자 자리가 버킷에 걸렸으면, 두 자리 중 **버킷에서 더 먼** 쪽으로 옮긴다.
  // (예전에는 아래 자리만 보고 판단해서, 옮겨 간 위쪽에서 다시 가려도 모르고 있었다)
  if (Math.abs(by - mid(drillTop)) < h / 2 + 0.05)
    drillWant = Math.abs(by - mid(DRILL_SPOT.low)) > Math.abs(by - mid(DRILL_SPOT.high)) ? DRILL_SPOT.low : DRILL_SPOT.high;
  drillTop += (drillWant - drillTop) * Math.min(1, dt * 2.5);
  box.style.top = `${(drillTop * 100).toFixed(1)}%`;
  box.style.transform = 'none';
  // 왼쪽 레버판(과 '▶ 선회' 이름표)에 글이 깔리지 않게, 레버판과 높이가 겹치면 그 오른쪽에서 시작한다
  const pad = $('stick-l').getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const left = pad.width && b.bottom > pad.top ? Math.max(0.16 * innerWidth, pad.right + 18) : 0.16 * innerWidth;
  box.style.left = `${Math.round(left)}px`;
}

/**
 * 레버 길잡이를 그린다 (오른쪽 스틱 위).
 * 가동범위 링 = 이 정도 깊이로, 원호 = 12시에서 3시로, 점 = 지금 가야 할 자리.
 */
function updateGuide() {
  const g = tutor && !tutor.cleared ? (tutor.current?.guide?.(session) ?? null) : null;
  const box = $('guide-r');
  const stick = $('stick-r');
  // <svg>는 HTMLElement가 아니라 `.hidden` 프로퍼티가 속성을 바꾸지 않는다.
  // 속성을 직접 넣고 빼야 한다 — 안 그러면 영영 숨어 있다
  if (!g) {
    box.setAttribute('hidden', '');
    stick.classList.remove('rough');
    return;
  }
  box.removeAttribute('hidden');
  if (g.rough) stick.classList.add('rough');
  else stick.classList.remove('rough');
  const R = 50 * g.ring;
  const pt = (d: number) => `${(Math.cos((d * Math.PI) / 180) * R).toFixed(1)} ${(-Math.sin((d * Math.PI) / 180) * R).toFixed(1)}`;
  box.querySelector('.g-ring')?.setAttribute('r', String(R));
  const d = `M ${pt(g.from)} A ${R} ${R} 0 0 1 ${pt(g.to)}`;
  $('g-arc-bg').setAttribute('d', d);
  $('g-arc').setAttribute('d', d);
  const dot = $('g-dot');
  dot.setAttribute('cx', (Math.cos((g.at * Math.PI) / 180) * R).toFixed(1));
  dot.setAttribute('cy', (-Math.sin((g.at * Math.PI) / 180) * R).toFixed(1));
}

/**
 * 레버를 얼마나 밀었나를 칸 3개로 보여 준다. 글자는 0자다.
 * `Step.gauge`가 있는 구간에서만 띄운다 — 평소에는 화면을 어지럽히지 않는다.
 */
function updateGauge(part: Part | null) {
  const want = tutor?.current?.gauge;
  const box = $('dr-gauge');
  if (!want || !part) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  // 손 자리로 센다. 시범 중에는 앱이 민 값(기계 값)을 손 자리로 되돌린다 — 노브와 같은 자리
  const ax = PART_AXIS[part];
  const now = gaugeLevel(tutor?.demoState() === 'demo' ? uncurve(session.input[ax]) : session.stick[ax]);
  box.classList.toggle('hit', now === want);
  const bars = box.children;
  for (let i = 0; i < bars.length; i++) {
    bars[i].classList.toggle('on', i < now);
    bars[i].classList.toggle('want', i === want - 1);
  }
}

/**
 * 부품 깜빡임은 쓰지 않는다.
 *
 * 깜빡이는 곳을 **눌러야 하는 것으로** 읽힌다 (앱 주인 지적). 게다가 이 과정을 듣는
 * 사람은 필기 합격자라 붐·암·버킷이 뭔지 이미 안다. 지시문이 레버를 직접 말하면 된다.
 */
function updateIntro() {
  if (intro) {
    intro = false;
    exc.highlight([]);
  }
}
let intro = false;
function updateMeter() {
  updateSay();
  updateIntro();
  // 단계가 바뀔 때 한 번: 운전석에서 시선을 내려 땅을 보여 준다
  if (tutor && tutor.step !== peekStep) {
    peekStep = tutor.step;
    if (tutor.current?.peek) peekGround();
  }
  updateGuide();
  dodgeBucket();
  // 땅 표식 ("여기를 파세요")
  const sp = tutor && !tutor.cleared ? (tutor.current?.spot?.(session) ?? null) : null;
  if (sp) spot?.put(sp.swing, sp.r);
  else spot?.hide();
  // 미션이 띄우는 짧은 한 줄 (세는 중 ●●○ · 멈춘 뒤 오차 cm · 레버 익히기의 반응)
  const h = tutor?.hud() ?? null;
  if (tutor?.lesson.big) {
    const part = stepPart();
    // 세 줄을 동시에 띄우지 않는다. 반응·코치가 있으면 그것만, 없을 때만 레버 방향을 말한다
    // (지시문이 이미 레버를 말하고 있으면 부품 줄은 비운다)
    // 교정이 먼저다. 반응("좋아요")이 떠 있는 동안 "붐을 더 내리기"가 가려지면 안 된다
    const d = tutor.demoState();
    // 시범 중에는 레버를 밀어도 안 먹는다. 가만히 있으면 "왜 안 되지"가 되니 그 말을 해 준다
    // '좋아요'를 띄우는 동안은 다음 단계 안내를 섞지 않는다 (해낸 것과 고칠 것이 한 화면에 같이 뜬다)
    const say = tutor.current?.ask || passUntil ? '' : d !== 'user' && userPush > 0.12 ? '시범 중이에요 — 잠시 보세요' : (tutor.coach?.msg ?? h ?? '');
    const t = tutor.current?.text ?? '';
    // 시범에는 배지(시범 중)가 이미 떠 있다. 부품 줄까지 띄우면 네 줄이 된다
    // 첫 부품만 말하면 '붐 내림 + 암 당기기'에서 왼쪽 레버 이야기가 빠진다 (검토) — 깜빡이는 것 전부
    const ways = (tutor.current?.labels ?? []).filter((l) => LABEL_WAY[l]).map((l) => `${l} = ${LABEL_WAY[l]}`);
    $('dr-part').textContent = !say && !passUntil && d === 'user' && ways.length && !t.includes('레버') ? ways.join('\n') : '';
    updateGauge(part);
    const badge = $('dr-badge');
    // 두 줄 지시 + 작은 줄 + 배지 = 네 줄이다. 작은 줄이 있으면 배지는 숨긴다
    badge.hidden = !!say || (d === 'user' && !tutor.current?.demo) || !!tutor.current?.ask;
    badge.textContent = d === 'user' ? '직접 해보기' : '시범 중';
    // 배속 버튼: 시범이 도는 단계와 '다시 볼까요?'에서만 (다시 보기 전에 느리게 고를 수 있게)
    $('btn-slow').hidden = !(tutor.current?.ask || (tutor.current?.demo && d !== 'user'));
    // 시범 건너뛰기: 시범이 도는 동안 언제든 실습으로 (퀴즈 미션은 시범이 곧 문제라 빼고)
    $('btn-skip').hidden = !(
      tutor.hasDemo &&
      !tutor.current?.ask &&
      tutor.step < tutor.practiceStart() &&
      !tutor.lesson.steps.some((st) => st.quiz)
    );
    // 실습 중에 시범을 다시 보는 길. 막혀서 처음으로 돌아간 적이 있으면 눈에 띄게
    const demoBtn = $('btn-demo');
    demoBtn.hidden = !(tutor.hasDemo && d === 'user' && !tutor.current?.ask && tutor.practiceStart() > 0 && tutor.step >= tutor.practiceStart());
    demoBtn.classList.toggle('nudge', stuckN > 0);
    $('dr-say').textContent = say;
    $('m-hold').hidden = true;
    const ok = tutor.bag.okN ?? 0;
    const bad = tutor.bag.badN ?? 0;
    if (ok > fxOk) {
      fxOk = ok;
      playDrillFx('ok');
    }
    if (bad > fxBad) {
      fxBad = bad;
      playDrillFx('bad');
    }
  } else {
    $('m-hold').hidden = !h;
    if (h) $('m-hold').textContent = h;
  }
  const m = guideLv >= 1 || passUntil ? null : (tutor?.meter() ?? null);
  // 큰 지시문 화면(기본기)은 지시문 바로 밑에 같은 막대를 쓴다 — 얼마나 남았는지 보여야 기다린다
  const drM = $('dr-meter');
  const el = tutor?.lesson.big ? drM : meterEl;
  (el === drM ? meterEl : drM).hidden = true;
  el.hidden = !m;
  if (!m) return;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const band = el.querySelector<HTMLElement>('.band')!;
  const needle = el.querySelector<HTMLElement>('.needle')!;
  const fillEl = el.querySelector<HTMLElement>('.fill')!;
  if (m.band) {
    el.classList.add('is-band');
    band.style.left = pct(m.band[0]);
    band.style.width = pct(m.band[1] - m.band[0]);
    needle.style.left = pct(m.v);
    el.classList.toggle('ok', m.v >= m.band[0] && m.v <= m.band[1]);
  } else {
    el.classList.remove('is-band');
    fillEl.style.width = pct(m.v);
    el.classList.toggle('ok', m.v >= 1);
  }
}
let missionStep = -1;
function renderMission(intro = false) {
  const m = $('mission');
  if (!tutor) {
    m.hidden = true;
    $('drill').hidden = true;
    $('dr-ask').hidden = true;
    $('btn-slow').hidden = true;
    $('dr-part').textContent = '';
    $('dr-gauge').hidden = true;
    $('dr-badge').hidden = true;
    $('drill-fx').innerHTML = '';
    $('btn-why').hidden = true;
    for (const el of document.querySelectorAll('.lab')) el.classList.remove('hint');
    return;
  }
  // 레버 익히기: 지시문을 배경에 크게. 미션 판·게이지는 안 쓴다
  const big = !!tutor.lesson.big;
  $('drill').hidden = !big;
  if (big) {
    m.hidden = true;
    $('drill').classList.remove('ok', 'bad');
    $('drill-fx').innerHTML = '';
    // 방금 해낸 단계: 다음 지시 전에 잠깐 '좋아요 ✓' (지시가 바로 갈아 끼워지면 됐는지 모른다)
    const passing = passUntil > 0;
    $('dr-text').textContent = passing ? '좋아요' : (tutor.notice ?? tutor.current?.text ?? '');
    $('dr-text').classList.toggle('pass', passing);
    $('dr-ask').hidden = !tutor.current?.ask;
    renderQuiz();
    // 시작 점검: 점검판은 점검 단계 동안만
    if (tutor.lesson.check) {
      const p = $('exam-check');
      p.hidden = !!tutor.current?.quiz || tutor.cleared;
      p.classList.remove('working');
      if (!p.hidden) syncExamCheck();
    }
    for (const el of document.querySelectorAll('.lab')) el.classList.toggle('hint', new Set(tutor.current?.labels ?? []).has((el.textContent ?? '').replace(/ /g, ' ')));
    return;
  }
  const st = tutor.current;
  const n = tutor.lesson.steps.length;
  m.hidden = false;
  $('btn-why').hidden = !tutor.lesson.why;
  $('m-head').innerHTML = `${ICON[tutor.lesson.icon]}${tutor.lesson.title}${guideLv ? `<span class="m-lv">${GUIDE_TAG[guideLv]}</span>` : ''}<span class="m-n">${Math.min(tutor.step + 1, n)}/${n}</span>`;
  // 안내 없음: 단계 문구도 숨기고 '혼자 해 보기'만 (되돌림 안내는 보임)
  const stText = guideLv >= 2 ? '안내 없이 끝까지 해 보세요' : (st?.text ?? '');
  $('m-text').textContent = st ? (tutor.notice ? `${tutor.notice} → ${stText}` : stText) : '';
  m.classList.toggle('retry', !!tutor.notice);
  // ----- 단계 넘어감 연출: 방금 채운 칸 터짐(.just) + 미션 판 통통(.adv) -----
  const adv = !intro && tutor.step > 0 && tutor.step !== missionStep;
  missionStep = tutor.step;
  $('m-pips').innerHTML = Array.from({ length: n }, (_, k) => `<i class="${k < tutor!.step ? 'ok' : k === tutor!.step ? 'now' : ''}${adv && k === tutor!.step - 1 ? ' just' : ''}"></i>`).join('');
  if (adv) {
    m.classList.remove('adv');
    void m.offsetWidth;
    m.classList.add('adv');
  }
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
  setHints(guideLv >= 1 ? [] : (tutor.coach?.labels ?? st?.labels ?? []));
}
/** 되돌릴 수 없는 실수로 앞 단계로 돌아감: 낮은 소리 + 진동, 여러 번이면 미션 처음 상태로 */
function onRewind() {
  if (!tutor) return;
  sound.thump(0.5);
  buzz(40);
  if (tutor.wantReset) {
    const msg = tutor.notice;
    stuckN++;
    startLesson(lessonIdx, true, guideLv, false);
    tutor!.notice = `${msg ?? ''} (흙·자세를 처음으로)`.trim();
  }
  renderMission();
}
function onLessonClear() {
  // 실격 패널('다시!')이 떠 있으면 성공으로 치지 않는다 (둘이 같이 뜨면 안 된다)
  if (!$('fail').hidden) return;
  const L = tutor!.lesson;
  // 한 톤 배경은 성공 카드 뒤에서도 그대로 둔다 (장면·안개와 맞게). 다음 판(newSession)에서 지운다
  const done = new Set(loadCleared());
  done.add(L.id);
  save('exc-tut', JSON.stringify([...done]));
  // 최고 별점 (목록에 보인다)
  const g0 = L.grade?.(tutor!.s as never, tutor!.bag);
  if (g0) {
    const best = loadBest();
    if ((best[L.id] ?? 0) < g0.stars) {
      best[L.id] = g0.stars;
      save('exc-tut-best', JSON.stringify(best));
    }
  }
  renderMission();
  $('mission').hidden = true;
  for (const el of document.querySelectorAll('.lab')) el.classList.remove('hint');
  $('clear-title').innerHTML = `${ICON[L.icon]}${L.title}`;
  // 등급이 있는 미션만: 별 n개를 켜고 한 줄 평. 없으면 지금까지와 똑같이 별 세 개
  const g = L.grade?.(tutor!.s as never, tutor!.bag);
  const c0 = $('clear');
  const stars = [...document.querySelectorAll<HTMLElement>('.cl-stars i')];
  stars.forEach((el, k) => el.classList.toggle('off', !!g && k >= g.stars));
  $('clear-note').hidden = !g;
  // 못한 사람에게만 시범 다시 보기 (버튼이 이미 많다 — 늘 띄우면 고르기 어렵다)
  $('btn-clear-demo').hidden = !(tutor!.hasDemo && g && g.stars < 3);
  // 평가 한 문장 + 다음 행동(굵게) — 한 덩어리면 조언으로 안 읽힌다 (디자인 검토)
  const note = $('clear-note');
  note.textContent = '';
  const cut = (g?.note ?? '').search(/[.]\s/);
  if (g && cut > 0) {
    note.append(g.note.slice(0, cut + 1) + ' ');
    const tip = document.createElement('span');
    tip.className = 'tip';
    tip.textContent = g.note.slice(cut + 2);
    note.append(tip);
  } else note.textContent = g?.note ?? '';
  // 등급 없는 미션은 조용한 카드에서 별을 안 보인다 (큰 CLEAR는 지금처럼 별 셋)
  c0.classList.toggle('graded', !!g);
  // 과정의 끝: 목록 맨 끝, 또는 마무리 칸의 끝(그 뒤는 번외 기초교육) — 여기서 시험으로 잇는다
  const nextL = curLessons()[lessonIdx + 1];
  const last = !nextL || (L.tier === '마무리' && nextL.tier !== '마무리');
  const quizL = L.steps.some((st) => st.quiz);
  const retry = quizL && !!g && g.stars === 1;
  $('btn-clear-next').hidden = last || retry;
  $('btn-clear-exam').hidden = !last;
  $('btn-clear-free').hidden = !last;
  const again = $('btn-clear-again');
  again.textContent = quizL ? '↺ 다시 풀기' : '↺ 다시 연습';
  again.classList.toggle('big', retry);
  again.classList.toggle('go', retry);
  // 성공하면 안내를 한 단계 줄여 같은 미션 다시 (레버 안내 → 목표만 → 안내 없이). 퀴즈에는 뜻이 없다
  const less = $('btn-clear-less');
  less.hidden = guideLv >= 2 || quizL;
  less.textContent = guideLv === 0 ? '목표만 보고 다시' : '안내 없이 다시';
  streak++;
  const big = last && streak === 1;
  installPatterns();
  const c = $('clear');
  // 반복 연습 흐름이라 조용히, 마지막 미션 첫 성공만 크게 축하
  c.classList.toggle('quiet', !big);
  c.querySelector('.cl-word')!.textContent = quizL && g ? g.note.split('.')[0] : guideLv >= 2 ? '안내 없이 성공' : big ? 'CLEAR!' : streak > 1 ? `성공 ${streak}회` : '성공';
  if (quizL && g) note.textContent = g.note.slice(g.note.indexOf('.') + 1).trim();
  c.hidden = true;
  void c.offsetWidth;
  c.hidden = false;
  // 자동으로 다시 시작하지 않음: '반복'·'다음'·'목록' 중 사용자가 고름
  if (big) {
    sound.jingle();
    buzz([30, 40, 30, 40, 80]);
  } else {
    sound.ding();
    buzz(30);
  }
}
function onLessonFail(v: Violation) {
  if (!tutor || tutor.cleared) return;
  $('fail-detail').textContent = v.detail;
  $('mission').hidden = true;
  $('fail').hidden = false;
}
$('btn-clear-next').onclick = () => startLesson(lessonIdx + 1);
$('btn-clear-again').onclick = () => startLesson(lessonIdx, true, guideLv, false);
$('btn-clear-demo').onclick = () => startLesson(lessonIdx, true, guideLv, true);
$('btn-skip').onclick = () => {
  if (!tutor || tutor.cleared) return;
  sound.select();
  tutor.skipDemo();
  renderMission();
};
$('btn-demo').onclick = () => {
  if (lessonIdx < 0 || !tutor) return;
  sound.select();
  startLesson(lessonIdx, true, guideLv, true);
};
$('btn-clear-less').onclick = () => startLesson(lessonIdx, true, Math.min(2, guideLv + 1));
/** 시범 0.5배속 (켜 두면 다음 시범에도 유지 — 이 기기에만 기억) */
let demoSlow = (() => {
  try {
    return localStorage.getItem('exc-demo-slow') === '1';
  } catch {
    return false;
  }
})();
const paintSlow = () => {
  $('btn-slow').classList.toggle('on', demoSlow);
  $('btn-slow').setAttribute('aria-pressed', String(demoSlow));
};
paintSlow();
$('btn-slow').onclick = () => {
  demoSlow = !demoSlow;
  sound.select();
  paintSlow();
  try {
    localStorage.setItem('exc-demo-slow', demoSlow ? '1' : '0');
  } catch {
    /* 저장 못 해도 이번 판에는 그대로 */
  }
};
// 기초교육 고르기 문제: 보기를 누르면 맞았나·풀이를 보이고 '다음'
function renderQuiz() {
  const q = tutor?.current?.quiz;
  const box = $('dr-quiz');
  box.hidden = !q;
  // 문제 푸는 동안은 레버·게이지를 숨긴다 (보기·풀이와 겹치지 않게)
  document.body.classList.toggle('quiz-on', !!q);
  if (!q || !tutor) return;
  const qs = tutor.lesson.steps.filter((st) => st.quiz);
  $('dq-count').textContent = `${qs.findIndex((st) => st.quiz === q) + 1}/${qs.length}`;
  const picked = tutor.picked;
  const opts = $('dq-opts');
  opts.innerHTML = '';
  q.options.forEach((o, i) => {
    const b = document.createElement('button');
    b.textContent = o;
    b.disabled = picked !== null;
    if (picked !== null && i === q.answer) b.classList.add('right');
    if (picked !== null && i === picked && i !== q.answer) b.classList.add('wrong');
    b.onclick = () => {
      if (!tutor) return;
      const ok = tutor.answer(i);
      if (ok === null) return;
      if (ok) sound.select();
      renderQuiz();
    };
    opts.appendChild(b);
  });
  const ex = $('dq-explain');
  ex.hidden = picked === null;
  if (picked !== null) {
    const ok = picked === q.answer;
    ex.className = 'dq-explain ' + (ok ? 'ok' : 'no');
    ex.innerHTML = '';
    const head = document.createElement('b');
    head.textContent = ok ? '맞았어요' : '아쉬워요';
    ex.append(head, document.createTextNode(q.explain));
  }
  $('dq-next').hidden = picked === null;
}
$('dq-next').onclick = () => {
  if (!tutor?.current?.quiz) return;
  sound.select();
  tutor.nextQuiz();
  if (tutor.cleared) onLessonClear();
  else renderMission();
};
// 시범 뒤 고르기: 다시 보기 / 다음
const askPick = (again: boolean) => {
  if (!tutor?.current?.ask) return;
  sound.select();
  tutor.choose(again);
  if (tutor.cleared) onLessonClear();
  else renderMission();
};
$('btn-replay').onclick = () => askPick(true);
$('btn-ask-next').onclick = () => askPick(false);
// 배우기 중 '다시': 흙·자세까지 이 미션 처음 상태로
$('btn-restart').onclick = () => {
  if (lessonIdx < 0 || !tutor) return;
  sound.select();
  startLesson(lessonIdx, true, guideLv, false);
};
$('btn-clear-map').onclick = () => {
  $('clear').hidden = true;
  tutor = null;
  newSession();
  openLessonMap();
};
$('btn-clear-exam').onclick = () => {
  $('clear').hidden = true;
  tutor = null;
  // 시험 기준이 걸린 판으로. 잠겨 있으면 결제 벽이 뜬다
  if (needPay('practice')) return openPaywall('practice');
  modeKey = 'practice';
  save('exc-mode', modeKey);
  newSession();
};
$('btn-clear-free').onclick = () => {
  $('clear').hidden = true;
  tutor = null;
  modeKey = 'free';
  save('exc-mode', modeKey);
  newSession();
};
$('btn-fail-retry').onclick = () => {
  $('fail').hidden = true;
  startLesson(lessonIdx, false, guideLv);
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
sound.setMaster(volAll);
const wheelCtl = new SteeringWheel($('wheel-ctl'));
// 바퀴 보기: 누르면 왼쪽 앞바퀴를 내려다보고, 다시 누르면 앞을 봄
// 바퀴 보기·미러 보기는 하나만 (다시 누르면 앞을 봄)
function setLook(which: 'wheel' | 'mirror' | null) {
  if (!drive) return;
  drive.lookWheel = which === 'wheel';
  drive.lookMirror = which === 'mirror';
  $('btn-lookwheel').classList.toggle('on', drive.lookWheel);
  $('btn-lookmirror').classList.toggle('on', drive.lookMirror);
  $('btn-lookfront').classList.toggle('on', !which);
  sound.select();
}
$('btn-lookfront').onclick = () => setLook(null);
$('btn-lookwheel').onclick = () => setLook(drive?.lookWheel ? null : 'wheel');
$('btn-lookmirror').onclick = () => setLook(drive?.lookMirror ? null : 'mirror');
const pedalAccel = new Pedal($('pedal-accel'));
const pedalBrake = new Pedal($('pedal-brake'));
const left = new Joystick($('stick-l'));
const right = new Joystick($('stick-r'));
const keys = new Keys();
const pad = new Pad();
function renderPadUi() {
  $('pad-state').innerHTML = pad.name
    ? `<i class="pad-dot on"></i><b>${pad.name}</b> 연결됨`
    : '<i class="pad-dot"></i>연결된 패드 없음 · 블루투스로 연결하고 아무 버튼이나 누르세요';
}
pad.onChange = renderPadUi;
// 설정 > 조작키: 누르면 다음 키로 바꿈 (겹치면 맞바꿈, Esc 취소)
function renderKeys(wait?: string) {
  // 화면 조이스틱과 같은 십자 배치: [위, 왼쪽, 오른쪽, 아래]
  const pads: (typeof KEY_ACTIONS)[number]['id'][][] = [
    ['ly+', 'lx-', 'lx+', 'ly-'],
    ['ry+', 'rx-', 'rx+', 'ry-'],
  ];
  const pos = ['up', 'lt', 'rt', 'dn'];
  $('key-grid').innerHTML = pads
    .map(
      (ids) =>
        `<div class="key-pad"><i class="key-knob"></i>${ids
          .map((id, i) => {
            const a = KEY_ACTIONS.find((x) => x.id === id)!;
            return `<button class="keybtn ${pos[i]}${wait === id ? ' wait' : ''}" data-k="${id}"><b>${wait === id ? '?' : keyName(keys.map[id])}</b><small>${a.label}</small></button>`;
          })
          .join('')}</div>`,
    )
    .join('');
  for (const b of $('key-grid').querySelectorAll<HTMLElement>('[data-k]'))
    b.onclick = () => {
      const id = b.dataset.k as (typeof KEY_ACTIONS)[number]['id'];
      renderKeys(id);
      keys.rebind(id, () => renderKeys());
    };
}
renderKeys();
$('btn-keys-reset').onclick = () => {
  keys.cancelRebind();
  keys.reset();
  renderKeys();
};

async function goFullscreen() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (o?.lock) await o.lock('landscape');
  } catch {
    /* 아이폰 Safari 등 미지원: 홈 화면에 추가 안내 */
  }
}
const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = (navigator as Navigator & { standalone?: boolean }).standalone || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
if (isIOS && !standalone) $('fs-hint').hidden = false;
// ---------- 실제 시험: 시작 전 점검 → 손 들기 → 감독관 호각 ----------
/** 굴착: 출발 감독관은 왼쪽(문 창 너머), 장비 최대 반경(약 7.9m) 밖 안전한 곳 (반경 약 10m, B 통과구역 밖) */
const START_SPOT_DIG: [number, number] = [-4.0, 9.0];
/** 점검·손 들기 동안 운전석 시선이 감독관을 향함 (손 드는 걸 서로 봐야 하니까) */
let examLookAt: THREE.Vector3 | null = null;
const examTarget = () => (drive ? drive.s : session);
const starterIdx = () => (drive ? 0 : 3);
function syncExamCheck() {
  const t = examTarget();
  const set = (id: string, on: boolean, txt: string) => {
    $(id).classList.toggle('on', on);
    $(id).querySelector('small')!.textContent = txt;
  };
  set('ec-belt', t.belt, t.belt ? '체결' : '풀림');
  set('ec-lever', t.leverUnlocked, t.leverUnlocked ? '풀림' : '잠김');
  set('ec-rpm', t.rpm >= 0.6, t.rpm >= 0.6 ? '작업' : '저속');
}
function resetExamCheck() {
  const p = $('exam-check');
  p.hidden = true;
  p.classList.remove('working');
  $('hand-pop').hidden = true;
  examLookAt = null;
}
function openExamCheck() {
  const p = $('exam-check');
  p.classList.remove('working');
  p.hidden = false;
  syncExamCheck();
  // 출발 감독관이 나를 봄 (좌석 높이가 바뀌었을 수 있어 다시)
  if (examiners) {
    const eye = new THREE.Vector3();
    (drive ? drive.exc : exc).eyeWorld(eye, eyeOffset());
    examiners.face(starterIdx(), eye);
    examLookAt = examiners.headOf(starterIdx(), new THREE.Vector3());
  }
}
$('ec-belt').onclick = () => {
  const t = examTarget();
  t.belt = !t.belt;
  sound.select();
  syncExamCheck();
};
$('ec-lever').onclick = () => {
  const t = examTarget();
  t.leverUnlocked = !t.leverUnlocked;
  sound.select();
  syncExamCheck();
};
$('ec-rpm').onclick = () => {
  const t = examTarget();
  t.rpm = t.rpm >= 0.6 ? 0.3 : 0.8;
  sound.select();
  syncExamCheck();
};
$('ec-hand').onclick = () => {
  const p = $('exam-check');
  if (p.classList.contains('working')) return;
  // 배우기 시작 점검: 손을 들면 신호만 (감독관·호각 없이 다음 단계로)
  if (tutor?.lesson.check) {
    const h = $('hand-pop');
    h.hidden = true;
    void h.offsetWidth;
    h.hidden = false;
    setTimeout(() => (h.hidden = true), 1500);
    sound.select();
    session.signaled = true;
    return;
  }
  p.classList.add('working');
  const h = $('hand-pop');
  h.hidden = true;
  void h.offsetWidth;
  h.hidden = false;
  setTimeout(() => (h.hidden = true), 1500);
  // 감독관: 손 든 것을 보고 팔을 들며 호각 → 시작. 그다음 선회 반경 밖으로 물러남
  const i = starterIdx();
  setTimeout(() => examiners?.signal(i), 450);
  setTimeout(beginWork, 650);
  // 호각을 듣고 시선을 작업 쪽으로
  setTimeout(() => (examLookAt = null), 1100);
  setTimeout(() => {
    examiners?.lower(i);
    examiners?.watchPoint(i, null);
  }, 1900);
};
function beginWork() {
  setTimeout(() => sound.whistle('start'), 300);
  if (drive) drive.s.ready();
  else session.ready();
  const f = $('ready-flash');
  f.hidden = false;
  setTimeout(() => (f.hidden = true), 1100);
}
function startMode() {
  tutorLook = false;
  if (session.flags.key === 'tutorial') return openLessonMap();
  if (needPay(session.flags.key)) return openPaywall(session.flags.key);
  if (matchMedia('(pointer: coarse)').matches) goFullscreen();
  sound.start(); // 휴대폰은 화면을 누른 순간에만 소리를 켤 수 있음
  $('precheck').hidden = true;
  const k = session.flags.key;
  if (k === 'free') return beginWork();
  // 등장 연출: 연습 시험(긴장) / 실제 시험(최고 긴장)
  const boss = k === 'exam';
  const bi = $('boss-intro');
  bi.className = boss ? 'boss' : 'mid';
  $('bi-tag').hidden = true; // 작은 부제 없이 모드 이름만
  $('bi-title').textContent = MODE_INFO[k].label;
  const lim = drive ? '2:00' : '4:00';
  $('bi-sub').textContent = boss ? `${lim} · 실격하면 끝` : lim;
  // 애니메이션을 처음부터 다시 재생
  bi.hidden = true;
  void bi.offsetWidth;
  bi.hidden = false;
  sound.bossIntro(boss);
  if (boss) buzz([60, 120, 200]);
  setTimeout(() => {
    bi.hidden = true;
    if (boss) openExamCheck();
    else beginWork();
  }, boss ? 2400 : 1600);
}
$('btn-engine').onclick = () => session.restartEngine();
// 그만하기: 실수로 끝나지 않게 길게 눌러야(0.6초) 작동
{
  const end = $('btn-end');
  let holdT = 0;
  let tipT = 0;
  const cancel = () => {
    clearTimeout(holdT);
    // 다 누르기 전에 뗐으면 길게 누르라고 알려줌
    if (end.classList.contains('holding')) {
      const box = end.parentElement!;
      box.classList.add('end-tip');
      clearTimeout(tipT);
      tipT = window.setTimeout(() => box.classList.remove('end-tip'), 1500);
    }
    end.classList.remove('holding');
  };
  end.onpointerdown = (e) => {
    e.preventDefault();
    // 배우기 '목록'은 이동 버튼: 바로
    if (session.flags.key === 'tutorial') return drive ? drive.s.abandon() : session.abandon();
    end.parentElement!.classList.remove('end-tip');
    end.classList.add('holding');
    holdT = window.setTimeout(() => {
      end.classList.remove('holding');
      if (drive) drive.s.abandon();
      else session.abandon();
    }, 600);
  };
  end.onpointerup = end.onpointerleave = end.onpointercancel = cancel;
}
$('btn-settings').innerHTML = ICON.gear;
// 레버 글자 켜고 끄기 (배우기에서 반짝이는 글자는 꺼도 보임)
let labelsOn = load('exc-labels') !== '0';
const syncLabels = () => {
  document.body.classList.toggle('labels-off', !labelsOn);
  const b = $('btn-labels');
  b.innerHTML = `${ICON.tag}<i class="sw"></i>`;
  b.title = labelsOn ? '레버 이름 끄기' : '레버 이름 켜기';
  b.classList.toggle('off', !labelsOn);
};
$('btn-labels').onclick = () => {
  labelsOn = !labelsOn;
  save('exc-labels', labelsOn ? '1' : '0');
  syncLabels();
};
syncLabels();
$('btn-paywall-close').innerHTML = ICON.close;
// 시작 페이지 종목 탭: 굴착 · 주행
{
  const KIND: Record<string, [keyof typeof ICON, string]> = { dig: ['stScoop', '굴착 작업'], drive: ['kDrive', '코스 주행'] };
  // 첫 방문 1회: 고르지 않은 과목에 살짝 빛 지나감 (다른 과목도 있다는 힌트)
  const hintKind = !load('exc-kind-hint') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (hintKind) save('exc-kind-hint', '1');
  for (const b of document.querySelectorAll<HTMLButtonElement>('#sp-kind [data-kind]')) {
    const [ic, name] = KIND[b.dataset.kind!];
    b.innerHTML = `${ICON[ic]}<span>${name}</span>`;
    const k = b.dataset.kind;
    if (k === 'dig' || k === 'drive') {
      b.classList.toggle('on', k === kindKey);
      b.setAttribute('aria-pressed', String(k === kindKey));
      if (hintKind && k !== kindKey) {
        b.classList.add('hint');
        b.addEventListener('animationend', () => b.classList.remove('hint'), { once: true });
      }
      b.onclick = () => {
        document.querySelector('#sp-kind .hint')?.classList.remove('hint');
        if (kindKey === k) return;
        kindKey = k;
        save('exc-kind', k);
        for (const o of document.querySelectorAll<HTMLElement>('#sp-kind [data-kind]')) {
          o.classList.toggle('on', o.dataset.kind === k);
          o.setAttribute('aria-pressed', String(o.dataset.kind === k));
        }
        sound.start();
        sound.select();
        newSession();
      };
    } else if (b.classList.contains('soon'))
      b.onclick = () => {
        b.classList.remove('say');
        void b.offsetWidth;
        b.classList.add('say');
      };
  }
}
// 가격 (임시 값: 실제 가격이 정해지면 여기만 바꿈)
const PRICE = 9900;
$('btn-buy').textContent = `${PRICE.toLocaleString('ko-KR')}원 평생 이용하기`;
// TODO: 결제 연동 (앱스토어 인앱결제 또는 웹 결제). 지금은 테스트: 누르면 결제된 것으로 1판 이용
$('btn-buy').onclick = () => {
  $('paywall').hidden = true;
  if (!payFor) return;
  testPass = payFor;
  if (modeKey !== payFor) {
    modeKey = payFor;
    save('exc-mode', modeKey);
    newSession();
  }
  payFor = null;
  // 결제 완료 표시 → 바로 시작
  sound.start();
  sound.jingle();
  const pd = $('paid');
  pd.hidden = false;
  setTimeout(() => {
    pd.hidden = true;
    startMode();
  }, 900);
};
// 구매 복원: 계정 없이 구매 코드로. (TODO: redeem()에 서명 키 검증 붙이기)
$('btn-restore').onclick = () => {
  const box = $('redeem');
  box.hidden = !box.hidden;
  if (!box.hidden) $<HTMLInputElement>('redeem-input').focus();
};
$('btn-redeem').onclick = () => {
  const msg = $('redeem-msg');
  msg.hidden = false;
  msg.textContent = redeem($<HTMLInputElement>('redeem-input').value.trim()) ? '이용권이 살아났어요' : '코드를 확인할 수 없어요';
};
$('paid-ico').innerHTML = ICON.check;
$('fail-retry-ico').innerHTML = ICON.retry;
$('pw-perks').innerHTML = ['큐넷 공개문제 그대로 — 굴착 4분 · 주행 2분', '실격 규칙을 그대로 걸고 판', '끝나면 채점표 — 뭘 고쳐야 하는지'].map((t) => `<li>${ICON.check}${t}</li>`).join('');
$('btn-settings2').innerHTML = ICON.gear;
$('btn-near').innerHTML = `${ICON.pin} 가까운 곳`;
$('btn-retry').onclick = () => {
  newSession();
  startMode();
};
$('btn-home').onclick = () => newSession();

/** 사용자에게 보일 규칙 이름: 채점 기준 번호·[해석] 같은 내부 표기를 뺀다 */
const plainTitle = (t: string) => t.replace(/\[[^\]]*\]\s*/g, '').trim();
function showToast(v: Violation) {
  // 배우기에서 시킨 동작이 낸 경고는 띄우지 않는다 (억울하지 않게)
  if (tutor?.current?.quiet?.includes(v.id)) return;
  // 레버 익히기: 실격으로 끝내지 않고 주의로만 알림
  const soft = !!tutor?.lesson.noFail;
  if (v.kind === 'disqualify' && session.flags.key === 'exam') return; // 실제 시험: 감독관 연출이 알림
  if (v.kind === 'disqualify' && !soft) sound.whistle('fail');
  // 레버 익히기: 실격 대신 주의지만 소리는 냄 (낮은 쿵)
  else if (v.kind === 'disqualify') sound.thump(0.5);
  if (v.id === 'W-JOLT' || v.id === 'W-IMPACT') sound.thump(0.8);
  if (v.kind === 'warning' && !session.flags.feedback) return; // 실제 시험: 경고 알림 없음
  const el = document.createElement('div');
  const dq = v.kind === 'disqualify' && !soft;
  el.className = 'toast' + (dq ? '' : ' warn');
  el.innerHTML = `<b>${v.kind === 'disqualify' ? '실격' : '주의'}</b>${v.detail}`;
  const box = $('toasts');
  box.prepend(el);
  while (box.children.length > 3) box.lastElementChild!.remove();
  setTimeout(() => el.remove(), 3500);
  if (dq) buzz(120);
  else if (v.id === 'W-JOLT' && performance.now() - lastBuzz > 400) {
    lastBuzz = performance.now();
    buzz([40, 30, 25]); // 덜컹
  }
}

/**
 * 알림을 처음 띄울 때만 굵은 글씨·흔들림 효과·대체 글꼴(ⓓ 같은 기호) 준비로 한 프레임이 크게 끊긴다 (CPU 6배 저속에서 90~150ms, 두 번째부터 20ms).
 * 흙을 싣고 처음 선회할 때 '끝까지 담김' 알림과 겹쳐 끊겨 보였음 → 시작 화면(조작 전)에서 안 보이게 한 번 그려 둔다
 */
/**
 * 셰이더 미리 컴파일: 처음엔 숨겨져 있던 물체(버킷 속 흙, 날 앞 흙더미 등)의 셰이더 프로그램을 시작 때 만들어 둠.
 * three의 compile은 보이는 물체만 다루므로 잠깐 다 보이게 해서 컴파일.
 * (그래픽 드라이버 쪽 마무리 준비는 실제로 픽셀을 칠할 때라, 첫 흙 끊김의 원인이던 흙덩이는 ExcavatorView.warmClumps로 따로 예열)
 */
/** 예열할 시각 (performance.now 기준, 0 = 끝남) */
let warmPending = 0;
/** 흙 알갱이·먼지 예열 시각: 흙덩이와 같은 프레임에 그리면 흙덩이 예열이 실패해서(측정 3/3) 0.4초 늦춤 */
let warmFxPending = 0;
const warmV = new THREE.Vector3();
const warmSide = new THREE.Vector3();
/**
 * 흙덩이·흙 알갱이·먼지를 카메라 바로 앞에 몇 프레임 실제로 그려 그래픽 드라이버 준비를 미리 끝냄
 * (처음 흙이 들어오는·쏟는 순간 끊기던 것: 트레이스상 GPU 쪽 화면 내보내기 70~100ms. 화면에 실제로 칠해져야 준비되므로 카메라 앞 2.5m)
 */
function warmEffects() {
  const now = performance.now();
  const clumps = warmPending > 0 && now >= warmPending;
  const fxs = warmFxPending > 0 && now >= warmFxPending;
  if (!clumps && !fxs) return;
  camera.getWorldDirection(warmV);
  warmV.multiplyScalar(2.5).add(camera.position);
  // 서로 가리지 않게 좌우로 떼어 놓음
  warmSide.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(0.4);
  if (clumps) {
    warmPending = 0;
    exc.warmClumps(warmV.clone().add(warmSide));
  }
  if (fxs) {
    warmFxPending = 0;
    fx.warm(warmV.sub(warmSide));
  }
}
function warmShaders() {
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  renderer.compile(scene, camera);
  for (const o of hidden) o.visible = false;
}

let toastsWarm = false;
function warmToasts() {
  if (toastsWarm) return;
  toastsWarm = true;
  const box = $('toasts');
  const els = ['toast', 'toast warn', 'toast entry good', 'toast entry ok', 'toast entry bad'].map((c) => {
    const el = document.createElement('div');
    el.className = c;
    el.style.opacity = '0.01';
    // 기본 글꼴에 없는 기호(ⓐ~ⓕ·①~④·㎥ 등)는 처음 쓸 때 대체 글꼴을 찾느라 더 오래 걸려 같이 그려 둠
    el.innerHTML = '<b>실격 · 주의 · 끝까지 담김 85% 👍 Q11</b>위치 앞뒤 좌우 정확 · 장비 쪽 12cm · 흙을 흘림 ⓐⓑⓒⓓⓔⓕ ①②③④ ㎥ ° ± × … ← ↑ → ↓ ▶ ◀ ○ ◎ ✓ ✗ △';
    box.append(el);
    return el;
  });
  // 두 프레임 그린 뒤 지움 (그려져야 글자·효과가 준비됨)
  requestAnimationFrame(() => requestAnimationFrame(() => els.forEach((el) => el.remove())));
}

/** 첫 삽 위치 피드백: 목표(ⓑ선 안쪽 30cm, 중심) 대비 앞뒤·좌우 */
function showEntry(e: DigEntry) {
  if (!session.flags.feedback) return;
  // 가운데 글자로 가르치는 미션에서는 이 토스트가 끼어들면 안 된다 (지시와 경쟁한다)
  if (tutor?.lesson.big) return;
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
    // 자유 연습: 시간 제한 없음
    const a = Math.floor(s.t);
    tm.textContent = `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
    tm.className = 'timer';
  }
  const free = s.flags.key === 'free';
  $('dig').textContent = free ? `${s.digCount}회` : `${s.digCount}/${s.params.minDigCount}`;
  $('chip-dig').classList.toggle('done', !free && s.digCount >= s.params.minDigCount);
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
  // 숫자는 평적 기준 (게이지 눈금 = 평적 100%, 끝 = 고봉)
  const pct = `평적 ${Math.round((s.load / s.m.struckCapacity) * 100)}%`;
  if (loadPct.textContent !== pct) loadPct.textContent = pct;
  const gd = $('guide');
  gd.textContent = s.flags.guide ? s.guide() : '';
  gd.hidden = !gd.textContent;
  $('btn-engine').hidden = s.engineOn;
  const ring = $('endring');
  const p = s.endProgress;
  ring.style.opacity = p > 0 && s.flags.feedback ? '1' : '0';
  ring.style.borderColor = `rgba(47,210,122,${0.3 + p * 0.7})`;
  ring.style.transform = `scale(${1 + p * 0.3})`;
}

function playDq(v: Violation, done: () => void) {
  const ex = examiners!;
  const timeUp = v.id === 'D-TIME';
  $('dq-why').textContent = timeUp ? '시간 초과' : v.title;
  const banner = $('dq-banner');
  banner.hidden = true;
  void banner.offsetWidth;
  banner.hidden = false;
  // 1) 실격 자리를 비스듬히 위에서
  const look = new THREE.Vector3();
  const pos = new THREE.Vector3();
  let wait = 0;
  if (v.at && !timeUp) {
    look.set(v.at.x, Math.max(0.3, v.at.y), v.at.z);
    const out = new THREE.Vector3(v.at.x, 0, v.at.z).normalize();
    const side = new THREE.Vector3(-out.z, 0, out.x);
    pos.copy(look).addScaledVector(out, 3.2).addScaledVector(side, 2.6).setY(look.y + 2.4);
    cine = { pos, look };
    wait = 1700;
  }
  // 2) 가장 가까운 감독관이 팔을 들고 호각 (시간 초과는 시간 감독관이 초시계를 들고)
  setTimeout(() => {
    const i = timeUp ? ex.timer : ex.nearest(v.at ?? { x: 0, z: 0 });
    ex.signal(i, timeUp);
    const head = ex.headOf(i, new THREE.Vector3());
    const toMachine = new THREE.Vector3(-head.x, 0, -head.z).normalize();
    const side = new THREE.Vector3(-toMachine.z, 0, toMachine.x);
    cine = { pos: head.clone().addScaledVector(toMachine, 3.2).addScaledVector(side, 1.2).setY(1.9), look: head.clone().setY(1.55) };
    sound.whistle(timeUp ? 'time' : 'fail');
    buzz(timeUp ? [400] : [120, 80, 120]);
    setTimeout(() => {
      banner.hidden = true;
      done();
    }, 2200);
  }, wait);
}

/** 결과 '다음엔 이렇게': 가장 큰 문제 하나를 고칠 행동으로 */
function renderTip(dq: { id: string; title: string }[], verdict: Score | null, abandoned: boolean, mode: ModeKey) {
  const box = $('res-tip');
  // 실제 시험은 기록을 알려주지 않으니 합격이면 실격 이유만, 감점으로 떨어졌을 땐 가장 큰 감점 하나만
  const t = abandoned ? null : fixTip(kindKey, dq, mode === 'exam' && verdict?.pass ? null : verdict);
  box.hidden = !t;
  if (!t) return;
  box.innerHTML = `<div class="rt-text"><small>다음엔 이렇게</small><b></b></div>`;
  box.querySelector('b')!.textContent = t.tip;
}
/** 한 판 끝냈다. 연습은 많이 할수록 좋으니 막지 않고 쌓아서 보여준다 */
function showRuns() {
  const runs = bumpRuns(todayKey());
  const el = $('res-runs');
  el.hidden = false;
  el.textContent = runs.today > 1 ? `연습 ${runs.total}판째 · 오늘 ${runs.today}판` : `연습 ${runs.total}판째`;
}

function showResult() {
  const s = session;
  if (s.flags.key === 'tutorial') {
    // 배우기: 결과표 대신 미션 판정(마무리 미션은 종료가 곧 성공), 그만하기는 스테이지 맵으로
    if (tutor && !s.abandoned) return;
    clearTimeout(againTimer);
    $('clear').hidden = true;
    tutor = null;
    newSession();
    openLessonMap();
    return;
  }
  // 실제 시험 실격: 실격 자리 → 감독관 호각 → 결과
  if (dqPlaying) return;
  if (testPass === s.flags.key) testPass = null; // 테스트 이용권 1판 소진
  if (s.flags.key === 'exam' && s.endedByRule && !s.abandoned && examiners && !dqShown) {
    dqShown = true;
    dqPlaying = true;
    playDq(s.endedByRule, () => {
      dqPlaying = false;
      showResult();
    });
    return;
  }
  const r = s.result();
  showRuns();
  showRuns();
  const sum = s.engine.summary();
  const dq = sum.filter((x) => x.kind === 'disqualify');
  const warn = sum.filter((x) => x.kind === 'warning');
  const stamp = $('stamp');
  stamp.className = 'stamp ' + (dq.length || s.abandoned ? 'fail' : 'pass');
  const mode = s.flags.key;
  // ----- 도장: 합격 / 불합격 (자유 연습은 실격) · 기권 -----
  stamp.textContent = s.abandoned ? (mode === 'exam' ? '기권' : '종료') : dq.length ? (mode === 'free' ? '실격' : '불합격') : '합격';
  stamp.hidden = mode === 'free' && !dq.length;
  // 제목은 모드, 판정은 도장 (같은 말 두 번 안 함)
  $('res-title').textContent = MODE_INFO[mode].label;
  installPatterns();
  const clean = mode !== 'free' && !s.abandoned && !dq.length;
  const card = $('result').querySelector('.card')!;
  card.className = `card wide res ${MODE_INFO[mode].cls}${clean ? ' clean' : ''}`;
  // ----- 등급·합격 판정 (src/sim/score.ts): 화면엔 등급 S·A·B·C·F와 ◎○△✗만 -----
  const verdict: Score | null = mode === 'free' ? null : scoreDig(r, { dq: dq.length > 0, abandoned: s.abandoned, mode });
  const passed = mode !== 'free' && !s.abandoned && (verdict ? verdict.pass : !dq.length);
  if (mode !== 'free' && !s.abandoned) {
    stamp.textContent = passed ? '합격' : '불합격';
    stamp.className = 'stamp ' + (passed ? 'pass' : 'fail');
  }
  card.classList.toggle('clean', passed);
  renderScore($('res-score'), mode === 'free' ? null : verdict, mode === 'free');
  renderTip(dq, verdict, s.abandoned, mode);
  const dqList = $('res-dq');
  dqList.innerHTML =
    (dq.length
      ? dq.map((d) => `<li class="dq"><b>${plainTitle(d.title)}</b>${d.count > 1 ? `<small>${d.count}회</small>` : ''}</li>`).join('')
      : s.abandoned && mode === 'exam'
        ? '' // 기권은 도장으로 이미 알림
        : '<li class="ok"><b>실격 없음</b></li>') +
    '';
  if (mode === 'exam') dqList.innerHTML += precheckLi(s.precheck);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const cmOf = (v: number) => `${Math.round(v * 100)}cm`;
  const fl = r.flattenVol > 0 ? r.flatness : null; // 평탄작업을 안 했으면 표시 안 함
  const load = avg(r.loadRatios);
  const dr = avg(r.entries.map((e) => Math.abs(e.dr)));
  const dl = avg(r.entries.map((e) => Math.abs(e.dl)));
  const pack = avg(r.packRatios);
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
  // 큰 숫자 3개 (아케이드 결과판): [이름, 값, 문제 있음]
  const hero: [string, string, boolean][] = [
    ['굴착', mode === 'free' ? `${r.digCount}회` : `${r.digCount}/4`, mode !== 'free' && r.digCount < 4],
    ['흙량', r.loadRatios.length ? pct(load) : '-', r.loadRatios.length > 0 && load < 0.8],
    ['시간', mmss(r.elapsed), mode !== 'free' && r.elapsed > 240],
  ];
  $('res-hero').innerHTML = hero.filter(([, v]) => v !== '-').map(([k, v, bad]) => `<div class="hero-tile${bad ? ' bad' : ''}"><span>${k}</span><b>${v}</b></div>`).join('');
  // 자세히 (접힘): [항목, 값, 문제 있음]
  const items: [string, string, boolean][] = [
    ['덤프', `${r.dumpCount}회`, false],
    ['최저 흙량', r.loadRatios.length ? pct(Math.min(...r.loadRatios)) : '-', r.loadRatios.length > 0 && Math.min(...r.loadRatios) < 0.8],
    ['위치 오차 앞뒤 · 좌우', r.entries.length ? `${cmOf(dr)} · ${cmOf(dl)}` : '-', dr > 0.15 || dl > 0.15],
    ['안쪽까지 담김', r.packRatios.length ? pct(pack) : '-', r.packRatios.length > 0 && pack < 0.6],
    ['운반 중 흘림', `${Math.round(r.carrySpill * 1000)}L`, r.carrySpill > 0.02],
    ['평탄 편차', fl ? cmOf(fl.meanDev) : '-', !!fl && fl.meanDev > 0.1],
    ['이빨로 밀어 평탄', r.flattenOpenRatio > 0 || fl ? pct(r.flattenOpenRatio) : '-', !!fl && r.flattenOpenRatio < 0.5],
    ['충격 · 덜컹', `${r.impacts} · ${r.jolts}회`, r.impacts + r.jolts > 0],
  ];
  // 실제 시험: 실제처럼 시간·흙량 같은 기록은 알려주지 않음 (실격 판정만)
  $('res-cols').classList.toggle('dq-only', mode === 'exam');
  // 스크롤 없게: 펼침 목록 대신 고칠 것만 칩으로 (자유 연습은 없음)
  const bad = mode === 'practice' ? items.filter((x) => x[2]) : [];
  // 주의(경고)도 칩으로 합침
  const chips = [...(mode === 'practice' ? warn.map((w) => [w.title, `${w.count}회`]) : []), ...bad.map(([k, v]) => [k, v])];
  $('res-checks').innerHTML = chips.map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('');
  $('res-cols').classList.toggle('single', mode !== 'exam' && !dq.length);
  $('res-cols').hidden = mode === 'exam' && !dq.length && s.abandoned;
  // ----- 합격이면 합격 연출 뒤 결과표가 밀려 들어옴 (src/ui/passFx.ts) -----
  $('result').classList.toggle('after-pass', passed);
  if (passed)
    playPass(
      { perfect: !!verdict && verdict.items.every((it) => it.got >= it.max), exam: mode === 'exam' },
      () => {
        sound.stamp();
        sound.jingle();
        buzz([40, 60, 80]);
      },
      () => ($('result').hidden = false),
    );
  else setTimeout(() => ($('result').hidden = false), 600);
  // 도장이 쾅 찍히는 순간 (CSS 지연과 맞춤)
  if (!stamp.hidden && !passed)
    setTimeout(() => {
      sound.stamp();
      if (clean) sound.jingle();
      buzz(40);
    }, 600 + 350);
}

/** 실제 시험 시작 전 점검 결과 한 줄 (안 한 것은 빨갛게) */
function precheckLi(pc: { belt: boolean; lever: boolean; rpm: boolean }) {
  const it = (ok: boolean, t: string) => `<span class="${ok ? 'pc-ok' : 'pc-bad'}">${ok ? '✓' : '✗'} ${t}</span>`;
  return `<li class="pc">${it(pc.belt, '안전벨트')}${it(pc.lever, '안전레버')}${it(pc.rpm, 'RPM')}</li>`;
}
/** 주행 결과: 실격 판정 + 과제 시간 · 정지 · 주차 */
function showDriveResult() {
  const d = drive;
  if (!d) return;
  const s = d.s;
  const mode = s.flags.key;
  if (testPass === mode) testPass = null;
  if (mode === 'tutorial') {
    // 배우기: 미션 판정이 맡음. 그만하기(목록)면 스테이지 맵으로
    if (s.abandoned) {
      clearTimeout(againTimer);
      $('clear').hidden = true;
      tutor = null;
      newSession();
      openLessonMap();
    }
    return;
  }
  const sum = s.engine.summary();
  const dq = sum.filter((x) => x.kind === 'disqualify');
  const warn = sum.filter((x) => x.kind === 'warning');
  const stamp = $('stamp');
  stamp.className = 'stamp ' + (dq.length || s.abandoned ? 'fail' : 'pass');
  // ----- 도장: 합격 / 불합격 (자유 연습은 실격) · 기권 -----
  stamp.textContent = s.abandoned ? (mode === 'exam' ? '기권' : '종료') : dq.length ? (mode === 'free' ? '실격' : '불합격') : '합격';
  stamp.hidden = mode === 'free' && !dq.length;
  $('res-title').textContent = `코스운전 · ${MODE_INFO[mode].label}`;
  installPatterns();
  const clean = mode !== 'free' && !s.abandoned && !dq.length;
  const card = $('result').querySelector('.card')!;
  card.className = `card wide res ${MODE_INFO[mode].cls}${clean ? ' clean' : ''}`;
  // ----- 등급·합격 판정 (src/sim/score.ts): 화면엔 등급 S·A·B·C·F와 ◎○△✗만 -----
  const verdict: Score | null = mode === 'free' ? null : scoreDrive(s);
  const passed = mode !== 'free' && !s.abandoned && (verdict ? verdict.pass : !dq.length);
  if (mode !== 'free' && !s.abandoned) {
    stamp.textContent = passed ? '합격' : '불합격';
    stamp.className = 'stamp ' + (passed ? 'pass' : 'fail');
  }
  card.classList.toggle('clean', passed);
  renderScore($('res-score'), mode === 'free' ? null : verdict, mode === 'free');
  renderTip(dq, verdict, s.abandoned, mode);
  $('res-dq').innerHTML = dq.length
    ? dq.map((x) => `<li class="dq"><b>${plainTitle(x.title)}</b>${x.count > 1 ? `<small>${x.count}회</small>` : ''}</li>`).join('')
    : s.abandoned && mode === 'exam'
      ? ''
      : '<li class="ok"><b>실격 없음</b></li>';
  if (mode === 'exam') $('res-dq').innerHTML += precheckLi(s.precheck);
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
  const hero: [string, string, boolean][] = [
    ['시간', s.stage === 'READY' ? '-' : mmss(s.taskT), s.taskT > s.p.timeLimit],
    ['정지선', s.stopped ? '정지' : '-', !s.stopped],
    ['주차', s.parkedOk === null ? '-' : s.parkedOk ? '구역 안' : '구역 밖', s.parkedOk === false],
  ];
  $('res-hero').innerHTML = hero.filter(([, v]) => v !== '-').map(([k, v, bad]) => `<div class="hero-tile${bad ? ' bad' : ''}"><span>${k}</span><b>${v}</b></div>`).join('');
  $('res-cols').classList.toggle('dq-only', mode === 'exam');
  $('res-checks').innerHTML = mode === 'practice' ? warn.map((w) => `<span>${w.title} <b>${w.count}회</b></span>`).join('') : '';
  $('res-cols').classList.toggle('single', mode !== 'exam' && !dq.length);
  $('res-cols').hidden = mode === 'exam' && !dq.length && s.abandoned;
  // ----- 합격이면 합격 연출 뒤 결과표가 밀려 들어옴 (src/ui/passFx.ts) -----
  $('result').classList.toggle('after-pass', passed);
  if (passed)
    playPass(
      { perfect: !!verdict && verdict.items.every((it) => it.got >= it.max), exam: mode === 'exam' },
      () => {
        sound.stamp();
        sound.jingle();
        buzz([40, 60, 80]);
      },
      () => ($('result').hidden = false),
    );
  else setTimeout(() => ($('result').hidden = false), 600);
  // 도장이 쾅 찍히는 순간 (CSS 지연과 맞춤)
  if (!stamp.hidden && !passed)
    setTimeout(() => {
      sound.stamp();
      if (clean) sound.jingle();
      buzz(40);
    }, 600 + 350);
}

// ---------- 루프 (고정 60Hz 시뮬레이션) ----------
const STEP = 1 / 60;
let acc = 0;
/** 시범 지시문 읽는 시간이 몇 초 남았나 (그동안 시범을 세워 둔다) */
let readLeft = 0;
let readStep = -1;
/** 두 줄 지시문을 읽는 시간: 한국어 초당 5~6자 + 눈을 옮기는 시간 */
const readSec = (t: string) => Math.min(2.2, Math.max(0.9, 0.4 + t.replace(/\s/g, '').length * 0.06));
let last = performance.now();
let frameAvg = 16;
let slowT = 0;
const perf = $('perf');
perf.hidden = !debug;

/** 운전하지 않는 화면은 덜 자주 그림 (발열·배터리): 시작 무대 30fps, 결과·목록 등 창이 떠 있으면 20fps */
let lastDraw = 0;
function frame(now: number) {
  const cap = opening ? 0 : !$('precheck').hidden ? 30 : operating() ? 0 : 20;
  if (cap && now - lastDraw < 1000 / cap - 3) {
    requestAnimationFrame(frame);
    return;
  }
  lastDraw = now;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // 해상도 자동 낮춤은 운전 화면 속도로만 판단 (일부러 덜 그리는 화면은 빼고)
  if (!cap) frameAvg = frameAvg * 0.95 + dt * 1000 * 0.05;
  // ----- 오프닝 중에는 게임 대신 오프닝만 그림 (src/ui/intro.ts) -----
  if (opening?.frame(dt)) {
    sound.rest();
    requestAnimationFrame(frame);
    return;
  }
  // ----- 시작 페이지가 열려 있으면 3D 무대만 그림 (src/ui/startStage.ts) -----
  if (startStage.frame(dt, kindKey)) {
    sound.rest();
    requestAnimationFrame(frame);
    return;
  }
  // 키보드는 켜짐/꺼짐뿐이라 서서히 오르내리게 (초당 4: 갑자기 떼면 약하게 덜컹)
  const ramp = (cur: number, target: number) => cur + Math.max(-dt * 4, Math.min(dt * 4, target - cur));
  pad.poll();
  kb.lx = ramp(kb.lx, keys.lx);
  kb.ly = ramp(kb.ly, keys.ly);
  kb.rx = ramp(kb.rx, keys.rx);
  kb.ry = ramp(kb.ry, keys.ry);
  const userInput = {
    lx: curveSwing(clamp1(left.x + kb.lx + pad.lx)),
    ly: curve(clamp1(left.y + kb.ly + pad.ly)),
    rx: curve(clamp1(right.x + kb.rx + pad.rx)),
    ry: curve(clamp1(right.y + kb.ry + pad.ry)),
  };
  // 앱이 레버를 대신 미는 시범(tutor.drive)과 단계 판정(tutor.update)은 **시뮬 한 스텝마다** 부른다 (아래 반복문).
  // 화면 프레임마다 부르면 30fps 폰에서는 시범 한 프레임에 시뮬이 두 번 돌아 시범이 버킷을 땅에 박고,
  // 120Hz 폰에서는 '멈춰 있음' 카운터가 끊겨 안내가 안 뜬다 (개발 검토, 2026-11-16).
  // 0.5배속은 시뮬 시간만 절반으로 흘린다 — 시범도 스텝에 묶여 있으니 같이 느려진다
  const slowNow = !drive && demoSlow && !!tutor && tutor.demoState() === 'demo';
  if (!tutor) session.input = userInput;
  // 시범 중에 손을 댔나 (입력은 무시되지만 **대답은 해야 한다**)
  userPush = Math.max(
    Math.hypot(left.x + kb.lx + pad.lx, left.y + kb.ly + pad.ly),
    Math.hypot(right.x + kb.rx + pad.rx, right.y + kb.ry + pad.ry),
  );
  // 손이 실제로 민 자리 (커브 전). 레버를 12시→3시로 옮기는 손놀림을 볼 때 쓴다
  session.stick = {
    lx: clamp1(left.x + kb.lx + pad.lx),
    ly: clamp1(left.y + kb.ly + pad.ly),
    rx: clamp1(right.x + kb.rx + pad.rx),
    ry: clamp1(right.y + kb.ry + pad.ry),
  };
  const demo = tutor?.demoState() ?? 'user';
  document.body.classList.toggle('demo', demo !== 'user');
  if (demo !== 'user') {
    // 시범 값은 기계에 들어가는 값(곡선 뒤)이다. 손이 둘 레버 자리(곡선 앞)로 되돌려 그린다 —
    // 그래야 노브가 길잡이 고리·점과 같은 자리에 온다
    left.show(uncurve(session.input.lx, 3), uncurve(session.input.ly));
    right.show(uncurve(session.input.rx), uncurve(session.input.ry));
  } else {
    left.unshow();
    right.unshow();
  }
  if (drive) {
    driveFrame(dt, now);
    return;
  }
  acc += slowNow ? dt * 0.5 : dt;
  // 시범 지시문이 바뀌면 기계를 잠깐 세우고 글부터 읽힌다 (영상 일시정지처럼).
  // 글이 바뀌는 순간 동작이 같이 지나가면 '무엇을 하라는지' 읽기 전에 끝난다 (템포 검토)
  if (tutor && tutor.step !== readStep) {
    readStep = tutor.step;
    const st = tutor.current;
    readLeft = st?.demo && !st.ask ? readSec(st.text) : 0;
  }
  if (readLeft > 0 && demo === 'demo' && $('settings').hidden && $('why').hidden) {
    readLeft -= dt;
    acc = 0;
  }
  if (!$('settings').hidden || !$('why').hidden) acc = 0; // 설정·이론 카드 중에는 일시정지 (시범·판정도 같이 멈춘다)
  let n = 0;
  // 밀린 시간을 버리지 않고 따라잡는다 (저사양에서도 제한시간이 실제 시간과 일치)
  acc = Math.min(acc, 0.5);
  const rw = tutor?.rewinds ?? 0;
  while (acc >= STEP && n < 30) {
    if (tutor) session.input = tutor.drive(userInput);
    session.step(STEP);
    acc -= STEP;
    n++;
    if (tutor && $('why').hidden && tutor.update()) {
      if (tutor.cleared) {
        onLessonClear();
        break;
      }
      // 직접 한 단계를 해냈다: 링·꽃가루 + '좋아요 ✓'를 보여 준 뒤 다음 지시 (시범·고르기는 제외).
      // 레버 익히기는 단계 안에서 이미 같은 연출을 1.2초 보여 준다
      const prev = tutor.lesson.steps[tutor.step - 1];
      // 보기만 하는 단계(peek)는 해낸 게 없다 — 칭찬하면 장난처럼 보인다 (유저 검토)
      const pass = tutor.lesson.big && prev && !prev.demo && !prev.ask && !prev.peek && tutor.bag.okN === undefined;
      if (pass) passUntil = now + PASS_MS;
      renderMission(); // 판을 새로 그리면 연출 자리를 비우므로 연출은 그 뒤에
      if (pass) playDrillFx('ok');
      else sound.ding();
    }
  }
  if (passUntil && now >= passUntil) {
    passUntil = 0;
    renderMission();
  }
  if (tutor && tutor.rewinds !== rw) onRewind();
  // 평탄 도움 색·긁은 자국: 연습 모드에서 첫 덤프 뒤 (실제 시험 없음)
  soilView.flatGuide = session.flags.feedback && session.dumpCount >= 1;
  soilView.now = session.t;
  soilView.sync();
  // 이빨이 지나간 자리: '두 레버를 같이 쓰기'에서만 (붐만 쓰면 호가 보인다)
  if (trail) {
    if (tutor?.lesson.trail && $('why').hidden) {
      const w = toWorld(session.pose.swing, session.frame.tip);
      trail.push(w.x, w.y, w.z);
      trail.object.visible = true;
    } else if (trail.count) {
      trail.clear();
      trail.object.visible = false;
    }
  }
  exc.sync(session);
  fx.sync(session);
  sound.active = operating();
  sound.update(session);
  updateMeter();
  if (examiners) {
    exc.bucketWorld(tmpV);
    examiners.update(dt, now / 1000, tmpV);
  }
  updateCamera(dt);
  updateHud();
  warmEffects();
  renderer.render(scene, camera);
  // 자동일 때만: 느리면 화질을 낮추고, 넉넉하면 올린다 (손으로 고른 값은 건드리지 않는다)
  // 일부러 덜 그리는 화면(메뉴·결과)에서는 프레임 평균이 멈춘 값이라 판단하지 않는다
  if (cap) slowT = 0;
  else if (frameAvg > 38 || frameAvg < 20) slowT += dt;
  else slowT = Math.max(0, slowT - dt);
  if (slowT > 2) {
    const next = qTick(frameAvg);
    if (next !== null) applyQuality(next);
    slowT = 0;
  }
  if (debug) {
    const info = renderer.info.render;
    perf.textContent = `fps ${(1000 / frameAvg).toFixed(0)}  dpr ${renderer.getPixelRatio().toFixed(2)}\nsim ${session.simMs.toFixed(2)}ms  draw ${info.calls}  tri ${info.triangles}\n장부오차 ${session.ledgerError().toExponential(1)}`;
  }
  requestAnimationFrame(frame);
}
/** 장비를 실제로 만지는 화면인가: 인트로·모드 선택·배우기 목록·설정·결과 등 창이 하나도 안 떠 있을 때 */
const MODALS = [...document.querySelectorAll<HTMLElement>('.modal')];
function operating() {
  return $('intro').hidden && MODALS.every((m) => m.hidden);
}
/** 주행 프레임: 고정 60Hz로 차를 움직이고 코스·미러·카메라·HUD 갱신 */
function driveFrame(dt: number, _now: number) {
  const d = drive!;
  // 화면: 돌리는 핸들 + 브레이크·가속 페달. 키보드: 핸들 좌우(감는 속도)·페달
  pedalAccel.update(dt);
  pedalBrake.update(dt);
  d.setControls(
    -clamp1(kb.lx + pad.lx),
    Math.max(pedalAccel.value, curve(Math.max(0, kb.ry)), pad.accel),
    Math.max(pedalBrake.value, curve(Math.max(0, -kb.ry)), pad.brake),
    wheelCtl.take(),
  );
  const side = Math.abs(d.s.steer) >= d.s.p.maxSteer - 1e-4 ? Math.sign(d.s.steer) : 0;
  wheelCtl.draw(d.s.wheelAngle, d.s.lockPush, side);
  d.s.lockPush = 0;
  if (wheelCtl.hitLock) {
    // 끝에 '턱' 걸리는 느낌: 짧은 진동 + 둔탁한 소리
    buzz(25);
    sound.thump(0.35);
  }
  acc += dt;
  if (!$('settings').hidden || !$('precheck').hidden || !$('why').hidden) acc = 0;
  acc = Math.min(acc, 0.5);
  let n = 0;
  const rw = tutor?.rewinds ?? 0;
  // 단계 판정도 시뮬 한 스텝마다 (화면 주사율에 묶이지 않게)
  while (acc >= STEP && n < 30) {
    d.step(STEP);
    acc -= STEP;
    n++;
    if (tutor && $('why').hidden && tutor.update()) {
      if (tutor.cleared) {
        onLessonClear();
        break;
      }
      sound.ding();
      renderMission();
    }
  }
  d.sync(scene);
  if (tutor && tutor.rewinds !== rw) onRewind();
  updateMeter();
  sound.active = operating();
  sound.update(d.soundState());
  d.camera(camera, camMode, eyeOffset(), dt, examLookAt);
  d.hud();
  if (examiners) {
    const c = d.s.center;
    examiners.update(dt, _now / 1000, tmpV.set(c.x, 1.5, c.z));
  }
  renderer.render(scene, camera);
  if (debug) {
    const info = renderer.info.render;
    perf.textContent = `fps ${(1000 / frameAvg).toFixed(0)}  draw ${info.calls}  tri ${info.triangles}`;
  }
  requestAnimationFrame(frame);
}
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
/** 레버 감도 곡선: 조금 기울이면 아주 천천히 (미세 조작) */
const curve = (v: number) => Math.sign(v) * Math.abs(v) ** 2.2;
// 선회는 조금 밀면 아주 천천히(미세 조정), 끝까지 밀어야 최고 속도
const curveSwing = (v: number) => Math.sign(v) * Math.abs(v) ** 3;
/** curve·curveSwing의 반대 (기계 값 → 레버 자리) */
const uncurve = (v: number, p = 2.2) => Math.sign(v) * Math.abs(v) ** (1 / p);
const kb = { lx: 0, ly: 0, rx: 0, ry: 0 };
let lastBuzz = 0;

newSession();
applySize();
addEventListener('resize', applySize);
addEventListener('orientationchange', () => setTimeout(applySize, 300));
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(applySize).observe(canvas);
// ----- 오프닝: 처음 온 사람에게만 (탭·키로 건너뜀, ?nointro면 생략) -----
// 두 번째부터는 바로 시작 화면. 링크를 누른 사람이 조작까지 가는 시간을 줄인다
const startStage = new StartStage(renderer, () => styleKey);
const playIntro = wantIntro(loadRaw(INTRO_KEY), new URLSearchParams(location.search).has('nointro'));
if (playIntro) saveRaw(INTRO_KEY, '1');
let opening: Intro | null = playIntro ? new Intro(renderer, startStage, () => (opening = null)) : null;
requestAnimationFrame(frame);

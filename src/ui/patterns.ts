/**
 * 배경 무늬 (햇살·빛줄기 대신). 모두 실행 중에 캔버스로 한 번 그려 재사용한다 (파일·네트워크 없음).
 * - blueprintCanvas: 시작 무대 뒤 '현장 측량 설계도'. 격자·등고선·치수선·작업 반경 호·측량 표식. 이어 붙여도 이음매 없음
 * - guillocheURL: 합격 연출 뒤 자격증·증서식 정밀 무늬(길로셰). 메달을 둘러싼 인장처럼
 */

const TAU = Math.PI * 2;

/** 설계도 노란 기준점 위치 (타일 비율, 캔버스 기준 x·y). 시작 무대가 여기서 퍼지는 고리를 띄움 */
const BENCHES: [number, number, string][] = [
  [9, 8, 'EL ±0.00'],
  [27, 12, 'BM-2'],
  [16, 30, 'EL -0.50'],
  [29, 22, 'EL -1.60'],
  [4, 21, 'BM-1'],
  [20, 4, 'BM-3'],
  [13, 17, 'EL -0.30'],
];
export const BLUEPRINT_PINGS: [number, number][] = BENCHES.map(([u, v]) => [u / 32, v / 32]);

/**
 * 이어 붙는 설계도 (정사각 size px). 1칸 = size/32.
 * layer 'grid': 바탕색 + 격자·교차 십자 (뒤층), 'marks': 투명 바탕에 등고선·반경 호·치수·기준점 (앞층, 다른 속도로 흘러 깊이감)
 */
export function blueprintCanvas(layer: 'grid' | 'marks', size = 1024): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const cell = size / 32;
  if (layer === 'marks') return drawMarks(c, g, size, cell);
  g.fillStyle = '#1b2557';
  g.fillRect(0, 0, size, size);
  // 1) 격자: 가는 선(1m) + 굵은 선(5m)
  g.lineWidth = 1;
  g.strokeStyle = '#27367c';
  g.beginPath();
  for (let i = 0; i < 32; i++) {
    g.moveTo(i * cell + 0.5, 0);
    g.lineTo(i * cell + 0.5, size);
    g.moveTo(0, i * cell + 0.5);
    g.lineTo(size, i * cell + 0.5);
  }
  g.stroke();
  g.strokeStyle = '#33479a';
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i < 32; i += 4) {
    g.moveTo(i * cell, 0);
    g.lineTo(i * cell, size);
    g.moveTo(0, i * cell);
    g.lineTo(size, i * cell);
  }
  g.stroke();
  // 굵은 격자 교차점: 작은 십자
  g.strokeStyle = '#4a5fb4';
  g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 0; i < 32; i += 4)
    for (let j = 0; j < 32; j += 4) {
      const x = i * cell;
      const y = j * cell;
      g.moveTo(x - 5, y);
      g.lineTo(x + 5, y);
      g.moveTo(x, y - 5);
      g.lineTo(x, y + 5);
    }
  g.stroke();
  return c;
}

function drawMarks(c: HTMLCanvasElement, g: CanvasRenderingContext2D, size: number, cell: number): HTMLCanvasElement {
  // 경계를 넘는 요소는 아홉 자리에 그려 이음매 없이
  const tiled = (draw: () => void) => {
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) {
        g.save();
        g.translate(dx, dy);
        draw();
        g.restore();
      }
  };
  // 2) 등고선: 구덩이 두 곳 둘레 (불규칙한 닫힌 곡선)
  const contours = (cx: number, cy: number, n: number, r0: number, dr: number, ph: number) => {
    for (let k = 0; k < n; k++) {
      const r = r0 + k * dr;
      g.strokeStyle = k % 4 === 0 ? '#4458ad' : '#33468f';
      g.lineWidth = k % 4 === 0 ? 2 : 1.2;
      g.beginPath();
      for (let s = 0; s <= 120; s++) {
        const a = (s / 120) * TAU;
        const rr = r * (1 + 0.13 * Math.sin(2 * a + ph + k * 0.18) + 0.07 * Math.sin(3 * a - ph * 1.7 + k * 0.1) + 0.03 * Math.sin(7 * a + k));
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr * 0.8;
        if (s) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
  };
  tiled(() => {
    contours(size * 0.27, size * 0.3, 11, cell * 1.2, cell * 0.85, 0.6);
    contours(size * 0.76, size * 0.74, 9, cell * 1.0, cell * 0.95, 2.4);
  });

  // 3) 작업 반경 호: 눈금 + 반경 표기
  const mono = (px: number) => `600 ${px}px ui-monospace, Menlo, Consolas, monospace`;
  tiled(() => {
    const cx = size * 0.62;
    const cy = size * 0.18;
    const R = cell * 7.9;
    g.strokeStyle = '#4a60b8';
    g.lineWidth = 1.5;
    g.setLineDash([10, 6]);
    g.beginPath();
    g.arc(cx, cy, R, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    for (let d = 0; d <= 36; d++) {
      const a = (0.15 + (0.7 * d) / 36) * Math.PI;
      const l = d % 6 === 0 ? 12 : 6;
      g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      g.lineTo(cx + Math.cos(a) * (R - l), cy + Math.sin(a) * (R - l));
    }
    g.stroke();
    // 반경선
    g.strokeStyle = '#33479a';
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(0.32 * Math.PI) * R, cy + Math.sin(0.32 * Math.PI) * R);
    g.stroke();
    g.fillStyle = '#5a70c4';
    g.font = mono(15);
    g.fillText('R 7.9 m', cx + Math.cos(0.32 * Math.PI) * R * 0.55 + 6, cy + Math.sin(0.32 * Math.PI) * R * 0.55);
  });

  // 4) 치수선: 건축 도면식 사선 끝 표시 + 수치
  const dim = (x0: number, y0: number, x1: number, y1: number, label: string) => {
    g.strokeStyle = '#4d63b8';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    for (const [x, y] of [
      [x0, y0],
      [x1, y1],
    ]) {
      // 보조선 + 사선 틱
      g.moveTo(x + nx * 10, y + ny * 10);
      g.lineTo(x - nx * 10, y - ny * 10);
      g.moveTo(x - 6 * Math.cos(ang - 0.8), y - 6 * Math.sin(ang - 0.8));
      g.lineTo(x + 6 * Math.cos(ang - 0.8), y + 6 * Math.sin(ang - 0.8));
    }
    g.stroke();
    g.save();
    g.translate((x0 + x1) / 2, (y0 + y1) / 2);
    g.rotate(ang);
    g.fillStyle = '#6078cc';
    g.font = mono(14);
    g.textAlign = 'center';
    g.fillText(label, 0, -7);
    g.restore();
  };
  tiled(() => {
    dim(cell * 2, cell * 15, cell * 6, cell * 15, '4.00');
    dim(cell * 20, cell * 27, cell * 26, cell * 27, '6.00');
    dim(cell * 13, cell * 21, cell * 13, cell * 25, '1.50');
    dim(cell * 3, cell * 26, cell * 7.5, cell * 29.5, '2.50');
  });

  // 5) 측량 표식(기준점) + 표고 표기, 노란 표식 몇 개만 (밀도는 선, 강조는 점으로)
  const bench = (x: number, y: number, label: string, warm: boolean) => {
    g.strokeStyle = warm ? '#c79a3a' : '#6078cc';
    g.fillStyle = warm ? '#c79a3a' : '#6078cc';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x, y, 7, 0, TAU);
    g.moveTo(x - 12, y);
    g.lineTo(x + 12, y);
    g.moveTo(x, y - 12);
    g.lineTo(x, y + 12);
    g.stroke();
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, 7, -Math.PI / 2, 0);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, 7, Math.PI / 2, Math.PI);
    g.closePath();
    g.fill();
    g.font = mono(13);
    g.textAlign = 'left';
    g.fillText(label, x + 14, y - 8);
  };
  tiled(() => {
    for (const [u, v, label] of BENCHES) bench(cell * u, cell * v, label, true);
  });
  // 6) 구역 표기 (A·C)
  g.fillStyle = '#3b4fa6';
  g.font = `800 ${cell * 1.6}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillText('A', size * 0.27, size * 0.3 + cell * 0.55);
  g.fillText('C', size * 0.76, size * 0.74 + cell * 0.55);
  return c;
}

/**
 * 길로셰(증서 무늬): 엮인 사인 띠 + 꽃잎 곡선 + 눈금 고리. 투명 배경 PNG data URL
 * color: 선 색(#rrggbb), alpha: 선 진하기
 */
export type GuillocheLayer = 'band' | 'rose' | 'core';
export function guillocheURL(color: string, alpha: number, layers: GuillocheLayer[] = ['band', 'rose', 'core'], size = 720): string {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const h = size / 2;
  g.translate(h, h);
  g.strokeStyle = color;
  g.lineJoin = 'round';
  const path = (f: (t: number) => [number, number], n: number) => {
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const [x, y] = f((i / n) * TAU);
      if (i) g.lineTo(x * h, y * h);
      else g.moveTo(x * h, y * h);
    }
    g.stroke();
  };
  const has = (l: GuillocheLayer) => layers.includes(l);
  // 바깥 엮인 띠: 위상 다른 사인 고리 여러 겹
  g.globalAlpha = alpha;
  g.lineWidth = 1.3;
  if (has('band'))
    for (let j = 0; j < 8; j++) {
      const ph = (j / 8) * (TAU / 36);
      path((t) => {
        const r = 0.82 + 0.06 * Math.sin(36 * (t + ph));
        return [Math.cos(t) * r, Math.sin(t) * r];
      }, 1440);
    }
  // 가운데 꽃잎: 외파선(에피트로코이드) 24잎, 세 겹 회전
  g.globalAlpha = alpha * 0.85;
  g.lineWidth = 1.1;
  if (has('rose'))
    for (let j = 0; j < 3; j++) {
      const rot = (j / 3) * (TAU / 24);
      path((t) => {
        const R = 24;
        const b = 1;
        const x = (R + b) * Math.cos(t) - 6 * Math.cos(((R + b) / b) * t);
        const y = (R + b) * Math.sin(t) - 6 * Math.sin(((R + b) / b) * t);
        const s = 0.62 / (R + b + 6);
        return [(x * Math.cos(rot) - y * Math.sin(rot)) * s, (x * Math.sin(rot) + y * Math.cos(rot)) * s];
      }, 2400);
    }
  // 안쪽 물결 고리 두 줄
  g.globalAlpha = alpha * 0.9;
  if (has('rose'))
    for (const [r0, k] of [
      [0.46, 48],
      [0.5, 48],
    ] as const)
      path((t) => {
        const r = r0 + 0.012 * Math.sin(k * t);
        return [Math.cos(t) * r, Math.sin(t) * r];
      }, 1200);
  // 눈금 고리 (바깥·안쪽)
  g.globalAlpha = alpha;
  g.lineWidth = 1.4;
  g.beginPath();
  if (has('band'))
    for (let d = 0; d < 180; d++) {
      const a = (d / 180) * TAU;
      const l = d % 5 === 0 ? 0.035 : 0.018;
      g.moveTo(Math.cos(a) * 0.93 * h, Math.sin(a) * 0.93 * h);
      g.lineTo(Math.cos(a) * (0.93 + l) * h, Math.sin(a) * (0.93 + l) * h);
    }
  if (has('core'))
    for (let d = 0; d < 120; d++) {
      const a = (d / 120) * TAU;
      g.moveTo(Math.cos(a) * 0.4 * h, Math.sin(a) * 0.4 * h);
      g.lineTo(Math.cos(a) * 0.425 * h, Math.sin(a) * 0.425 * h);
    }
  g.stroke();
  for (const r of [...(has('band') ? [0.92, 0.99] : []), ...(has('core') ? [0.395] : [])]) {
    g.beginPath();
    g.arc(0, 0, r * h, 0, TAU);
    g.stroke();
  }
  return c.toDataURL('image/png');
}

let installed = false;
/**
 * CSS 변수로 무늬 등록. 층별(서로 반대로 돌며 겹쳐 일렁임): --gl-band·--gl-rose·--gl-core, 진한 금색(완벽 합격): --gl-*-strong.
 * --guilloche: 세 층 합친 한 장 (금박 반짝임 마스크)
 */
export function installPatterns() {
  if (installed) return;
  installed = true;
  const root = document.documentElement.style;
  for (const l of ['band', 'rose', 'core'] as const) {
    root.setProperty(`--gl-${l}`, `url(${guillocheURL('#ffc23a', 0.55, [l])})`);
    root.setProperty(`--gl-${l}-strong`, `url(${guillocheURL('#ffe08a', 0.9, [l])})`);
  }
  root.setProperty('--guilloche', `url(${guillocheURL('#ffffff', 1)})`);
}

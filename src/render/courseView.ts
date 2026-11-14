/**
 * 코스운전 바닥: 포장면 + 노란 경계선 + 흰 가로선(출발·종료, 정지, 도착) + 주차구역.
 * 선 색은 학원 시범 영상 기준 (판정명세_주행.md 3-2).
 */
import * as THREE from 'three';
import type { Course, LineBand, P } from '../sim/drive/course';
import { buildExamSurroundings, EXAM_FLOOR } from './examSite';
import type { Site } from '../sim/site';
import { PALETTE } from './toon';

const YELLOW = 0xf2c230;
const WHITE = 0xf6f6f2;
const ASPHALT = 0x6c7177;

export class CourseView {
  readonly group = new THREE.Group();
  constructor(c: Course, site: Site, exam: boolean) {
    // 바닥: 넓은 잔디(또는 시험장 단색) + 코스 포장면
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 140).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: exam ? EXAM_FLOOR : PALETTE.grass }),
    );
    ground.position.y = -0.01;
    this.group.add(ground);
    const b = c.bbox;
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(b.x1 - b.x0, b.z1 - b.z0).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: ASPHALT }),
    );
    pad.position.set((b.x0 + b.x1) / 2, 0.002, (b.z0 + b.z1) / 2);
    this.group.add(pad);

    const yellow: THREE.BufferGeometry[] = [];
    const white: THREE.BufferGeometry[] = [];
    for (const a of c.bounds) {
      const g = new THREE.RingGeometry(a.r0, a.r1, 96, 1, -a.a1, a.a1 - a.a0).rotateX(-Math.PI / 2);
      g.translate(a.c.x, 0.006, a.c.z);
      yellow.push(g);
    }
    const band = (l: LineBand) => quad(l.p0, l.p1, { x: l.p0.x + l.n.x * l.w, z: l.p0.z + l.n.z * l.w }, { x: l.p1.x + l.n.x * l.w, z: l.p1.z + l.n.z * l.w });
    white.push(band(c.start), band(c.arrive), ...c.parking.map(band));
    // 정지선: 접점에서 진행 방향 u 범위, 코스 가로 방향으로 안쪽 경계 ~ 바깥 경계
    const J = c.junction;
    // 접점의 중심선에서 가로 방향으로 ±폭/2 (n은 진행 방향 왼쪽)
    for (const [u0, u1] of [c.stopRear, c.stopFront]) {
      const at = (u: number, v: number): P => ({ x: J.p.x + J.t.x * u + J.n.x * v, z: J.p.z + J.t.z * u + J.n.z * v });
      const hw = c.width / 2;
      white.push(quad(at(u0, -hw), at(u0, hw), at(u1, -hw), at(u1, hw)));
    }
    this.group.add(new THREE.Mesh(merge(yellow), new THREE.MeshBasicMaterial({ color: YELLOW, side: THREE.DoubleSide })));
    const wm = new THREE.Mesh(merge(white), new THREE.MeshBasicMaterial({ color: WHITE, side: THREE.DoubleSide }));
    wm.position.y = 0.002;
    this.group.add(wm);
    if (exam) {
      // 시험장 배경: 담·건물·나무 (굴착과 같은 시험장). 작업장 바닥 칠은 코스와 겹치지 않게 높이로 구분
      const sur = buildExamSurroundings(site, '코스운전');
      this.group.add(sur);
    }
  }
}

function quad(a: P, b: P, c: P, d: P) {
  // a-b가 한 변, c-d가 맞은 변 (a↔c, b↔d)
  const g = new THREE.BufferGeometry();
  const y = 0.008;
  g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, y, a.z, b.x, y, b.z, c.x, y, c.z, b.x, y, b.z, d.x, y, d.z, c.x, y, c.z], 3));
  g.computeVertexNormals();
  return g;
}
function merge(gs: THREE.BufferGeometry[]) {
  const out = gs.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of out) for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  const n = out.reduce((s, g) => s + g.attributes.position.count, 0);
  const arr = new Float32Array(n * 3);
  let o = 0;
  for (const g of out) {
    arr.set(g.attributes.position.array as Float32Array, o);
    o += g.attributes.position.count * 3;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return m;
}

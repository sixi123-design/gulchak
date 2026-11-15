/**
 * 배우기 미션 하나를 **실제로 조작해서** 끝까지 가 보고, 화면에 뜬 것을 전부 모은다.
 *
 * 소스에서 문구를 긁지 않는다. 유저가 실제로 보는 것만 모아야 검수가 의미가 있다.
 */
import { launch, SHOTS } from './cdp.mjs';

/**
 * 화면이 반짝이는 **레버 라벨** → 누를 키.
 * 지시문 문구에 묶지 않는다 — 문구를 고칠 때마다 봇이 따라 깨지면 안 된다.
 */
const KEY_OF_LABEL = {
  '붐 올림': 'KeyK',
  '붐 내림': 'KeyI',
  '암 펴기': 'KeyW',
  '암 당기기': 'KeyS',
  '버킷 오므림': 'KeyJ',
  '버킷 펴기': 'KeyL',
  '선회 ◀': 'KeyA',
  '▶ 선회': 'KeyD',
};
/** 지금 반짝이는 라벨들 */
const HINTS = `[...document.querySelectorAll('.stick .lab.hint')].map(e=>e.textContent.trim())`;
/** 자리를 맞추는 구간인가 (반짝임만으로는 '어디까지'를 알 수 없다) */
const AIMING = /멈추기|맞추세요/;
/** 3칸 표시 상태 (레버를 얼마나 밀라는 구간) */
const GAUGE = `(()=>{const g=document.getElementById('dr-gauge');
  if(!g||g.hidden) return null;
  const bars=[...g.children];
  return { want: bars.findIndex(b=>b.className.includes('want'))+1, on: bars.filter(b=>b.className.includes('on')).length }})()`;

const sel = (id) => `document.getElementById('${id}')`;
const line = (id) => `(${sel(id)}?.textContent||'').split(String.fromCharCode(10)).join(' / ')`;

export async function playLesson({ url, title, maxSteps = 140 }) {
  const b = await launch({ w: 412, h: 892 });
  await b.send('Page.enable');
  await b.send('Runtime.enable');
  await b.pre("try{localStorage.setItem('exc-seen-intro','1')}catch(e){}");
  await b.open(url);
  await b.sleep(1200);
  await b.js("[...document.querySelectorAll('button')].find(e=>e.offsetParent&&/배우기/.test(e.textContent)).click()");
  await b.sleep(700);
  const list = await b.js("[...document.querySelectorAll('button.lrow')].map(e=>e.textContent.trim())");
  await b.js(`[...document.querySelectorAll('button.lrow')].find(e=>/${title}/.test(e.textContent)).click()`);
  await b.sleep(700);
  // '왜 배우나' 카드
  const why = await b.js("[...document.querySelectorAll('#why-text p, #why-text li, #why-text div')].map(e=>e.textContent.trim()).filter(Boolean)");
  const whyTitle = await b.js(`${sel('why-title')}?.textContent||''`);
  const shots = [];
  shots.push(await b.shot('why'));
  await b.tap('#btn-why-go');
  await b.sleep(900);

  const seen = [];
  const facts = [];
  let last = '';
  let cleared = false;
  const press = async (ks, ms) => {
    for (const k of ks) await b.key(k, 'keyDown', 'x');
    await b.sleep(ms);
    for (const k of ks) await b.key(k, 'keyUp');
  };
  for (let i = 0; i < maxSteps; i++) {
    const text = await b.js(line('dr-text'));
    const part = await b.js(line('dr-part'));
    const say = await b.js(line('dr-say'));
    const badge = await b.js(`${sel('dr-badge')}?.hidden ? '' : (${sel('dr-badge')}?.textContent||'')`);
    for (const [k, v] of [['지시', text], ['부품줄', part], ['작은줄', say], ['배지', badge]])
      if (v && !seen.some((x) => x.kind === k && x.text === v)) seen.push({ kind: k, text: v });
    if (text !== last) {
      last = text;
      facts.push({ step: facts.length, text, state: await b.js(STATE) });
      shots.push(await b.shot(`step${facts.length}`));
    }
    const hints = await b.js(HINTS);
    const keys = hints.map((l) => KEY_OF_LABEL[l]).filter(Boolean);
    const gauge = await b.js(GAUGE);
    if (gauge && keys.length) {
      // '한 칸만' 같은 구간: 길게 누르면 끝까지 간다. 톡톡 눌러 목표 칸에 맞추고 놓는다
      await press(keys, gauge.on < gauge.want ? 170 : 60);
      await b.sleep(450);
    } else if (AIMING.test(text)) {
      // 자리 맞추기: 상태를 보고 조금씩 (반짝임만으로는 '어디까지'를 모른다)
      const st = await b.js(STATE);
      const want =
        st.gap < 0.03
          ? ['KeyK'] // 땅에 박혔으면 붐 올리기
          : st.gap > 0.45
            ? ['KeyI'] // 너무 높으면 붐 내리기
            : st.r - st.target > 0.6
              ? ['KeyS'] // 너무 멀면 암 당기기
              : st.target - st.r > 0.6
                ? ['KeyW'] // 너무 가까우면 암 펴기
                : []; // 범위 안이면 가만히 둬서 멈춤을 인정받는다
      await press(want, 110);
    } else if (keys.length) await press(keys, 320);
    else await b.sleep(300);
    await b.sleep(110);
    if (await b.js("!document.getElementById('clear').hidden")) {
      cleared = true;
      break;
    }
  }
  const clear = {
    title: await b.js(`${sel('clear-title')}?.textContent||''`),
    note: await b.js(`${sel('clear-note')}?.textContent||''`),
  };
  shots.push(await b.shot('clear'));
  await b.close();
  return { list, whyTitle, why, seen, facts, cleared, clear, shots, shotDir: SHOTS };
}

const STATE = `(()=>{const s=window.__exc?.session; if(!s) return {};
  const a=s.site.stations.find(x=>x.name==='A');
  return { r:+s.frame.tip.r.toFixed(2), gap:+s.groundGap().toFixed(2),
    target:+((a.zoneIn+a.zoneOut)/2).toFixed(2), load:+(s.load/s.m.struckCapacity).toFixed(2),
    jolt:+s.maxJolt.toFixed(3) }})()`;

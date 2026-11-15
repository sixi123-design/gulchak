// Chrome DevTools Protocol 드라이버 — 설치 없이 (node 내장 WebSocket + 설치된 Chrome)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_PATH ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) =>
    existsSync(p),
  );
const PORT = 9333;
const PROFILE = join(tmpdir(), 'exc-review-profile');
export const SHOTS = join(tmpdir(), 'exc-review-shots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ w = 412, h = 892, url = 'about:blank' } = {}) {
  rmSync(PROFILE, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    `--window-size=${w},${h}`, '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--hide-scrollbars', '--mute-audio', '--no-first-run', '--disable-gpu-sandbox',
    '--force-device-scale-factor=1', url,
  ], { stdio: 'ignore', detached: false });

  let ws = null;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) { ws = page.webSocketDebuggerUrl; break; }
    } catch {}
  }
  if (!ws) { proc.kill(); throw new Error('chrome CDP 연결 실패'); }

  const sock = new WebSocket(ws);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
  let id = 0;
  const waiting = new Map();
  const events = [];
  sock.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const myId = ++id;
    waiting.set(myId, (msg) => (msg.error ? rej(new Error(method + ': ' + msg.error.message)) : res(msg.result)));
    sock.send(JSON.stringify({ id: myId, method, params }));
  });

  const api = {
    proc, send, events,
    async open(target) {
      await send('Page.enable'); await send('Runtime.enable');
      await send('Page.navigate', { url: target });
      await sleep(2500);
    },
    async pre(src) { await send('Page.addScriptToEvaluateOnNewDocument', { source: src }); },
    async js(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
      return r.result.value;
    },
    async shot(name) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64'));
      return `${SHOTS}/${name}.png`;
    },
    async key(code, type, text) {
      const vk = { KeyI: 73, KeyK: 75, KeyJ: 74, KeyL: 76, KeyW: 87, KeyS: 83, KeyA: 65, KeyD: 68 }[code] ?? 0;
      await send('Input.dispatchKeyEvent', { type, code, key: code.replace('Key', '').toLowerCase(), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: type === 'keyDown' ? text : undefined });
    },
    async hold(code, ms) {
      await api.key(code, 'keyDown', code.replace('Key', '').toLowerCase());
      await sleep(ms);
      await api.key(code, 'keyUp');
    },
    async tap(sel) { return api.js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'NOT FOUND'; e.click(); return 'ok'})()`); },
    sleep,
    async close() { try { await send('Browser.close'); } catch {} sock.close(); proc.kill(); },
  };
  return api;
}

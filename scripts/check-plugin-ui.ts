// Headless-Chrome check of the page in plugin mode: serves dist/, fakes the
// JUCE bridge (window.__JUCE__.backend) that the plugin's WebView injects,
// and plays the C++ side: sends the session state, host automation, host
// notes and meters, and checks what the page sends back. Screenshots to
// out/screenshot-plugin*.png. Needs `npm run build` first.
//
//   node scripts/check-plugin-ui.ts

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4175, DEBUG = 9335;
const UI_W = 1360, UI_H = 1000;   // src/plugin.ts
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = createServer((req, res) => {
  let p = join('dist', decodeURIComponent((req.url ?? '/').split('?')[0]));
  if (!existsSync(p) || p.endsWith('/')) p = 'dist/index.html';
  res.setHeader('content-type', MIME[extname(p)] ?? 'application/octet-stream');
  res.end(readFileSync(p));
}).listen(PORT);

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DEBUG}`, `--window-size=${UI_W},${UI_H}`, '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--user-data-dir=/tmp/ft-vector-chrome-plugin', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// What JUCE injects, reduced to the two calls the page uses. Everything the
// page emits is recorded in window.__sent; window.__toPage(msg) is the C++ side.
const FAKE_JUCE = `
  window.__sent = [];
  const listeners = new Map();
  window.__JUCE__ = { backend: {
    emitEvent: (id, payload) => window.__sent.push({ id, payload: JSON.parse(JSON.stringify(payload)) }),
    addEventListener: (id, fn) => { (listeners.get(id) ?? listeners.set(id, []).get(id)).push(fn); },
  } };
  window.__toPage = (msg) => (listeners.get('vector') ?? []).forEach((fn) => fn(msg));
`;

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

async function main(): Promise<void> {
  let targets: { webSocketDebuggerUrl: string; type: string }[] = [];
  for (let i = 0; i < 50 && targets.length === 0; i++) {
    await sleep(200);
    try { targets = (await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json()).filter((t: { type: string }) => t.type === 'page'); } catch { /* not up yet */ }
  }
  if (targets.length === 0) throw new Error('chrome did not start');
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map<number, (v: unknown) => void>();
  const logs: string[] = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m.result ?? m.error); pending.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled') logs.push(`[${m.params.type}] ${m.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(' ')}`);
    else if (m.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description ?? ''}`);
  };
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<unknown>((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression: string) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }) as { result?: { value?: unknown }; exceptionDetails?: { text: string } };
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };
  type Sent = { id: string; payload: { type: string; [k: string]: unknown } };
  const takeSent = async () => (await evaluate('window.__sent.splice(0)')) as Sent[];

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_JUCE });
  await send('Emulation.setDeviceMetricsOverride', { width: UI_W, height: UI_H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(2000);

  // 1. the page asks for the state and loads nothing by itself
  let sent = await takeSent();
  check(sent.length === 1 && sent[0].payload.type === 'ready', `on open the page only asks for the state (sent: ${sent.map((s) => s.payload.type).join(', ')})`);
  check(await evaluate("document.documentElement.classList.contains('in-plugin')") === true, 'plugin mode is on');
  check(await evaluate("getComputedStyle(document.querySelector('.power-wrap')).display") === 'none', 'the power switch is hidden');

  // 2. the session state arrives: the sound, the preset name, your presets (one from before the fmEnv split)
  await evaluate(`window.__toPage({ type: 'state', values: { cutoff: 555, res: 0.4, rvMix: 0.7 }, preset: 'Hologram', last: 'Hologram',
    user: [{ name: 'Mine', values: { cutoff: 300 }, v: 2 }, { name: 'Old', values: { fmEnv: 1, pdEnv: 0.4 } }, { bogus: true }] })`);
  await sleep(200);
  sent = await takeSent();
  check(sent.every((s) => s.payload.type === 'current'), `the state is not echoed back as parameters (sent: ${sent.map((s) => s.payload.type).join(', ') || 'nothing'})`);
  check(await evaluate('window.__vector.values.cutoff') === 555, 'the state sets the values');
  check(await evaluate("document.querySelector('#preset-name').textContent") === 'Hologram', 'the header shows the session preset');
  check(await evaluate("document.querySelectorAll('#browser-list .card[data-tag=user]').length") === 2, 'your presets from the file are in the browser (the malformed one is dropped)');

  // an old saved sound keeps its sound: the one value becomes both the mode and the amount
  await evaluate("window.__vector.loadPreset('Old')");
  const old = await evaluate('[window.__vector.values.fmEnv, window.__vector.values.fmEnvAmt, window.__vector.values.pdEnv, window.__vector.values.pdEnvAmt]') as number[];
  check(old.join(',') === '1,1,0,0.4', `an old preset's fmEnv / pdEnv split into mode and amount (${old.join(', ')})`);
  await takeSent();

  // 3. host automation moves a knob and a table cell without being sent back
  await evaluate("window.__toPage({ type: 'params', values: { cutoff: 1234, volume: 0.5, wv3: 9 } })");
  await sleep(100);
  sent = await takeSent();
  check(sent.length === 0, 'automation is not echoed back');
  check(await evaluate('window.__vector.values.cutoff') === 1234, 'automation updates the values');
  check(await evaluate("document.querySelector('#master').value") === '0.5', 'automation of the volume moves the master slider');

  // 4. loading a preset on the page sends the whole sound, then its name
  await evaluate("window.__vector.loadPreset('Slide Bass')");
  sent = await takeSent();
  const preset = sent.find((s) => s.payload.type === 'preset');
  const current = sent.filter((s) => s.payload.type === 'current').pop();
  check(!!preset && (preset.payload.values as Record<string, number>).cutoff === 1200, 'loading a preset sends its values');
  check(current?.payload.name === 'Slide Bass', 'and its name, to keep with the session');

  // 5. a knob moved on the page becomes a parameter change and marks the sound edited
  await evaluate("document.querySelector('.knob').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))");
  sent = await takeSent();
  check(sent.some((s) => s.payload.type === 'param'), `turning a knob sends a parameter (sent: ${sent.map((s) => s.payload.type).join(', ') || 'nothing'})`);
  check(sent.some((s) => s.payload.type === 'current' && s.payload.name === ''), 'and marks the sound edited');

  // 6. the on-screen keyboard plays through the plugin
  await evaluate("window.__vector.synth.noteOn(60, 100); window.__vector.synth.noteOff(60)");
  sent = await takeSent();
  check(sent.map((s) => s.payload.type).join(',') === 'noteOn,noteOff', 'notes from the page go to the plugin');

  // 7. host notes light the keys; meters, scope, the machine display and the host tempo show up
  await evaluate(`window.__toPage({ type: 'notes', list: [[64, 100, 0], [67, 90, 2]] });
    window.__toPage({ type: 'stats', voices: 3, load: 0.042, peakL: 0.5, peakR: 0.4, tempo: 122,
      scope: Array.from({ length: 1024 }, (_, i) => Math.sin(i / 20) * 0.5),
      display: [0xa5, 0x0f, 0x10, 0x01, 3, 5, 2, 77, 1, 40, 3, 0, 0, 0, 0, 0] })`);
  await sleep(100);
  check(String(await evaluate("document.querySelector('#stats').textContent")).includes('122 bpm'), 'the host tempo shows in the status line');
  check(await evaluate("document.querySelector('.bitrow .val').textContent") === 'A5', 'the registers show the display bytes');

  // 8. drawing in a grid lands in the right cell when the page is scaled
  await send('Emulation.setDeviceMetricsOverride', { width: UI_W / 2, height: UI_H / 2, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  await evaluate("document.querySelectorAll('#tabs .tab')[2].click()");
  await sleep(400);
  const cell = await evaluate(`(() => {
    const c = document.querySelector('.grid canvas'); const r = c.getBoundingClientRect();
    const x = r.left + r.width * (20.5 / 32), y = r.top + 2;
    for (const t of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, buttons: 1, bubbles: true, pointerId: 1 }));
    return window.__vector.values.wv20;
  })()`);
  sent = await takeSent();
  check(cell === 15 && sent.some((s) => s.payload.type === 'param' && s.payload.id === 'wv20'), `a click on wave cell 20 of a half-size page sets wv20 (it is ${cell})`);
  await send('Emulation.setDeviceMetricsOverride', { width: UI_W, height: UI_H, deviceScaleFactor: 1, mobile: false });
  await sleep(300);

  // 9. saving a sound goes to the plugin's file
  await evaluate('document.querySelector("#save").click()');
  await sleep(200);
  await evaluate('const n = document.querySelector("#save-name"); n.value = "Check Sound"; n.dispatchEvent(new Event("input")); document.querySelector("#savebar").requestSubmit()');
  sent = await takeSent();
  const save = sent.find((s) => s.payload.type === 'saveUser');
  const saved = (save?.payload.presets ?? []) as { name: string; v?: number }[];
  check(saved.map((p) => p.name).join(',') === 'Check Sound,Mine,Old' && saved.every((p) => p.v === 2), `saving writes your presets through the plugin (${saved.map((p) => p.name).join(', ')})`);

  // 10. the host swaps the whole state (its preset menu, a session load)
  await evaluate("window.__toPage({ type: 'state', values: { cutoff: 4000 }, preset: '', last: 'Slide Bass', user: [] })");
  await sleep(100);
  check(await evaluate("document.querySelector('#preset-tag').textContent") === 'edited', 'an edited session shows as edited');
  check(await evaluate("document.querySelector('#preset-name').textContent") === 'Slide Bass', 'under the name it came from');
  await evaluate("document.querySelector('#browser-close').click()");
  await sleep(300);

  // 11. every view but voice fits the design size with every module open; voice folds its channels or scrolls
  mkdirSync('out', { recursive: true });
  const heights: string[] = [];
  let tallest = 0;
  for (let t = 0; t < 4; t++) {
    await evaluate(`document.querySelectorAll('#tabs .tab')[${t}].click(); document.querySelectorAll('.panel.collapsed').forEach((p) => p.classList.remove('collapsed'))`);
    await sleep(700);
    const h = await evaluate("document.querySelector('#app').offsetHeight") as number;
    heights.push(`${['voice', 'motion', 'tables', 'link'][t]} ${h}`);
    if (t > 0) tallest = Math.max(tallest, h);
    const shot = await send('Page.captureScreenshot', { format: 'png' }) as { data: string };
    writeFileSync(`out/screenshot-plugin-${t + 1}.png`, Buffer.from(shot.data, 'base64'));
  }
  check(tallest <= UI_H, `motion, tables and link fit ${UI_W}x${UI_H} at full size (${heights.join(', ')})`);
  console.log('wrote out/screenshot-plugin-{1..4}.png');

  // 12. a window smaller than the design shows the whole page, scaled
  await send('Emulation.setDeviceMetricsOverride', { width: 1050, height: 834, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.querySelectorAll('#tabs .tab')[3].click()");
  await sleep(500);
  const box = await evaluate("(() => { const r = document.querySelector('#app').getBoundingClientRect(); return [r.right, r.bottom, innerWidth, innerHeight]; })()") as number[];
  check(box[0] <= box[2] + 0.5 && box[1] <= box[3] + 0.5, `at 1050x834 the link view fits (${Math.round(box[0])}x${Math.round(box[1])})`);
  // the voice view with every channel open scrolls, down to the bottom of the scaled page and no further
  await evaluate("document.querySelectorAll('#tabs .tab')[0].click(); document.querySelectorAll('.panel.collapsed').forEach((p) => p.classList.remove('collapsed'))");
  await sleep(500);
  const scroll = await evaluate("(() => { const r = document.querySelector('#app').getBoundingClientRect(); return [document.scrollingElement.scrollHeight, r.height, document.scrollingElement.scrollWidth, innerWidth]; })()") as number[];
  check(Math.abs(scroll[0] - scroll[1]) <= 2 && scroll[2] <= scroll[3], `the open voice view scrolls exactly its scaled height (${Math.round(scroll[0])} vs ${Math.round(scroll[1])}), not sideways`);
  const small = await send('Page.captureScreenshot', { format: 'png' }) as { data: string };
  writeFileSync('out/screenshot-plugin-small.png', Buffer.from(small.data, 'base64'));
  console.log('wrote out/screenshot-plugin-small.png');

  const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]'));
  for (const l of errors) console.log('  console', l);
  check(errors.length === 0, 'no console errors');
  if (failures) process.exitCode = 1;
  ws.close();
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { chrome.kill(); server.close(); });

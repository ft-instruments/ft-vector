// Headless-Chrome smoke test: serves dist/, opens the page, boots the
// AudioWorklet, plays a note and checks that the worklet reports output;
// takes a screenshot into out/screenshot.png. Needs `npm run build` first.
//
//   node scripts/check-browser.ts

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4173, DEBUG = 9333;
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = createServer((req, res) => {
  let p = join('dist', decodeURIComponent((req.url ?? '/').split('?')[0]));
  if (!existsSync(p) || p.endsWith('/')) p = 'dist/index.html';
  res.setHeader('content-type', MIME[extname(p)] ?? 'application/octet-stream');
  res.end(readFileSync(p));
}).listen(PORT);

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DEBUG}`, '--window-size=1400,1500', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=/tmp/ft-vector-chrome', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(2500);
  const title = await evaluate('document.title');
  const panels = await evaluate('document.querySelectorAll("#panels .win").length');
  const knobs = await evaluate('document.querySelectorAll(".knob").length');
  console.log(`page "${title}": ${panels} windows, ${knobs} knobs`);

  const peak = await evaluate(`(async () => {
    const v = window.__vector;
    await v.synth.start();
    v.loadPreset('Thomas');
    await new Promise((r) => setTimeout(r, 300));
    v.synth.noteOn(60, 100); v.synth.noteOn(67, 100);
    await new Promise((r) => setTimeout(r, 1600));
    const p = v.peak();
    v.synth.noteOff(60); v.synth.noteOff(67);
    return p;
  })()`);
  const state = await evaluate('document.querySelector("#start").textContent');
  console.log(`audio: ${state}; worklet peak while holding a chord: ${Number(peak).toFixed(3)}`);
  // let the display update, then screenshot the whole page
  await sleep(400);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }) as { data: string };
  mkdirSync('out', { recursive: true });
  writeFileSync('out/screenshot.png', Buffer.from(shot.data, 'base64'));
  console.log('wrote out/screenshot.png');
  const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]'));
  for (const l of logs) console.log('  console', l);
  if (errors.length) { console.error(`${errors.length} console error(s)`); process.exitCode = 1; }
  if (!(Number(peak) > 0.01)) { console.error('no audio from the worklet'); process.exitCode = 1; }
  ws.close();
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { chrome.kill(); server.close(); });

// Site test suite: drives headless Chrome over the DevTools protocol on emulated devices.
// No dependencies: Node 22+ (built-in WebSocket) and an installed Chrome / Edge.
//
//   node tests/site.test.mjs              all devices
//   node tests/site.test.mjs iphone,desktop
//   CHROME="C:/path/chrome.exe" node tests/site.test.mjs
//
// Serves the repo itself (no caching), answers the GitHub photo-list API from the local photos/
// folder (offline, no rate limit) and never opens a visible window. Screenshots of failures go
// to the OS temp folder (path printed at the end). Exit code 1 if any check fails.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-tests-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';
const AND = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';
const DEVICES = {
  desktop: { w: 1920, h: 1080, dpr: 1, touch: false, name: 'Desktop 1920' },
  laptop:  { w: 1366, h: 768,  dpr: 1, touch: false, name: 'Laptop 1366' },
  ipad:    { w: 820,  h: 1180, dpr: 2, touch: true, ua: IPAD, name: 'iPad portrait' },
  android: { w: 412,  h: 915,  dpr: 2.6, touch: true, ua: AND, name: 'Android phone' },
  iphone:  { w: 390,  h: 844,  dpr: 3, touch: true, ua: IOS, name: 'iPhone 15' },
  se:      { w: 375,  h: 667,  dpr: 2, touch: true, ua: IOS, name: 'iPhone SE' },
};
const only = process.argv[2] ? process.argv[2].split(',') : Object.keys(DEVICES);

// ---------- static server (no-store, so Chrome never runs stale files) ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0].split('#')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const PHOTO_LIST = JSON.stringify(fs.readdirSync(path.join(ROOT, 'photos')).map(name => ({ name, type: 'file' })));

// ---------- headless Chrome ----------
const CANDIDATES = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const CHROME = CANDIDATES.find(p => fs.existsSync(p));
if (!CHROME) { console.error('Chrome not found - set CHROME=path'); process.exit(2); }
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'pt-chrome-'))}`,
  '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let tabs;
for (let i = 0; i < 60 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(250); } }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let seq = 0; const pending = new Map(); let errors = [];
ws.addEventListener('message', async ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon|goatcounter|gc\.zgo/.test(m.params.entry.url || m.params.entry.text)) errors.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  if (m.method === 'Fetch.requestPaused') {
    const u = m.params.request.url;
    if (u.includes('api.github.com')) send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(PHOTO_LIST).toString('base64') });
    else if (/goatcounter|gc\.zgo\.at/.test(u)) send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' });
    else send('Fetch.continueRequest', { requestId: m.params.requestId });
  }
});
const send = (method, params = {}) => new Promise(r => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed'); return r.result?.result?.value; };
const go = async (p, wait = 3500) => { await send('Page.navigate', { url: BASE + p }); await sleep(wait); };
const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 }); const f = path.join(OUT, name + '.jpg'); fs.writeFileSync(f, Buffer.from(s.result.data, 'base64')); return f; };
const rect = async sel => JSON.parse(await js(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'null'; var r=e.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,top:r.top,w:r.width,h:r.height,vis:r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'})})()`) || 'null');
let touch = false;
async function tap(x, y) {
  if (touch) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(40);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
}
async function openMenuIfPhone() {
  const t = await rect('.nav-toggle');
  if (t && t.vis && !(await js(`document.querySelector('.nav-links').classList.contains('open')`))) { await tap(t.x, t.y); await sleep(400); }
}
async function tapNav(href) { await openMenuIfPhone(); const a = await rect(`.nav-links a[href="${href}"]`); if (!a || !a.vis) throw new Error('nav link not visible: ' + href); await tap(a.x, a.y); }

// ---------- checks ----------
const results = [];
async function check(dev, name, fn, soft = false) {
  errors = [];
  let ok = false, note = '';
  try { const r = await fn(); ok = r === true || (r && r.ok); note = r && r.note ? r.note : ''; }
  catch (e) { note = 'threw: ' + e.message.split('\n')[0]; }
  if (ok && errors.length) { ok = false; note = (note ? note + '; ' : '') + errors.slice(0, 3).join(' | '); }
  if (!ok) note += ' [' + path.basename(await shot(`${dev}_${name.replace(/\W+/g, '_')}`)) + ']';
  results.push({ dev, name, ok, note, soft });
  console.log(`${ok ? 'PASS' : soft ? 'WARN' : 'FAIL'}  ${dev.padEnd(8)} ${name}${note ? '  - ' + note : ''}`);
}

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Performance.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*api.github.com*' }, { urlPattern: '*goatcounter*' }, { urlPattern: '*gc.zgo.at*' }] });

for (const key of only) {
  const d = DEVICES[key]; if (!d) { console.error('unknown device ' + key); continue; }
  touch = d.touch;
  await send('Emulation.setDeviceMetricsOverride', { width: d.w, height: d.h, deviceScaleFactor: d.dpr, mobile: d.touch, screenWidth: d.w, screenHeight: d.h });
  await send('Emulation.setTouchEmulationEnabled', { enabled: d.touch, maxTouchPoints: d.touch ? 5 : 0 });
  await send('Emulation.setUserAgentOverride', { userAgent: d.ua || '' });
  // pointer type must be set per device, or a desktop run after a phone run still reports a touch screen
  await send('Emulation.setEmulatedMedia', { features: d.touch
    ? [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }, { name: 'any-pointer', value: 'coarse' }, { name: 'any-hover', value: 'none' }]
    : [{ name: 'pointer', value: 'fine' }, { name: 'hover', value: 'hover' }, { name: 'any-pointer', value: 'fine' }, { name: 'any-hover', value: 'hover' }] });
  await send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log(`\n== ${d.name} (${d.w}x${d.h})`);

  for (const page of ['index.html', 'gallery.html', 'press.html']) {
    await check(key, `${page}: loads, no errors, no sideways overflow, cube background`, async () => {
      await go(page);
      const s = JSON.parse(await js(`JSON.stringify({sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth, canvas:!!document.getElementById('wave-bg'), gl:!!(function(){var c=document.getElementById('wave-bg');return c&&(c.getContext('webgl2')||c.getContext('webgl'))})()})`));
      return { ok: s.sw <= s.cw + 1 && s.canvas && s.gl, note: s.sw > s.cw + 1 ? `page is ${s.sw}px wide in a ${s.cw}px screen` : (!s.canvas ? 'no cube canvas' : '') };
    });
  }

  await check(key, 'nav bar stays at the top while scrolling', async () => {
    await go('press.html', 2500);
    await js(`document.documentElement.style.scrollBehavior='auto'; scrollTo(0, 2000); 'ok'`); await sleep(400);
    const top = await js(`Math.round(document.querySelector('nav').getBoundingClientRect().top)`);
    return { ok: Math.abs(top) <= 1, note: `nav top = ${top}` };
  });

  if (d.touch && d.w < 700) {
    await check(key, 'phone menu opens', async () => {
      await go('index.html', 2500); await openMenuIfPhone();
      return await js(`document.querySelector('.nav-links').classList.contains('open')`);
    });
    await check(key, 'Connect icons in one row', async () => {
      await go('index.html', 2500);
      const tops = await js(`[...document.querySelector('.social-row').children].map(c=>Math.round(c.getBoundingClientRect().top))`);
      return { ok: new Set(tops).size === 1, note: `rows at ${[...new Set(tops)].join(', ')}` };
    });
  }

  await check(key, 'Home -> Press: ripple transition, nothing left behind', async () => {
    await go('index.html'); await tapNav('press.html'); await sleep(5000);
    const s = JSON.parse(await js(`JSON.stringify({url:location.pathname, rings:[...document.body.children].filter(e=>e.style&&e.style.zIndex==='2147483000').length, vt:!!document.activeViewTransition})`));
    return { ok: s.url.endsWith('/press.html') && s.rings === 0 && !s.vt, note: JSON.stringify(s) };
  });

  await check(key, 'Home -> Contact (same page): jumps, lands below the nav bar', async () => {
    await go('index.html'); await tapNav('#contact'); await sleep(3500);
    const s = JSON.parse(await js(`JSON.stringify({hash:location.hash, top:Math.round(document.getElementById('contact').getBoundingClientRect().top), menuOpen:document.querySelector('.nav-links').classList.contains('open'), bottom:Math.round(innerHeight+scrollY)>=document.documentElement.scrollHeight-2})`));
    // lands at 60 (bar height), or lower when the page can't scroll any further
    return { ok: s.hash === '#contact' && (Math.abs(s.top - 60) <= 2 || (s.bottom && s.top > 0)) && !s.menuOpen, note: JSON.stringify(s) };
  });

  await check(key, 'Home -> Experience (same page): lands on the Experience list, below the bar', async () => {
    await go('index.html'); await tapNav('#experience'); await sleep(3500);
    const s = JSON.parse(await js(`JSON.stringify({hash:location.hash, top:Math.round(document.getElementById('experience').getBoundingClientRect().top), label:(function(){var l=[...document.querySelectorAll('.cv-section-label')].find(e=>e.textContent.trim()==='Experience');var r=l.getBoundingClientRect();return r.top>60&&r.bottom<innerHeight})()})`));
    return { ok: s.hash === '#experience' && Math.abs(s.top - 60) <= 2 && s.label, note: JSON.stringify(s) };
  });

  await check(key, 'Contact lands on "Connect With Me", not Experience', async () => {
    await go('index.html'); await tapNav('#contact'); await sleep(3500);
    const s = JSON.parse(await js(`JSON.stringify({connect:(function(){var l=[...document.querySelectorAll('.cv-section-label')].find(e=>e.textContent.trim()==='Connect With Me');var r=l.getBoundingClientRect();return r.top>=59&&r.bottom<innerHeight})(), icons:(function(){var r=document.querySelector('.social-row').getBoundingClientRect();return r.top>60&&r.bottom<=innerHeight})()})`));
    return { ok: s.connect && s.icons, note: JSON.stringify(s) };
  });

  await check(key, 'project card with a chooser: opens it, page does not jump to the top', async () => {
    await go('index.html');
    await js(`document.documentElement.style.scrollBehavior='auto'; document.getElementById('multi-rd').scrollIntoView({block:'center'}); 'ok'`); await sleep(500);
    const y0 = await js('Math.round(scrollY)');
    const c = await rect('#multi-rd'); await tap(c.x, c.y); await sleep(1500);
    const s = JSON.parse(await js(`JSON.stringify({y:Math.round(scrollY), popup:document.getElementById('popup-rd').classList.contains('show'), hash:location.hash})`));
    return { ok: Math.abs(s.y - y0) <= 2 && s.popup, note: `scrollY ${y0} -> ${s.y}, chooser open ${s.popup}` };
  });

  await check(key, 'Press -> Contact (other page): arrives without scrolling', async () => {
    await go('press.html'); await tapNav('index.html#contact');
    const ys = [];
    for (const t of [250, 700, 1500, 3500]) { await sleep(t - (ys.length ? [250, 700, 1500, 3500][ys.length - 1] : 0)); ys.push(await js(`Math.round(scrollY)`)); }
    const path_ = await js('location.pathname + location.hash');
    return { ok: path_.endsWith('index.html#contact') && ys.every(y => y === ys[ys.length - 1]) && ys[0] > 500, note: `scrollY over time ${ys.join(' -> ')}` };
  });

  await check(key, 'gallery viewer: open, click-zoom, click-unzoom, close', async () => {
    await go('gallery.html', 4500);
    const tile = await rect('#gallery .gallery-masonry-item');
    if (!tile) return { ok: false, note: 'no gallery tiles' };
    await tap(tile.x, Math.min(tile.y, d.h - 60)); await sleep(1800);
    const opened = await js(`document.getElementById('lightbox').classList.contains('open')`);
    const img = await rect('#lightbox-img');
    await tap(img.x, img.y); await sleep(900);
    const zoomed = await js(`document.getElementById('lightbox-stage').classList.contains('zoomed')`);
    await tap(img.x, img.y); await sleep(900);
    const unzoomed = !(await js(`document.getElementById('lightbox-stage').classList.contains('zoomed')`));
    const c = await rect('#lightbox-close'); await tap(c.x, c.y); await sleep(1800);
    const closed = !(await js(`document.getElementById('lightbox').classList.contains('open')`));
    return { ok: opened && zoomed && unzoomed && closed, note: JSON.stringify({ opened, zoomed, unzoomed, closed }) };
  });

  if (!d.touch) {
    await check(key, 'custom cursor: VIEW over a photo, normal elsewhere', async () => {
      await go('gallery.html', 4500);
      const tile = await rect('#gallery .gallery-masonry-item');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tile.x, y: tile.y }); await sleep(300);
      const over = JSON.parse(await js(`JSON.stringify({on:document.documentElement.classList.contains('fx-cursor'), label:(document.querySelector('.fx-cursor-label')||{}).textContent, photo:document.querySelector('.fx-cursor-ring').classList.contains('is-photo')})`));
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: d.h - 5 }); await sleep(300);
      const off = await js(`document.querySelector('.fx-cursor-ring').classList.contains('is-photo')`);
      return { ok: over.on && over.photo && over.label === 'VIEW' && !off, note: JSON.stringify(over) };
    });
  } else {
    await check(key, 'touch screen: no custom cursor', async () => {
      await go('index.html', 2000);
      return !(await js(`document.documentElement.classList.contains('fx-cursor')`));
    });
  }

  // performance: main-thread cost while idle on Home (cube background + photo wall), budget per class
  await check(key, 'performance budget (idle on Home)', async () => {
    const slow = d.touch && d.w < 700 ? 4 : 1;               // phones: simulate a mid-range CPU
    await send('Emulation.setCPUThrottlingRate', { rate: slow });
    await go('index.html', 5000);
    const m = async () => Object.fromEntries((await send('Performance.getMetrics')).result.metrics.map(x => [x.name, x.value]));
    const a = await m(); const t0 = Date.now();
    const fps = await js(`new Promise(r=>{let n=0,t=performance.now();(function f(){n++; if(performance.now()-t<2500) requestAnimationFrame(f); else r(Math.round(n/((performance.now()-t)/1000)))})()})`);
    const b = await m(); const sec = (Date.now() - t0) / 1000;
    await send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const busy = Math.round((b.TaskDuration - a.TaskDuration) / sec * 1000);
    const budget = slow > 1 ? 450 : 200;                     // ms of main-thread work per second
    return { ok: busy <= budget && fps >= 50, note: `busy ${busy} ms/s (budget ${budget}${slow > 1 ? ', 4x slower CPU' : ''}), ${fps} fps` };
  }, true); // soft: headless draws WebGL on the CPU, so this runs high vs a real GPU - reported, never fails the run
}

// ---------- summary ----------
const failed = results.filter(r => !r.ok && !r.soft), warned = results.filter(r => !r.ok && r.soft);
console.log(`\n${results.length - failed.length - warned.length}/${results.length} passed` + (warned.length ? `, ${warned.length} warning(s)` : '') +
  (failed.length ? `, ${failed.length} FAILED` : '') + (failed.length || warned.length ? ` (screenshots in ${OUT})` : ''));
ws.close(); chrome.kill(); server.close();
process.exit(failed.length ? 1 : 0);

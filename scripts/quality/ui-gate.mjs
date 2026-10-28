// 画面のチェック（G2）: 本物の Chrome（playwright-core。PC に入っている Chrome を使う）で、ビルドしたアプリを開き、
// 画面の幅 × ボタンの大きさ × 動き の組み合わせごとに、見た目と指の操作を確かめる。
//   ・はみ出し・重なり: 上のバー・左のツールバー・下の欄・パネルが画面に収まり、決めた組が重ならない。横にスクロールしない
//   ・点の横の ☑確定: 指でタップした点から離れて、画面の中・下のバーと重ならずに出る。押すと決まる
//   ・スナップのシート: OSNAP を長押し → 指を滑らせて離すと切り替わって閉じる（本物の指の操作。CDP の touch）
//   ・パネル（オプション・座標一覧・UCS 管理）が画面に収まる
//   ・エラー（pageerror・console.error）が出ない
// 撮った画面は .quality/ui/ に置く（見比べ用）。失敗があれば理由を出して終了コード 1。
// 使い方: npm run build のあと npm run ui-gate（CHROME_PATH で Chrome の場所を変えられる）
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, '.quality/ui');
const PORT = 4317;
fs.mkdirSync(OUT, { recursive: true });

const VIEWS = [
    { name: 'phone', width: 390, height: 844, touch: true },
    { name: 'tablet', width: 1024, height: 768, touch: true },
    { name: 'tablet-tall', width: 768, height: 1024, touch: true },
    { name: 'pc', width: 1366, height: 768, touch: false },
];
const BTN = ['m', 'xl'];
const failures = [];
const fail = (run, msg) => failures.push(`[${run}] ${msg}`);

function chromePath() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const c = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
    return c.find((p) => fs.existsSync(p));
}
async function startServer() {
    if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) throw new Error('dist が無いので、先に npm run build してください');
    const viteBin = path.join(ROOT, 'node_modules/vite/bin/vite.js');
    const p = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'pipe' });
    for (let i = 0; i < 100; i++) {
        try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) return p; } catch { /* まだ */ }
        await new Promise((r) => setTimeout(r, 200));
    }
    p.kill();
    throw new Error('プレビューのサーバーが起動しませんでした');
}
const rectOf = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}, sel);
const inside = (r, vw, vh, m = 0.5) => r.x >= -m && r.y >= -m && r.x + r.w <= vw + m && r.y + r.h <= vh + m;
const overlap = (a, b) => a && b && a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;

let dwgChecked = false; // DWG の読込エンジンは最初の1回だけ確かめる
async function runOne(browser, v, btn, motion) {
    const run = `${v.name}・ボタン${btn}・動き${motion ? '入' : '切'}`;
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, hasTouch: v.touch, isMobile: v.touch && v.width < 700,
        reducedMotion: motion ? 'no-preference' : 'reduce', serviceWorkers: 'block' });
    // 安全のヘッダー（CSP）に止められた所を集める（v5.56）
    await ctx.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
    await ctx.addInitScript(({ btn, motion }) => {
        try {
            localStorage.setItem('cad_display_prefs', JSON.stringify({ btnSize: btn, motion: motion ? 'on' : 'off' }));
            localStorage.setItem('cad_guide', JSON.stringify({ welcome: 'never', tours: {}, hintsMode: 'off', hintCounts: {}, tips: {} }));
        } catch { /* 使えなくても続ける */ }
    }, { btn, motion });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_|net::|Failed to load resource/.test(m.text())) errs.push('console.error: ' + m.text().slice(0, 200)); });
    page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(`http://127.0.0.1:${PORT}`)) errs.push(`読み込めないファイル ${r.status()}: ${r.url().replace(`http://127.0.0.1:${PORT}`, '')}`); });
    const resp = await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    const csp = resp && resp.headers()['content-security-policy'];
    const scriptSrc = ((csp || '').match(/script-src ([^;]*)/) || [])[1] || '';
    if (!csp || !/connect-src 'self'[^;]*https:\/\/api\.anthropic\.com/.test(csp) || !/frame-ancestors 'none'/.test(csp) || /https?:|\*/.test(scriptSrc)) fail(run, `安全のヘッダー（CSP）が付いていない・よそのスクリプトを許しています: ${csp || 'なし'}`);
    await page.waitForTimeout(900);
    const shot = (n) => page.screenshot({ path: path.join(OUT, `${v.name}-${btn}-${motion ? 'm' : 'r'}-${n}.png`) });
    const vw = v.width, vh = v.height;

    // ---- 1. 基本の配置 ----
    const parts = {};
    for (const s of ['#top-bar', '#toolbar', '#status-bar']) parts[s] = await rectOf(page, s);
    for (const [s, r] of Object.entries(parts)) {
        if (!r) { fail(run, `${s} が見えません`); continue; }
        if (!inside(r, vw, vh)) fail(run, `${s} が画面からはみ出しています ${JSON.stringify(r)}`);
    }
    if (overlap(parts['#top-bar'], parts['#status-bar'])) fail(run, '上のバーと下の欄が重なっています');
    if (overlap(parts['#toolbar'], parts['#status-bar'])) fail(run, '左のツールバーと下の欄が重なっています');
    const hScroll = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
    if (hScroll > 1) fail(run, `横にスクロールできてしまいます（${hScroll}px）`);
    // ルーペの 🔍（v5.57）: 下のバーの中にあって、ほかのボタンと重ならず、押すと切り替わる
    const lb = await rectOf(page, '#btn-loupe');
    if (!lb || !inside(lb, vw, vh) || overlap(lb, await rectOf(page, '#btn-area-select')) || overlap(lb, await rectOf(page, '#ucs-label'))) fail(run, `ルーペの 🔍 が下のバーに収まっていません ${JSON.stringify(lb)}`);
    else {
        await page.click('#btn-loupe');
        const off = await page.evaluate(() => !loupeEnabled() && document.getElementById('btn-loupe').getAttribute('aria-pressed') === 'false');
        await page.click('#btn-loupe');
        if (!off || !(await page.evaluate(() => loupeEnabled()))) fail(run, 'ルーペの 🔍 を押しても切り替わりません');
    }
    // 下のバーの座標が、公共座標の長い値でも切れずに収まる（v5.57。🔍 を足した分、狭い画面で切れていた）
    const crd = await page.evaluate(() => { setCoordsDisplay(-12345.678, 23456.789); const c = document.getElementById('coords-display'), sb = document.getElementById('status-bar').getBoundingClientRect(), r = c.getBoundingClientRect();
        return { ok: r.right <= sb.right - 2 && [...c.children].every((e) => e.scrollWidth <= e.clientWidth + 1), r: { l: r.left, rr: r.right, sb: sb.right } }; });
    if (!crd.ok) fail(run, `下のバーの座標が切れています ${JSON.stringify(crd.r)}`);
    // たたんだコマンドのボタンの文字が丸に収まる・OSNAP と ▼ が重ならない（v5.51.1）
    const pill = await page.evaluate(() => { const b = document.getElementById('command-pill'); return { sw: b.scrollWidth, cw: b.clientWidth }; });
    if (pill.sw > pill.cw + 1) fail(run, `たたんだコマンドのボタンの文字が切れています（${pill.sw}px / ${pill.cw}px）`);
    if (overlap(await rectOf(page, '#btn-osnap'), await rectOf(page, '#btn-osnap-panel'))) fail(run, 'OSNAP と ▼ が重なっています');
    // 全体表示で、図面の端が左のツールバー・上のバー・下の欄の下に隠れない（v5.51.1）
    const ext = await page.evaluate(() => {
        entities.length = 0;
        entities.push({ type: 'LINE', layer: 0, color: null, x1: 35000, y1: -12000, x2: 35100, y2: -11900 }, { type: 'LINE', layer: 0, color: null, x1: 35000, y1: -11900, x2: 35100, y2: -12000 });
        if (typeof ensureEntityIds === 'function') ensureEntityIds();
        zoomExtents(true);
        const p = [wcsToScreen(35000, -12000), wcsToScreen(35100, -11900)], c = canvas.getBoundingClientRect();
        const box = { x: c.left + Math.min(p[0].x, p[1].x), y: c.top + Math.min(p[0].y, p[1].y), w: Math.abs(p[1].x - p[0].x), h: Math.abs(p[1].y - p[0].y) };
        entities.length = 0; render();
        return box;
    });
    for (const s of ['#top-bar', '#toolbar', '#status-bar']) if (overlap(ext, parts[s])) fail(run, `全体表示で図面の端が ${s} の下に隠れます`);
    await shot('base');

    // ---- 2. 点の横の ☑確定（指の端末だけ） ----
    if (v.touch) {
        const cv = await rectOf(page, '#cad-canvas, canvas');
        await page.evaluate(() => { entities.length = 0; issueCommand('LINE'); });
        const taps = [[0.5, 0.5], [0.92, 0.2], [0.12, 0.85], [0.5, 0.9]];
        for (const [fx, fy] of taps) {
            const x = Math.round(cv.x + cv.w * fx), y = Math.round(cv.y + cv.h * fy);
            // その場所に図面（canvas）が見えているときだけ（ボタンなどの上なら、そのボタンが押される）
            if (!(await page.evaluate(([px, py]) => { const el = document.elementFromPoint(px, py); return !!el && el.id === 'cad-canvas'; }, [x, y]))) continue;
            await page.touchscreen.tap(x, y);
            await page.waitForTimeout(80);
            const b = await rectOf(page, '#line-float-confirm');
            if (!b) { fail(run, `(${x},${y}) をタップしても点の横の ☑確定 が出ません`); continue; }
            if (!inside(b, vw, vh)) fail(run, `点の横の ☑確定 が画面からはみ出しています（タップ ${x},${y} → ${JSON.stringify(b)}）`);
            const bar = await rectOf(page, '#fs-dim-actionbar');
            if (overlap(b, bar)) fail(run, `点の横の ☑確定 が下のバーと重なっています（タップ ${x},${y}）`);
            const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
            if (Math.hypot(cx - x, cy - y) < 40) fail(run, `点の横の ☑確定 がタップした点に近すぎます（${Math.round(Math.hypot(cx - x, cy - y))}px）`);
        }
        await shot('float');
        await page.waitForTimeout(320);
        const b = await rectOf(page, '#line-float-confirm');
        if (b) {
            await page.touchscreen.tap(Math.round(b.x + b.w / 2), Math.round(b.y + b.h / 2));
            await page.waitForTimeout(80);
            const mode = await page.evaluate(() => cmdState.mode);
            if (mode !== 'WAITING_LINE_P2') fail(run, `点の横の ☑確定 を押しても始点が決まりません（${mode}）`);
        }
        await page.evaluate(() => resetCommand());

        // ---- 3. スナップのシート: 長押し → 滑らせて離す（本物の指の操作） ----
        const ob = await rectOf(page, '#btn-osnap');
        if (ob) {
            const cdp = await ctx.newCDPSession(page);
            const sx = ob.x + ob.w / 2, sy = ob.y + ob.h / 2;
            const before = await page.evaluate(() => !!osnapState.cen);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
            await page.waitForTimeout(420);
            const sheet = await rectOf(page, '#snap-sheet');
            await page.waitForTimeout(motion ? 650 : 50);
            const chip = await rectOf(page, '#snap-sheet [data-ss="cen"]');
            if (!sheet || !chip) { fail(run, 'OSNAP の長押しでスナップのシートが開きません'); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
            else {
                const sh = await rectOf(page, '#snap-sheet');
                if (!inside(sh, vw, vh, 2)) fail(run, `スナップのシートが画面からはみ出しています ${JSON.stringify(sh)}`);
                const cx = chip.x + chip.w / 2, cy = chip.y + chip.h / 2;
                for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx + (cx - sx) * i / 6, y: sy + (cy - sy) * i / 6 }] });
                await shot('sheet');
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                await page.waitForTimeout(500);
                const after = await page.evaluate(() => ({ cen: !!osnapState.cen, open: snapSheetIsOpen(), main: !!osnapState.main }));
                if (after.cen === before) fail(run, 'シートで指を滑らせて「中心」の上で離しても切り替わりません');
                if (after.open) fail(run, '切り替えたあと、シートが閉じません');
                if (!after.main) fail(run, '長押しのあと、OSNAP が切れてしまいました');
                await page.evaluate((b0) => { osnapState.cen = b0; }, before);
            }
        }
    }

    // ---- 4. パネルが画面に収まる ----
    for (const [name, fn] of [['オプション', 'showOptionsPanel()'], ['座標一覧', 'showCoordListPanel()'], ['UCS 管理', 'showUcsManager()'], ['画層の色をまとめて変える', "showLayerManagerPanel(); lmBulkColorMode(true); lmBulkPickAll('all')"],
        ['座標表の読み取り結果', "_airead = { files: [], rows: [{ num: '103', name: 'BM-12', x: '-112360.000', y: '123470.500', z: '102.345', unsure: true, why: 'X の 3 が 8 かも', use: true }, { num: '2', name: '', x: '-12350.1O0', y: '23460.000', z: '', unsure: false, why: '', use: true }], unit: 'm', notes: '見出しは X・Y', cost: 0.04, model: 'claude-opus-5-5', mm: false }; aireadRenderReview()"]]) {
        await page.evaluate((f) => { closePropertyPanel(); (0, eval)(f); }, fn);
        await page.waitForTimeout(motion ? 300 : 60);
        const r = await rectOf(page, '#property-panel');
        if (!r) { fail(run, `${name} のパネルが開きません`); continue; }
        if (!inside(r, vw, vh, 2)) fail(run, `${name} のパネルが画面からはみ出しています ${JSON.stringify(r)}`);
    }
    // 画層の色をまとめて変える欄（v5.52）: ボタンがパネルの中に収まり、文字が切れない
    const bulkOut = await page.evaluate(() => { const p = document.getElementById('property-panel').getBoundingClientRect();
        return [...document.querySelectorAll('.lm-bulk button, .lm-bulk input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > p.right + 1 || r.left < p.left - 1 || e.scrollWidth > e.clientWidth + 2); }).map((e) => e.textContent.trim() || e.id); });
    if (bulkOut.length) fail(run, `画層の色をまとめて変える欄がはみ出しています: ${bulkOut.join(', ')}`);
    // 座標表の読み取り結果（v5.55）: 値の欄がパネルに収まり、重ならず、数が切れない（スマホの幅でも X・Y・標高が全部見える）
    const ai = await page.evaluate(() => {
        closePropertyPanel();
        _airead = { files: [], rows: [{ num: '103', name: 'BM-12', x: '-112360.000', y: '123470.500', z: '102.345', unsure: true, why: '確認', use: true }], unit: 'm', notes: '', cost: 0, model: 'claude-opus-5-5', mm: false };
        aireadRenderReview();
        const p = document.getElementById('property-panel').getBoundingClientRect();
        const cells = [...document.querySelectorAll('#airead-review .airead-cell')];
        const bad = cells.filter((e) => { const r = e.getBoundingClientRect(); return r.width < 1 || r.right > p.right + 1 || r.left < p.left - 1 || e.scrollWidth > e.clientWidth + 1; }).map((e) => e.dataset.key);
        for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) { const a = cells[i].getBoundingClientRect(), b = cells[j].getBoundingClientRect(); if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad.push(cells[i].dataset.key + '×' + cells[j].dataset.key); }
        _airead = null; closePropertyPanel();
        return { n: cells.length, bad };
    });
    if (ai.n !== 5 || ai.bad.length) fail(run, `座標表の読み取り結果の欄が収まりません: ${ai.bad.join(', ') || ai.n + '個'}`);
    // 書き出したあとの知らせ（📤 送る と ☁ Dropbox へ の2つのボタン）が画面に収まる（v5.54）
    const snk = await page.evaluate(async () => {
        localStorage.setItem('cad_dropbox_key', 'uigate1234ab'); closePropertyPanel();
        const oc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
        try { await downloadBlob(new Blob(['x']), 'ゲートの確認_とても長い名前の図面ファイル.dxf', undefined, { named: true }); } finally { HTMLAnchorElement.prototype.click = oc; localStorage.removeItem('cad_dropbox_key'); }
        const s = document.getElementById('cad-snack'); if (!s || !s.classList.contains('show')) return { shown: false };
        const r = s.getBoundingClientRect(); const btns = [...s.querySelectorAll('.sn-act')].filter((b) => b.style.display !== 'none').map((b) => { const q = b.getBoundingClientRect(); return { t: b.textContent, x: q.x, y: q.y, w: q.width, h: q.height }; });
        hideSnack(); return { shown: true, r: { x: r.x, y: r.y, w: r.width, h: r.height }, btns };
    });
    if (!snk.shown) fail(run, '書き出したあとの知らせが出ません');
    else {
        if (!inside(snk.r, vw, vh, 2)) fail(run, `書き出したあとの知らせが画面からはみ出しています ${JSON.stringify(snk.r)}`);
        if (!snk.btns.some((b) => b.t === '☁ Dropbox へ')) fail(run, '書き出したあとの知らせに「☁ Dropbox へ」がありません');
        for (const b of snk.btns) if (!inside(b, vw, vh, 2)) fail(run, `知らせのボタン「${b.t}」が画面からはみ出しています`);
    }
    // 座標読取の ＋ は、読んだ点を画面の同じ場所に置いたまま拡大する（v5.52）
    const fsz = await page.evaluate(() => { document.body.classList.add('fullscreen-mode'); const w = screenToWcs(canvas.width * 0.3, canvas.height * 0.6);
        const u = wcsToUcs(w.x, w.y); updateFsCoordTooltip(0, 0, u.x, u.y, null, true); const p0 = wcsToScreen(w.x, w.y); fsZoomIn(); const p1 = wcsToScreen(w.x, w.y);
        document.body.classList.remove('fullscreen-mode'); window._fsZoomAnchor = null; return Math.hypot(p1.x - p0.x, p1.y - p0.y); });
    if (!(fsz < 0.5)) fail(run, `座標読取の ＋ で、読んだ点が動きます（${fsz}px）`);
    await shot('panel');
    await page.evaluate(() => closePropertyPanel());

    // あとから読む部品（Claude の SDK・PDF の表示）が CSP の下でも読める。止められた所が無い
    const lazy = await page.evaluate(async () => { const out = []; try { const k = await window.loadClaudeSdk(); k.z.object({ a: k.z.string() }).safeParse({ a: 'x' }); k.betaZodOutputFormat(k.z.object({ a: k.z.string() })); out.push('claude'); } catch (e) { out.push('claude NG ' + e.message); } try { await window.loadPdfJs(); out.push('pdf'); } catch (e) { out.push('pdf NG ' + e.message); } return out; });
    if (lazy.join() !== 'claude,pdf') fail(run, `あとから読む部品が読めません: ${lazy.join(' / ')}`);
    if (!dwgChecked) {
        dwgChecked = true;
        const dwg = await page.evaluate(async () => { try { const m = await window.loadLibreDwg(); const L = m.LibreDwg || (m.default && m.default.LibreDwg); if (!L || typeof L.create !== 'function') return 'LibreDwg.create が無い'; await L.create(); return 'ok'; } catch (e) { return 'NG ' + (e && e.message || e); } });
        if (dwg !== 'ok') fail(run, `DWG の読込エンジンが動きません（CSP?）: ${dwg}`);
    }
    const viol = await page.evaluate(() => window.__csp || []);
    if (viol.length) fail(run, `CSP に止められました: ${[...new Set(viol)].slice(0, 5).join(' / ')}`);
    if (errs.length) fail(run, 'エラー: ' + [...new Set(errs)].slice(0, 5).join(' / '));
    await ctx.close();
}

const exe = chromePath();
if (!exe) { console.error('✖ Chrome が見つかりません（CHROME_PATH で場所を指定してください）'); process.exit(1); }
const server = await startServer();
const browser = await chromium.launch({ executablePath: exe, headless: true });
const t0 = Date.now();
let runs = 0;
try {
    for (const v of VIEWS) for (const btn of BTN) { await runOne(browser, v, btn, false); runs++; }
    await runOne(browser, VIEWS[1], 'm', true); runs++; // 動き 入（バネ・ポップ）も1回
} finally {
    await browser.close();
    server.kill();
}
const sec = ((Date.now() - t0) / 1000).toFixed(1);
if (failures.length) {
    console.error(`✖ 画面のチェック（G2）: ${failures.length} 件（${runs} 通り・${sec} 秒。画面は .quality/ui/）\n` + failures.map((f) => '  - ' + f).join('\n'));
    process.exit(1);
}
console.log(`✔ 画面のチェック（G2）: ${runs} 通り（幅 ${VIEWS.length} × ボタンの大きさ ${BTN.length} ＋ 動き入）すべて通りました（${sec} 秒。画面は .quality/ui/）`);

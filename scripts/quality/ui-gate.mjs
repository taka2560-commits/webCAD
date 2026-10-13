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

async function runOne(browser, v, btn, motion) {
    const run = `${v.name}・ボタン${btn}・動き${motion ? '入' : '切'}`;
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, hasTouch: v.touch, isMobile: v.touch && v.width < 700,
        reducedMotion: motion ? 'no-preference' : 'reduce', serviceWorkers: 'block' });
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
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
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
    for (const [name, fn] of [['オプション', 'showOptionsPanel()'], ['座標一覧', 'showCoordListPanel()'], ['UCS 管理', 'showUcsManager()']]) {
        await page.evaluate((f) => { closePropertyPanel(); (0, eval)(f); }, fn);
        await page.waitForTimeout(motion ? 300 : 60);
        const r = await rectOf(page, '#property-panel');
        if (!r) { fail(run, `${name} のパネルが開きません`); continue; }
        if (!inside(r, vw, vh, 2)) fail(run, `${name} のパネルが画面からはみ出しています ${JSON.stringify(r)}`);
    }
    await shot('panel');
    await page.evaluate(() => closePropertyPanel());

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

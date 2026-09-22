'use strict';
// 操作ガイド（cad-guide.js）のテスト:
//   初回の案内、ツアー（練習用の図面・操作で進む・元の図面に戻る・保存しない）、座標読取モードのツアー、
//   操作中のヒント、つまずいたときの一言、ヘルプ、ツアーが指す画面の部品が実在すること、ポリラインの完了
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

describe('操作ガイド: 初回の案内', () => {
    it('はじめて使う人には、起動後に「はじめての方へ」を出す', async () => {
        const app = await loadApp({ firstRun: true });
        try {
            await wait(1100); // 起動から約1.5秒後
            const card = app.window.document.getElementById('guide-card');
            assert.ok(card && card.style.display === 'block', '案内が出ていない');
            assert.match(card.textContent, /はじめての方へ/);
            // 「あとで」→ 閉じて、次回また出す
            app.eval(`guideWelcomeAnswer('later')`);
            assert.equal(card.style.display, 'none');
            assert.equal(JSON.parse(app.eval(`localStorage.getItem('cad_guide')`)).welcome, 'later');
            assert.deepEqual(app.errors(), []);
        } finally { app.close(); }
    });
    it('以前から使っている人には、案内ではなく一度だけお知らせを出す', async () => {
        const app = await loadApp({ firstRun: true, storage: { cad_canvas_bg: '#000' } });
        try {
            await wait(1100);
            assert.notEqual(app.window.document.getElementById('guide-card')?.style.display, 'block');
            assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /操作ガイドができました/);
            assert.equal(JSON.parse(app.eval(`localStorage.getItem('cad_guide')`)).welcome, 'notice');
        } finally { app.close(); }
    });
    it('「表示しない」を選ぶと、もう出さない', async () => {
        const app = await loadApp({ firstRun: true });
        try {
            await wait(1100);
            app.eval(`guideWelcomeAnswer('never')`);
            app.eval(`_guideStartup(0)`);
            assert.equal(app.window.document.getElementById('guide-card').style.display, 'none');
        } finally { app.close(); }
    });
});

describe('操作ガイド: ツアー', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    beforeEach(() => {
        app.eval(`
            if (guideTourActive()) endGuideTour(false);
            GUIDE_STEP_DONE_MS = 0;
            resetCommand(); entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
            localStorage.removeItem('cad_survey_unit');
            view = { x: 400, y: 300, scale: 1, rotation: 0 };
        `);
    });
    const step = () => app.eval('_tour ? _tour.def.steps[_tour.i].title : null');
    const tick = async () => { app.eval('_tourTick()'); await wait(5); };

    it('はじめてツアー: 練習用の図面を出し、操作すると次へ進む', async () => {
        app.eval(`startGuideTour('basic')`);
        assert.equal(step(), 'ようこそ');
        assert.ok(app.eval('entities.length') >= 10, '練習用の図面');
        assert.equal(app.eval('window._drawingName'), '練習用図面');
        assert.match(app.eval(`document.getElementById('guide-card').textContent`), /1 \/ 12/);
        app.eval('guideTourNext()');
        assert.equal(step(), '拡大・縮小');
        // 拡大すると進む
        app.eval('view.scale *= 1.5;'); await tick();
        assert.equal(step(), '画面を動かす');
        app.eval('view.x += 120;'); await tick();
        assert.equal(step(), '全体を表示');
        app.eval('zoomExtents()'); await wait(5);
        assert.equal(step(), '図形を選ぶ');
        // 区画の線をタップ（選択）
        app.eval(`cmdState.highlightIdx = entities.findIndex(e => e.type === 'PLINE');`); await tick();
        assert.equal(step(), 'ルーペと座標');
        app.eval(`guideNotify('idleDrag')`); await wait(5); // スマホ: 1本指でなぞる（ルーペ）と進む
        assert.equal(step(), '測ってみる');
        app.eval(`processCommand('MEASURE')`); await tick();
        assert.equal(step(), '基点を決める');
        app.eval(`handlePointInput(surveyToWcs(0, 0), true)`); await tick();
        assert.equal(step(), '距離を読む');
        app.eval(`mouse.wcsX = surveyToWcs(20, 30).x; mouse.wcsY = surveyToWcs(20, 30).y; snapResult = null; measureWriteDims();`); await wait(5);
        assert.equal(step(), '元に戻す');
        app.eval('undo()'); await wait(5);
        assert.equal(step(), '保存');
        app.eval('saveProject()'); await wait(5);
        assert.equal(step(), 'おわり');
        app.eval('endGuideTour(true)');
        assert.equal(app.eval('guideTourActive()'), false);
        assert.equal(JSON.parse(app.eval(`localStorage.getItem('cad_guide')`)).tours.basic, 'done');
    });

    it('PC では「カーソルを動かす」でルーペと座標の手順が進む', async () => {
        app.eval(`isMobile = () => false; startGuideTour('basic'); _tourGo(5);`);
        assert.equal(step(), 'ルーペと座標');
        assert.match(app.eval(`document.getElementById('guide-card').textContent`), /カーソルを動かす/);
        app.eval('mouse.screenX += 200;'); await tick();
        assert.equal(step(), '測ってみる');
        app.eval(`endGuideTour(false); isMobile = () => true;`);
    });

    it('ツアーが終わると、開いていた図面・元に戻す履歴・表示位置に戻る', () => {
        app.eval(`
            saveUndo(); entities.push({ type: 'LINE', layer: 0, color: null, x1: 1, y1: 2, x2: 3, y2: 4 });
            setDrawingName('現場A'); view = { x: 11, y: 22, scale: 3, rotation: 0 };
        `);
        const before = app.val('{ n: entities.length, e: entities[0], undo: undoStack.length }');
        app.eval(`startGuideTour('basic')`);
        assert.notEqual(app.eval('entities.length'), 1);
        app.eval('endGuideTour(false)');
        const e = app.val('entities[0]');
        assert.equal(app.eval('entities.length'), before.n);
        assert.deepEqual([e.x1, e.y1, e.x2, e.y2], [1, 2, 3, 4]);
        assert.equal(app.eval('undoStack.length'), before.undo);
        assert.equal(app.eval('window._drawingName'), '現場A');
        assert.deepEqual(app.val('[view.x, view.y, view.scale]'), [11, 22, 3]);
    });

    it('ツアー中は練習用の図面を保存しない（自動保存・💾保存とも）', async () => {
        app.eval(`startGuideTour('basic')`);
        assert.equal(await app.eval('_doAutoSave()'), false);
        const n = await app.eval(`(async () => { await saveProject('ガイドのテスト'); return (await _dbGetAll(STORE_PROJECTS)).length; })()`);
        assert.equal(n, 0, '保存一覧に練習用の図面が増えない');
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /実際には保存しません/);
        app.eval('endGuideTour(false)');
    });

    it('ツアー中にファイルを開くと、先に元の図面へ戻してツアーを終える', () => {
        app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 5, y2: 5 });`);
        app.eval(`startGuideTour('basic')`);
        app.eval('guideBeforeFileOpen()');
        assert.equal(app.eval('guideTourActive()'), false);
        assert.equal(app.eval('entities.length'), 1);
    });

    it('座標読取モードのツアー: 入る → なぞって読む → … → 通常の画面に戻る', async () => {
        app.eval(`osnapState.main = true; startGuideTour('fullscreen')`);
        assert.equal(step(), '座標読取モードに入る');
        app.eval(`document.body.classList.add('fullscreen-mode')`); await tick();
        assert.equal(step(), 'なぞって読む');
        const c = app.val('surveyToWcs(20, 30)');
        app.eval(`snapResult = { wcsX: ${c.x}, wcsY: ${c.y}, type: '端点' };`); await tick();
        assert.equal(step(), '座標を残す');
        assert.equal(app.eval(`document.getElementById('guide-card').className`), 'gc-fs'); // 右端のボタンを隠さない幅
        app.eval('guideTourNext()');
        assert.equal(step(), '拡大・縮小');
        app.eval('view.scale *= 2;'); await tick();
        assert.equal(step(), 'スナップの設定');
        app.eval('guideTourNext()'); assert.equal(step(), '全体を表示');
        app.eval('zoomExtents()'); await wait(5);
        assert.equal(step(), '道具箱を開く');
        app.eval(`const d = document.getElementById('fs-tools-drawer'); d.classList.remove('fs-drawer-closed'); d.classList.add('fs-drawer-open');`); await tick();
        assert.equal(step(), '道具箱の中身');
        app.eval('guideTourNext()');
        assert.equal(app.eval(`document.getElementById('fs-tools-drawer').classList.contains('fs-drawer-open')`), false); // 道具箱を閉じる
        assert.equal(step(), '通常の画面に戻る');
        app.eval(`document.body.classList.remove('fullscreen-mode')`); await tick();
        assert.equal(step(), 'おわり');
        app.eval('endGuideTour(true)');
    });

    it('ツアーが指し示すボタン・パネルはすべて画面に実在する', () => {
        const missing = app.val(`(function(){
            buildOsnapPanel(); showOptionsPanel();
            const out = [];
            Object.entries(GUIDE_TOURS).forEach(([id, t]) => t.steps.forEach(s => {
                const tg = s.target; if (!tg || tg === 'canvas' || (typeof tg === 'object' && !Array.isArray(tg))) return;
                (Array.isArray(tg) ? tg : [tg]).forEach(sel => { if (!document.querySelector(sel)) out.push(id + ': ' + s.title + ' → ' + sel); });
            }));
            hidePropertyPanel();
            return out;
        })()`);
        assert.deepEqual(missing, []);
    });

    it('すべてのツアーを始めて終えてもエラーにならない', () => {
        app.val('Object.keys(GUIDE_TOURS)').forEach(id => {
            app.eval(`startGuideTour('${id}'); for (let i = 0; i < 20 && guideTourActive(); i++) { _tourTick(); guideTourSkip(); }`);
            assert.equal(app.eval('guideTourActive()'), false, id);
        });
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});

describe('操作ガイド: 操作中のヒントと一言', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`resetCommand(); _guide = { welcome: 'never' }; _guideSave(); _hintSession = null; entities.length = 0;
            document.getElementById('guide-tip') && (document.getElementById('guide-tip').style.display = 'none');`);
    });
    const hint = () => app.eval(`(function(){ const h = document.getElementById('guide-hint'); return h && h.style.display === 'block' ? h.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);

    it('コマンドを始めると手順カードが出て、操作が進むと次の手順に変わる', async () => {
        app.eval(`processCommand('LINE')`); await wait(5);
        assert.match(hint(), /線分.*1\/2.*始点/);
        app.eval('handlePointInput({ x: 0, y: 0 }, true)'); await wait(5);
        assert.match(hint(), /2\/2.*次の点/);
        app.eval('resetCommand()'); await wait(5);
        assert.equal(hint(), null);
    });
    it('基点測定・ポリラインの手順', async () => {
        app.eval(`processCommand('MEASURE')`); await wait(5);
        assert.match(hint(), /基点測定.*基点/);
        app.eval('handlePointInput({ x: 0, y: 0 }, true)'); await wait(5);
        assert.match(hint(), /記入/);
        app.eval(`resetCommand(); processCommand('PLINE')`); await wait(5);
        assert.match(hint(), /始点/);
        app.eval('handlePointInput({ x: 0, y: 0 }, true)'); await wait(5);
        assert.match(hint(), /完了/);
    });
    it('「最初の3回」: 同じコマンドは3回まで出し、4回目からは出さない', async () => {
        for (let i = 0; i < 3; i++) { app.eval(`processCommand('RECTANG')`); await wait(5); assert.ok(hint(), `${i + 1}回目`); app.eval('resetCommand()'); await wait(5); }
        app.eval(`processCommand('RECTANG')`); await wait(5);
        assert.equal(hint(), null);
        // 「常に」なら出す
        app.eval(`resetCommand(); setGuideHintsMode('always'); processCommand('RECTANG')`); await wait(5);
        assert.ok(hint());
        // 「出さない」
        app.eval(`resetCommand(); setGuideHintsMode('off'); processCommand('RECTANG')`); await wait(5);
        assert.equal(hint(), null);
    });
    it('✕ で、そのコマンドの間は隠す', async () => {
        app.eval(`processCommand('LINE')`); await wait(5);
        app.eval('guideHideHintForCommand()');
        app.eval('handlePointInput({ x: 0, y: 0 }, true)'); await wait(5);
        assert.equal(hint(), null);
    });
    it('1本指でなぞって画面を動かそうとしたら「2本指で」と一言（スマホ）', () => {
        app.eval(`isMobile = () => true; guideNotify('idleDrag'); guideNotify('idleDrag');`);
        assert.match(app.eval(`document.getElementById('guide-tip').textContent`), /2本指/);
    });
    it('寸法で ☑確定 を押さずに指を離し続けたら一言', async () => {
        app.eval(`processCommand('DIMLINEAR')`); await wait(5);
        app.eval(`guideNotify('dimTouchEnd'); guideNotify('dimTouchEnd');`);
        assert.match(app.eval(`document.getElementById('guide-tip').textContent`), /☑確定/);
    });
    it('コマンドの最初で止まっていたら一言と手順カード', async () => {
        app.eval(`GUIDE_STUCK_MS = 30; _guide.hintCounts = { LINE: 9 }; processCommand('LINE')`); await wait(5);
        assert.equal(hint(), null); // 4回目以降なので手順カードは出ていない
        await wait(60);
        assert.match(app.eval(`document.getElementById('guide-tip').textContent`), /❌終了/);
        assert.ok(hint(), '止まっていたので手順カードを出し直す');
        app.eval('GUIDE_STUCK_MS = 25000;');
    });
    it('長押しで削除したら「↩ で戻せる」と一言', () => {
        app.eval(`guideNotify('longPressDelete')`);
        assert.match(app.eval(`document.getElementById('guide-tip').textContent`), /↩/);
    });
    it('同じ一言は決まった回数までしか出さない', () => {
        for (let i = 0; i < 5; i++) app.eval(`guideShowTip('longPress')`);
        assert.equal(JSON.parse(app.eval(`localStorage.getItem('cad_guide')`)).tips.longPress, 3);
    });

    it('ヘルプ: ツアー・機能ごとの説明・コマンド一覧・ヒントの設定', () => {
        app.eval('showGuideHelp()');
        const t = app.eval(`document.getElementById('property-panel-content').textContent`);
        for (const w of ['はじめてツアー', '座標読取モードのツアー', '画面の動かし方', 'スナップ', '保存とオフライン', 'コマンド一覧', 'MEASURE', '最初の3回']) assert.match(t, new RegExp(w));
        assert.ok(app.eval(`document.querySelectorAll('#property-panel-content .gh-topic button').length`) >= 5, '「やってみる」');
        assert.ok(app.eval(`!!document.getElementById('menu-guide-btn') && !!document.getElementById('fs-btn-help') && !!document.getElementById('guide-help-btn')`));
        app.eval('hidePropertyPanel()');
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});

describe('ポリラインの完了（スマホでも完了できる）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => app.eval(`resetCommand(); entities.length = 0;`));

    it('画面下に ☑確定（完了）と ⭘閉じる が出て、☑確定 で完了する', () => {
        app.eval(`processCommand('PLINE')`);
        assert.equal(app.eval(`document.getElementById('pline-close-btn').style.display`), '');
        app.eval(`handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 10, y: 0 }, true); dimConfirmPoint();`);
        const e = app.val('entities[0]');
        assert.equal(e.type, 'PLINE'); assert.equal(e.closed, false); assert.equal(e.points.length, 2);
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.equal(app.eval(`document.getElementById('pline-close-btn').style.display`), 'none');
    });
    it('⭘閉じる で閉じた形になる（3点以上）', () => {
        app.eval(`processCommand('PLINE'); handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 10, y: 0 }, true); plineCloseFromBar();`);
        assert.equal(app.eval('entities.length'), 0, '2点では閉じない');
        app.eval(`handlePointInput({ x: 10, y: 10 }, true); plineCloseFromBar();`);
        assert.equal(app.val('entities[0].closed'), true);
    });
    it('「複線」をもう一度押しても、❌終了 でも、描いた部分は残る', () => {
        app.eval(`toggleCommand('PLINE'); handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 10, y: 0 }, true); toggleCommand('PLINE');`);
        assert.equal(app.eval('entities.length'), 1);
        app.eval(`processCommand('PLINE'); handlePointInput({ x: 0, y: 5 }, true); handlePointInput({ x: 10, y: 5 }, true); processCommand('CANCEL');`);
        assert.equal(app.eval('entities.length'), 2);
    });
    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});

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
                // 初めから画面にある部品だけ（パネルの中の部品 { sel }・図面の点・関数で決まる所は、機能のツアーのテストで確かめる）
                const tg = s.target; if (!tg || tg === 'canvas' || typeof tg === 'function' || (typeof tg === 'object' && !Array.isArray(tg))) return;
                (Array.isArray(tg) ? tg : [tg]).forEach(sel => { if (!document.querySelector(sel)) out.push(id + ': ' + s.title + ' → ' + sel); });
            }));
            hidePropertyPanel();
            return out;
        })()`);
        assert.deepEqual(missing, []);
    });

    // ---- 機能の練習ツアー（cad-guide-tours.js）: 書いてあるとおりに操作すると最後まで進み、指す部品がそのとき画面にある ----
    const targetOk = () => app.eval(`(() => { const s = _tour.def.steps[_tour.i], sel = _tourTargetSel(_tourTargetSpec(s)); return !sel || sel === 'canvas' || !!document.querySelector(sel); })()`);
    const at = async (title) => { await tick(); assert.equal(step(), title); assert.equal(targetOk(), true, `「${title}」の指す部品が無い`); };
    // 図面の測点 (X, Y) に吸い付けて指定する（点の指定・区画のタップ）
    const pickAt = (X, Y) => app.eval(`(() => { const w = _gP(${X}, ${Y}), s = wcsToScreen(w.x, w.y); mouse.screenX = s.x; mouse.screenY = s.y; mouse.wcsX = w.x; mouse.wcsY = w.y;
        snapResult = { wcsX: w.x, wcsY: w.y, type: '端点' }; handlePointInput({ x: w.x, y: w.y }, false); })()`);
    const done = async () => { await tick(); assert.equal(step(), 'おわり'); app.eval('endGuideTour(true)'); assert.equal(app.eval('guideTourActive()'), false); };

    it('測量計算のツアー: メニュー → 求積（区画をタップ）→ 逆計算（A→C）。終わると点の欄・求積の対象は元に戻る', async () => {
        app.eval(`_cogo.slots = { IA: { x: 1, y: 2, name: '元の点' } }; _cogo.area = null; _cogo.tab = 'pt'; startGuideTour('cogo')`);
        await at('メニューを開く');
        assert.deepEqual(app.val('_cogo.slots'), {}, 'ツアーの間は点の欄を空に');
        app.eval('toggleTopMenu()'); await at('🧮 測量計算');
        app.eval('showCogoPanel(); toggleTopMenu();'); await at('区画を選ぶ'); // 「求積」タブはもう開いているので飛ばす
        app.eval('cogoPickLot()'); await at('区画をタップ');
        pickAt(10, 15); await at('求積表');
        assert.match(app.eval(`document.getElementById('cogo-result').textContent`), /600\.00/);
        app.eval('guideTourNext()'); await at('逆計算');
        app.eval(`cogoSetTab('inv')`); await at('始点を指定');
        app.eval(`cogoPick('IA')`); await tick();
        assert.equal(app.val('_tourTargetSpec(_tour.def.steps[_tour.i]).r'), 34, '指定の途中は図面の点を指す');
        pickAt(0, 0); await at('終点を指定');
        pickAt(20, 30); await at('距離と方向角');
        assert.match(app.eval(`document.getElementById('cogo-result').textContent`), /36\.056 m/);
        app.eval('guideTourNext()'); await done();
        assert.equal(app.val('_cogo.slots.IA.name'), '元の点');
        assert.equal(app.eval('_cogo.tab'), 'pt');
        assert.equal(app.eval(`document.getElementById('property-panel').style.display`), 'none');
    });

    it('SIMA の変換のツアー: 練習用の SIMA → 別窓の点 A → 図面の A → 点名で組 → 取り込み。終わると取り込んだ点も変換の状態も消える', async () => {
        app.eval(`startGuideTour('helm')`);
        await at('変換の画面');
        assert.equal(app.eval('_cogo.tab'), 'helm');
        app.eval('guideTourNext()'); await at('SIMA を読み込む');
        app.eval('guideTourAct()'); await at('別窓の点をタップ');
        assert.equal(app.eval('_helm.src.points.length'), 7);
        app.eval(`helmSelectSource(_gtHelmIdx('A'))`); await at('図面で同じ点を指定');
        pickAt(0, 0); await at('点名で組にする');
        app.eval('helmPairByName()'); await at('精度を確かめる');
        assert.equal(app.eval('_helm.pairs.length'), 4);
        assert.ok(app.eval('_helm.sol.sigma0') < 0.002, '練習用の SIMA は mm まで合う');
        assert.ok(Math.abs(app.eval('_helm.sol.rot') * 180 / Math.PI - 25) < 0.01, '右回り 25°');
        app.eval('guideTourNext()'); await at('図面に取り込む');
        app.eval('helmImport()'); await tick();
        assert.ok(app.eval(`layers.some(l => l.name === '変換_練習用')`));
        await done();
        assert.equal(app.eval('_helm.src'), null);
        assert.equal(app.eval(`layers.some(l => l.name === '変換_練習用')`), false, '練習の取り込みは消える');
        assert.equal(app.eval(`document.getElementById('helm-view').style.display`), 'none');
    });

    it('杭打ちのツアー: 器械点から → 器械点 A・後視点 B → C へ → ✓済。終わると杭打ちの状態は元に戻る', async () => {
        app.eval(`_stake.mode = 'gnss'; startGuideTour('stake')`);
        await at('杭打ちの画面');
        app.eval('guideTourNext()'); await at('器械点から');
        app.eval(`stakeSetMode('ts')`); await at('器械点を指定');
        app.eval(`cogoPick('KS', 'stake')`); pickAt(0, 0); await at('後視点を指定');
        pickAt(0, 30); await at('次の杭へ');
        app.eval('stakeStep(1); stakeStep(1);'); await at('夾角と距離');
        assert.match(app.eval(`document.getElementById('stake-result').textContent`), /夾角/);
        app.eval('guideTourNext()'); await at('✓ 済');
        app.eval('stakeToggleDone()'); await done();
        assert.equal(app.eval('_stake.mode'), 'gnss');
        assert.equal(app.eval('_cogo.slots.KS'), undefined);
    });

    it('点を動かすツアー: 線を選ぶ → 端の点を動かす → 元に戻す → 選んだ図形のバー', async () => {
        app.eval(`startGuideTour('grip')`);
        await at('線を選ぶ');
        app.eval('_gtSelectRoad()'); await at('端の点を動かす');
        app.eval('saveUndo(); entities[_gtRoadIdx()].x2 += 5;'); await at('元に戻す');
        app.eval('undo()'); await at('選んだ図形のバー');
        assert.equal(app.eval(`document.getElementById('sel-actionbar').style.display`), 'flex');
        app.eval('guideTourNext()'); await done();
    });

    it('写真・メモのツアー: ピンを立てる → 場所 → メモ → 一覧へ。終わると練習のピンは消える', async () => {
        const pins = () => app.eval(`entities.filter(e => e && e.type === 'PIN').length`);
        const before = pins();
        app.eval(`startGuideTour('photo')`);
        await at('ピンを立てる');
        app.eval('photoStartAdd()'); await at('ピンの場所');
        pickAt(20, 30); await at('メモと写真');
        app.eval('guideTourNext()'); await at('一覧へ戻る');
        app.eval('showPhotoPanel()'); await done();
        assert.equal(pins(), before);
    });

    it('印刷のツアー: 縮尺を選ぶ → 枠の中に入れる → PDF。終わると印刷の設定は元に戻る', async () => {
        app.eval(`localStorage.setItem(PRINT_OPTS_KEY, JSON.stringify({ paper: 'A4', scale: 1000 })); startGuideTour('print')`);
        await at('印刷・PDF の画面');
        app.eval('guideTourNext()'); await at('縮尺を選ぶ');
        app.eval(`printSet('scale', 250)`); await at('枠の中に入れる');
        app.eval('view.x += 150;'); await at('PDF にする');
        app.eval('guideTourNext()'); await done();
        assert.deepEqual(JSON.parse(app.eval(`localStorage.getItem(PRINT_OPTS_KEY)`)), { paper: 'A4', scale: 1000 });
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
    it('長押しで削除したときは、一言ではなくトーストで知らせる（二重に出さない）', () => {
        app.eval(`document.getElementById('guide-tip') && (document.getElementById('guide-tip').style.display = 'none'); guideNotify('longPressDelete')`);
        assert.notEqual(app.eval(`(document.getElementById('guide-tip') || { style: {} }).style.display`), 'block');
    });
    it('同じ一言は決まった回数までしか出さない', () => {
        for (let i = 0; i < 5; i++) app.eval(`guideShowTip('dimConfirm')`);
        assert.equal(JSON.parse(app.eval(`localStorage.getItem('cad_guide')`)).tips.dimConfirm, 3);
    });

    it('ヘルプ: ツアー・機能ごとの説明・コマンド一覧・ヒントの設定', () => {
        app.eval('showGuideHelp()');
        const t = app.eval(`document.getElementById('property-panel-content').textContent`);
        for (const w of ['はじめてツアー', '座標読取モードのツアー', '画面の動かし方', 'スナップ', '保存とオフライン', 'コマンド一覧', 'MEASURE', '最初の3回']) assert.match(t, new RegExp(w));
        assert.ok(app.eval(`document.querySelectorAll('#property-panel-content .gh-topic button').length`) >= 5, '「やってみる」');
        assert.ok(app.eval(`!!document.getElementById('menu-guide-btn') && !!document.getElementById('fs-btn-help') && !!document.getElementById('guide-help-btn')`));
        app.eval('hidePropertyPanel()');
    });

    const box = `document.getElementById('property-panel-content')`;
    const shown = () => app.val(`[...${box}.querySelectorAll('.gh-cat .gh-topic[data-id]')].filter(d => d.style.display !== 'none').map(d => d.dataset.id)`);
    it('ヘルプ: 分類ごとに、手順（番号つき）とコツに分けた説明。すべての説明の分類・ツアー・開く が正しい', () => {
        app.eval('showGuideHelp()');
        const t = app.eval(`${box}.textContent`);
        for (const c of ['はじめに', '描く・直す', '測る・寸法', '測量', '図面・ファイル・印刷', '表示・設定', '困ったとき']) assert.match(t, new RegExp(c));
        assert.ok(app.eval(`${box}.querySelectorAll('.gh-topic[data-id] ol.gh-steps li').length`) >= 150, '手順');
        assert.ok(app.eval(`${box}.querySelectorAll('.gh-topic[data-id] ul.gh-tips li').length`) >= 30, 'コツ');
        const bad = app.val(`GUIDE_TOPICS.filter(t => !GUIDE_HELP_CATS.some(c => c[0] === t.cat) || (t.tour && !GUIDE_TOURS[t.tour]) || (t.open && typeof t.open.run !== 'function') || !(t.steps || t.lead)).map(t => t.id)`);
        assert.deepEqual(bad, []);
        assert.equal(new Set(app.val('GUIDE_TOPICS.map(t => t.id)')).size, app.val('GUIDE_TOPICS.length'), '説明の id は重ならない');
        assert.equal(app.val('GUIDE_TOUR_MENU.filter(([id]) => !GUIDE_TOURS[id]).length'), 0, '練習ツアーの一覧はすべて実在する');
        assert.equal(app.val(`Object.keys(GUIDE_TOURS).filter(id => id !== 'basic' && !GUIDE_TOUR_MENU.some(([m]) => m === id)).length`), 0, 'すべてのツアーを一覧に出す');
        // スマホと PC で書き分けた説明は、今の端末の方
        app.eval(`isMobile = () => false; showGuideHelp();`);
        assert.match(app.eval(`${box}.querySelector('.gh-topic[data-id="view"]').textContent`), /ホイール/);
        app.eval(`isMobile = () => true; showGuideHelp();`);
        assert.match(app.eval(`${box}.querySelector('.gh-topic[data-id="view"]').textContent`), /2本指/);
        app.eval('hidePropertyPanel()');
    });

    it('ヘルプ: 探す（ひらがなの読み・カタカナ・コマンド）。見つかった説明は開く', () => {
        app.eval('showGuideHelp()');
        app.eval(`guideHelpSearch('きゅうせき')`);
        assert.ok(shown().includes('cogo-area'), JSON.stringify(shown()));
        assert.equal(app.eval(`${box}.querySelector('.gh-topic[data-id="cogo-area"]').open`), true);
        assert.match(app.eval(`document.getElementById('gh-found').textContent`), /見つかりました/);
        assert.equal(app.eval(`${box}.querySelector('.gh-extra').style.display`), 'none', '探しているあいだはツアー・設定の欄を隠す');
        app.eval(`guideHelpSearch('へんかん')`); assert.ok(shown().includes('helm'));
        app.eval(`guideHelpSearch('ヘルマート')`); assert.ok(shown().includes('helm'));
        app.eval(`guideHelpSearch('すなっぷ すいつかない')`); assert.deepEqual(shown(), ['faq-snap']); // 2語とも含む説明
        app.eval(`guideHelpSearch('ＨＥＬＭＥＲＴ')`); // 全角でも
        assert.ok(app.eval(`[...${box}.querySelectorAll('.gh-cmds tr[data-k]')].some(tr => tr.style.display !== 'none' && /HELMERT/.test(tr.textContent))`));
        app.eval(`guideHelpSearch('ありえない言葉ざざ')`);
        assert.deepEqual(shown(), []);
        assert.match(app.eval(`document.getElementById('gh-found').textContent`), /見つかりませんでした/);
        app.eval(`guideHelpSearch('')`);
        assert.equal(shown().length, app.val('GUIDE_TOPICS.length'));
        // ヒントの設定を変えても、探している言葉はそのまま
        app.eval(`guideHelpSearch('くい'); setGuideHintsMode('always');`);
        assert.equal(app.eval(`document.getElementById('gh-search').value`), 'くい');
        assert.ok(shown().includes('stake'));
        app.eval(`setGuideHintsMode('auto'); hidePropertyPanel();`);
    });

    it('ヘルプの「開く」でその機能のパネルを開く（エラーにならない）', () => {
        const help = app.eval('GUIDE_HELP_TITLE');
        for (const id of app.val(`GUIDE_TOPICS.filter(t => t.open && !['gnss', 'open', 'save'].includes(t.id)).map(t => t.id)`)) {
            app.eval(`showGuideHelp(); guideHelpOpen('${id}')`);
            assert.notEqual(app.eval(`document.getElementById('property-panel-title').textContent`), help, id);
        }
        app.eval('hidePropertyPanel()');
        assert.deepEqual(app.errors(), []);
    });

    it('パネルの見出しの ？: その画面の説明を開き、◀ で元のパネルに戻る。説明の無いパネルには出さない', () => {
        const q = () => app.eval(`document.getElementById('property-panel-help').style.display`);
        const title = () => app.eval(`document.getElementById('property-panel-title').textContent`);
        app.eval(`showCogoPanel('inv')`);
        assert.equal(q(), '');
        app.eval('guidePanelHelp()');
        assert.equal(title(), '❓ ヘルプ・操作ガイド');
        assert.equal(q(), 'none', 'ヘルプ自身には出さない');
        assert.equal(app.eval(`${box}.querySelector('.gh-topic[data-id="cogo-calc"]').open`), true);
        assert.match(app.eval(`document.querySelector('.gh-back').textContent`), /測量計算 に戻る/);
        app.eval('guideHelpBack()');
        assert.equal(title(), '🧮 測量計算'); assert.equal(app.eval('_cogo.tab'), 'inv');
        app.eval(`cogoSetTab('helm'); guidePanelHelp()`);
        assert.equal(app.eval(`${box}.querySelector('.gh-topic[data-id="helm"]').open`), true, '変換タブなら変換の説明');
        for (const fn of ['showStakePanel()', 'showTsPanel()', 'showPrintPanel()', 'showUnderlayPanel()', 'showPhotoPanel()', 'showCoordListPanel()', 'showOptionsPanel()', 'showLayerManagerPanel()', 'showBlockManagerPanel()']) {
            app.eval(fn); assert.equal(q(), '', fn);
        }
        app.eval(`showPropertyPanel('円 作図設定', '')`); assert.equal(q(), 'none');
        app.eval(`cogoSetTab('area'); hidePropertyPanel()`);
    });

    it('点の指定の手順カードは、機能ごとの言葉（測量計算・杭打ち・写真のピン・下絵・変換）', async () => {
        app.eval(`setGuideHintsMode('always')`);
        app.eval(`showCogoPanel('inv'); cogoPick('IA')`); await wait(5);
        assert.match(hint(), /点の指定.*始点/);
        app.eval(`resetCommand(); _cogo.pick = null; cogoPick('KS', 'stake')`); await wait(5);
        assert.match(hint(), /杭打ち.*器械点/);
        app.eval(`resetCommand(); _cogo.pick = null; photoStartAdd()`); await wait(5);
        assert.match(hint(), /ピンを立てる.*場所/);
        app.eval(`resetCommand(); _cogo.pick = null; cogoPick('UA', 'underlay')`); await wait(5);
        assert.match(hint(), /下絵.*1\/4.*画像の上/);
        app.eval(`resetCommand(); _cogo.pick = null; cogoPick('HT', 'helm')`); await wait(5);
        assert.match(hint(), /変換.*別窓で選んだ点/);
        app.eval(`resetCommand(); _cogo.pick = null; setGuideHintsMode('auto'); hidePropertyPanel();`);
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

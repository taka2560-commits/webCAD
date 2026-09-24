'use strict';
// 杭打ちナビ（cad-stake.js）のテスト:
//   夾角・方向角・水平距離の計算、順番（範囲選択・◀▶・済み）、現在地から（距離・向き・北へ／東へ・近づいたら知らせる・コンパス）、
//   器械点から（杭打ち表・図面に置く・CSV）、点の指定（📍 と ❌終了でパネルに戻る）、重ね表示
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

describe('杭打ちナビ', () => {
    let app;
    before(async () => {
        app = await loadApp();
        const ev = app.eval; app.run = (c) => ev('{' + c + '\n}');
    });
    after(() => app.close());
    beforeEach(() => {
        app.window.confirm = () => true;
        app.eval(`
            resetCommand(); localStorage.removeItem('cad_survey_unit');
            entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true }); currentLayerIndex = 0;
            view = { x: 400, y: 300, scale: 4, rotation: 0 };
            _cogo.slots = {}; _cogo.pick = null; _stake.list = []; _stake.idx = -1; _stake.loose = new Map(); _stake.mode = 'gnss'; _stake.compass = false; _stake.heading = null; _stake.near = false;
            _gnss.on = false; _gnss.fix = null;
            addSurveyData([{ num: '1', name: 'A', X: 0, Y: 0, z: 10 }, { num: '2', name: 'B', X: 10, Y: 0, z: 11 }, { num: '3', name: 'K1', X: 0, Y: 10, z: 12.5 }, { num: '4', name: 'K2', X: -10, Y: 0 }], []);
            undoStack.length = 0;
        `);
    });
    const panelText = () => app.eval(`document.getElementById('property-panel-content').textContent`);
    const panelTitle = () => app.eval(`document.getElementById('property-panel').style.display === 'flex' ? document.getElementById('property-panel-title').textContent : ''`);

    it('器械点・後視点から見た杭の夾角（右回り）・方向角・水平距離', () => {
        const r = app.val(`stakeFromStation({ X: 0, Y: 0 }, { X: 10, Y: 0 }, { X: 0, Y: 10 })`); // 後視は北、杭は東
        assert.ok(near(r.ang, 90) && near(r.az, 90) && near(r.dist, 10), JSON.stringify(r));
        const s = app.val(`stakeFromStation({ X: 0, Y: 0 }, { X: 0, Y: 10 }, { X: 10, Y: 0 })`); // 後視は東、杭は北
        assert.ok(near(s.ang, 270) && near(s.az, 0));
    });
    it('順番: 範囲選択した測点だけ（無ければすべて）。◀ ▶ は端で折り返す。済みで次の済んでいない杭へ', () => {
        const idxOf = (n) => app.eval(`entities.findIndex(e => e.type === 'POINT' && e.name === '${n}')`);
        app.eval(`cmdState.selectedIndices = [${idxOf('K1')}, ${idxOf('K2')}]; showStakePanel()`);
        assert.equal(app.eval('_stake.list.length'), 2);
        assert.equal(app.eval('_cogo.slots.KT.name'), 'K1');
        assert.match(panelText(), /1 \/ 2（済 0）/);
        app.eval('stakeStep(-1)');
        assert.equal(app.eval('_cogo.slots.KT.name'), 'K2');
        app.eval('stakeStep(1); stakeToggleDone()');
        assert.equal(app.eval('_cogo.slots.KT.name'), 'K2'); // 済んでいない次の杭
        assert.match(panelText(), /2 \/ 2（済 1）/);
        app.eval('stakeToggleDone()');
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /すべて済みました/);
        app.eval('stakeToggleDone()'); // もう一度押すと取り消し（記録を消す）
        assert.equal(app.eval('_stake.list.filter(p => _stakeIsDone(p)).length'), 1);
        app.eval(`cmdState.selectedIndices = []; cmdState.highlightIdx = -1; showStakePanel()`);
        assert.equal(app.eval('_stake.list.length'), 4);
    });
    it('現在地から: GNSS が無ければ案内し、測位したら距離・向き・北へ／東へを出す。近づいたら1回だけ振動', () => {
        app.eval(`showStakePanel(); _cogo.slots.KT = { x: 10, y: 0, name: 'K1', snapped: true }; _stakeUpdate()`); // K1: 東へ 10
        assert.match(panelText(), /現在地を使う/);
        let vib = 0;
        Object.defineProperty(app.window.navigator, 'vibrate', { value: () => { vib++; return true; }, configurable: true });
        app.eval(`_gnss.on = true; _gnss.fix = { x: 0, y: -6, X: -6, Y: 0, acc: 3, accU: 3 }; stakeOnGnss()`); // 南へ 6 の所
        let t = panelText();
        assert.match(t, /11\.7 m/);          // √(10² + 6²)
        assert.match(t, /北東/);
        assert.match(t, /\+6\.000 m/);       // 北へ
        assert.match(t, /\+10\.000 m/);      // 東へ
        assert.doesNotMatch(t, /このあたりです/);
        app.eval(`_gnss.fix = { x: 8, y: 0, X: 0, Y: 8, acc: 3, accU: 3 }; stakeOnGnss()`); // 2 m 手前（精度 3 m の範囲）
        t = panelText();
        assert.match(t, /このあたりです/);
        app.eval(`_gnss.fix = { x: 8.5, y: 0, X: 0, Y: 8.5, acc: 3, accU: 3 }; stakeOnGnss()`);
        assert.equal(vib, 1);
        // 矢印は北が上（東の杭なら 90°）
        assert.equal(app.eval(`document.getElementById('stake-arrow-g').getAttribute('transform')`), 'rotate(90.0)');
    });
    it('杭打ちの記録: 現在地との差（実測−計画）を測点に残す（保存・↩ で戻る）。CSV に出す', async () => {
        app.eval(`showStakePanel(); stakeStep(2)`); // K1（X 0, Y 10 → 図面の x 10, y 0）
        assert.equal(app.eval('_cogo.slots.KT.name'), 'K1');
        app.eval(`_gnss.on = true; _gnss.fix = { x: 9, y: 0.5, X: 0.5, Y: 9, acc: 2.5 }; stakeToggleDone()`);
        const e = app.val(`entities.find(e => e.type === 'POINT' && e.name === 'K1')`);
        assert.ok(e.stake && Math.abs(e.stake.dX - 0.5) < 1e-9 && Math.abs(e.stake.dY + 1) < 1e-9 && Math.abs(e.stake.dist - Math.hypot(0.5, 1)) < 1e-9 && e.stake.acc === 2.5, JSON.stringify(e.stake));
        assert.ok(app.val(`_buildSaveData('t')`).entities.some((x) => x.name === 'K1' && x.stake), '保存データに記録が無い');
        // 記録は済みの杭を選び直すと見える
        app.eval(`stakeStep(-1)`);
        assert.equal(app.eval('_cogo.slots.KT.name'), 'K1');
        const t = app.eval(`document.getElementById('property-panel-content').textContent`);
        assert.match(t, /差（実測−計画） ΔX \+0\.500\s+ΔY -1\.000（1\.118 m）・精度 ±2\.5 m/);
        app.eval(`window.__dl = downloadBlob; downloadBlob = (b, n) => { window.__blob = b; window.__name = n; }; stakeExportRecords(); downloadBlob = window.__dl;`);
        assert.match(app.eval('window.__name'), /_杭打ち記録\.csv$/);
        const csv = await app.eval('new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsText(window.__blob); })');
        assert.match(csv, /K1,0\.000,10\.000,0\.500,9\.000,0\.500,-1\.000,1\.118,2\.5,/);
        app.eval('undo()');
        assert.equal(app.eval(`!!entities.find(e => e.type === 'POINT' && e.name === 'K1').stake`), false);
    });
    it('🧭 向きに合わせる: 端末の向き（iPhone の webkitCompassHeading）の分だけ矢印を回す', async () => {
        app.eval(`showStakePanel(); _cogo.slots.KT = { x: 10, y: 0, name: 'K1', snapped: true }; _gnss.on = true; _gnss.fix = { x: 0, y: 0, X: 0, Y: 0, acc: 3 }; _stakeUpdate()`);
        await app.eval('stakeToggleCompass()');
        assert.equal(app.eval('_stake.compass'), true);
        app.eval(`(() => { const e = new Event('deviceorientation'); Object.defineProperty(e, 'webkitCompassHeading', { value: 60 }); window.dispatchEvent(e); })()`);
        await new Promise((r) => setTimeout(r, 150));
        assert.equal(app.eval('_stake.heading'), 60);
        assert.equal(app.eval(`document.getElementById('stake-arrow-g').getAttribute('transform')`), 'rotate(30.0)'); // 東(90°) − 向き(60°)
        await app.eval('stakeToggleCompass()');
        assert.equal(app.eval('_stake.compass'), false);
    });
    it('器械点から: 夾角・水平距離・高低差、杭打ち表を図面に置く（元に戻す1回）・CSV', async () => {
        app.eval(`showStakePanel(); stakeSetMode('ts'); cogoSlotTyped('KS', 'A', 'stake'); cogoSlotTyped('KB', 'B', 'stake'); cogoSlotTyped('KT', 'K1', 'stake')`);
        const t = panelText();
        assert.match(t, /90°00′00″/);       // 夾角（後視 B＝北、杭 K1＝東）
        assert.match(t, /10\.000 m/);
        assert.match(t, /\+2\.500 m/);      // 高低差 12.5 − 10
        assert.match(t, /杭打ち表を図面に置く/);
        const n0 = app.eval('entities.length');
        app.eval('stakePlaceTable()');
        const added = app.val(`entities.slice(${n0})`);
        assert.ok(added.length > 10 && added.every((e) => e.blockName === '杭打ち表'));
        assert.ok(added.some((e) => e.type === 'TEXT' && e.text === '杭打ち表　器械点 A・後視点 B'));
        assert.ok(added.some((e) => e.type === 'TEXT' && e.text === '180°00′00″')); // K2（南）
        app.eval('undo()');
        assert.equal(app.eval('entities.length'), n0);
        app.eval(`window.__dl = downloadBlob; downloadBlob = (b, n) => { window.__blob = b; window.__name = n; }; stakeExportCsv(); downloadBlob = window.__dl;`);
        assert.match(app.eval('window.__name'), /_杭打ち表\.csv$/);
        const csv = await app.eval('new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsText(window.__blob); })');
        assert.match(csv, /杭打ち表,器械点 A,後視点 B/);
        assert.match(csv, /K1,0\.000,10\.000,90°00′00″,90°00′00″,10\.000/);
    });
    it('📍 で器械点→後視点を続けて指定し、終わると杭打ちのパネルに戻る。❌終了でも戻る', () => {
        app.eval(`showStakePanel(); stakeSetMode('ts'); cogoPick('KS', 'stake')`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_DIMCOGO_PT');
        app.eval(`snapResult = { wcsX: 0, wcsY: 0, type: '点' }; handlePointInput({ x: 0, y: 0 }, false)`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_DIMCOGO_PT'); // 後視点へ
        app.eval(`snapResult = { wcsX: 0, wcsY: 10, type: '点' }; handlePointInput({ x: 0, y: 10 }, false)`);
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.equal(panelTitle(), '📍 杭打ち');
        assert.equal(app.eval('_cogo.slots.KS.name'), 'A');
        assert.equal(app.eval('_cogo.slots.KB.name'), 'B');
        app.eval(`cogoPick('KT', 'stake'); issueCommand('CANCEL')`);
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.equal(panelTitle(), '📍 杭打ち');
        // 種類を切り替えると指定中の点はやめる
        app.eval(`cogoPick('KT', 'stake'); stakeSetMode('gnss')`);
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
    });
    it('重ね表示・杭を中央に・コマンド・手順カード', () => {
        app.eval(`processCommand('STAKE')`);
        assert.equal(panelTitle(), '📍 杭打ち');
        app.eval(`_stakeSetRec(_stake.list[1], { time: new Date().toISOString() }); _gnss.on = true; _gnss.fix = { x: 5, y: 5, X: 5, Y: 5, acc: 4 }; _drawFrame(false)`);
        app.eval(`stakeSetMode('ts'); cogoSlotTyped('KS', 'A', 'stake'); cogoSlotTyped('KB', 'B', 'stake'); _drawFrame(false)`);
        app.eval('stakeShowTarget()');
        const t = app.val('_cogo.slots.KT'), s = app.val(`wcsToScreen(${t.x}, ${t.y})`);
        assert.ok(near(s.x, app.eval('canvas.width / 2'), 1e-6) && near(s.y, app.eval('canvas.height / 2'), 1e-6));
        assert.equal(app.eval(`_guideHintFor('WAITING_DIMCOGO_PT').title`), '📍 点の指定');
        assert.deepEqual(app.errors(), []);
    });
});

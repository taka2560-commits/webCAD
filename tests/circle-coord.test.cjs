'use strict';
// 円を座標で描く（v5.58。cad-circle.js の circleDrawAtCoord）: 円の作図設定の「📍 座標で描く」。
// 座標の読み方はコマンド欄の「X,Y」と同じ（X＝北・Y＝東、UCS、オプションの座標の単位）。中心の位置は、アプリのコードを使わない
// 別の式（UCS の回転と原点）で照らす。測点を選んだときは測点の位置そのまま（文字に直した数を通さない）
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('円を座標で描く', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => app.eval(`resetCommand(); closePropertyPanel(); hideSnack(); entities.length = 0; undoStack.length = 0;
        ucs = { originX: 0, originY: 0, angle: 0 }; setDisplayPref('coordUnit', 'auto'); setDisplayPref('lenUnit', 'auto');
        view = { x: 400, y: 300, scale: 1, rotation: 0 }; processCommand('C');`));
    const set = (id, v) => app.eval(`document.getElementById('${id}').value = ${JSON.stringify(v)}; document.getElementById('${id}').dispatchEvent(new Event('input'));`);
    const circles = () => app.val(`entities.filter((e) => e.type === 'CIRCLE').map((e) => [e.cx, e.cy, e.radius])`);
    // 別の式: 測量の X（北）・Y（東）→ UCS（x＝東、y＝北）→ WCS（回転して原点を足す）
    const oracle = (X, Y, u) => { const ux = Y, uy = X, c = Math.cos(u.angle), s = Math.sin(u.angle); return [ux * c - uy * s + u.originX, ux * s + uy * c + u.originY]; };

    it('円のコマンドを始めると、作図設定に「📍 座標で描く」が出る。X・Y・半径を打つと、その中心に円を描く（続けて描ける・↩ で戻る）', () => {
        assert.equal(app.val(`!!document.getElementById('circle-coord')`), true);
        set('circle-cx', '-12345.678'); set('circle-cy', '23456.789'); set('circle-cr', '2.5');
        app.eval('circleDrawAtCoord()');
        assert.deepEqual(circles(), [[23456.789, -12345.678, 2.5]], 'X＝北は図面の y、Y＝東は図面の x');
        set('circle-cx', '-12346'); set('circle-cy', '23457');
        app.eval('circleDrawAtCoord()');
        assert.equal(circles().length, 2, '続けて描ける');
        app.eval('undo()');
        assert.equal(circles().length, 1);
        assert.equal(app.val(`String(cmdState.mode)`).startsWith('WAITING_CIRCLE_'), true, '円のコマンドは続いている（タップでも描ける）');
        assert.deepEqual(app.errors(), []);
    });

    it('コマンド欄の「X,Y」と同じ読み方: UCS（回転・原点）と、座標・長さの単位（mm 表示）を、別の式で照らす', () => {
        const cases = [
            { u: { originX: 0, originY: 0, angle: 0 }, X: 100.25, Y: -50.5, r: 3 },
            { u: { originX: 35000.123, originY: -12000.456, angle: 0.5235987755982988 }, X: 12.345, Y: 67.89, r: 0.75 },
            { u: { originX: -1e5, originY: 2e5, angle: -2.2 }, X: -0.001, Y: 0, r: 1e-3 },
        ];
        for(const c of cases) {
            app.eval(`entities.length = 0; ucs = ${JSON.stringify(c.u)};`);
            set('circle-cx', String(c.X)); set('circle-cy', String(c.Y)); set('circle-cr', String(c.r));
            app.eval('circleDrawAtCoord()');
            const [cx, cy, rr] = circles()[0], [ex, ey] = oracle(c.X, c.Y, c.u);
            assert.ok(Math.abs(cx - ex) < 1e-9 && Math.abs(cy - ey) < 1e-9, `${JSON.stringify(c)} → ${cx},${cy} / ${ex},${ey}`);
            assert.equal(rr, c.r);
            // コマンド欄で同じ座標を打ったときの点と同じ
            const typed = app.val(`(() => { const X = fromDisplayUnit(${c.X}, 'coord'), Y = fromDisplayUnit(${c.Y}, 'coord'); return ucsToWcs(Y, X); })()`);
            assert.ok(Math.abs(typed.x - cx) < 1e-12 && Math.abs(typed.y - cy) < 1e-12);
        }
        // 表示の単位 mm（図面は m）: 打った数は mm、半径も mm
        app.eval(`entities.length = 0; ucs = { originX: 0, originY: 0, angle: 0 }; setDisplayPref('coordUnit', 'mm'); setDisplayPref('lenUnit', 'mm'); closePropertyPanel(); resetCommand(); processCommand('C');`);
        set('circle-cx', '-12345678'); set('circle-cy', '23456789'); set('circle-cr', '2500');
        app.eval('circleDrawAtCoord()');
        const [cx, cy, r] = circles()[0];
        assert.ok(Math.abs(cx - 23456.789) < 1e-9 && Math.abs(cy + 12345.678) < 1e-9 && Math.abs(r - 2.5) < 1e-12, `${cx},${cy},${r}`);
    });

    it('測点を選ぶと、その測点の位置そのままを中心にする（描くときに引き直す）。X・Y を打ち直すと、打った数を使う', () => {
        app.eval(`addSurveyData([{ num: '7', name: 'BM-7', X: -12345.6789012, Y: 23456.7890123, z: null }], []); closePropertyPanel(); resetCommand(); processCommand('C');`);
        const p = app.val(`(() => { const q = collectSurveyPoints().find((x) => x.name === 'BM-7'); return { x: q.x, y: q.y }; })()`);
        set('circle-pt', 'BM-7');
        app.eval(`circleCoordPickPoint('BM-7')`);
        assert.match(app.val(`document.getElementById('circle-coord-note').textContent`), /BM-7/);
        set('circle-cr', '1');
        app.eval('circleDrawAtCoord()');
        const c = circles()[0];
        assert.equal(c[0], p.x, '測点の位置と同じ（丸めない）');
        assert.equal(c[1], p.y);
        // 番号でも選べる。X を打ち直すと測点の欄は空になり、打った数を使う
        set('circle-pt', '7'); app.eval(`circleCoordPickPoint('7')`);
        assert.equal(app.val(`document.getElementById('circle-cx').value`), '-12345.6789012');
        set('circle-cx', '0'); app.eval('circleCoordTyped()'); // jsdom はインラインの oninput を動かさない
        assert.equal(app.val(`document.getElementById('circle-pt').value`), '');
        set('circle-cy', '0');
        app.eval('circleDrawAtCoord()');
        assert.deepEqual(circles()[1].slice(0, 2), [0, 0]);
    });

    it('G3: 無い点名に打ち直すと描かない（前の測点の位置に描かない）。選んだ測点が消えたら（↩）描かない', () => {
        app.eval(`addSurveyData([{ num: '7', name: 'BM-7', X: -100, Y: 200, z: null }], []); closePropertyPanel(); resetCommand(); processCommand('C');`);
        set('circle-pt', 'BM-7'); app.eval(`circleCoordPickPoint('BM-7')`);
        set('circle-pt', 'BM-8'); app.eval(`circleCoordPickPoint('BM-8')`);
        assert.equal(app.val(`document.getElementById('circle-cx').value`), '', '前の測点の座標を残さない');
        assert.match(app.val(`document.getElementById('circle-coord-note').textContent`), /BM-8.*見つかりません/);
        set('circle-cr', '1');
        app.eval('circleDrawAtCoord()');
        assert.equal(circles().length, 0);
        // 選んだあとに測点が消えた（↩）
        app.eval(`undoStack.length = 0; entities.length = 0; addSurveyData([{ num: '9', name: 'P9', X: 10, Y: 20, z: null }], []);`);
        app.eval(`saveUndo(); closePropertyPanel(); resetCommand(); processCommand('C');`);
        set('circle-pt', 'P9'); app.eval(`circleCoordPickPoint('P9')`); set('circle-cr', '1');
        app.eval(`entities.length = 0; render();`); // 測点が消えた（↩ と同じ形）
        app.eval('circleDrawAtCoord()');
        assert.equal(circles().length, 0, '消えた測点の古い位置に描かない');
    });

    it('G3: パネルを開いたまま単位を切り替えても、見出しの単位（出したときの単位）で読む。固定半径（タップで置く円）の半径は変えない', () => {
        app.eval(`lastParams.radius = '50'; closePropertyPanel(); resetCommand(); processCommand('C');`);
        set('circle-cx', '-12345.678'); set('circle-cy', '23456.789'); set('circle-cr', '2.5');
        app.eval(`setDisplayPref('coordUnit', 'mm'); setDisplayPref('lenUnit', 'mm');`); // 開いたまま切り替え
        app.eval('circleDrawAtCoord()');
        const [cx, cy, r] = circles()[0];
        assert.ok(Math.abs(cx - 23456.789) < 1e-9 && Math.abs(cy + 12345.678) < 1e-9 && r === 2.5, `${cx},${cy},${r}`);
        assert.equal(app.val('lastParams.radius'), '50', 'タップで置く円の半径（下のバーの表示）とずれない');
        // 作図設定の半径の欄も同じ
        app.eval(`setDisplayPref('lenUnit', 'auto'); setDisplayPref('coordUnit', 'auto'); closePropertyPanel(); resetCommand(); processCommand('C');
            document.getElementById('prop-circle-r').value = '3'; setDisplayPref('lenUnit', 'mm'); applyCirclePreset();`);
        assert.equal(app.val('lastParams.radius'), '3', '見出しが (m) のとき打った 3 は 3m');
    });

    it('半径が 0 以下・数でない、X・Y が空のときは描かず、欄に理由を出す', () => {
        set('circle-cx', '1'); set('circle-cy', '2'); set('circle-cr', '0');
        app.eval('circleDrawAtCoord()');
        set('circle-cr', 'abc');
        app.eval('circleDrawAtCoord()');
        set('circle-cr', '1'); set('circle-cx', '');
        app.eval('circleDrawAtCoord()');
        assert.equal(circles().length, 0);
        assert.equal(app.val('undoStack.length'), 0, '描かないときは ↩ を増やさない');
    });

    it('画面の外に描いたときは「🔍 見る」で見に行ける', () => {
        set('circle-cx', '90000'); set('circle-cy', '90000'); set('circle-cr', '1');
        app.eval('circleDrawAtCoord()');
        assert.equal(circles().length, 1);
        assert.equal(app.val(`[...document.querySelectorAll('#cad-snack .sn-act')].some((b) => b.textContent === '🔍 見る' && b.style.display !== 'none')`), true);
        app.eval(`[...document.querySelectorAll('#cad-snack .sn-act')].find((b) => b.textContent === '🔍 見る').click()`);
        const s = app.val('wcsToScreen(90000, 90000)');
        assert.ok(Math.abs(s.x - app.val('canvas.width') / 2) < 1e-6 && Math.abs(s.y - app.val('canvas.height') / 2) < 1e-6, '円の中心が画面の真ん中に');
    });
});

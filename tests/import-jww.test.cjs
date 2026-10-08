'use strict';
// JWW（Jw_cad の図面）の取り込み（v5.34）: 公開されている形式の説明（jwdatafmt.txt）どおりに組み立てた JWW を読み、
// 版ごとの違い（2.30・4.20・7.00）・線・円・円弧・楕円・点・文字（Shift-JIS・Unicode）・寸法・ソリッド・ブロック・画層・色・線種を確かめる
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { loadApp, near } = require('./helpers/load-app.cjs');

const D = Math.PI / 180;
// JWW を組み立てる（MFC の CArchive の書き方）
function jwwWriter(ver, sjis) {
    const parts = [];
    const b = (n) => { const x = Buffer.alloc(n); parts.push(x); return x; };
    const w = {
        u8(v) { b(1).writeUInt8(v); }, u16(v) { b(2).writeUInt16LE(v); }, u32(v) { b(4).writeUInt32LE(v >>> 0); }, i32(v) { b(4).writeInt32LE(v); },
        f64(v) { b(8).writeDoubleLE(v); }, raw(buf) { parts.push(Buffer.from(buf)); },
        str(s) { const bytes = /^[\x20-\x7e]*$/.test(s) ? Buffer.from(s, 'latin1') : Buffer.from(sjis(s)); if (bytes.length < 255) w.u8(bytes.length); else { w.u8(255); w.u16(bytes.length); } w.raw(bytes); },
        wstr(s) { w.u8(255); w.u16(0xFFFE); w.u8(s.length); w.raw(Buffer.from(s, 'utf16le')); },
        out() { return Buffer.concat(parts); },
    };
    const classes = new Map();
    let map = 1;
    w.obj = (cls) => {
        if (classes.has(cls)) w.u16(0x8000 | classes.get(cls));
        else { w.u16(0xFFFF); w.u16(1); w.u16(cls.length); w.raw(Buffer.from(cls, 'latin1')); classes.set(cls, map++); }
        map++;
    };
    w.data = (o) => { w.u32(o.group || 0); w.u8(o.style ?? 1); w.u16(o.color ?? 2); if (ver >= 351) w.u16(o.width || 0); w.u16(o.layer || 0); w.u16(o.g || 0); w.u16(o.flg || 0); };
    w.sen = (o) => { w.data(o); w.f64(o.x1); w.f64(o.y1); w.f64(o.x2); w.f64(o.y2); };
    w.ten = (o) => { w.data(o); w.f64(o.x); w.f64(o.y); w.u32(o.kari || 0); if ((o.style ?? 1) === 100) { w.u32(o.code || 1); w.f64(0); w.f64(1); } };
    w.moji = (o) => { w.data(Object.assign({ style: 1 }, o)); w.f64(o.x); w.f64(o.y); w.f64(o.x + 10); w.f64(o.y); w.u32(0); w.f64(o.sy); w.f64(o.sy); w.f64(0); w.f64(o.deg || 0); w.str('ＭＳ ゴシック'); if (o.wide) w.wstr(o.text); else w.str(o.text); };
    w.enko = (o) => { w.data(o); w.f64(o.cx); w.f64(o.cy); w.f64(o.r); w.f64(o.start || 0); w.f64(o.arc ?? Math.PI * 2); w.f64(o.tilt || 0); w.f64(o.flat ?? 1); w.u32(o.full ? 1 : 0); };
    w.solid = (o) => { w.data(o); [o.p1, o.p4, o.p2, o.p3].forEach((p) => { w.f64(p[0]); w.f64(p[1]); }); if ((o.color ?? 2) === 10) w.u32(o.rgb); };
    // ヘッダー（opt: names[g][l]・gnames・scale[g]・gstate[g]・sxf（SXF の色の表に入れる { 番号: 値 }）・nWid・junk（図形の前に足すごみのバイト数））
    w.header = (opt) => {
        w.raw(Buffer.from('JwwData.', 'latin1')); w.u32(ver); w.str('memo'); w.u32(3); w.u32(0);
        for (let g = 0; g < 16; g++) { w.u32((opt.gstate || {})[g] ?? 2); w.u32(0); w.f64((opt.scale || {})[g] ?? 1); w.u32(0); for (let l = 0; l < 16; l++) { w.u32(2); w.u32(0); } }
        for (let i = 0; i < 14 + 5 + 1; i++) w.u32(0);
        w.i32(opt.nWid ?? 1);
        w.f64(0); w.f64(0); w.f64(1); w.u32(0); w.u32(0); for (let i = 0; i < 5; i++) w.f64(0);
        for (let g = 0; g < 16; g++) for (let l = 0; l < 16; l++) w.str(((opt.names || {})[g] || {})[l] || '');
        for (let g = 0; g < 16; g++) w.str((opt.gnames || {})[g] || '');
        w.f64(0); w.f64(35); w.u32(0); w.f64(0);
        if (ver >= 300) { w.f64(0); w.f64(0); }
        w.u32(0); for (let i = 0; i < 6; i++) w.f64(1);
        if (ver >= 300) { for (let n = 0; n < 8; n++) { w.f64(1); w.f64(0); w.f64(0); w.u32(0); } } else { for (let n = 0; n < 4; n++) { w.f64(1); w.f64(0); w.f64(0); } }
        if (ver >= 300) { w.f64(0); w.f64(0); w.f64(0); w.u32(0); w.f64(0); w.f64(0); w.f64(0); w.u32(0); }
        for (let i = 0; i < 11; i++) w.f64(0);
        for (let n = 0; n < 10; n++) { w.u32(n); w.u32(1); }
        for (let n = 0; n < 10; n++) { w.u32(n); w.u32(1); w.f64(0.5); }
        for (let i = 0; i < 8 * 4 + 5 * 5 + 4 * 4 + 11; i++) w.u32(0);
        if (ver >= 223) { for (let i = 0; i < 5; i++) w.u32(0); for (let i = 0; i < 5; i++) w.f64(0); }
        if (ver >= 225) for (let i = 0; i < 4; i++) w.f64(0);
        if (ver >= 230) { w.u32(0); w.u32(0); }
        if (ver >= 420) {
            for (let n = 0; n <= 256; n++) { w.u32((opt.sxf || {})[n] ?? 0); w.u32(1); }
            for (let n = 0; n <= 256; n++) { w.str(''); w.u32(0); w.u32(1); w.f64(0.5); }
            for (let n = 0; n <= 32; n++) { w.u32(0); w.u32(0); w.u32(0); w.u32(0); }
            for (let n = 0; n <= 32; n++) { w.str(''); w.u32(0); for (let k = 0; k < 10; k++) w.f64(0); }
        }
        for (let i = 1; i <= 10; i++) { w.f64(3); w.f64(3); w.f64(0); w.u32(1); }
        w.f64(3); w.f64(3); w.f64(0); w.u32(1); w.u32(1); w.f64(0); w.f64(0); w.u32(0); for (let i = 0; i < 6; i++) w.f64(0);
        if (opt.junk) w.raw(Buffer.alloc(opt.junk, 7));
    };
    return w;
}

describe('JWW（Jw_cad の図面）の取り込み', () => {
    let app, sjis;
    before(async () => {
        app = await loadApp();
        sjis = (s) => app.val(`Array.from(encodeShiftJis(${JSON.stringify(s)}))`);
    });
    after(() => app.close());

    // 図面を組み立てて、読み込んだ図形を返す
    const build = (ver, opt, body) => {
        const w = jwwWriter(ver, sjis);
        w.header(opt || {});
        body(w);
        return w.out();
    };
    const convert = (buf) => {
        app.window.__buf = new Uint8Array(buf);
        return app.val(`(() => { entities.length = 0; layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); _importMode = 'fresh';
            const j = parseJwwBuffer(window.__buf.buffer); const r = convertJwwToApp(j);
            return { ver: j.ver, warnings: r.warnings, skip: r.skipStats, hidden: r.hiddenFills, layers: layers.map(l => ({ name: l.name, visible: l.visible !== false })),
                ents: r.entities.map(e => Object.assign({}, e, { layerName: layers[e.layer] && layers[e.layer].name })) }; })()`);
    };
    const full = (w, ver, blocks) => {
        // 図形のリスト
        const list = [
            ['CDataSen', () => w.sen({ x1: 0, y1: 0, x2: 10, y2: 5, layer: 1, color: 2, style: 1 })],
            ['CDataSen', () => w.sen({ x1: 1, y1: 1, x2: 2, y2: 2, layer: 1, color: 8, style: 5 })],
            ['CDataEnko', () => w.enko({ cx: 3, cy: 4, r: 2, full: 1, color: 3 })],
            ['CDataEnko', () => w.enko({ cx: 0, cy: 0, r: 5, start: 30 * D, arc: 60 * D, tilt: 10 * D })],
            ['CDataEnko', () => w.enko({ cx: 50, cy: 50, r: 10, flat: 0.5, tilt: 30 * D, full: 1 })],
            ['CDataEnko', () => w.enko({ cx: 60, cy: 50, r: 10, flat: 0.5, start: 0, arc: Math.PI / 2 })],
            ['CDataTen', () => w.ten({ x: 7, y: 8, color: 2 })],
            ['CDataMoji', () => w.moji({ x: 5, y: 6, sy: 3.5, deg: 30, text: '境界杭', g: 1, color: 2 })],
            ['CDataMoji', () => w.moji({ x: 0, y: 0, sy: 2, text: '^@BMphoto.bmp,10,10', color: 2 })],
            ['CDataSunpou', () => {
                w.data({ color: 2 }); w.sen({ x1: 0, y1: -10, x2: 30, y2: -10, color: 2 }); w.moji({ x: 14, y: -9, sy: 2.5, text: '30.000', color: 2 });
                if (ver >= 420) { w.u16(0); w.sen({ x1: 0, y1: 0, x2: 0, y2: -10 }); w.sen({ x1: 30, y1: 0, x2: 30, y2: -10 }); for (let k = 0; k < 4; k++) w.ten({ x: 0, y: -10 }); }
            }],
            ['CDataSolid', () => w.solid({ p1: [0, 0], p2: [4, 0], p3: [4, 3], p4: [0, 3], color: 10, rgb: 0x00336699 })],
            ['CDataSolid', () => w.solid({ style: 101, p1: [20, 20], p4: [2, 1], p2: [0, 0], p3: [Math.PI * 2, 100], color: 3 })],
            ['CDataSen', () => w.sen({ x1: 0, y1: 0, x2: 1, y2: 0, color: 105, g: 2 })],
            ['CDataSen', () => w.sen({ x1: 0, y1: 0, x2: 1, y2: 1, color: 150, style: 34 })],
            ['CDataBlock', () => { w.data({}); w.f64(100); w.f64(200); w.f64(2); w.f64(2); w.f64(Math.PI / 2); w.u32(1); }],
        ];
        w.u16(list.length);
        list.forEach(([cls, f]) => { w.obj(cls); f(); });
        // ブロックの定義
        w.u16(blocks ? 1 : 0);
        if (blocks) {
            w.obj('CDataList'); w.data({}); w.u32(1); w.u32(1);
            if (blocks.time8) { w.u32(0x66000000); w.u32(0); } else w.u32(0x66000000);
            w.str('マーク');
            w.u16(2); w.obj('CDataSen'); w.sen({ x1: 0, y1: 0, x2: 1, y2: 0 }); w.obj('CDataEnko'); w.enko({ cx: 0, cy: 0, r: 0.5, full: 1 });
        }
        if (ver >= 700) w.u32(0); // 同梱画像の個数
    };
    const OPT = { names: { 0: { 1: '境界' }, 1: { 0: '文字' } }, gnames: { 1: 'G1' }, scale: { 1: 100 }, gstate: { 2: 0 }, sxf: { 50: 0x00FF8000 } };
    const find = (r, f) => r.ents.filter(f);

    for (const ver of [230, 420, 700]) {
        it(`版 ${ver}: 線・円・円弧・楕円・点・文字・寸法・ソリッド・ブロック・画層・色・線種`, () => {
            const r = convert(build(ver, OPT, (w) => full(w, ver, {})));
            assert.equal(r.ver, ver);
            assert.deepEqual(r.warnings, []);
            assert.deepEqual(r.skip, { IMAGE: 1 }, '画像の参照だけ取り込まない');
            const lines = find(r, (e) => e.type === 'LINE' && !e.gid);
            assert.deepEqual(lines.slice(0, 2).map((e) => [e.x1, e.y1, e.x2, e.y2, e.color, e.lt || null, e.layerName]), [[0, 0, 10, 5, null, null, '0-1 境界'], [1, 1, 2, 2, '#ff0000', 'CENTER', '0-1 境界']]);
            // 円・円弧（開始角は傾きを足す）・楕円・楕円弧（折れ線）
            const c = find(r, (e) => e.type === 'CIRCLE' && !e.gid)[0];
            assert.deepEqual([c.cx, c.cy, c.radius, c.color], [3, 4, 2, '#00ff00']);
            const a = find(r, (e) => e.type === 'ARC')[0];
            assert.ok(near(a.startAngle, 40 * D, 1e-12) && near(a.endAngle, 100 * D, 1e-12) && a.radius === 5);
            const el = find(r, (e) => e.type === 'ELLIPSE')[0];
            assert.ok(el && near(el.rx, 10) && near(el.ry, 5) && near(el.rotation, 30 * D, 1e-12));
            const ea = find(r, (e) => e.type === 'PLINE' && !e.closed)[0];
            assert.ok(ea && near(ea.points[0].x, 70) && near(ea.points[0].y, 50) && near(ea.points[ea.points.length - 1].x, 60) && near(ea.points[ea.points.length - 1].y, 55), '楕円弧の両端');
            const p = find(r, (e) => e.type === 'POINT')[0];
            assert.deepEqual([p.x, p.y], [7, 8]);
            // 文字: Shift-JIS、高さは図寸 × グループの縮尺（1/100）、角度
            const t = find(r, (e) => e.type === 'TEXT' && e.text === '境界杭')[0];
            assert.ok(t && near(t.height, 350) && near(t.rotation, 30 * D, 1e-12) && t.x === 5 && t.y === 6 && t.halign === 'left');
            assert.equal(t.layerName, '1-0 文字', 'いくつものグループを使うときは、グループの番号を名前の前に');
            // 寸法: 線（と補助線）と文字を1つのまとまりに
            const dim = r.ents.filter((e) => e.gid && e.gid.startsWith('d'));
            assert.deepEqual(dim.map((e) => e.type).sort(), (ver >= 420 ? ['LINE', 'LINE', 'LINE', 'TEXT'] : ['LINE', 'TEXT']));
            assert.equal(new Set(dim.map((e) => e.gid)).size, 1);
            // ソリッド: 任意色（RGB）・円のソリッド。初めは非表示
            const fills = find(r, (e) => e.type === 'HATCH');
            assert.equal(fills.length, 2);
            assert.deepEqual(fills[0].target.points.map((q) => [q.x, q.y]), [[0, 0], [4, 0], [4, 3], [0, 3]]);
            assert.equal(fills[0].color, '#996633');
            assert.ok(fills.every((f) => f.hidden && f.hiddenBy === 'fill'));
            assert.equal(r.hidden, 2);
            assert.ok(fills[1].target.points.length >= 60 && fills[1].target.points.every((q) => near(Math.hypot((q.x - 20) / 2, (q.y - 20) / 2), 1, 1e-9)), '円のソリッド（半径 2・扁平率 1/2）');
            // SXF の色: 105 は既定義色の黄、150 は図面の色の表（4.20 から。無ければ白）
            const sx = find(r, (e) => e.type === 'LINE' && e.x2 === 1 && e.y2 === 0 && !e.gid)[0];
            assert.equal(sx.color, '#ffff00');
            assert.equal(sx.layerName, '2-0');
            assert.equal(r.layers.find((l) => l.name === '2-0').visible, false, '非表示のグループ');
            const s150 = find(r, (e) => e.type === 'LINE' && e.x2 === 1 && e.y2 === 1 && e.x1 === 0)[0];
            assert.equal(s150.color, ver >= 420 ? '#0080ff' : null);
            assert.equal(s150.lt, 'CENTER', 'SXF の線種 4（一点長鎖線）');
            // ブロック: 2倍・90° 回して (100, 200) に置く
            const bl = r.ents.filter((e) => e.blockName === 'マーク');
            assert.equal(bl.length, 2);
            const bline = bl.find((e) => e.type === 'LINE'), bcirc = bl.find((e) => e.type === 'CIRCLE');
            assert.ok(near(bline.x1, 100) && near(bline.y1, 200) && near(bline.x2, 100) && near(bline.y2, 202));
            assert.ok(near(bcirc.cx, 100) && near(bcirc.cy, 200) && near(bcirc.radius, 1));
            assert.equal(bline.gid, bcirc.gid);
        });
    }

    it('ブロックの定義の作成時刻が 8 バイト（64ビット）でも読む', () => {
        const r = convert(build(700, OPT, (w) => full(w, 700, { time8: true })));
        assert.equal(r.ents.filter((e) => e.blockName === 'マーク').length, 2);
        assert.deepEqual(r.warnings, []);
    });

    it('Unicode の文字（Jw_cad 8）と、ヘッダーの長さが合わないとき（最初の図形の印を探して続ける）', () => {
        let r = convert(build(700, {}, (w) => { w.u16(1); w.obj('CDataMoji'); w.moji({ x: 1, y: 2, sy: 2, text: '測点ＫＰ１', wide: true }); w.u16(0); w.u32(0); }));
        assert.equal(r.ents[0].text, '測点ＫＰ１');
        r = convert(build(700, { junk: 13 }, (w) => { w.u16(1); w.obj('CDataSen'); w.sen({ x1: 0, y1: 0, x2: 3, y2: 4 }); w.u16(0); w.u32(0); }));
        assert.equal(r.ents.length, 1);
        assert.match(r.warnings[0], /ヘッダーの一部を読み飛ばしました/);
    });

    it('JWW でないファイル・途中で切れたファイルは、理由を出して開かない', () => {
        assert.throws(() => app.eval(`parseJwwBuffer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer)`), /JWW（Jw_cad の図面）ではありません/);
        const buf = build(700, {}, (w) => { w.u16(1); w.obj('CDataSen'); w.sen({ x1: 0, y1: 0, x2: 3, y2: 4 }); });
        app.window.__cut = new Uint8Array(buf.subarray(0, buf.length - 10));
        assert.throws(() => app.eval(`parseJwwBuffer(window.__cut.buffer)`), /途中で切れています/);
    });

    it('📁開く で .jww を選ぶと、置き換え・追加を聞いてから読み込み、図面の単位を mm にする', async () => {
        const buf = build(700, { names: { 0: { 0: '外周' } } }, (w) => { w.u16(1); w.obj('CDataSen'); w.sen({ x1: 0, y1: 0, x2: 3000, y2: 4000 }); w.u16(0); w.u32(0); });
        app.eval(`localStorage.setItem('cad_survey_unit', 'm'); entities.length = 0; _importMode = 'fresh'; window.__calls = []; window.__pt = window._prepareImportTarget;
            window._prepareImportTarget = (next) => { window.__calls.push('target'); next('fresh'); };`);
        app.window.__jw = { name: '現況.jww', arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
        try {
            app.eval(`(() => { const inp = document.getElementById('dxf-file-input'); Object.defineProperty(inp, 'files', { configurable: true, value: [window.__jw] });
                inp.dispatchEvent(new window.Event('change')); delete inp.files; })()`);
            await new Promise((res) => setTimeout(res, 120));
        } finally { app.eval('window._prepareImportTarget = window.__pt;'); }
        assert.deepEqual(app.val('window.__calls'), ['target']);
        assert.deepEqual(app.val(`entities.map(e => [e.type, e.x2, e.y2, layers[e.layer].name])`), [['LINE', 3000, 4000, '外周']]);
        assert.equal(app.val('getSurveyUnit()'), 'mm');
        assert.equal(app.val('window._drawingName'), '現況.jww');
        assert.match(app.val(`document.getElementById('dxf-file-input').getAttribute('accept') || ''`), /\.jww/);
    });
});

'use strict';
// トータルステーション連携（cad-sdr.js・cad-ts.js）のテスト:
//   SDR33・SDR2x の読み込み（器械点・後視・目標高・観測 F1/F2/MC・縮尺係数・既知点・縮小値）、単位（グラード・フィート）、
//   チェックサム、SDR33 の書き出し（桁・点名の置き換え・往復）、ファイルを開く、通信（Web Serial の模擬）での受信・送信
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { ReadableStream, WritableStream } = require('node:stream/web');
const { loadApp, near } = require('./helpers/load-app.cjs');

// ---- 仕様（Sokkia SDR 3章）どおりの桁で記録を作る ----
const A = (s, w = 16) => String(s).padEnd(w).slice(0, w);                    // 文字の欄（左詰め）
const Rn = (v, w = 16) => (v === null ? '' : String(v)).padEnd(w).slice(0, w); // 数値の欄（左詰め・空白埋め）
const hdr33 = (angle = '1', dist = '1') => '00NM' + A('SDR33 V04-04.02') + '0000' + A('25-Sep-26 12:00') + angle + dist + '1111';
const hdr20 = () => '00NM' + A('SDR20 V03-05') + '0000' + A('25-Sep-26 12:00') + '111111';
const instr = (vopt) => '01NM' + '1' + A('') + '000000' + A('') + '000000' + '3' + vopt + A('') + A('') + A('');
const stn33 = (id, N, E, Z, ih, desc = '') => '02TP' + A(id) + Rn(N) + Rn(E) + Rn(Z) + Rn(ih) + A(desc);
const tgt33 = (th) => '03NM' + Rn(th);
const sf33 = (sf) => '06NM' + Rn(sf);
const bkb33 = (from, to, az, h) => '07TP' + A(from) + A(to) + Rn(az) + Rn(h);
const pos33 = (id, N, E, Z, desc = '') => '08KI' + A(id) + Rn(N) + Rn(E) + Rn(Z) + A(desc);
const obs33 = (d, from, to, sd, v, h, desc = '') => '09' + d + A(from) + A(to) + Rn(sd) + Rn(v) + Rn(h) + A(desc);
const red33 = (from, to, az, hd, vd) => '11KI' + A(from) + A(to) + Rn(az) + Rn(hd) + Rn(vd) + A('');
// SDR2x: 点番号 4桁・数値 10桁
const stn20 = (id, N, E, Z, ih) => '02TP' + id + Rn(N, 10) + Rn(E, 10) + Rn(Z, 10) + Rn(ih, 10) + A('');
const bkb20 = (from, to, az, h) => '07TP' + from + to + Rn(az, 10) + Rn(h, 10);
const obs20 = (d, from, to, sd, v, h) => '09' + d + from + to + Rn(sd, 10) + Rn(v, 10) + Rn(h, 10) + A('');
const pos20 = (id, N, E, Z) => '08KI' + id + Rn(N, 10) + Rn(E, 10) + Rn(Z, 10) + A('');
const checksum = (lines) => lines.reduce((s, l) => s + [...l].reduce((a, c) => a + c.charCodeAt(0), 0), 0) % 65536;
const frame = (lines, sum) => '\x02\r\n' + lines.join('\r\n') + '\r\n\x03' + String(sum === undefined ? checksum(lines) : sum).padStart(5, '0') + '\r\n';

describe('SDR 形式の読み書き', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    const parse = (text) => { app.window.__sdr = text; return app.val('parseSdr(window.__sdr)'); };
    const pt = (r, id) => r.points.find((p) => p.id === id);

    it('SDR33: 器械点・後視・目標高から観測を座標にする（天頂角・標高）', () => {
        const r = parse([hdr33(), '10NMJOB1            121111', instr('1'),
            stn33('S1', 1000, 2000, 10, 1.5, 'KIKAI'), bkb33('S1', 'S2', 0, 0), tgt33(1.5),
            obs33('F1', 'S1', 'P1', 10, 90, 90, 'KUI'),
            obs33('F1', 'S1', 'P2', 20, 80, 45)].join('\r\n'));
        assert.equal(r.format, 33);
        assert.equal(r.job, 'JOB1');
        assert.equal(r.stations.length, 1);
        assert.equal(r.obsCount, 2);
        const p1 = pt(r, 'P1');
        assert.ok(near(p1.X, 1000) && near(p1.Y, 2010) && near(p1.Z, 10), JSON.stringify(p1)); // 東へ 10
        assert.equal(p1.desc, 'KUI');
        const hd = 20 * Math.sin(80 * Math.PI / 180), vd = 20 * Math.cos(80 * Math.PI / 180);
        const p2 = pt(r, 'P2');
        assert.ok(near(p2.X, 1000 + hd * Math.SQRT1_2) && near(p2.Y, 2000 + hd * Math.SQRT1_2) && near(p2.Z, 10 + 1.5 + vd - 1.5), JSON.stringify(p2));
        assert.ok(pt(r, 'S1'), '器械点も点にする');
        assert.deepEqual(r.warnings, []);
    });
    it('後視の読みで向きを合わせる。後視の方向角が空なら既知点から求める', () => {
        // 後視（方向角 120°）を水平角 30° で視準 → 水平角 0° の方向は 90°（東）
        let r = parse([hdr33(), stn33('S1', 0, 0, 0, 0), bkb33('S1', 'BS', 120, 30), tgt33(0), obs33('F1', 'S1', 'A', 10, 90, 0)].join('\n'));
        assert.ok(near(pt(r, 'A').X, 0) && near(pt(r, 'A').Y, 10), JSON.stringify(pt(r, 'A')));
        // 既知点 BS が北にある: 後視の方向角 0°。後視を 10° で視準 → 水平角 100° は 90°（東）
        r = parse([hdr33(), pos33('BS', 50, 0, null), stn33('S1', 0, 0, 0, 0), bkb33('S1', 'BS', null, 10), obs33('F1', 'S1', 'B', 10, 90, 100)].join('\n'));
        assert.ok(near(pt(r, 'B').X, 0) && near(pt(r, 'B').Y, 10), JSON.stringify(pt(r, 'B')));
    });
    it('反（F2）は正に直し、補正済み（MC）は方向角として扱う。同じ点は後の値を使う', () => {
        const r = parse([hdr33(), instr('1'), stn33('S1', 0, 0, 0, 0), bkb33('S1', 'N', 0, 0),
            obs33('F2', 'S1', 'Q', 10, 270, 270), // 反: 天頂角 90°・水平角 90°
            obs33('MC', 'S1', 'M', 10, 90, 180)].join('\n')); // 方向角 180°（南）
        assert.ok(near(pt(r, 'Q').X, 0) && near(pt(r, 'Q').Y, 10), JSON.stringify(pt(r, 'Q')));
        assert.ok(near(pt(r, 'M').X, -10) && near(pt(r, 'M').Y, 0), JSON.stringify(pt(r, 'M')));
        const d = parse([hdr33(), stn33('S1', 0, 0, 0, 0), bkb33('S1', 'N', 0, 0), obs33('F1', 'S1', 'D', 10, 90, 90), obs33('F1', 'S1', 'D', 12, 90, 90)].join('\n'));
        assert.equal(d.points.filter((p) => p.id === 'D').length, 1);
        assert.ok(near(pt(d, 'D').Y, 12));
    });
    it('鉛直角が高低角（水平0°）の機械・縮尺係数・縮小値（11）', () => {
        let r = parse([hdr33(), instr('2'), stn33('S1', 0, 0, 100, 1), bkb33('S1', 'N', 0, 0), tgt33(1), obs33('F1', 'S1', 'U', 10, 30, 0)].join('\n'));
        assert.ok(near(pt(r, 'U').X, 10 * Math.cos(Math.PI / 6)) && near(pt(r, 'U').Z, 100 + 5), JSON.stringify(pt(r, 'U')));
        r = parse([hdr33(), sf33(0.9996), stn33('S1', 0, 0, 0, 0), bkb33('S1', 'N', 0, 0), obs33('F1', 'S1', 'K', 100, 90, 0)].join('\n'));
        assert.ok(near(pt(r, 'K').X, 99.96));
        r = parse([hdr33(), pos33('A', 10, 10, 5), red33('A', 'B', 90, 20, -2)].join('\n'));
        assert.ok(near(pt(r, 'B').X, 10) && near(pt(r, 'B').Y, 30) && near(pt(r, 'B').Z, 3), JSON.stringify(pt(r, 'B')));
    });
    it('単位: グラード・フィートは度・m に直して、知らせる', () => {
        const r = parse([hdr33('2', '2'), stn33('S1', 0, 0, 0, 0), bkb33('S1', 'N', 0, 0), obs33('F1', 'S1', 'G', 100, 100, 100)].join('\n'));
        assert.ok(near(pt(r, 'G').Y, 30.48) && near(pt(r, 'G').X, 0), JSON.stringify(pt(r, 'G'))); // 100 gon = 90°、100 ft = 30.48 m
        assert.ok(r.warnings.some((w) => /グラード/.test(w)) && r.warnings.some((w) => /フィート/.test(w)));
    });
    it('SDR2x（点番号 4桁・数値 10桁）も読める。見出しが無くても書式を見分ける', () => {
        const lines = [stn20('0001', 100, 200, 50, 1), bkb20('0001', '9999', 0, 0), obs20('F1', '0001', '1000', 10, 90, 180), pos20('2000', -132.937, 398.153, 55.917)];
        let r = parse([hdr20()].concat(lines).join('\r\n'));
        assert.equal(r.format, 20);
        assert.ok(near(pt(r, '1000').X, 90) && near(pt(r, '1000').Y, 200) && near(pt(r, '1000').Z, 51), JSON.stringify(pt(r, '1000')));
        assert.ok(near(pt(r, '2000').X, -132.937) && near(pt(r, '2000').Z, 55.917));
        r = parse(lines.join('\r\n'));
        assert.equal(r.format, 20);
        assert.ok(pt(r, '1000'));
        assert.ok(r.warnings.some((w) => /見出し/.test(w)));
    });
    it('通信の枠（STX・ETX）とチェックサム（合う・合わない・00000 は確かめない）', () => {
        const lines = [hdr33(), pos33('KP1', 645.479, -52621.837, 12.5)];
        assert.equal(parse(frame(lines)).checksum.ok, true);
        const bad = frame(lines).replace('KP1', 'KQ1');
        assert.equal(parse(bad).checksum.ok, false);
        assert.equal(parse(frame(lines, 0)).checksum.ok, true);
        assert.equal(parse(frame(lines)).points[0].id, 'KP1');
    });
    it('SDR33 の書き出し: 記録の長さ・数値の欄・点名の置き換え・読み直すと同じ座標', () => {
        const pts = [{ id: 'KP1', X: 645.479, Y: -52621.837, Z: 12.5 }, { id: '境界1', X: 1.5, Y: -2.25, Z: null }, { id: 'KP1', X: 3, Y: 4, Z: null }, { id: 'X', X: -1234567.123456789, Y: 7654321.5, Z: null }];
        app.window.__pts = pts;
        const r = app.val('buildSdr33Records(window.__pts, { job: "GENBA", date: new Date(2026, 8, 25, 12, 34) })');
        assert.equal(r.lines[0].length, 46);
        assert.match(r.lines[0], /^00NMSDR33 V04-04\.02 0000/);
        assert.match(r.lines[0], /25-Sep-26 12:34 /);
        assert.equal(r.lines[1], '10NMGENBA           121111');
        r.lines.slice(2).forEach((l) => assert.equal(l.length, 84, l));
        assert.equal(r.lines[2].slice(0, 20), '08KIKP1             ');
        assert.equal(r.lines[2].slice(20, 36), '645.47900000    ');
        assert.equal(r.lines[2].slice(36, 52), '-52621.83700000 ');
        assert.deepEqual(r.renamed.map((x) => x.to), ['P0001', 'P0002']); // 日本語の点名・重なった点名
        app.window.__lines = r.lines;
        const back = app.val('parseSdr(sdrFileText(window.__lines))');
        assert.equal(back.points.length, 4);
        assert.ok(near(back.points[0].X, 645.479) && near(back.points[0].Y, -52621.837) && near(back.points[0].Z, 12.5));
        assert.equal(back.points[1].Z, null);
        assert.ok(near(back.points[3].X, -1234567.123456789, 1e-6) && near(back.points[3].Y, 7654321.5));
        // 通信用は STX・ETX とチェックサム
        const comms = app.eval('sdrCommsText(window.__lines)');
        const tail = comms.slice(-10); // CR LF ETX チェックサム5桁 CR LF
        assert.ok(comms.startsWith('\x02\r\n') && tail.slice(0, 3) === '\r\n\x03' && /^\d{5}\r\n$/.test(tail.slice(3)), JSON.stringify(tail));
        assert.equal(parse(comms).checksum.ok, true);
    });
});

describe('TS連携: ファイルと通信', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.window.confirm = () => true;
        app.eval(`resetCommand(); entities.length = 0; undoStack.length = 0; localStorage.removeItem('cad_survey_unit');
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true }); currentLayerIndex = 0; _ts.pending = null; _ts.parser = null;`);
    });
    const job = () => [hdr33(), '10NMGENBA           121111', stn33('S1', 1000, 2000, 10, 1.5), bkb33('S1', 'S2', 0, 0), tgt33(1.5),
        obs33('F1', 'S1', 'P1', 10, 90, 90), obs33('F1', 'S1', 'P2', 10, 90, 180)];
    const bytes = (s) => Array.from(s, (c) => c.charCodeAt(0));

    it('SDR ファイルを開くと測点になる（器械点・観測から計算した点）', async () => {
        app.window.__file = new app.window.File([job().join('\r\n')], 'genba.sdr', { type: 'text/plain' });
        const r = await app.eval('loadSdrFile(window.__file)');
        assert.ok(r);
        const names = app.val(`entities.filter(e => e.type === 'POINT').map(e => e.name)`);
        assert.deepEqual(names.sort(), ['P1', 'P2', 'S1']);
        const p1 = app.val(`entities.find(e => e.type === 'POINT' && e.name === 'P1')`);
        assert.ok(near(p1.x, 2010) && near(p1.y, 1000) && near(p1.z, 10)); // 図面の x＝東・y＝北
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /観測から計算 2件/);
    });
    it('「開く」で .sdr を選ぶと SDR として読む', async () => {
        app.window.__file = new app.window.File([job().join('\r\n')], 'genba.sdr', { type: 'text/plain' });
        app.eval(`(() => { const inp = document.getElementById('dxf-file-input'); Object.defineProperty(inp, 'files', { value: [window.__file], configurable: true }); inp.dispatchEvent(new Event('change')); })()`);
        await new Promise((r) => setTimeout(r, 100));
        assert.equal(app.eval(`entities.filter(e => e.type === 'POINT').length`), 3);
        assert.match(app.eval(`document.getElementById('dxf-file-input').getAttribute('accept')`), /\.sdr/);
    });
    it('座標一覧・メニューから SDR33 で書き出す（点名は測点から）', async () => {
        app.eval(`addSurveyData([{ num: '1', name: 'KP1', X: 645.479, Y: -52621.837, z: 12.5 }, { num: '2', name: 'KP2', X: 642.388, Y: -52620.022 }], [])`);
        app.eval(`window.__dl = downloadBlob; downloadBlob = (b, n) => { window.__blob = b; window.__name = n; }; exportSdr33(); downloadBlob = window.__dl;`);
        assert.match(app.eval('window.__name'), /\.sdr$/);
        const text = await app.eval('new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsText(window.__blob); })');
        const back = (() => { app.window.__sdr = text; return app.val('parseSdr(window.__sdr)'); })();
        assert.deepEqual(back.points.map((p) => p.id), ['KP1', 'KP2']);
        assert.ok(near(back.points[0].Z, 12.5));
        app.eval('showCoordListPanel()');
        assert.match(app.eval(`document.getElementById('property-panel-content').textContent`), /SDR33出力/);
    });
    it('Web Serial が無いブラウザでは、ファイルでの受け渡しを案内する', () => {
        app.eval('showTsPanel()');
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '📡 TS連携');
        assert.match(app.eval(`document.getElementById('property-panel-content').textContent`), /このブラウザでは機械と直接つなげません/);
    });
    it('受信: 行の途中で分かれて届いても読み、ETX で取り込み待ちにする。取り込みは元に戻す1回', () => {
        app.eval('showTsPanel()');
        const b = bytes(frame(job()));
        // 7バイトずつ届く
        for (let i = 0; i < b.length; i += 7) { app.window.__b = b.slice(i, i + 7); app.eval('tsReceiveBytes(window.__b)'); }
        assert.equal(app.eval('_ts.pending.points.length'), 3);
        assert.equal(app.eval('_ts.pending.checksum.ok'), true);
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /受信しました: 点 3点/);
        app.eval('_tsUpdateResult()');
        assert.match(app.eval(`document.getElementById('ts-result').textContent`), /P1/);
        app.eval('_drawFrame(false)'); // 取り込み前の点の重ね表示
        app.eval('tsImport()');
        assert.equal(app.eval(`entities.filter(e => e.type === 'POINT').length`), 3);
        assert.equal(app.eval('_ts.pending'), null);
        app.eval('undo()');
        assert.equal(app.eval('entities.length'), 0);
    });
    it('受信: チェックサムが合わなければ知らせる。XOFF・XON で送信を止める・再開する', () => {
        app.eval('showTsPanel()');
        app.window.__b = bytes(frame(job(), 12345)); app.eval('tsReceiveBytes(window.__b)');
        assert.equal(app.eval('_ts.pending.checksum.ok'), false);
        app.eval('_tsUpdateResult()');
        assert.match(app.eval(`document.getElementById('ts-result').textContent`), /チェックサムが合いません/);
        app.eval('tsReceiveBytes([0x13])'); assert.equal(app.eval('_ts.xoff'), true);
        app.eval('tsReceiveBytes([0x11])'); assert.equal(app.eval('_ts.xoff'), false);
    });
    it('Web Serial（模擬）: つなぐ・受信する・測点を送る・切断する', async () => {
        // 模擬のポート: 受信はテストから流し込み、送信は書き込まれたバイトを集める
        let pushRx; const sent = [];
        const port = {
            opened: null,
            readable: new ReadableStream({ start(c) { pushRx = (arr) => c.enqueue(Uint8Array.from(arr)); } }),
            writable: new WritableStream({ write(chunk) { sent.push(...chunk); } }),
            open: async function (o) { this.opened = o; },
            close: async () => {},
            addEventListener: () => {},
        };
        Object.defineProperty(app.window.navigator, 'serial', { value: { requestPort: async () => port }, configurable: true });
        app.eval(`localStorage.setItem('cad_ts_opts', JSON.stringify({ baudRate: 1200, dataBits: 8, parity: 'none', stopBits: 1 }))`);
        await app.eval('tsConnect()');
        assert.deepEqual(port.opened && [port.opened.baudRate, port.opened.dataBits, port.opened.parity], [1200, 8, 'none']);
        assert.match(app.eval(`document.getElementById('property-panel-content').textContent`), /つながっています/);
        pushRx(bytes(frame(job())));
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(app.eval('_ts.pending && _ts.pending.points.length'), 3);
        // 図面の測点を送る
        app.eval(`addSurveyData([{ num: '1', name: 'KP1', X: 1, Y: 2 }], [])`);
        await app.eval('tsSendPoints()');
        const text = String.fromCharCode(...sent);
        assert.ok(text.startsWith('\x02\r\n00NMSDR33'), JSON.stringify(text.slice(0, 20)));
        assert.match(text, /08KIKP1\s+1\.00000000\s+2\.00000000/);
        app.window.__sdr = text;
        assert.equal(app.eval('parseSdr(window.__sdr).checksum.ok'), true);
        await app.eval('tsDisconnect()');
        assert.equal(app.eval('_ts.port'), null);
        delete app.window.navigator.serial;
    });
    it('コマンド（TS・SDROUT）とヘルプ', () => {
        app.eval(`processCommand('TS')`);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '📡 TS連携');
        assert.ok(app.eval(`GUIDE_TOPICS.some(t => /トータルステーション/.test(t.title))`));
        assert.deepEqual(app.errors(), []);
    });
});

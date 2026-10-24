'use strict';
// 座標表の読み取り（v5.55。cad-ai-read.js）: 自分の API キー・Claude への頼み方（モデル・画像・PDF・答えの形・断られたときのやり直し）・
// 答えの読み方（途中で切れた・別のモデルに替わった）・確かめる表（自信の無い行・直す・数でない欄・mm・X と Y の入れ替え）・取り込み。
// Claude には送らない（代わりの SDK で受ける）。答えの形（zod）は本物の SDK の部品で JSON Schema にする
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');
const { z } = require('zod/v4');
const { loadApp } = require('./helpers/load-app.cjs');

const KEY = 'sk-ant-api03-' + 'x'.repeat(40);

describe('座標表の読み取り', () => {
    let app, w, sent, reply;
    before(async () => {
        app = await loadApp();
        w = app.window;
        // 代わりの SDK: 頼んだ中身を残し、決めた答えを返す
        class FakeAnthropic {
            constructor(opt) { w.__clientOpt = opt; this.beta = { messages: { stream: (params) => { sent.push(params); return { finalMessage: async () => (typeof reply === 'function' ? reply(params) : reply) }; } } }; }
        }
        class APIConnectionError extends Error {}
        FakeAnthropic.APIConnectionError = APIConnectionError;
        w.__ConnErr = APIConnectionError;
        w.loadClaudeSdk = async () => ({ Anthropic: FakeAnthropic, betaZodOutputFormat, z });
        app.eval('window.__realPrep = aireadPrepFile');
    });
    after(() => app.close());
    beforeEach(() => {
        sent = []; reply = null;
        app.eval(`localStorage.removeItem('cad_claude_key'); _airead = null; _aireadBusy = false; closePropertyPanel(); hideSnack();
            entities.length = 0; undoStack.length = 0;
            aireadPrepFile = async (f) => ({ name: f.name, kind: /\\.pdf$/i.test(f.name) ? 'pdf' : 'image', mediaType: /\\.pdf$/i.test(f.name) ? 'application/pdf' : 'image/jpeg', data: 'QUJD', url: /\\.pdf$/i.test(f.name) ? null : 'data:image/jpeg;base64,QUJD' });`);
    });
    // Claude の答え（本物と同じく text ブロックに JSON）
    const answer = (points, extra, opt) => ({ stop_reason: (opt && opt.stop) || 'end_turn', model: 'claude-opus-5-5', usage: { input_tokens: 5000, output_tokens: 1000 },
        content: [...((opt && opt.before) || []), { type: 'text', text: (opt && opt.raw) || JSON.stringify(Object.assign({ points, unit: 'm', notes: '' }, extra || {})) }] });
    const P = (num, name, x, y, zz, unsure, why) => ({ num, name, x, y, z: zz || '', unsure: !!unsure, unsure_reason: why || '' });
    const pick = async (names) => {
        await app.eval(`aireadPicked(${JSON.stringify(names)}.map((n) => new File(['x'], n, { type: n.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' })))`);
        await new Promise((r) => setTimeout(r, 30));
    };
    const toast = () => app.val(`document.getElementById('cad-toast') ? document.getElementById('cad-toast').textContent : ''`);
    const sum = () => app.val(`document.getElementById('airead-sum').textContent`);

    it('キーが無ければ、キーを入れる欄を出す。形の違うキーは入れない。入れたら写真を選ぶ画面になる', () => {
        app.eval('showAireadPanel()');
        assert.equal(app.val(`!!document.getElementById('airead-key')`), true);
        assert.equal(app.val(`!!document.getElementById('airead-file')`), false);
        app.eval(`setAireadKey('abc')`);
        assert.equal(app.val('aireadKey()'), '');
        app.eval(`setAireadKey('${KEY}')`);
        assert.equal(app.val('aireadKey()'), KEY);
        assert.equal(app.val(`!!document.getElementById('airead-file')`), true);
        assert.match(app.val(`document.getElementById('airead-file').accept`), /image\/\*.*pdf/);
    });

    it('Claude への頼み方: 自分のキー・Claude Opus 5.5・effort high・答えの形（読むのはアプリ）・断られたら別のモデル・画像と PDF を順に', async () => {
        app.eval(`setAireadKey('${KEY}')`);
        reply = answer([P('1', 'T1', '-12345.678', '23456.789', '10.25')]);
        await pick(['表1.jpg', '表2.pdf']);
        assert.deepEqual(app.val('window.__clientOpt'), { apiKey: KEY, dangerouslyAllowBrowser: true });
        const p = sent[0];
        assert.equal(p.model, 'claude-opus-5-5');
        assert.deepEqual([...p.betas], ['server-side-fallback-2026-07-01']);
        assert.equal(p.fallbacks, 'default');
        assert.equal(p.output_config.effort, 'high');
        assert.equal(p.output_config.format.type, 'json_schema');
        assert.equal(typeof p.output_config.format.parse, 'undefined', 'SDK には読ませない（途中で切れた答えで例外にならないように）');
        assert.deepEqual([...p.output_config.format.schema.required].sort(), ['notes', 'points', 'unit']);
        assert.ok(p.max_tokens >= 32000, '長い表でも途中で切れないように');
        assert.equal(p.thinking, undefined, '考える深さは effort で（thinking は送らない）');
        const c = p.messages[0].content;
        assert.deepEqual([...c.map((b) => b.type)], ['text', 'image', 'text', 'document', 'text']);
        assert.deepEqual({ ...c[1].source }, { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' });
        assert.deepEqual({ ...c[3].source }, { type: 'base64', media_type: 'application/pdf', data: 'QUJD' });
        assert.match(p.system, /X は北/);
        assert.deepEqual(app.errors(), []);
    });

    it('確かめる表: 自信の無い行に色・理由・「見比べた」。ほかの欄を直しても印は残る。数でない欄は赤く、取り込まない', async () => {
        app.eval(`setAireadKey('${KEY}')`);
        reply = answer([P('1', 'T1', '-12345.678', '23456.789', '10.25'), P('2', 'T2', '-12350.1O0', '23460.000', '', true, 'X の小数3桁目が 0 か O か'), P('3', 'T3', '-12360.000', '23470.500')], { notes: '見出しは X・Y' });
        await pick(['表.jpg']);
        assert.equal(app.val(`document.querySelectorAll('.airead-row.unsure').length`), 1);
        assert.match(app.val(`document.querySelector('.airead-why').textContent`), /0 か O/);
        assert.equal(app.val(`document.querySelectorAll('.airead-img').length`), 1);
        assert.match(app.val(`document.getElementById('airead-review').textContent`), /約 \$0\.040/); // 5000×$4/100万 + 1000×$20/100万
        assert.match(sum(), /取り込む点: 2点.*数でない行 1/);
        assert.equal(app.val(`document.querySelector('#airead-row-1 .airead-x').classList.contains('bad')`), true, 'X の欄が赤い');
        // 点名だけ直しても、X の疑いの印は残る（G3）
        app.eval(`aireadEdit(1, 'name', 'T2a')`);
        assert.equal(app.val('_airead.rows[1].unsure'), true);
        app.eval(`aireadEdit(1, 'x', '－１２３５０．１００')`); // 全角で直しても読める
        assert.equal(app.val('_airead.rows[1].x'), '-12350.100');
        assert.match(sum(), /取り込む点: 3点（うち見比べていない、自信の無い行 1）/);
        app.eval('aireadConfirm(1)');
        assert.equal(app.val(`document.querySelectorAll('.airead-row.unsure').length`), 0);
        app.eval(`aireadEdit(2, 'use', false)`);
        assert.match(app.val(`document.getElementById('airead-import').textContent`), /2点を取り込む/);
    });

    it('1つ直しても表全体は描き直さない（ほかの行の欄・表のスクロールはそのまま）', async () => {
        app.eval(`setAireadKey('${KEY}')`);
        reply = answer([P('1', 'A', '-1.000', '2.000'), P('2', 'B', '-3.000', '4.000')]);
        await pick(['表.jpg']);
        app.eval(`window.__keep = document.querySelector('#airead-row-1 .airead-x'); aireadEdit(0, 'x', '-1.500')`);
        assert.equal(app.val(`document.querySelector('#airead-row-1 .airead-x') === window.__keep`), true);
        assert.equal(app.val(`document.querySelector('#airead-row-0 .airead-x').value`), '-1.500');
    });

    it('数の文字: 桁区切りのカンマだけ外す。「.」のつもりのカンマ・途中の空白・数でない標高は取り込まない（値を変えない）', () => {
        const t = (s) => app.val(`_aireadNumText(${JSON.stringify(s)})`);
        assert.equal(t('1,234,567.890'), '1234567.890');
        assert.equal(t('－２３，４５６．７８９'), '-23456.789'); // 全角の桁区切り
        assert.equal(t('-12345,678'), '-12345,678', '小数点のつもりのカンマは外さない（外すと 1000 倍の数になる）');
        assert.equal(t('23456 789'), '23456 789');
        assert.equal(t(' +12.5 '), '+12.5');
        const pt = (r, mm, zmm) => app.val(`aireadRowToPoint(${JSON.stringify(Object.assign({ num: '1', name: '', z: '' }, r))}, ${!!mm}, ${zmm === undefined ? 'undefined' : !!zmm})`);
        assert.equal(pt({ x: '-12345,678', y: '1.0' }), null);
        assert.equal(pt({ x: '-12345.678', y: '23456 789' }), null);
        assert.equal(pt({ x: '-12345.678', y: '23456.789', z: '1O.25' }), null, '標高が数でない行も取り込まない（黙って標高を消さない）');
        assert.deepEqual(pt({ x: '-12345.678', y: '23456.789', z: '' }), { num: '1', name: '', X: -12345.678, Y: 23456.789, z: null });
        assert.deepEqual(pt({ x: '-.5', y: '12.', z: '0' }), { num: '1', name: '', X: -0.5, Y: 12, z: 0 });
        // mm: X・Y は m に、標高は「標高も mm」のときだけ
        assert.deepEqual(pt({ x: '-12345678', y: '23456789', z: '10250' }, true, true), { num: '1', name: '', X: -12345.678, Y: 23456.789, z: 10.25 });
        assert.deepEqual(pt({ x: '-12345678', y: '23456789', z: '10.25' }, true, false), { num: '1', name: '', X: -12345.678, Y: 23456.789, z: 10.25 });
    });

    it('取り込み: 文字のままの値を数にして座標一覧へ（丸めない）。mm なら m に、X と Y を入れ替えられる', async () => {
        app.eval(`setAireadKey('${KEY}')`);
        reply = answer([P('101', 'BM1', '-12345.678', '23456.789', '10.250'), P('102', '', '-12345.001', '23456.002')]);
        await pick(['表.jpg']);
        app.eval('aireadImport()'); // 図面が空なので、置き換え・追加は聞かない
        await new Promise((r) => setTimeout(r, 30));
        const pts = app.val(`collectSurveyPoints().map((p) => { const s = wcsToSurvey(p.x, p.y); return [p.num, p.name, Math.round(s.X * 1e6) / 1e6, Math.round(s.Y * 1e6) / 1e6, p.z]; })`);
        assert.deepEqual(pts, [['101', 'BM1', -12345.678, 23456.789, 10.25], ['102', '', -12345.001, 23456.002, null]]);
        // mm の表・東北の順
        reply = answer([P('1', '', '23456789', '-12345678', '1000')], { unit: 'mm' });
        await pick(['表mm.jpg']);
        assert.equal(app.val(`document.getElementById('airead-mm').checked`), true, 'Claude が mm と読んだら初めから入');
        assert.equal(app.val(`document.getElementById('airead-zmm').checked`), true);
        app.eval('aireadSwapXY()');
        assert.deepEqual(app.val('aireadRowToPoint(_airead.rows[0], _airead.mm, _airead.zmm)'), { num: '1', name: '', X: -12345.678, Y: 23456.789, z: 1 });
        assert.deepEqual(app.errors(), []);
    });

    it('置き換え・追加で「やめる」・✕ で閉じたあとも、読み取った表に戻れる（読み直さない）', async () => {
        app.eval(`setAireadKey('${KEY}'); entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 1, y2: 1 }); ensureEntityIds();`);
        reply = answer([P('1', 'A', '-1.000', '2.000')]);
        await pick(['表.jpg']);
        app.eval(`aireadEdit(0, 'name', 'A直した')`);
        app.eval(`window.__cc = cadChoose; cadChoose = (o, cb) => cb(null); aireadImport(); cadChoose = window.__cc;`);
        assert.equal(app.val(`!!document.getElementById('airead-review')`), true, 'やめたら表に戻る');
        assert.equal(app.val('_airead.rows[0].name'), 'A直した');
        app.eval('closePropertyPanel(); showAireadPanel()');
        assert.equal(app.val(`!!document.getElementById('airead-review')`), true, 'メニューから開き直しても表');
        assert.equal(sent.length, 1, '読み直していない');
        app.eval('aireadRestart()');
        assert.equal(app.val(`!!document.getElementById('airead-file')`), true, '「別の写真を読む」で選び直し');
    });

    it('答えの読み方: 途中で切れた・別のモデルに替わった（書きかけを混ぜない）・断られた', async () => {
        app.eval(`setAireadKey('${KEY}')`);
        reply = answer(null, null, { stop: 'max_tokens', raw: '{"points":[{"num":"1","name":"","x":"-1.0"' });
        await pick(['表.jpg']);
        assert.match(toast(), /途中で切れました/);
        assert.equal(app.val('_airead'), null);
        reply = answer([P('1', 'A', '-1.000', '2.000')], null, { before: [{ type: 'text', text: '{"points":[{"num":"9"' }, { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } }] });
        await pick(['表.jpg']);
        assert.equal(app.val('_airead.rows.length'), 1, '替わったあとの答えだけを読む');
        app.eval('_airead = null');
        reply = { stop_reason: 'refusal', model: 'claude-opus-5-5', usage: {}, content: [{ type: 'text', text: '{"poi' }] };
        await pick(['表.jpg']);
        assert.match(toast(), /断りました/);
        assert.equal(app.val('_airead'), null);
    });

    it('キーが違う・通信できない（SDK の APIConnectionError）・大きすぎるときは、わかる言葉で知らせて何も取り込まない', async () => {
        app.eval(`setAireadKey('${KEY}')`);
        reply = () => { const e = new Error('invalid x-api-key'); e.status = 401; throw e; };
        await pick(['表.jpg']);
        assert.match(toast(), /API キーが違う/);
        reply = () => { throw new w.__ConnErr('Connection error.'); };
        await pick(['表.jpg']);
        assert.match(toast(), /電波/);
        app.eval(`window.__prep = aireadPrepFile; aireadPrepFile = async (f) => ({ name: f.name, kind: 'pdf', mediaType: 'application/pdf', data: 'A'.repeat(16 * 1024 * 1024), url: null });`);
        await pick(['a.pdf', 'b.pdf']);
        assert.match(toast(), /大きすぎ/);
        assert.equal(sent.length, 2, '大きすぎるときは送らない');
        app.eval('aireadPrepFile = window.__prep');
        assert.equal(app.val('entities.length'), 0);
    });

    it('読み取り中にもう一度選んでも、2回送らない（料金が2回かからない）', async () => {
        app.eval(`setAireadKey('${KEY}'); showAireadPanel()`);
        let release;
        reply = () => new Promise((r) => { release = () => r(answer([P('1', 'A', '-1.000', '2.000')])); });
        const first = app.eval(`aireadPicked([new File(['x'], 'a.jpg', { type: 'image/jpeg' })])`);
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(app.val(`document.getElementById('airead-pick').disabled`), true);
        await app.eval(`aireadPicked([new File(['x'], 'b.jpg', { type: 'image/jpeg' })])`);
        assert.equal(sent.length, 1);
        assert.match(toast(), /いま読み取っています/);
        release();
        await first;
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(app.val('_aireadBusy'), false);
    });

    it('PDF はそのまま（base64）。大きすぎる PDF は送らない', async () => {
        await app.eval(`(async () => { const f = new File([new Uint8Array([37, 80, 68, 70, 45])], 'a.pdf', { type: 'application/pdf' }); window.__pdf = await window.__realPrep(f); })()`);
        assert.deepEqual(app.val('window.__pdf'), { name: 'a.pdf', kind: 'pdf', mediaType: 'application/pdf', data: 'JVBERi0=', url: null });
        await app.eval(`(async () => { const f = new File(['x'], 'big.pdf', { type: 'application/pdf' }); Object.defineProperty(f, 'size', { value: 21 * 1024 * 1024 });
            try { await window.__realPrep(f); window.__big = 'sent'; } catch(e) { window.__big = e.message; } })()`);
        assert.match(app.val('window.__big'), /大きすぎ/);
    });

    it('オプションの欄: キーは見せない（password）・状態・消す', () => {
        app.eval(`setAireadKey('${KEY}'); showOptionsPanel()`);
        assert.equal(app.val(`document.getElementById('opt-ai-key').type`), 'password');
        assert.equal(app.val(`document.getElementById('opt-ai-key').value`), '', 'キーの文字は欄に出さない');
        assert.match(app.val(`document.getElementById('opt-ai-status').textContent`), /入っています/);
        app.eval(`setAireadKey('')`);
        assert.equal(app.val('aireadEnabled()'), false);
        assert.deepEqual(app.errors(), []);
    });
});

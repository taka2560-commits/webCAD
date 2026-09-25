// ===== Web CAD トータルステーション連携: 画面・通信 =====
// cad-ts.js - 「📡 TS連携」パネル。ファイル（SIMA・SDR）の受け渡しと、Web Serial（USB ケーブル・Bluetooth）での受信・送信。
//   受信: 機械で「現場管理 → 現場データ送信」をすると、届いたデータをその場で読み、点を図面に重ねて見せる。
//         S タイプの「SD」（SDR33）は行ごとに、T タイプの「APA-SIMA（座標）」（SIMA）は届くのが止まったところで読む。
//         「図面に取り込む」で測点にする（元に戻すは1回）。
//   送信: 機械を「既知点 → 外部入力」で待ち受けにしてから、「SIMA で送る」（T タイプの APA-SIMA（座標）。1行ずつ Shift-JIS・CR LF）
//         か「SDR33 で送る」（S タイプの SD。SDR33 の既知点 08KI を STX〜ETX で）。
//         機械が XOFF（受信の一時停止）を返したら、XON が来るまで待つ。「ACK のやり取り」（T タイプの ACK モード「標準」）では、
//         受け取った記録ごとに ACK を返し、送る行ごとに機械の ACK を待つ（NAK なら送り直す）。
//   ※ 1行の区切りや合図の細かい決まりは、機械の説明書に無く別冊のコミュニケーションマニュアルにしか無い。実機の生データで確かめる。
//   Web Serial が使えるのは PC の Chrome・Edge と Android の Chrome。iPhone・iPad ではファイル（SIMA・SDR）で受け渡しする。
//   受信した生データ: 届いたバイトを制御文字も見える形で残す（測るたびの出力「HVD アウト」「NEZ アウト」の形式を実機で確かめるため。
//                     その形式は機械の説明書に無く、別冊のコミュニケーションマニュアルにしか載っていない）。
// SDR の読み書きは cad-sdr.js。

const TS_TITLE = '📡 TS連携';
const TS_BAUDS = [1200, 2400, 4800, 9600, 19200, 38400];
const TS_OPTS_KEY = 'cad_ts_opts';
const _ts = {
    port: null, reader: null, reading: false, xoff: false, sending: false,
    parser: null, pending: null, // 受信中の SDR（sdrParser）と、取り込み待ちの結果（parseSdr と同じ形）
    buf: '', rxBytes: 0, rxLines: 0, uiTimer: null,
    raw: [], rawCur: '', rawTimer: null, rawOpen: false, // 受信した生データ（[{ t: 日時, s: 見える形の文字列 }]）と、組み立て中の行
    howtoOpen: false, // 「つなぎ方」を開いているか
    sima: '', simaBuf: [], simaTimer: null, simaSawEtx: false, // 受信した SIMA（読んだ文字列・ためているバイト）
    ackWait: null, sendNote: '', // 送信中に待っている機械の ACK、送信の進み具合
    writeChain: Promise.resolve(), // 書き込みの順番待ち（同時に書くとポートがふさがっていて失敗するため）
};
// 時間の決まり（テストで短くできるようにまとめる）
const TS_TIMING = {
    simaIdle: 1200,   // SIMA: この間なにも届かなければ、送信が終わったとみなして読む
    ackTimeout: 5000, // 送信: 機械の ACK をこれだけ待つ
    lineGap: 30,      // 送信: ACK を待たないときの、行と行の間
};
const TS_SIMA_RE = /^\s*[A-Z]\d\d\s*,/m; // SIMA の記録（A01・Z00 など）
const TS_RAW_MAX = 300;       // 残す行の数
const TS_RAW_IDLE_MS = 300;   // この間なにも届かなければ、そこで1行とする（CR・LF で終わらない出力もあるため）
const TS_CTRL_NAMES = { 0x00: 'NUL', 0x02: 'STX', 0x03: 'ETX', 0x04: 'EOT', 0x05: 'ENQ', 0x06: 'ACK', 0x0a: 'LF', 0x0d: 'CR', 0x11: 'XON', 0x13: 'XOFF', 0x15: 'NAK', 0x1b: 'ESC' };
function _tsOpts() {
    const def = { baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, ack: false };
    try { return Object.assign(def, JSON.parse(localStorage.getItem(TS_OPTS_KEY) || '{}')); } catch { return def; }
}
function _tsSaveOpts(o) { try { localStorage.setItem(TS_OPTS_KEY, JSON.stringify(o)); } catch { /* 保存できなくても続行 */ } }
function tsSerialAvailable() { return typeof navigator !== 'undefined' && !!navigator.serial && typeof navigator.serial.requestPort === 'function'; }

// ===== パネル =====
window.showTsPanel = function() { _tsRender(); render(); };
function _tsSel(id, label, list, cur) {
    return `<div class="prop-row cogo-row"><div class="prop-label cogo-label">${label}</div><select id="${id}" class="prop-val" onchange="tsSetOpt()" style="min-width:0;">` +
        list.map(([v, t]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${t}</option>`).join('') + '</select></div>';
}
function _tsRender() {
    const o = _tsOpts();
    let h = '<div class="ts-sec">ファイル（USB メモリ・SD カード）</div>' +
        '<div class="cogo-btns"><button class="prop-btn btn-sub" onclick="tsOpenSdrFile()">📁 SIMA を開く</button><button class="prop-btn btn-sub" onclick="exportSima()">📄 SIMA で書き出す</button></div>' +
        '<div class="cogo-btns"><button class="prop-btn btn-sub" onclick="exportSdr33()">📄 SDR33 で書き出す</button></div>' +
        _cogoNote('SIMA（.sim）は測点・区画をそのまま受け渡します。「開く」では SDR（SDR33・SDR2x）の現場データも開け、器械点・後視・観測から座標を計算して測点にします。書き出したファイルは、機械で既知点・杭打ち点として読み込めます。') +
        '<div class="ts-sec">通信（USB ケーブル・Bluetooth）</div>';
    if(!tsSerialAvailable()) {
        h += _cogoNote('このブラウザでは機械と直接つなげません。PC の Chrome・Edge（117 以降）、Android の Chrome（137 以降）で使えます。iPhone・iPad は、ファイル（SIMA・SDR）で受け渡します。');
    } else if(!_ts.port) {
        h += _tsSel('ts-baud', 'ボーレート', TS_BAUDS.map((b) => [b, b + ' bps']), o.baudRate) +
            _tsSel('ts-bits', 'データ長', [[8, '8 ビット'], [7, '7 ビット']], o.dataBits) +
            _tsSel('ts-parity', 'パリティ', [['none', 'なし'], ['even', '偶数'], ['odd', '奇数']], o.parity) +
            _tsSel('ts-stop', 'ストップビット', [[1, '1 ビット'], [2, '2 ビット']], o.stopBits) +
            '<button class="prop-btn" onclick="tsConnect()">🔌 機械とつなぐ</button>' +
            _tsHowTo();
    } else {
        h += `<div class="ts-status"><span class="ts-dot"></span>つながっています&nbsp;&nbsp;<span id="ts-rx">${_tsRxText()}</span></div>` +
            '<div class="cogo-btns"><button class="prop-btn btn-sub" onclick="tsSendSima()">📤 SIMA で送る</button><button class="prop-btn btn-sub" onclick="tsSendPoints()">📤 SDR33 で送る</button></div>' +
            '<div class="cogo-btns"><button class="prop-btn btn-sub" onclick="tsDisconnect()">切断</button></div>' +
            `<label class="edit-chk"><input type="checkbox" ${o.ack ? 'checked' : ''} onchange="tsSetAck(this.checked)"> ACK のやり取りをする（T タイプで ACK モードが「標準」のとき）</label>` +
            _cogoNote('受信: 機械で「現場管理 → 現場データ送信」。T タイプは「APA-SIMA（座標）」、S タイプは「SD」を選びます。届いた点はその場で図面に重ねて表示します。<br>送信: 機械を「既知点 → 外部入力」で待ち受けにしてから 📤（SIMA は T タイプの「APA-SIMA（座標）」、SDR33 は S タイプの「SD」）。範囲選択した測点、無ければすべてを送ります。');
    }
    h += '<div id="ts-result" class="cogo-result"></div>';
    if(_ts.port || _ts.raw.length) {
        h += `<details class="ts-raw" ${_ts.rawOpen ? 'open' : ''} ontoggle="tsRawToggle(this.open)"><summary>🔍 受信した生データ（形式の確認用）<span id="ts-raw-n"></span></summary>` +
            '<pre id="ts-raw" class="ts-raw-pre"></pre>' +
            '<div class="cogo-btns"><button class="prop-btn btn-sub" onclick="tsCopyRaw()">📋 コピー</button><button class="prop-btn btn-sub" onclick="tsClearRaw()">消す</button></div>' +
            _cogoNote('機械から届いたデータを、そのまま表示します（&lt;CR&gt;・&lt;LF&gt;・&lt;ETX&gt; などは制御文字）。測るたびの出力（HVD アウト・NEZ アウト）の形式を確かめるときに使います。') +
            '</details>';
    }
    showPropertyPanel(TS_TITLE, h);
    _tsUpdateResult();
}
// つなぎ方（ソキア iM-100。取扱説明書の9章「外部機器との接続」、FIELD-TERRACE の接続設定、カタログより）
function _tsHowTo() {
    return `<details class="ts-howto" ${_ts.howtoOpen ? 'open' : ''} ontoggle="tsHowtoToggle(this.open)"><summary>📖 つなぎ方（ソキア iM-100）</summary>` +
        '<div class="ts-howto-body">' +
        '<b>Bluetooth</b>（Android の Chrome・PC の Chrome／Edge）<ol>' +
        '<li>機械: 〔設定〕→「通信条件」→「通信設定」で、通信モードを「Bluetooth」にする。通信タイプは、SIMA で受け渡すときは「T タイプ」（CR/LF「アリ」・ACK モード「不要」）、SDR や測るたびの出力のときは「S タイプ」（チェックサム・Xon/Xoff「ナシ」）。</li>' +
        '<li>端末の Bluetooth の設定で、機械とペアリングしておく（最初の1回）。機械の Bluetooth アドレス（12桁）は、通信設定の「Bluetooth」に出ます。</li>' +
        '<li>機械: 観測画面の4ページ目の Bluetooth のキーで待ち受けにする（マークが点滅し、短い音）。</li>' +
        '<li>ここで「🔌 機械とつなぐ」→ 機械を選ぶ（長い音でつながります）。ボーレートなどの設定は使いません。</li></ol>' +
        '<b>ケーブル（RS-232C）</b>（PC）<ol>' +
        '<li>機械の電源を切り、ケーブル DOC210（D-sub 9ピン）でつなぐ。PC にシリアルの端子が無ければ USB 変換アダプタを使う。外部電源と一緒に使うときは Y ケーブル（EDC211・EDC212）。</li>' +
        '<li>機械: 通信モードを「RS232C」にし、上のボーレートなどを機械と同じにする（機械の初期値は 9600 bps・8 ビット・なし・1 ビット）。</li>' +
        '<li>「🔌 機械とつなぐ」→ COM ポートを選ぶ。</li></ol>' +
        '<b>SIMA の受け渡し</b>（つないだあと。通信タイプは「T タイプ」）<ol>' +
        '<li>機械へ送る: 機械で「既知点 → 外部入力 → APA-SIMA（座標）」を選んで待ち受け → ここで「📤 SIMA で送る」。送り終わっても機械が待ち続けるときは〔ESC〕で終えます。</li>' +
        '<li>機械から受ける: 機械で「現場管理 → 現場データ送信 → T タイプ → 現場を選ぶ → APA-SIMA（座標）」→ 届いたら「✅ 図面に取り込む」。</li></ol>' +
        _cogoNote('Bluetooth が届くのは約10m。金属・コンクリートは電波を通さず、雨・霧・人の体でも短くなるので、見通しのよい高い所で使います。通信中に機械の通信設定を変えると切れます。Android では切れたことが分からない場合があるので、そのときは「切断」→「機械とつなぐ」でつなぎ直します。') +
        '</div></details>';
}
window.tsHowtoToggle = function(open) { _ts.howtoOpen = !!open; };
function _tsRxText() { return _ts.sendNote || (_ts.rxLines ? `受信 ${_ts.rxLines}行` : '受信待ち'); }
window.tsSetAck = function(on) { const o = _tsOpts(); o.ack = !!on; _tsSaveOpts(o); };
window.tsSetOpt = function() {
    const v = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
    const o = _tsOpts();
    if(v('ts-baud')) o.baudRate = parseInt(v('ts-baud'), 10);
    if(v('ts-bits')) o.dataBits = parseInt(v('ts-bits'), 10);
    if(v('ts-parity')) o.parity = v('ts-parity');
    if(v('ts-stop')) o.stopBits = parseInt(v('ts-stop'), 10);
    _tsSaveOpts(o);
};
window.tsOpenSdrFile = function() { const f = document.getElementById('dxf-file-input'); if(f) f.click(); };

// 取り込み待ちの点（受信中は途中までの結果）
function _tsCurrent() {
    if(_ts.pending) return _ts.pending;
    if(_ts.parser && _ts.parser.result.points.size) return Object.assign({}, _ts.parser.result, { points: [..._ts.parser.result.points.values()], partial: true });
    return null;
}
function _tsUpdateResult() {
    const rx = document.getElementById('ts-rx'); if(rx) rx.textContent = _tsRxText();
    _tsUpdateRaw();
    const box = document.getElementById('ts-result');
    if(!box) return;
    const r = _tsCurrent();
    if(!r) { box.innerHTML = ''; return; }
    const rows = r.points.slice(0, 200).map((p) => `<tr><td class="c">${escapeHtml(p.id)}</td><td class="r">${cogoFix(p.X, 3)}</td><td class="r">${cogoFix(p.Y, 3)}</td><td class="r">${p.Z === null ? '' : cogoFix(p.Z, 3)}</td></tr>`).join('');
    const sima = r.format === 'SIMA';
    let h = `<div class="ts-sec">${r.partial ? '受信中' : '受信した点'}（${sima ? 'SIMA' : r.format === 20 ? 'SDR2x' : 'SDR33'}${r.job ? '・' + escapeHtml(r.job) : ''}）</div>` +
        _cogoKv(sima ? [['点', r.points.length + '点', 'cogo-big'], ['区画', r.lots.length + '件']]
            : [['点', r.points.length + '点', 'cogo-big'], ['観測から計算', r.obsCount + '件'], ['器械点', r.stations.length + '点']]) +
        `<div class="cogo-table-wrap"><table class="cogo-table"><thead><tr><th>点名</th><th>X</th><th>Y</th><th>標高</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    if(r.points.length > 200) h += _cogoNote(`ほか ${r.points.length - 200}点`);
    if(r.checksum && !r.checksum.ok) h += '<div class="cogo-warn">⚠ チェックサムが合いません。受信の途中で文字が欠けた可能性があります（通信設定を確かめて、もう一度送ってください）</div>';
    r.warnings.forEach((w) => { h += `<div class="cogo-warn">⚠ ${escapeHtml(w)}</div>`; });
    h += '<div class="cogo-btns">' + (r.points.length ? '<button class="prop-btn" onclick="tsImport()">✅ 図面に取り込む</button>' : '') + '<button class="prop-btn btn-sub" onclick="tsDiscard()">破棄</button></div>';
    box.innerHTML = h;
}
// 受信中の画面の書き換えは間引く（1行ごとに描き直さない）
function _tsScheduleUi() {
    if(_ts.uiTimer) return;
    _ts.uiTimer = setTimeout(() => { _ts.uiTimer = null; _tsUpdateResult(); renderOverlay(); }, 150);
}
window.tsImport = function() {
    const r = _tsCurrent();
    if(!r || !r.points.length) return;
    saveUndo();
    const res = r.format === 'SIMA' ? addSurveyData(r.simaPoints, r.lots) : null; // SIMA は点番号・区画もそのまま
    const n = res ? res.pointCount : sdrAddToDrawing(r);
    render();
    addCommandLog(`-> TS から受信した測点 ${n}点を取り込みました` + (res && res.lotCount ? `（区画 ${res.lotCount}）` : '') + (r.obsCount ? `（観測から計算 ${r.obsCount}件）` : ''));
    showToast(`測点 ${n}点を取り込みました` + (res && res.lotCount ? `・区画 ${res.lotCount}` : ''), 3000);
    if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    _ts.pending = null; _ts.parser = null; _ts.sima = '';
    _tsUpdateResult();
};
window.tsDiscard = function() { _ts.pending = null; _ts.parser = null; _ts.sima = ''; _tsUpdateResult(); renderOverlay(); };

// ===== 通信 =====
window.tsConnect = async function() {
    if(!tsSerialAvailable()) return;
    const o = _tsOpts();
    let port;
    try { port = await navigator.serial.requestPort(); }
    catch(e) { if(e && e.name !== 'NotFoundError') showToast('機械を選べませんでした: ' + e.message, 4000); return; } // NotFoundError は選ぶのをやめたとき
    try { await port.open({ baudRate: o.baudRate, dataBits: o.dataBits, parity: o.parity, stopBits: o.stopBits, flowControl: 'none', bufferSize: 4096 }); }
    catch(e) { showToast('ポートを開けませんでした（ほかのアプリが使っていないか確かめてください）: ' + e.message, 5000); return; }
    _ts.port = port; _ts.xoff = false; _ts.buf = ''; _ts.rxBytes = 0; _ts.rxLines = 0;
    if(port.addEventListener) port.addEventListener('disconnect', _tsOnLost);
    addCommandLog('-> TS とつながりました');
    showToast('機械とつながりました', 2000);
    _tsRender();
    _tsReadLoop(port);
};
function _tsOnLost() {
    if(!_ts.port) return;
    _ts.port = null; _ts.reading = false;
    addCommandLog('-> TS との接続が切れました');
    showToast('機械との接続が切れました', 3000);
    if(_tsPanelOpen()) _tsRender();
}
window.tsDisconnect = async function() {
    const port = _ts.port;
    _ts.reading = false;
    try { if(_ts.reader) await _ts.reader.cancel(); } catch { /* 読み取りが終わっていてもよい */ }
    try { if(port) await port.close(); } catch { /* 閉じられなくてもよい */ }
    _ts.port = null;
    addCommandLog('-> TS との接続を切りました');
    if(_tsPanelOpen()) _tsRender();
};
async function _tsReadLoop(port) {
    _ts.reading = true;
    while(_ts.port === port && _ts.reading && port.readable) {
        const reader = port.readable.getReader();
        _ts.reader = reader;
        try {
            for(;;) {
                const { value, done } = await reader.read();
                if(done) break;
                if(value) tsReceiveBytes(value);
            }
        } catch(e) {
            addCommandLog('-> TS 受信エラー: ' + (e && e.message)); // 電源が切れた・ケーブルが抜けた など
        } finally {
            try { reader.releaseLock(); } catch { /* すでに解放済み */ }
            _ts.reader = null;
        }
    }
}
// ===== 受信した生データ（形式の確認用） =====
// 届いたバイトを、制御文字も見える形（<CR> <LF> <STX> <ETX> <ACK>、ほかは <1F> のような16進）で残す。
// 行の区切り: LF のあと、または TS_RAW_IDLE_MS のあいだ何も届かなかったとき
function _tsRawFeed(bytes) {
    for(let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        _ts.rawCur += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '<' + (TS_CTRL_NAMES[b] || b.toString(16).toUpperCase().padStart(2, '0')) + '>';
        if(b === 0x0a || _ts.rawCur.length > 2000) _tsRawFlush();
    }
    clearTimeout(_ts.rawTimer);
    _ts.rawTimer = _ts.rawCur ? setTimeout(_tsRawFlush, TS_RAW_IDLE_MS) : null;
}
function _tsRawFlush() {
    clearTimeout(_ts.rawTimer); _ts.rawTimer = null;
    if(!_ts.rawCur) return;
    _ts.raw.push({ t: new Date(), s: _ts.rawCur });
    _ts.rawCur = '';
    if(_ts.raw.length > TS_RAW_MAX) _ts.raw.splice(0, _ts.raw.length - TS_RAW_MAX);
    _tsScheduleUi();
}
// こちらから送ったデータも、生データの欄に「送信▶」をつけて残す（機械の応答と並べて確かめるため）
function _tsRawNote(s) {
    _tsRawFlush();
    _ts.raw.push({ t: new Date(), s, tx: true });
    if(_ts.raw.length > TS_RAW_MAX) _ts.raw.splice(0, _ts.raw.length - TS_RAW_MAX);
    _tsScheduleUi();
}
// 受信した生データの文字列（時刻つき。1行ずつ）
function tsRawText() {
    const p2 = (n) => String(n).padStart(2, '0');
    return _ts.raw.map((r) => `${p2(r.t.getHours())}:${p2(r.t.getMinutes())}:${p2(r.t.getSeconds())}.${String(r.t.getMilliseconds()).padStart(3, '0')}  ${r.tx ? '送信▶ ' : ''}${r.s}`).join('\n');
}
function _tsUpdateRaw() {
    const pre = document.getElementById('ts-raw');
    const n = document.getElementById('ts-raw-n');
    if(n) n.textContent = _ts.raw.length ? `（${_ts.raw.length}行）` : '';
    if(!pre) return;
    const lines = tsRawText().split('\n');
    pre.textContent = _ts.raw.length ? lines.slice(-80).join('\n') : '（まだ何も届いていません）';
    pre.scrollTop = pre.scrollHeight;
}
window.tsRawToggle = function(open) { _ts.rawOpen = !!open; };
window.tsCopyRaw = async function() {
    const text = tsRawText();
    if(!text) { showToast('まだ何も届いていません', 2500); return false; }
    try {
        await navigator.clipboard.writeText(text);
        showToast(`受信した生データ ${_ts.raw.length}行をコピーしました`, 2500);
        return true;
    } catch {
        // コピーできない環境: 表示を選んだ状態にする（長押し・Ctrl+C でコピー）
        const pre = document.getElementById('ts-raw');
        if(pre && window.getSelection) { pre.textContent = text; const r = document.createRange(); r.selectNodeContents(pre); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
        showToast('自動でコピーできませんでした。選んだ文字をコピーしてください', 3500);
        return false;
    }
};
window.tsClearRaw = function() { _ts.raw = []; _ts.rawCur = ''; clearTimeout(_ts.rawTimer); _ts.rawTimer = null; _tsUpdateRaw(); };

// ===== SIMA の受信（T タイプの APA-SIMA・S タイプの TSS） =====
// 届いたバイトをためておき、届くのが止まったら Shift-JIS の SIMA として読む（区切りの文字に頼らない）
function _tsSimaFeed(bytes) {
    const ack = !!_tsOpts().ack;
    for(let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if(b === 0x11 || b === 0x13 || b === 0x06 || b === 0x15) continue; // 流れの制御・受け取りの合図
        _ts.simaBuf.push(b);
        // ACK のやり取り: 記録の終わり（ETX。ETX が来ない送り方なら LF）ごとに ACK を返す
        if(ack && (b === 0x03 || (b === 0x0a && !_ts.simaSawEtx))) _tsSendAck();
        if(b === 0x03) _ts.simaSawEtx = true;
    }
    if(_ts.simaBuf.length > 8 * 1024 * 1024) _ts.simaBuf = []; // 異常に大きいときは捨てる
    clearTimeout(_ts.simaTimer);
    _ts.simaTimer = _ts.simaBuf.length ? setTimeout(_tsSimaFlush, TS_TIMING.simaIdle) : null;
}
// 受信したバイトを SIMA の文字列にする（ETX は記録の区切りとして改行に。ほかの制御文字は除いて Shift-JIS で読む）
function tsDecodeSima(bytes) {
    const b = [];
    for(const x of bytes) {
        if(x === 0x03) b.push(0x0a);
        else if(x === 0x0a || x === 0x0d || x === 0x09 || x >= 0x20) b.push(x);
    }
    try { return new TextDecoder('shift-jis').decode(Uint8Array.from(b)); }
    catch { return String.fromCharCode(...b); }
}
// ためたデータを読む。SIMA なら取り込み待ちにする（SIMA でなければ何もしない。SDR は行ごとに読んでいる）
function _tsSimaFlush() {
    clearTimeout(_ts.simaTimer); _ts.simaTimer = null;
    const bytes = _ts.simaBuf;
    _ts.simaBuf = []; _ts.simaSawEtx = false;
    if(!bytes.length) return false;
    const text = tsDecodeSima(bytes);
    if(!_ts.sima && !TS_SIMA_RE.test(text)) return false;
    _ts.sima += text; // 途中で間が空いて分かれて届いても、続きとしてつなぐ（取り込み・破棄で空にする）
    _ts.parser = null;
    _ts.pending = _tsSimaResult(_ts.sima);
    const n = _ts.pending.points.length;
    addCommandLog(`-> TS から SIMA を受信: 点 ${n}点` + (_ts.pending.lots.length ? `・区画 ${_ts.pending.lots.length}` : ''));
    showToast(n ? `SIMA を受信しました: 点 ${n}点\n「図面に取り込む」で測点になります` : 'SIMA を受信しましたが、座標データ（A01）がありません', 4000);
    if(!_tsPanelOpen()) _tsRender(); // 閉じていたら開いて見せる
    _tsScheduleUi();
    return true;
}
function _tsSimaResult(text) {
    const d = parseSima(text);
    const warnings = [];
    if(!d.points.length) warnings.push('座標データ（A01）がありません。機械で「APA-SIMA（座標）」を選んで送ってください（観測データは読めません）');
    if(d.skipped) warnings.push(`座標が読めない行 ${d.skipped}件は省きました`);
    return { format: 'SIMA', job: d.title || '', points: d.points.map((p) => ({ id: p.name || p.num, X: p.X, Y: p.Y, Z: p.z, desc: '' })),
        simaPoints: d.points, lots: d.lots, obsCount: 0, stations: [], warnings, checksum: null };
}
// 受け取りの合図（ACK）を返す（送信中で書き込めないときは返さない）
function _tsSendAck() {
    if(!_ts.port || !_ts.port.writable) return;
    _tsWriteBytes(Uint8Array.of(0x06)).then(() => _tsRawNote('<ACK>')).catch(() => { /* 送信中など */ });
}

// 届いたバイト列を行に分けて読む（XON/XOFF は送信の一時停止・再開、ACK/NAK は送った行を受け取れたかの合図）
function tsReceiveBytes(bytes) {
    _ts.rxBytes += bytes.length;
    _tsRawFeed(bytes);
    _tsSimaFeed(bytes);
    for(let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if(b === 0x13) { _ts.xoff = true; continue; }
        if(b === 0x11) { _ts.xoff = false; continue; }
        if(b === 0x06 || b === 0x15) { if(_ts.ackWait) _ts.ackWait(b === 0x06 ? 'ACK' : 'NAK'); continue; }
        if(b === 0x0d) continue;
        if(b === 0x0a) { const line = _ts.buf; _ts.buf = ''; _tsOnLine(line); continue; }
        _ts.buf += String.fromCharCode(b);
        if(_ts.buf.length > 4096) _ts.buf = ''; // 改行の来ないデータは捨てる
    }
}
function _tsOnLine(line) {
    if(!line) return;
    if(line.charCodeAt(0) === 2 || !_ts.parser) { _ts.parser = sdrParser(); _ts.pending = null; } // 新しい送信の始まり
    _ts.parser.feed(line);
    _ts.rxLines++;
    if(line.charCodeAt(0) === 3) {
        // 送信の終わり（ETX）: 取り込み待ちにする（SDR の記録が無ければ SIMA などなので、ここでは何もしない）
        const R = _ts.parser.result;
        if(!R.format && !R.points.size) { _ts.parser = null; _tsScheduleUi(); return; }
        _ts.sima = '';
        _ts.pending = Object.assign({}, R, { points: [...R.points.values()] });
        _ts.parser = null;
        const bad = _ts.pending.checksum && !_ts.pending.checksum.ok;
        addCommandLog(`-> TS から受信: 点 ${_ts.pending.points.length}点` + (bad ? '（チェックサム不一致）' : ''));
        showToast(`受信しました: 点 ${_ts.pending.points.length}点` + (bad ? '\n⚠ チェックサムが合いません' : '\n「図面に取り込む」で測点になります'), 4000);
        if(!_tsPanelOpen()) _tsRender(); // 閉じていたら開いて見せる
    }
    _tsScheduleUi();
}
// ASCII の文字列を送る（SDR）
async function _tsWrite(text) {
    const bytes = new Uint8Array(text.length);
    for(let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0x7f;
    await _tsWriteBytes(bytes);
}
// バイト列を送る（前の書き込みが終わってから。受信の ACK と送信の行が重なっても、どちらも抜けないように）
function _tsWriteBytes(bytes) {
    const run = () => _tsWriteNow(bytes);
    const p = _ts.writeChain.then(run, run);
    _ts.writeChain = p.catch(() => { /* 失敗は呼んだ側で扱う */ });
    return p;
}
// 32バイトずつ書く。機械が XOFF を返したら XON まで待つ
async function _tsWriteNow(bytes) {
    if(!_ts.port || !_ts.port.writable) throw new Error('機械とつながっていません');
    const writer = _ts.port.writable.getWriter();
    try {
        for(let i = 0; i < bytes.length; i += 32) {
            const t0 = Date.now();
            while(_ts.xoff) {
                if(Date.now() - t0 > 20000) throw new Error('機械から再開の合図（XON）が来ません');
                await new Promise((r) => setTimeout(r, 30));
            }
            await writer.write(bytes.subarray(i, i + 32));
        }
    } finally { writer.releaseLock(); }
}
// 測点を機械へ送る（範囲選択した測点があればそれだけ、無ければすべて）
window.tsSendPoints = async function() {
    if(!_ts.port || !_ts.port.writable || _ts.sending) return;
    const sel = new Set(cmdState.selectedIndices || []);
    if(cmdState.highlightIdx >= 0) sel.add(cmdState.highlightIdx);
    let pts = sel.size ? sdrPointsFromDrawing(sel) : [];
    const selected = pts.length > 0;
    if(!selected) pts = sdrPointsFromDrawing();
    if(!pts.length) { showToast('送れる測点がありません（点・属性付きブロック）', 3000); return; }
    if(!confirm(`${selected ? '選んだ' : 'すべての'}測点 ${pts.length}点を SDR33 で機械へ送ります。\n機械を「既知点 → 外部入力 → S タイプ → SD」で待ち受けにしてから OK を押してください。`)) return;
    const r = buildSdr33Records(pts, { job: _baseName().replace(/[^\x20-\x7e]/g, '').slice(0, 16) || 'WEBCAD' });
    _ts.sending = true;
    try {
        await _tsWrite(sdrCommsText(r.lines));
        const note = r.renamed.length ? `（点名を使えない ${r.renamed.length}点は P0001 などにしました）` : '';
        addCommandLog(`-> TS へ測点 ${pts.length}点を送りました${note}`);
        showToast(`測点 ${pts.length}点を送りました${note ? '\n' + note : ''}`, 3500);
    } catch(e) {
        addCommandLog('-> TS への送信に失敗: ' + e.message);
        showToast('送れませんでした: ' + e.message, 5000);
    } finally { _ts.sending = false; }
};

// ===== SIMA を機械へ送る（T タイプの「既知点 → 外部入力 → APA-SIMA（座標）」） =====
// 範囲選択した測点があればそれだけ、無ければすべて。戻り値: 送れたら true
window.tsSendSima = async function() {
    if(!_ts.port || !_ts.port.writable || _ts.sending) return false;
    const sel = new Set(cmdState.selectedIndices || []);
    if(cmdState.highlightIdx >= 0) sel.add(cmdState.highlightIdx);
    let r = sel.size ? buildSimaPointLines(_baseName(), sel) : { lines: [], pointCount: 0 };
    const selected = r.pointCount > 0;
    if(!selected) r = buildSimaPointLines(_baseName());
    if(!r.pointCount) { showToast('送れる測点がありません（点・属性付きブロック）', 3000); return false; }
    if(!confirm(`${selected ? '選んだ' : 'すべての'}測点 ${r.pointCount}点を SIMA（APA-SIMA の座標）で機械へ送ります。\n機械を「既知点 → 外部入力 → APA-SIMA（座標）」で待ち受けにしてから OK を押してください。`)) return false;
    _ts.sending = true;
    try {
        await _tsSendLines(r.lines);
        addCommandLog(`-> TS へ SIMA で測点 ${r.pointCount}点を送りました`);
        showToast(`SIMA で測点 ${r.pointCount}点を送りました`, 3500);
        return true;
    } catch(e) {
        addCommandLog('-> TS への送信に失敗: ' + e.message);
        showToast('送れませんでした: ' + e.message, 6000);
        return false;
    } finally { _ts.sending = false; _ts.sendNote = ''; _tsScheduleUi(); }
};
// 行を1行ずつ送る（Shift-JIS・CR LF）。ACK のやり取りをするときは、1行ごとに機械の ACK を待ち、NAK なら送り直す（3回まで）
async function _tsSendLines(lines) {
    const waitAck = !!_tsOpts().ack;
    for(let i = 0; i < lines.length; i++) {
        const bytes = encodeShiftJis(lines[i] + '\r\n');
        for(let tries = 0; ; tries++) {
            const ackP = waitAck ? _tsWaitAck(TS_TIMING.ackTimeout) : null;
            await _tsWriteBytes(bytes);
            _tsRawNote(lines[i] + '<CR><LF>');
            if(!ackP) { await new Promise((res) => setTimeout(res, TS_TIMING.lineGap)); break; }
            if(await ackP === 'ACK') break;
            if(tries >= 2) throw new Error('機械が受け取れませんでした（NAK が続きました）');
        }
        _ts.sendNote = `送信 ${i + 1}/${lines.length}行`;
        _tsScheduleUi();
    }
}
// 機械の ACK・NAK を待つ（来なければ知らせる）
function _tsWaitAck(ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { _ts.ackWait = null; reject(new Error('機械から受け取りの合図（ACK）が来ません。機械の ACK モードを「不要」にするか、「ACK のやり取りをする」を外してください')); }, ms);
        _ts.ackWait = (r) => { clearTimeout(timer); _ts.ackWait = null; resolve(r); };
    });
}

// ===== 重ね表示（受信した、取り込み前の点） =====
function _tsPanelOpen() {
    const p = document.getElementById('property-panel'), t = document.getElementById('property-panel-title');
    return !!(p && p.style.display === 'flex' && t && t.textContent === TS_TITLE);
}
function drawTsOverlay() {
    const r = _tsPanelOpen() ? _tsCurrent() : null;
    if(!r) return;
    ctx.save();
    ctx.strokeStyle = '#00ffff'; ctx.fillStyle = '#00ffff'; ctx.lineWidth = 1.5;
    ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    const many = r.points.length > 300;
    r.points.forEach((p) => {
        const w = surveyToWcs(p.X, p.Y), s = wcsToScreen(w.x, w.y);
        if(s.x < -20 || s.y < -20 || s.x > canvas.width + 20 || s.y > canvas.height + 20) return;
        ctx.beginPath(); ctx.moveTo(s.x - 5, s.y - 5); ctx.lineTo(s.x + 5, s.y + 5); ctx.moveTo(s.x + 5, s.y - 5); ctx.lineTo(s.x - 5, s.y + 5); ctx.stroke();
        if(!many) ctx.fillText(p.id, s.x + 6, s.y - 4);
    });
    ctx.restore();
}

// ===== コマンド =====
function processTsCommand(cmd) {
    if(cmd === 'TS' || cmd === 'TSLINK' || cmd === 'SOKKIA') { window.showTsPanel(); return true; }
    if(cmd === 'SDROUT' || cmd === 'EXPORTSDR') { window.exportSdr33(); return true; }
    return false;
}

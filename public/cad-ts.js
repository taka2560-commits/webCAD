// ===== Web CAD トータルステーション連携: 画面・通信 =====
// cad-ts.js - 「📡 TS連携」パネル。SDR ファイルの受け渡しと、Web Serial（USB ケーブル・Bluetooth）での受信・送信。
//   受信: 機械で「データ → 現場 → 通信出力 → S type（SDR33）」をすると、届いた記録をその場で読み、点を図面に重ねて見せる。
//         「図面に取り込む」で測点にする（元に戻すは1回）。
//   送信: 機械を「既知点 → 通信入力 → S type」にしてから「測点を送る」。SDR33 の既知点（08KI）を STX〜ETX で送る。
//         機械が XOFF（受信の一時停止）を返したら、XON が来るまで待つ。
//   Web Serial が使えるのは PC の Chrome・Edge と Android の Chrome。iPhone・iPad では SDR ファイルで受け渡しする。
// SDR の読み書きは cad-sdr.js。

const TS_TITLE = '📡 TS連携';
const TS_BAUDS = [1200, 2400, 4800, 9600, 19200, 38400];
const TS_OPTS_KEY = 'cad_ts_opts';
const _ts = {
    port: null, reader: null, reading: false, xoff: false, sending: false,
    parser: null, pending: null, // 受信中の SDR（sdrParser）と、取り込み待ちの結果（parseSdr と同じ形）
    buf: '', rxBytes: 0, rxLines: 0, uiTimer: null,
};
function _tsOpts() {
    const def = { baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 };
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
    let h = '<div class="ts-sec">SDR ファイル（USB メモリ・SD カード）</div>' +
        '<div class="cogo-btns"><button class="prop-btn btn-sub" onclick="tsOpenSdrFile()">📁 SDR を開く</button><button class="prop-btn btn-sub" onclick="exportSdr33()">📄 SDR33 で書き出す</button></div>' +
        _cogoNote('機械の現場データ（SDR33・SDR2x）を開くと、器械点・後視・観測から座標を計算して測点にします。書き出したファイルは、機械で既知点・杭打ち点として読み込めます。') +
        '<div class="ts-sec">通信（USB ケーブル・Bluetooth）</div>';
    if(!tsSerialAvailable()) {
        h += _cogoNote('このブラウザでは機械と直接つなげません。PC の Chrome・Edge、Android の Chrome で使えます（iPhone・iPad は SDR ファイルで受け渡しします）。');
    } else if(!_ts.port) {
        h += _tsSel('ts-baud', 'ボーレート', TS_BAUDS.map((b) => [b, b + ' bps']), o.baudRate) +
            _tsSel('ts-bits', 'データ長', [[8, '8 ビット'], [7, '7 ビット']], o.dataBits) +
            _tsSel('ts-parity', 'パリティ', [['none', 'なし'], ['even', '偶数'], ['odd', '奇数']], o.parity) +
            _tsSel('ts-stop', 'ストップビット', [[1, '1 ビット'], [2, '2 ビット']], o.stopBits) +
            '<button class="prop-btn" onclick="tsConnect()">🔌 機械とつなぐ</button>' +
            _cogoNote('Bluetooth は、先に端末の設定で機械とペアリングしておきます（ボーレートなどの設定は使いません）。ケーブルのときは、機械の通信設定と同じにします。');
    } else {
        h += `<div class="ts-status"><span class="ts-dot"></span>つながっています&nbsp;&nbsp;<span id="ts-rx">${_tsRxText()}</span></div>` +
            '<div class="cogo-btns"><button class="prop-btn btn-sub" onclick="tsSendPoints()">📤 測点を送る</button><button class="prop-btn btn-sub" onclick="tsDisconnect()">切断</button></div>' +
            _cogoNote('受信: 機械で「データ → 現場 → 通信出力 → S type（SDR33）」。届いた点はその場で図面に重ねて表示します。<br>送信: 機械を「既知点 → 通信入力 → S type」にしてから 📤（範囲選択した測点、無ければすべて）。');
    }
    h += '<div id="ts-result" class="cogo-result"></div>';
    showPropertyPanel(TS_TITLE, h);
    _tsUpdateResult();
}
function _tsRxText() { return _ts.rxLines ? `受信 ${_ts.rxLines}行` : '受信待ち'; }
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
    const box = document.getElementById('ts-result');
    if(!box) return;
    const r = _tsCurrent();
    if(!r) { box.innerHTML = ''; return; }
    const rows = r.points.slice(0, 200).map((p) => `<tr><td class="c">${escapeHtml(p.id)}</td><td class="r">${cogoFix(p.X, 3)}</td><td class="r">${cogoFix(p.Y, 3)}</td><td class="r">${p.Z === null ? '' : cogoFix(p.Z, 3)}</td></tr>`).join('');
    let h = `<div class="ts-sec">${r.partial ? '受信中' : '受信した点'}（${r.format === 20 ? 'SDR2x' : 'SDR33'}${r.job ? '・' + escapeHtml(r.job) : ''}）</div>` +
        _cogoKv([['点', r.points.length + '点', 'cogo-big'], ['観測から計算', r.obsCount + '件'], ['器械点', r.stations.length + '点']]) +
        `<div class="cogo-table-wrap"><table class="cogo-table"><thead><tr><th>点名</th><th>X</th><th>Y</th><th>標高</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    if(r.points.length > 200) h += _cogoNote(`ほか ${r.points.length - 200}点`);
    if(r.checksum && !r.checksum.ok) h += '<div class="cogo-warn">⚠ チェックサムが合いません。受信の途中で文字が欠けた可能性があります（通信設定を確かめて、もう一度送ってください）</div>';
    r.warnings.forEach((w) => { h += `<div class="cogo-warn">⚠ ${escapeHtml(w)}</div>`; });
    h += '<div class="cogo-btns"><button class="prop-btn" onclick="tsImport()">✅ 図面に取り込む</button><button class="prop-btn btn-sub" onclick="tsDiscard()">破棄</button></div>';
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
    const n = sdrAddToDrawing(r);
    render();
    addCommandLog(`-> TS から受信した測点 ${n}点を取り込みました` + (r.obsCount ? `（観測から計算 ${r.obsCount}件）` : ''));
    showToast(`測点 ${n}点を取り込みました`, 3000);
    if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    _ts.pending = null; _ts.parser = null;
    _tsUpdateResult();
};
window.tsDiscard = function() { _ts.pending = null; _ts.parser = null; _tsUpdateResult(); renderOverlay(); };

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
// 届いたバイト列を行に分けて読む（XON/XOFF は送信の一時停止・再開の合図）
function tsReceiveBytes(bytes) {
    _ts.rxBytes += bytes.length;
    for(let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if(b === 0x13) { _ts.xoff = true; continue; }
        if(b === 0x11) { _ts.xoff = false; continue; }
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
        // 送信の終わり（ETX）: 取り込み待ちにする
        const R = _ts.parser.result;
        _ts.pending = Object.assign({}, R, { points: [...R.points.values()] });
        _ts.parser = null;
        const bad = _ts.pending.checksum && !_ts.pending.checksum.ok;
        addCommandLog(`-> TS から受信: 点 ${_ts.pending.points.length}点` + (bad ? '（チェックサム不一致）' : ''));
        showToast(`受信しました: 点 ${_ts.pending.points.length}点` + (bad ? '\n⚠ チェックサムが合いません' : '\n「図面に取り込む」で測点になります'), 4000);
        if(!_tsPanelOpen()) _tsRender(); // 閉じていたら開いて見せる
    }
    _tsScheduleUi();
}
async function _tsWrite(text) {
    const bytes = new Uint8Array(text.length);
    for(let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0x7f;
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
    if(!confirm(`${selected ? '選んだ' : 'すべての'}測点 ${pts.length}点を機械へ送ります。\n機械を「既知点 → 通信入力 → S type」にしてから OK を押してください。`)) return;
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

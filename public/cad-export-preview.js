// ===== Web CAD 書き出す前の確認（SIMA・座標CSV・SDR33・変換後の SIMA） =====
// cad-export-preview.js - 書き出すファイルの中身を、表とファイルの文字で見せ、確かめてから書き出す
//   ・表: 点番号・点名・X（北）・Y（東）・標高（区画があれば区画名と点の数）。行が多いときは検索で絞る（先頭の 300 行）
//   ・ファイルの中身: 書き出す文字そのまま（先頭の 400 行）
//   ・気づいたこと: 点番号を振り直した・点名の無い点に名前を付けた・Shift-JIS で表せない文字（? になる）・区画の頂点に点を足した など
//   ・「📤 書き出す」で今までと同じファイルを書き出す（名前は欄で変えられる。スマホでは書き出したあとに「📤 送る」も出る）。「やめる」なら何も書き出さない
//   ・書き出したあと・やめたあとは、開く前のパネル（座標一覧・TS連携・測量計算の変換など）に戻る

const EXPORT_PREVIEW_TITLE = '📄 書き出す前の確認';
const EXPORT_PREVIEW_ROWS = 300;
const EXPORT_PREVIEW_LINES = 400;
let _xp = null; // { kind, fileName, encoding, rows, lots, text, notes, write, tab, q, back }

// o: { kind: 'SIMA' など, fileName, encoding, rows: [{ num, name, X, Y, z }], lots: [{ name, n }], text, notes: [{ text, warn }], write: () => void }
function showExportPreview(o) {
    // 開く前のパネル（パネルの ？ の対応表に、開き直す関数がある）
    const p = document.getElementById('property-panel'), t = document.getElementById('property-panel-title');
    const prev = p && p.style.display === 'flex' && t ? t.textContent : '';
    const h = prev && prev !== EXPORT_PREVIEW_TITLE && typeof GUIDE_PANEL_HELP !== 'undefined' ? GUIDE_PANEL_HELP[prev] : null;
    _xp = Object.assign({ tab: 'table', q: '', rows: [], lots: [], notes: [], back: h && typeof h.back === 'function' ? h.back : null }, o);
    _xpRender();
}
function _xpBack(o) { if(o && o.back) { try { o.back(); } catch { /* 戻れなくても書き出しは済んでいる */ } } }
function _xpFmt(v) { return (typeof v === 'number' && isFinite(v)) ? formatSurveyNumber(v) : ''; }
// 見えない制御文字（タブ以外）は ^B のように見せる
function _xpVisible(line) {
    return Array.from(String(line), (c) => { const k = c.charCodeAt(0); return (k < 32 && k !== 9) ? '^' + String.fromCharCode(k + 64) : c; }).join('');
}
function _xpRender() {
    const o = _xp;
    if(!o) return;
    const seg = (on, tab, label) => `<button type="button" class="prop-btn opt-bg-btn${on ? ' active' : ''}" aria-pressed="${on}" onclick="exportPreviewTab('${tab}')">${label}</button>`;
    let h = `<div class="cogo-note"><b>${escapeHtml(o.kind)}</b>（${escapeHtml(o.encoding)}）を書き出します。中身を確かめてから「📤 書き出す」を押してください。</div>`;
    // 書き出すファイルの名前（変えられる。拡張子は自動で付く。cad-outname.js）
    const [nb, ext] = _outNameSplit(o.fileName);
    if(o.nameBase === undefined) o.nameBase = nb;
    h += `<div class="xp-file" style="display:flex;align-items:center;gap:4px;font-size:12px;margin:4px 0;">📄 <input id="xp-name" class="prop-val" type="text" autocomplete="off" value="${escapeHtml(o.nameBase)}" oninput="exportPreviewName(this.value)" aria-label="書き出すファイルの名前" title="書き出すファイルの名前（拡張子は自動で付きます）" style="flex:1;min-width:0;"><b>${escapeHtml(ext)}</b></div>`;
    h += `<div class="xp-count" style="font-size:12px;margin:0 0 4px;">測点 ${o.rows.length}点${o.lots.length ? `・区画 ${o.lots.length}` : ''}</div>`;
    if(o.notes.length) {
        h += '<div class="xp-notes" style="margin:4px 0;">' + o.notes.map((n) =>
            `<div class="cogo-note" style="${n.warn ? 'color:#ffcc00;' : ''}">${n.warn ? '⚠' : 'ℹ'} ${escapeHtml(n.text)}</div>`).join('') + '</div>';
    }
    h += `<div class="opt-pref-seg" style="margin:6px 0;">${seg(o.tab === 'table', 'table', '表')}${seg(o.tab === 'text', 'text', 'ファイルの中身')}</div>`;
    if(o.tab === 'table') {
        h += `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;"><input id="xp-search" class="prop-val" type="search" placeholder="点名・点番号で検索" value="${escapeHtml(o.q)}" oninput="exportPreviewSearch(this.value)" style="flex:1;"></div>`;
        h += '<div id="xp-rows" style="max-height:40vh;overflow:auto;border:1px solid var(--border-2);border-radius:var(--r-sub);"></div>';
    } else {
        const lines = String(o.text).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
        const shown = lines.slice(0, EXPORT_PREVIEW_LINES).map(_xpVisible).join('\n');
        h += `<pre id="xp-text" style="max-height:40vh;overflow:auto;margin:0;padding:6px;border:1px solid var(--border-2);border-radius:var(--r-sub);font:11px/1.45 Consolas,monospace;color:#e0e0e0;white-space:pre;">${escapeHtml(shown)}</pre>`;
        if(lines.length > EXPORT_PREVIEW_LINES) h += `<div class="cogo-note">…ほか ${lines.length - EXPORT_PREVIEW_LINES}行（全部で ${lines.length}行）</div>`;
    }
    h += '<div class="cogo-btns" style="margin-top:8px;"><button class="prop-btn" onclick="exportPreviewWrite()">📤 書き出す</button><button class="prop-btn btn-sub" onclick="exportPreviewCancel()">やめる</button></div>';
    showPropertyPanel(EXPORT_PREVIEW_TITLE, h);
    if(o.tab === 'table') _xpRows();
}
// 表の行（検索で絞る）
function _xpRows() {
    const box = document.getElementById('xp-rows');
    if(!box || !_xp) return;
    const q = _xp.q.trim().toLowerCase();
    const list = q ? _xp.rows.filter((p) => String(p.name || '').toLowerCase().includes(q) || String(p.num || '').toLowerCase().includes(q)) : _xp.rows;
    const td = (t, right) => `<td style="padding:2px 6px;border-top:1px solid var(--border-1);white-space:nowrap;${right ? 'text-align:right;font-family:Consolas,monospace;color:#00ff88;' : ''}">${escapeHtml(t)}</td>`;
    let h = '<table style="border-collapse:collapse;font-size:11px;width:100%;"><thead><tr>' +
        ['番号', '点名', 'X', 'Y', '標高'].map((t) => `<th style="padding:2px 6px;text-align:left;color:var(--dim);position:sticky;top:0;background:var(--panel-bg);">${t}</th>`).join('') + '</tr></thead><tbody>';
    list.slice(0, EXPORT_PREVIEW_ROWS).forEach((p) => {
        h += '<tr>' + td(p.num) + td(p.name) + td(_xpFmt(p.X), true) + td(_xpFmt(p.Y), true) + td(_xpFmt(p.z), true) + '</tr>';
    });
    h += '</tbody></table>';
    if(!list.length) h = `<div style="color:#888;text-align:center;padding:12px;font-size:12px;">${q ? '該当する点がありません' : '点がありません'}</div>`;
    else if(list.length > EXPORT_PREVIEW_ROWS) h += `<div style="color:#888;text-align:center;padding:6px;font-size:11px;">ほか ${list.length - EXPORT_PREVIEW_ROWS}点（検索で絞り込めます。書き出すのは全部です）</div>`;
    if(_xp.lots.length && !q) {
        h += '<div class="ts-sec" style="margin:6px 6px 2px;">区画</div><div style="padding:0 6px 6px;font-size:11px;">' +
            _xp.lots.map((l) => `${escapeHtml(l.name)}（${l.n}点）`).join('、') + '</div>';
    }
    box.innerHTML = h;
}
window.exportPreviewTab = function(tab) { if(!_xp) return; _xp.tab = tab === 'text' ? 'text' : 'table'; _xpRender(); };
window.exportPreviewSearch = function(q) { if(!_xp) return; _xp.q = String(q || ''); _xpRows(); };
window.exportPreviewName = function(v) { if(_xp) _xp.nameBase = String(v); };
window.exportPreviewWrite = function() {
    const o = _xp;
    if(!o) return;
    _xp = null;
    closePropertyPanel();
    o.write(outNameFinal(o.nameBase === undefined ? '' : o.nameBase, o.fileName)); // 名前の欄の名前で（空ならもとの名前）
    _xpBack(o);
};
window.exportPreviewCancel = function() {
    const o = _xp;
    _xp = null;
    closePropertyPanel();
    if(o) { addCommandLog(`-> ${o.kind}の書き出しをやめました`); _xpBack(o); }
};

// Shift-JIS で書く文字を、書いたあとの文字にする（表せない文字は ?）。確認の表・ファイルの中身を、実際に書くものと同じにするため
function sjisRoundTrip(text) {
    try { return new TextDecoder('shift-jis').decode(encodeShiftJis(text)); } catch { return String(text); }
}

// ===== 気づいたこと =====
// Shift-JIS で表せない文字（書き出すと「?」になる）
function sjisBadChars(str) {
    const out = new Set();
    for(const ch of String(str)) { // 1文字ずつ変えてみて、? になった文字を拾う
        if(ch.codePointAt(0) < 0x80 || out.has(ch)) continue;
        const b = encodeShiftJis(ch);
        if(b.length === 1 && b[0] === 0x3F) out.add(ch);
    }
    return [...out];
}
// 測点の書き出し（SIMA・座標CSV）の気づいたこと。info は _prepareExport の結果
function surveyExportNotes(info, opts) {
    const o = opts || {};
    const n = [];
    if(info.numMode === 'renumbered') n.push({ warn: true, text: '点番号の無い点・重なった点番号・数でない点番号があったので、1 から振り直しました' });
    else if(info.numMode === 'assigned') n.push({ warn: false, text: '点番号はどの点にも無かったので、1 から順に付けました' });
    if(info.unnamed) n.push({ warn: false, text: `点名の無い ${info.unnamed}点は「P＋点番号」にしました` });
    if(info.lotAdded) n.push({ warn: false, text: `区画の頂点に測点が無かった ${info.lotAdded}か所は、点を足しました（点名は「区画名-番号」）` });
    if(info.noZ && info.noZ < info.pointCount) n.push({ warn: false, text: `標高の無い点が ${info.noZ}点あります（標高の欄は空です）` });
    if(o.sjis) {
        const bad = sjisBadChars((info.names || []).join(''));
        if(bad.length) n.push({ warn: true, text: `Shift-JIS で表せない文字（${bad.slice(0, 10).join(' ')}${bad.length > 10 ? ' など' : ''}）は「?」になります` });
    }
    if(o.sima && info.commaFixed) n.push({ warn: true, text: '点名・区画名の中のカンマ・改行は、空白にしました（SIMA の区切りと重なるため）' });
    return n;
}

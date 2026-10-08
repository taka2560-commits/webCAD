// ===== Web CAD 座標CSV の列の割り当て =====
// cad-csv-import.js - 座標CSV・テキスト（.csv・.txt）を開くと、プレビューを見ながら列（点番号・点名・X・Y・標高・使わない）を選んでから取り込む。
//   区切りはカンマ・タブ・空白（いくつ続いても1つ）から選べる（初めは自動）。見出しの行は読み飛ばす（行の数を変えられる）。
//   見出しに「点名・X・Y・標高」「N・E」などがあれば、その並びで割り当てる（Y,X の順のファイルも）。無ければ中身から推し量る（parseCoordCsv と同じ考え）。
//   X・Y を入れ替えるボタンがある。見出しの無いファイルで選んだ割り当ては覚えておき、同じ列の数のファイルで使う。
//   「取り込む」を押してから、今の図面を置き換えるか・追加するかを聞く（やめても図面は変わらない）。

const CSV_ROLES = [['skip', '使わない'], ['num', '点番号'], ['name', '点名'], ['X', 'X（北）'], ['Y', 'Y（東）'], ['Z', '標高']];
const CSV_MAP_KEY = 'cad_csv_map';
const CSV_MAX_COLS = 12;
const _csvm = { file: null, text: '', encoding: '', sep: 'auto', header: 0, roles: [], headerNamed: false };

function _csvHalf(s) { return (typeof cogoHalfWidth === 'function') ? cogoHalfWidth(s) : String(s); }
function _csvIsNum(s) { return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(_csvHalf(s).trim()); }
// 区切りの自動: タブがあってカンマが無ければタブ、カンマがあればカンマ、どちらも無く空白で分かれていれば空白
function csvDetectSep(text) {
    const lines = String(text).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/).filter(l => l.trim()).slice(0, 50);
    let tab = 0, comma = 0, space = 0;
    lines.forEach(l => { if(l.indexOf('\t') >= 0 && l.indexOf(',') < 0) tab++; else if(l.indexOf(',') >= 0) comma++; else if(/\S\s+\S/.test(l.trim())) space++; });
    return (tab >= comma && tab >= space && tab > 0) ? '\t' : (comma >= space && comma > 0) ? ',' : space > 0 ? ' ' : ',';
}
// 行を項目に分ける（空白区切りは、いくつ続いても1つの区切り）
function csvRows(text, sep) {
    const s = (sep === 'auto' || !sep) ? csvDetectSep(text) : sep;
    return String(text).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/).filter(l => l.trim()).map(l => {
        const line = l.trim();
        return s === ' ' ? line.split(/[ \t\u3000]+/) : _splitCsvLine(line, s);
    });
}
// 見出しの名前から役割を推し量る（分からない列は null）
function _csvRoleOfName(s) {
    const t = _csvHalf(s).trim().toLowerCase().replace(/[()（）\s]/g, '');
    if(/^(点番号|番号|no\.?|点no\.?|id|#)$/.test(t)) return 'num';
    if(/^(点名|名称|名前|点名称|測点名|name|point|pt)$/.test(t)) return 'name';
    if(/^(x|x座標|北|n|north|northing|x北)$/.test(t)) return 'X';
    if(/^(y|y座標|東|e|east|easting|y東)$/.test(t)) return 'Y';
    if(/^(標高|z|h|高さ|地盤高|elev|elevation|height|標高h)$/.test(t)) return 'Z';
    return null;
}
// 1行の中身から並びを推し量る（parseCoordCsv と同じ: すべて数なら 3列=点名,X,Y / 4列=点名,X,Y,標高 / 5列以上=点番号,点名,X,Y,標高。
// 文字の列があれば、それが点名で、前の数の列が点番号、後ろの数の列が X・Y・標高）
function _csvRolesOfRow(f) {
    const roles = f.map(() => 'skip');
    const firstText = f.findIndex(s => s !== '' && !_csvIsNum(s));
    if(firstText < 0) {
        const idx = f.map((s, i) => s !== '' ? i : -1).filter(i => i >= 0);
        const order = idx.length >= 5 ? ['num', 'name', 'X', 'Y', 'Z'] : idx.length === 4 ? ['name', 'X', 'Y', 'Z'] : idx.length === 3 ? ['name', 'X', 'Y'] : null;
        if(!order) return null;
        order.forEach((r, k) => { roles[idx[k]] = r; });
        return roles;
    }
    roles[firstText] = 'name';
    if(firstText > 0 && _csvIsNum(f[0])) roles[0] = 'num';
    const after = f.map((s, i) => (i > firstText && s !== '') ? i : -1).filter(i => i >= 0);
    if(after.length < 2 || !after.every(i => _csvIsNum(f[i]))) return null;
    ['X', 'Y', 'Z'].forEach((r, k) => { if(after[k] !== undefined) roles[after[k]] = r; });
    return roles;
}
// 区切り・見出しの行の数・列の役割を推し量る
function csvGuessMapping(text, sep) {
    const s = (sep && sep !== 'auto') ? sep : csvDetectSep(text);
    const rows = csvRows(text, s);
    const ncol = Math.min(CSV_MAX_COLS, rows.slice(0, 50).reduce((m, r) => Math.max(m, r.length), 0));
    const pad = (r) => { const a = r.slice(0, ncol); while(a.length < ncol) a.push('skip'); return a; };
    // 中身の行で一番多い並び
    const count = new Map();
    let first = -1;
    rows.slice(0, 200).forEach((f, i) => {
        const r = _csvRolesOfRow(f);
        if(!r) return;
        if(first < 0) first = i;
        const k = pad(r).join(',');
        count.set(k, (count.get(k) || 0) + 1);
    });
    let roles = null, best = 0;
    count.forEach((n, k) => { if(n > best) { best = n; roles = k.split(','); } });
    const header = first < 0 ? 0 : first;
    // 見出しに名前があれば、その並び（X・Y の順もこちらが正しい）
    let named = false;
    if(header > 0) {
        const hr = rows[header - 1].map(_csvRoleOfName);
        if(hr.includes('X') && hr.includes('Y')) { roles = pad(hr.map(r => r || 'skip')); named = true; }
    }
    if(!roles) roles = pad([]);
    // 見出しの無いファイルは、前に選んだ割り当て（同じ列の数）を使う
    if(!named) {
        try {
            const m = JSON.parse(localStorage.getItem(CSV_MAP_KEY) || 'null');
            if(m && Array.isArray(m.roles) && m.roles.length === ncol && m.roles.includes('X') && m.roles.includes('Y') && (m.sep === s)) roles = m.roles.slice();
        } catch { /* 覚えていなければ推し量ったまま */ }
    }
    return { sep: s, header, roles, ncol, named };
}
// 割り当てどおりに点にする。X・Y が数でない行は飛ばして数える
function csvPointsByRoles(rows, roles, header) {
    const out = { points: [], skipped: 0 };
    const col = (r) => roles.indexOf(r);
    const iX = col('X'), iY = col('Y'), iZ = col('Z'), iN = col('name'), iNo = col('num');
    if(iX < 0 || iY < 0) return out;
    rows.slice(header).forEach(f => {
        const v = (i) => (i >= 0 && f[i] !== undefined) ? String(f[i]).trim() : '';
        const X = _csvIsNum(v(iX)) ? parseFloat(_csvHalf(v(iX))) : NaN, Y = _csvIsNum(v(iY)) ? parseFloat(_csvHalf(v(iY))) : NaN;
        if(!isFinite(X) || !isFinite(Y)) { out.skipped++; return; }
        const z = (iZ >= 0 && _csvIsNum(v(iZ))) ? parseFloat(_csvHalf(v(iZ))) : null;
        out.points.push({ num: v(iNo), name: v(iN), X, Y, z: (z !== null && isFinite(z)) ? z : null });
    });
    return out;
}
// 割り当ての誤り（無ければ ''）
function _csvMapError(roles) {
    const used = roles.filter(r => r !== 'skip');
    if(new Set(used).size !== used.length) return '同じ役割を2つの列に選んでいます';
    if(!roles.includes('X') || !roles.includes('Y')) return 'X と Y の列を選んでください';
    return '';
}

// ===== 画面 =====
// .csv・.txt を開いたとき（cad-io.js の setupFileIO から）
async function loadCoordCsvFile(file) {
    addCommandLog(`座標CSVを読み込み中: ${file.name}...`);
    try {
        const dec = await _readTextFile(file);
        const g = csvGuessMapping(dec.text);
        Object.assign(_csvm, { file, text: dec.text, encoding: dec.encoding, sep: 'auto', header: g.header, roles: g.roles, headerNamed: g.named });
        _csvRender();
        return true;
    } catch(err) {
        addCommandLog(`エラー: 座標CSVの読み込みに失敗 - ${err.message}`);
        if(typeof reportImportFailure === 'function') reportImportFailure('座標CSV', file.name, err);
        return null;
    }
}
function _csvRender() {
    const sep = _csvm.sep === 'auto' ? csvDetectSep(_csvm.text) : _csvm.sep;
    const rows = csvRows(_csvm.text, sep);
    const ncol = _csvm.roles.length;
    const err = _csvMapError(_csvm.roles);
    const res = err ? { points: [], skipped: 0 } : csvPointsByRoles(rows, _csvm.roles, _csvm.header);
    const sepName = { ',': 'カンマ', '\t': 'タブ', ' ': '空白' };
    const opt = (cur, list) => list.map(([v, l]) => `<option value="${escapeHtml(v)}"${v === cur ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
    let h = `<div class="cogo-note">${escapeHtml(_csvm.file ? _csvm.file.name : '')}（${escapeHtml(_csvm.encoding)}）。列ごとに、何の値かを選んでください。X は北、Y は東（m）です。</div>` +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0;">' +
        `<label style="font-size:11px;">区切り <select id="csv-sep" class="prop-val" style="width:auto;" onchange="csvMapSep(this.value)">${opt(_csvm.sep, [['auto', `自動（${sepName[sep]}）`], [',', 'カンマ'], ['\t', 'タブ'], [' ', '空白']])}</select></label>` +
        `<label style="font-size:11px;">見出しの行 <input id="csv-header" class="prop-val" type="number" min="0" max="20" step="1" value="${_csvm.header}" style="width:52px;" onchange="csvMapHeader(this.value)"></label>` +
        '<button class="prop-btn btn-sub" style="margin-top:0;" onclick="csvMapSwap()" title="X と Y の列を入れ替える（東・北の順のファイル）">⇄ X と Y を入れ替える</button></div>';
    h += '<div style="overflow:auto;max-height:36vh;border:1px solid var(--border-2);border-radius:var(--r-sub);"><table class="csv-map" style="border-collapse:collapse;font-size:11px;width:100%;"><thead><tr>';
    for(let c = 0; c < ncol; c++) h += `<th style="padding:2px;"><select class="prop-val csv-role" data-col="${c}" style="width:auto;min-width:64px;" onchange="csvMapRole(${c}, this.value)" aria-label="${c + 1}列目の値">${opt(_csvm.roles[c], CSV_ROLES)}</select></th>`;
    h += '</tr></thead><tbody>';
    rows.slice(0, _csvm.header + 6).forEach((f, i) => {
        const head = i < _csvm.header;
        h += `<tr style="${head ? 'opacity:.45;text-decoration:line-through;' : ''}">`;
        for(let c = 0; c < ncol; c++) h += `<td style="padding:2px 4px;border-top:1px solid var(--border-2);white-space:nowrap;">${escapeHtml(f[c] === undefined ? '' : f[c])}</td>`;
        h += '</tr>';
    });
    h += '</tbody></table></div>';
    if(err) h += `<div class="cogo-note" style="color:#ff6b6b;">${escapeHtml(err)}</div>`;
    else {
        const ex = res.points.slice(0, 3).map(p => `${escapeHtml(p.name || p.num || '（名前なし）')}\u3000X ${p.X.toFixed(3)}\u3000Y ${p.Y.toFixed(3)}${p.z !== null ? `\u3000標高 ${p.z.toFixed(3)}` : ''}`).join('<br>');
        h += `<div class="cogo-note" id="csv-result">取り込む点: <b>${res.points.length}点</b>${res.skipped ? `（X・Y が読めない行 ${res.skipped}件は飛ばします）` : ''}${ex ? '<br>' + ex : ''}</div>`;
    }
    h += `<div class="cogo-btns"><button class="prop-btn" onclick="csvMapImport()" ${err || !res.points.length ? 'disabled' : ''}>📥 取り込む</button><button class="prop-btn btn-sub" onclick="csvMapCancel()">やめる</button></div>`;
    showPropertyPanel('📥 座標CSV の列', h);
}
window.csvMapRole = function(c, r) { _csvm.roles[c] = r; _csvRender(); };
window.csvMapSep = function(v) {
    _csvm.sep = v;
    const g = csvGuessMapping(_csvm.text, v);
    Object.assign(_csvm, { header: g.header, roles: g.roles, headerNamed: g.named });
    _csvRender();
};
window.csvMapHeader = function(v) { const n = parseInt(_csvHalf(v), 10); _csvm.header = Math.max(0, Math.min(20, isFinite(n) ? n : 0)); _csvRender(); };
window.csvMapSwap = function() { _csvm.roles = _csvm.roles.map(r => r === 'X' ? 'Y' : r === 'Y' ? 'X' : r); _csvRender(); };
window.csvMapCancel = function() { hidePropertyPanel(); addCommandLog('-> 座標CSVの取り込みをやめました'); };
window.csvMapImport = function() {
    const sep = _csvm.sep === 'auto' ? csvDetectSep(_csvm.text) : _csvm.sep;
    if(_csvMapError(_csvm.roles)) return;
    const data = csvPointsByRoles(csvRows(_csvm.text, sep), _csvm.roles, _csvm.header);
    if(!data.points.length) return;
    if(!_csvm.headerNamed) { try { localStorage.setItem(CSV_MAP_KEY, JSON.stringify({ sep, roles: _csvm.roles })); } catch { /* 覚えられなくても続行 */ } }
    const file = _csvm.file;
    hidePropertyPanel();
    _prepareImportTarget(() => {
        const r = addSurveyData(data.points, []);
        if(typeof _importMode === 'undefined' || _importMode !== 'append') setDrawingName(file.name);
        zoomExtents();
        render();
        const msg = `座標CSV読み込み: 測点 ${r.pointCount}点` + (data.skipped ? `\n（読めない行 ${data.skipped}件は省略）` : '');
        addCommandLog('-> ' + msg.replace(/\n/g, ' ') + `（文字コード: ${_csvm.encoding}）`);
        if(typeof showToast === 'function') showToast(msg, { kind: 'success', ms: 4000 });
        if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    });
};

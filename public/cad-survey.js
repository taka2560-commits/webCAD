// ===== Web CAD 測量機能 =====
// cad-survey.js - SIMA・座標CSVの入出力、座標一覧、GNSS（現在地の表示）
//
// 座標の約束（アプリ全体の表示と同じ）:
//   測量の X ＝ 北方向 ＝ 図面の y、測量の Y ＝ 東方向 ＝ 図面の x
//   図面の1単位の長さはオプションの「測量座標の単位」（m / mm、既定 m）に従う
//   一覧・出力の座標は図面の座標（WCS）。UCS を設定していても変換しない（ファイル交換用の正しい座標のため）

const SURVEY_LAYER_POINT = '測点';
const SURVEY_LAYER_LABEL = '測点名';
const SURVEY_LAYER_LOT = '区画';
const SURVEY_LAYER_LOT_LABEL = '区画名';

// ===== 設定 =====
function getSurveyUnit() {
    try { return localStorage.getItem('cad_survey_unit') === 'mm' ? 'mm' : 'm'; } catch { return 'm'; }
}
function surveyUnitFactor() { return getSurveyUnit() === 'mm' ? 1000 : 1; }
window.setSurveyUnit = function(u) {
    try { localStorage.setItem('cad_survey_unit', u === 'mm' ? 'mm' : 'm'); } catch { /* 保存できなくても続行 */ }
    addCommandLog(`-> 測量座標の単位: 図面の1単位 = 1${u === 'mm' ? 'mm' : 'm'}`);
    // 表示の単位（オプションの座標・長さの単位）の換算が変わるので、座標・寸法・プロパティを出し直す
    if(typeof _refreshShownValues === 'function') _refreshShownValues();
    if(typeof refreshCoordDisplay === 'function') refreshCoordDisplay();
    if(typeof render === 'function') render();
    if(typeof showOptionsPanel === 'function' && document.getElementById('opt-survey-unit')) showOptionsPanel();
};

// 測量座標（m）⇔ 図面の座標
function surveyToWcs(X, Y) { const f = surveyUnitFactor(); return { x: Y * f, y: X * f }; }
function wcsToSurvey(x, y) { const f = surveyUnitFactor(); return { X: y / f, Y: x / f }; }
// mm 単位（小数3桁）の文字列。-0.000 にならないようにする
function formatSurveyNumber(v) {
    if(typeof v !== 'number' || !isFinite(v)) return '';
    const r = Math.round(v * 1000) / 1000;
    return (Object.is(r, -0) ? 0 : r).toFixed(3);
}

// ===== 画層・測点の作成 =====
function _ensureSurveyLayer(name, color) {
    let i = layers.findIndex(l => l.name === name);
    if(i < 0) { layers.push({ name, color, visible: true }); i = layers.length - 1; }
    return i;
}
// 点名の文字の高さ（図面単位）: 点の広がりの 1/50 を目安に 0.2〜20m の範囲（全体表示のスマホ画面でも読める大きさ）
function _autoLabelHeight(pts) {
    const f = surveyUnitFactor();
    if(!pts.length) return 1 * f;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(p => { if(p.x < minX) minX = p.x; if(p.x > maxX) maxX = p.x; if(p.y < minY) minY = p.y; if(p.y > maxY) maxY = p.y; });
    const extent = Math.max(maxX - minX, maxY - minY);
    return Math.min(20 * f, Math.max(0.2 * f, extent / 50));
}
// 測点1つ分の図形（点の記号＋点名の文字を1つのグループにする）
function makeSurveyPointEntities(p, h, layerPt, layerLbl) {
    const gid = newGroupId('p');
    const pt = { type: 'POINT', layer: layerPt, color: null, x: p.x, y: p.y, name: p.name || '', num: p.num || '', z: (typeof p.z === 'number' && isFinite(p.z)) ? p.z : null, gid, blockName: '測点' };
    const out = [pt];
    if(p.name) {
        out.push({ type: 'TEXT', layer: layerLbl, color: null, x: p.x + h * 0.5, y: p.y + h * 0.3, text: p.name, height: h, halign: 'left', valign: 'bottom', gid, blockName: '測点', ptLabel: true });
    }
    return out;
}
// 多角形の重心（面積0なら頂点の平均）
function _polygonCentroid(pts) {
    let a = 0, cx = 0, cy = 0;
    for(let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        const c = p.x * q.y - q.x * p.y;
        a += c; cx += (p.x + q.x) * c; cy += (p.y + q.y) * c;
    }
    if(Math.abs(a) < 1e-12) {
        const n = pts.length || 1;
        return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
    }
    return { x: cx / (3 * a), y: cy / (3 * a) };
}
function polygonArea(pts) {
    let a = 0;
    for(let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
    return Math.abs(a) / 2;
}

/**
 * 測点（と区画）を図面に追加する。
 * points: [{ num, name, X, Y, z }]（測量座標・m）
 * lots:   [{ num, name, refs: [{ num, name }] }]（区画を構成する点の参照）
 * opt:    { layer, color }（任意）: 点・点名・区画・区画名を、この1つの画層にまとめて入れる（変換して取り込むときなど）
 * 戻り値: { pointCount, lotCount, skippedLots }
 */
function addSurveyData(points, lots, opt) {
    const one = opt && opt.layer ? _ensureSurveyLayer(opt.layer, opt.color || '#ffffff') : -1;
    const wpts = points.map(p => Object.assign({}, p, surveyToWcs(p.X, p.Y)));
    const h = _autoLabelHeight(wpts);
    const lp = one >= 0 ? one : _ensureSurveyLayer(SURVEY_LAYER_POINT, '#ffff00');
    const ll = one >= 0 ? one : _ensureSurveyLayer(SURVEY_LAYER_LABEL, '#ffffff');
    wpts.forEach(p => makeSurveyPointEntities(p, h, lp, ll).forEach(e => entities.push(e)));

    let lotCount = 0, skippedLots = 0;
    if(lots && lots.length) {
        const byNum = new Map(), byName = new Map();
        wpts.forEach(p => { if(p.num !== '' && p.num !== undefined && !byNum.has(String(p.num))) byNum.set(String(p.num), p); if(p.name && !byName.has(p.name)) byName.set(p.name, p); });
        const lotLayer = one >= 0 ? one : _ensureSurveyLayer(SURVEY_LAYER_LOT, '#00ff00');
        const lotLbl = one >= 0 ? one : _ensureSurveyLayer(SURVEY_LAYER_LOT_LABEL, '#00ff00');
        lots.forEach(lot => {
            const vs = [];
            lot.refs.forEach(r => {
                const p = byNum.get(String(r.num)) || (r.name ? byName.get(r.name) : undefined);
                if(p) vs.push({ x: p.x, y: p.y });
            });
            if(vs.length < 3 || vs.length !== lot.refs.length) { skippedLots++; return; }
            const gid = newGroupId('l');
            const name = lot.name || String(lot.num || '');
            entities.push({ type: 'PLINE', layer: lotLayer, color: null, points: vs, closed: true, lotName: name, lotNum: lot.num || '', gid, blockName: '区画' });
            if(name) {
                const c = _polygonCentroid(vs);
                entities.push({ type: 'TEXT', layer: lotLbl, color: null, x: c.x, y: c.y, text: name, height: h * 1.2, halign: 'center', valign: 'middle', gid, blockName: '区画' });
            }
            lotCount++;
        });
    }
    ensureEntityIds();
    _bumpGeomEpoch();
    initLayers();
    if(typeof updateLayerPanel === 'function') updateLayerPanel();
    return { pointCount: wpts.length, lotCount, skippedLots };
}

// ===== SIMA =====
// 例:
//   G00,01,作業名,
//   Z00,座標ﾃﾞｰﾀ,,
//   A00,
//   A01,1,KP1,-35000.123,20000.456,12.345,      ← 点番号, 点名, X(北), Y(東), 標高
//   A99,
//   Z00,区画ﾃﾞｰﾀ,
//   D00,1,848-1,1,                               ← 区画番号, 区画名
//   B01,1,KP1,                                   ← 構成点の点番号, 点名
//   D99,
function parseSima(text) {
    const out = { title: '', points: [], lots: [], skipped: 0 };
    let lot = null;
    const num = (s) => { const v = parseFloat(s); return (s !== undefined && String(s).trim() !== '' && isFinite(v)) ? v : null; };
    String(text).split(/\r\n|\r|\n/).forEach(raw => {
        const line = raw.trim();
        if(!line) return;
        const f = line.split(',').map(s => s.trim());
        const code = (f[0] || '').toUpperCase();
        if(code === 'G00') { out.title = f[2] || ''; }
        else if(code === 'A01') {
            const X = num(f[3]), Y = num(f[4]);
            if(X === null || Y === null) { out.skipped++; return; }
            out.points.push({ num: f[1] || '', name: f[2] || f[1] || '', X, Y, z: num(f[5]) });
        }
        else if(code === 'D00') { lot = { num: f[1] || '', name: f[2] || f[1] || '', refs: [] }; }
        else if(code === 'B01') { if(lot) lot.refs.push({ num: f[1] || '', name: f[2] || '' }); }
        else if(code === 'D99') { if(lot) out.lots.push(lot); lot = null; }
        // Z00（見出し）・A00/A99（区切り）・路線データ等は読み飛ばす
    });
    if(lot && lot.refs.length) out.lots.push(lot); // D99 が無いファイルへの対応
    return out;
}

// ファイルを読み、UTF-8 / Shift-JIS を自動判定して文字列にする
// （Blob.arrayBuffer は古い iOS Safari に無いため FileReader を使う）
function _readTextFile(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
            const bytes = new Uint8Array(r.result);
            resolve((typeof decodeDxfBuffer === 'function') ? decodeDxfBuffer(bytes) : { text: new TextDecoder('shift-jis').decode(bytes), encoding: 'Shift-JIS' });
        };
        r.onerror = () => reject(r.error || new Error('ファイルを読み込めませんでした'));
        r.readAsArrayBuffer(file);
    });
}

async function loadSimaFile(file) {
    addCommandLog(`SIMAファイルを読み込み中: ${file.name}...`);
    try {
        const dec = await _readTextFile(file);
        const data = parseSima(dec.text);
        if(!data.points.length) {
            addCommandLog('注意: 座標データ（A01）が見つかりませんでした');
            if(typeof showToast === 'function') showToast('SIMAファイルに座標データ（A01）が見つかりませんでした', 5000);
            return null;
        }
        const r = addSurveyData(data.points, data.lots);
        setDrawingName(file.name);
        zoomExtents();
        render();
        let msg = `SIMA読み込み: 測点 ${r.pointCount}点` + (r.lotCount ? `・区画 ${r.lotCount}` : '');
        if(r.skippedLots) msg += `\n（構成点が見つからない区画 ${r.skippedLots}件は省略）`;
        if(data.skipped) msg += `\n（座標が読めない行 ${data.skipped}件は省略）`;
        addCommandLog('-> ' + msg.replace(/\n/g, ' ') + `（文字コード: ${dec.encoding}）`);
        if(typeof showToast === 'function') showToast(msg, 5000);
        if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
        return r;
    } catch(err) {
        addCommandLog(`エラー: SIMAファイルの読み込みに失敗 - ${err.message}`);
        if(typeof reportImportFailure === 'function') reportImportFailure('SIMA', file.name, err);
        return null;
    }
}

// ===== 座標CSV =====
// 受け付ける並び（区切りはカンマまたはタブ。見出し行は自動で読み飛ばす）:
//   点名, X, Y[, 標高]   /   点番号, 点名, X, Y[, 標高]
//   （すべて数字の行は 3列=点名,X,Y / 4列=点名,X,Y,標高 / 5列以上=点番号,点名,X,Y,標高）
function parseCoordCsv(text) {
    const out = { points: [], skipped: 0 };
    const isNum = (s) => /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s);
    String(text).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/).forEach(raw => {
        const line = raw.trim();
        if(!line) return;
        const sep = (line.indexOf('\t') >= 0 && line.indexOf(',') < 0) ? '\t' : ',';
        const f = _splitCsvLine(line, sep);
        const firstText = f.findIndex(s => s !== '' && !isNum(s));
        let num = '', name, nums;
        if(firstText < 0) {
            const vals = f.filter(s => s !== '');
            if(vals.length >= 5) { num = vals[0]; name = vals[1]; nums = vals.slice(2); }
            else if(vals.length >= 3) { name = vals[0]; nums = vals.slice(1); }
            else { out.skipped++; return; }
        } else {
            name = f[firstText];
            if(firstText > 0 && isNum(f[0])) num = f[0];
            nums = f.slice(firstText + 1).filter(s => s !== '');
            if(!nums.every(isNum) || nums.length < 2) { if(out.points.length) out.skipped++; return; } // 見出し行など
        }
        const X = parseFloat(nums[0]), Y = parseFloat(nums[1]);
        const z = nums.length >= 3 ? parseFloat(nums[2]) : null;
        if(!isFinite(X) || !isFinite(Y)) { out.skipped++; return; }
        out.points.push({ num, name, X, Y, z: (z !== null && isFinite(z)) ? z : null });
    });
    return out;
}

// CSV の1行を項目に分ける（"…" で囲まれた項目の中の区切り文字・"" に対応。Excel の出力形式）
function _splitCsvLine(line, sep) {
    const out = [];
    let cur = '', inQ = false;
    for(let i = 0; i < line.length; i++) {
        const ch = line[i];
        if(inQ) {
            if(ch === '"') { if(line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
            else cur += ch;
        } else if(ch === '"' && cur.trim() === '') { inQ = true; cur = ''; }
        else if(ch === sep) { out.push(cur.trim()); cur = ''; }
        else cur += ch;
    }
    out.push(cur.trim());
    return out;
}

async function loadCoordCsvFile(file) {
    addCommandLog(`座標CSVを読み込み中: ${file.name}...`);
    try {
        const dec = await _readTextFile(file);
        const data = parseCoordCsv(dec.text);
        if(!data.points.length) {
            if(typeof showToast === 'function') showToast('座標を読み取れませんでした。\n「点名,X,Y,標高」または「点番号,点名,X,Y,標高」の並びにしてください', 6000);
            addCommandLog('注意: 座標を読み取れませんでした');
            return null;
        }
        const r = addSurveyData(data.points, []);
        setDrawingName(file.name);
        zoomExtents();
        render();
        const msg = `座標CSV読み込み: 測点 ${r.pointCount}点` + (data.skipped ? `\n（読めない行 ${data.skipped}件は省略）` : '');
        addCommandLog('-> ' + msg.replace(/\n/g, ' '));
        if(typeof showToast === 'function') showToast(msg, 4000);
        if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
        return r;
    } catch(err) {
        addCommandLog(`エラー: 座標CSVの読み込みに失敗 - ${err.message}`);
        if(typeof reportImportFailure === 'function') reportImportFailure('座標CSV', file.name, err);
        return null;
    }
}

// ===== 図面上の測点・区画を集める =====
// ・POINT 図形（SIMA/CSVで取り込んだ測点、GNSSで追加した点など）
// ・DXF/DWG のブロックで描かれた測点（属性に点名を持つブロック。挿入点を座標とする）
function collectSurveyPoints() {
    const out = [];
    const pointGids = new Set();
    const blocks = new Map(); // gid → { x, y, idx, name, score, blockName }
    entities.forEach((e, i) => {
        if(!e) return;
        if(e.type === 'POINT') {
            out.push({ kind: 'point', idx: i, id: e.id, gid: e.gid || null, name: e.name || '', num: e.num || '', x: e.x, y: e.y, z: (typeof e.z === 'number' && isFinite(e.z)) ? e.z : null });
            if(e.gid) pointGids.add(e.gid);
            return;
        }
        if(!e.gid || !e.ins) return;
        let b = blocks.get(e.gid);
        if(!b) { b = { x: e.ins.x, y: e.ins.y, idx: i, name: '', score: -1, blockName: e.blockName || '' }; blocks.set(e.gid, b); }
        if(e.type === 'TEXT' && e.attTag) {
            // 点名らしい属性（NAME・点名・番号など）を優先する
            const score = /NAME|NO|PT|POINT|点|名|番/i.test(e.attTag) ? 2 : 1;
            if(score > b.score && String(e.text || '').trim()) { b.name = String(e.text).trim(); b.score = score; }
        }
    });
    blocks.forEach((b, gid) => {
        if(pointGids.has(gid) || b.score < 0) return; // 属性の無いブロック（方位記号など）は測点としない
        out.push({ kind: 'block', idx: b.idx, id: entities[b.idx] ? entities[b.idx].id : null, gid, name: b.name, num: '', x: b.x, y: b.y, z: null, blockName: b.blockName });
    });
    return out;
}
// 区画: SIMA で取り込んだ区画、または「区画」を含む画層の閉じたポリライン
function collectSurveyLots() {
    const out = [];
    entities.forEach(e => {
        if(!e || e.type !== 'PLINE' || !e.closed || !e.points || e.points.length < 3) return;
        const lname = layers[e.layer] ? layers[e.layer].name : '';
        if(!e.lotName && !/区画|筆|地番/.test(lname)) return;
        out.push({ name: e.lotName || '', num: e.lotNum || '', points: e.points });
    });
    return out;
}

// ===== 出力 =====
const _SIMA_BAD = /[,\r\n]/g;
function _simaField(s) { return String(s === undefined || s === null ? '' : s).replace(_SIMA_BAD, ' ').trim(); }

// 出力用の測点（測量座標）。onlyIdx があれば、その図形の測点だけ。
// 点番号が全点にあり重複もなければそのまま、そうでなければ 1 から振り直す。点名が無ければ「P番号」
function _surveyExportPoints(onlyIdx) {
    const src = collectSurveyPoints().filter(p => !onlyIdx || onlyIdx.has(p.idx));
    const pts = src.map(p => { const s = wcsToSurvey(p.x, p.y); return { num: String(p.num || '').trim(), name: p.name, X: s.X, Y: s.Y, z: p.z }; });
    const nums = pts.map(p => p.num);
    const valid = nums.every(n => /^\d+$/.test(n)) && new Set(nums).size === nums.length;
    if(!valid) pts.forEach((p, i) => { p.num = String(i + 1); });
    pts.forEach(p => { if(!p.name) p.name = 'P' + p.num; });
    return pts;
}
function _simaA01(p) { return `A01,${_simaField(p.num)},${_simaField(p.name)},${formatSurveyNumber(p.X)},${formatSurveyNumber(p.Y)},${p.z === null || p.z === undefined ? '' : formatSurveyNumber(p.z)},`; }
// 測点だけの SIMA（座標データ）の行（機械の既知点へ送るときなど）。onlyIdx があれば、その図形の測点だけ
function buildSimaPointLines(title, onlyIdx) {
    const pts = _surveyExportPoints(onlyIdx);
    const L = [`G00,01,${_simaField(title || 'WebCAD')},`, 'Z00,座標ﾃﾞｰﾀ,,', 'A00,'];
    pts.forEach(p => L.push(_simaA01(p)));
    L.push('A99,');
    return { lines: L, pointCount: pts.length };
}
// 出力用に点番号・点名を揃え、区画の頂点を点に対応付ける
function _prepareExport() {
    const pts = _surveyExportPoints();
    // 区画の頂点 → 点（同じ座標の点が無ければ追加する）
    const key = (X, Y) => Math.round(X * 1000) + ',' + Math.round(Y * 1000);
    const byKey = new Map();
    pts.forEach(p => { const k = key(p.X, p.Y); if(!byKey.has(k)) byKey.set(k, p); });
    let next = pts.reduce((m, p) => Math.max(m, parseInt(p.num, 10) || 0), 0) + 1;
    const lots = collectSurveyLots().map((lot, li) => {
        const lotName = lot.name || ('区画' + (li + 1));
        const refs = lot.points.map((v, vi) => {
            const s = wcsToSurvey(v.x, v.y);
            const k = key(s.X, s.Y);
            let p = byKey.get(k);
            if(!p) { p = { num: String(next++), name: `${lotName}-${vi + 1}`, X: s.X, Y: s.Y, z: null }; pts.push(p); byKey.set(k, p); }
            return p;
        });
        return { name: lotName, refs };
    });
    return { pts, lots };
}

function buildSimaText(title) {
    const { pts, lots } = _prepareExport();
    const L = [];
    L.push(`G00,01,${_simaField(title || 'WebCAD')},`);
    L.push('Z00,座標ﾃﾞｰﾀ,,');
    L.push('A00,');
    pts.forEach(p => L.push(_simaA01(p)));
    L.push('A99,');
    if(lots.length) {
        L.push('Z00,区画ﾃﾞｰﾀ,');
        lots.forEach((lot, i) => {
            L.push(`D00,${i + 1},${_simaField(lot.name)},1,`);
            lot.refs.forEach(p => L.push(`B01,${_simaField(p.num)},${_simaField(p.name)},`));
            L.push('D99,');
        });
    }
    return { text: L.join('\r\n') + '\r\n', pointCount: pts.length, lotCount: lots.length };
}

function buildCoordCsvText() {
    const { pts } = _prepareExport();
    const q = (s) => /[",\r\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s);
    const L = ['点番号,点名,X,Y,標高'];
    pts.forEach(p => L.push([q(p.num), q(p.name), formatSurveyNumber(p.X), formatSurveyNumber(p.Y), p.z === null || p.z === undefined ? '' : formatSurveyNumber(p.z)].join(',')));
    return { text: L.join('\r\n') + '\r\n', pointCount: pts.length };
}

function _baseName() {
    const n = (window._drawingName || 'webcad').replace(/\.[^.]+$/, '').trim();
    return n || 'webcad';
}

window.exportSima = function() {
    const r = buildSimaText(_baseName());
    if(!r.pointCount) { if(typeof showToast === 'function') showToast('出力できる測点がありません（点・属性付きブロック・区画）', 4000); return; }
    const bytes = encodeShiftJis(r.text);
    downloadBlob(new Blob([bytes], { type: 'text/plain' }), _baseName() + '.sim');
    addCommandLog(`-> SIMA出力: 測点 ${r.pointCount}点` + (r.lotCount ? `・区画 ${r.lotCount}` : '') + '（Shift-JIS）');
    if(typeof showToast === 'function') showToast(`SIMA出力: 測点 ${r.pointCount}点` + (r.lotCount ? `・区画 ${r.lotCount}` : ''), 3000);
};
window.exportCoordCsv = function() {
    const r = buildCoordCsvText();
    if(!r.pointCount) { if(typeof showToast === 'function') showToast('出力できる測点がありません', 4000); return; }
    // Excel で文字化けしないよう UTF-8（BOM付き）で出力
    downloadBlob(new Blob(['\uFEFF' + r.text], { type: 'text/csv' }), _baseName() + '_座標.csv');
    addCommandLog(`-> 座標CSV出力: ${r.pointCount}点`);
    if(typeof showToast === 'function') showToast(`座標CSV出力: ${r.pointCount}点`, 3000);
};

// ===== Shift-JIS への変換（SIMA は Shift-JIS が標準。ブラウザは Shift-JIS で書き出せないため対応表を作る） =====
let _sjisMap = null;
function _buildSjisMap() {
    const dec = new TextDecoder('shift-jis');
    const map = new Map();
    for(let b = 0xA1; b <= 0xDF; b++) { // 半角カナ
        const ch = dec.decode(new Uint8Array([b]));
        if(ch.length === 1 && ch !== '\uFFFD') map.set(ch, [b]);
    }
    const leads = [];
    for(let b = 0x81; b <= 0x9F; b++) leads.push(b);
    for(let b = 0xE0; b <= 0xFC; b++) leads.push(b);
    for(const lead of leads) {
        // 「先頭バイト・後続バイト・改行」を並べて一度に変換し、改行で区切って1文字ずつ対応付ける
        const bytes = [], trails = [];
        for(let t = 0x40; t <= 0xFC; t++) { if(t === 0x7F) continue; bytes.push(lead, t, 0x0A); trails.push(t); }
        const parts = dec.decode(new Uint8Array(bytes)).split('\n');
        for(let k = 0; k < trails.length; k++) {
            const ch = parts[k];
            if(ch && ch.length === 1 && ch !== '\uFFFD' && !map.has(ch)) map.set(ch, [lead, trails[k]]);
        }
    }
    return map;
}
// Shift-JIS に無い、または別の文字として扱われる記号の置き換え
const _SJIS_ALIASES = { '〜': '～', '‖': '∥', '−': '－', '¢': '￠', '£': '￡', '¬': '￢' };
function encodeShiftJis(str) {
    if(!_sjisMap) _sjisMap = _buildSjisMap();
    const out = [];
    for(const ch0 of String(str)) {
        const c = ch0.codePointAt(0);
        if(c < 0x80) { out.push(c); continue; }
        const ch = _SJIS_ALIASES[ch0] || ch0;
        const b = _sjisMap.get(ch);
        if(b) out.push(...b); else out.push(0x3F); // 表せない文字は「?」
    }
    return new Uint8Array(out);
}

// ===== 座標一覧パネル =====
let _coordListSnapshot = [];
window.showCoordListPanel = function() {
    const unit = getSurveyUnit();
    const ucsActive = !(ucs.originX === 0 && ucs.originY === 0 && ucs.angle === 0);
    const html = `
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
            <input id="coord-search" class="prop-val" type="search" placeholder="点名・点番号で検索" oninput="updateCoordListContent()" style="flex:1;">
        </div>
        <div id="coord-list-note" style="font-size:10px;color:#888;margin-bottom:6px;">X＝北、Y＝東（図面の座標・単位 ${unit}）${ucsActive ? '<br><span style="color:#ffcc00;">※UCS設定中ですが、一覧と出力は図面の座標（WCS）です</span>' : ''}</div>
        <div id="coord-list-rows" style="max-height:48vh;overflow:auto;border:1px solid var(--border-2);border-radius:var(--r-sub);"></div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
            <button class="prop-btn btn-sub" style="flex:1;" onclick="exportCoordCsv()">📄 CSV出力</button>
            <button class="prop-btn btn-sub" style="flex:1;" onclick="exportSima()">📄 SIMA出力</button>
            <button class="prop-btn btn-sub" style="flex:1;" onclick="exportSdr33()" title="ソキアのトータルステーション用（既知点・杭打ち点）">📄 SDR33出力</button>
        </div>
        <div style="font-size:10px;color:#666;margin-top:6px;">SIMA・座標CSV・SDR は「開く」から読み込めます</div>`;
    showPropertyPanel('📍 座標一覧', html);
    window.updateCoordListContent();
};
const COORD_LIST_MAX_ROWS = 300;
window.updateCoordListContent = function() {
    const box = document.getElementById('coord-list-rows');
    if(!box) return;
    const qEl = document.getElementById('coord-search');
    const q = qEl ? qEl.value.trim().toLowerCase() : '';
    const all = collectSurveyPoints();
    const list = q ? all.filter(p => String(p.name).toLowerCase().includes(q) || String(p.num).toLowerCase().includes(q)) : all;
    _coordListSnapshot = list;
    box.textContent = '';
    if(!list.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'color:#888;text-align:center;padding:16px;font-size:12px;';
        empty.textContent = all.length ? '該当する測点がありません' : '測点がありません（SIMA・座標CSVの読み込み、点の作図、属性付きブロックの取り込みで表示されます）';
        box.appendChild(empty);
        return;
    }
    const frag = document.createDocumentFragment();
    list.slice(0, COORD_LIST_MAX_ROWS).forEach((p, k) => {
        const s = wcsToSurvey(p.x, p.y);
        const row = document.createElement('div');
        row.className = 'coord-row';
        row.style.cssText = 'display:flex;gap:6px;align-items:baseline;padding:7px 8px;border-bottom:1px solid var(--border-1);cursor:pointer;font-size:12px;';
        row.addEventListener('click', () => window.zoomToSurveyPoint(k));
        const nm = document.createElement('div');
        nm.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e0e0e0;font-weight:600;';
        nm.textContent = (p.num ? p.num + ' ' : '') + (p.name || '(名称なし)') + (p.kind === 'block' ? ' 🧩' : '');
        const xy = document.createElement('div');
        xy.style.cssText = 'font-family:Consolas,monospace;color:#00ff88;font-size:11px;text-align:right;white-space:nowrap;';
        xy.textContent = `X ${formatSurveyNumber(s.X)}  Y ${formatSurveyNumber(s.Y)}` + (p.z !== null ? `  H ${formatSurveyNumber(p.z)}` : '');
        row.appendChild(nm); row.appendChild(xy);
        frag.appendChild(row);
    });
    if(list.length > COORD_LIST_MAX_ROWS) {
        const more = document.createElement('div');
        more.style.cssText = 'color:#888;text-align:center;padding:8px;font-size:11px;';
        more.textContent = `他 ${list.length - COORD_LIST_MAX_ROWS}点（検索で絞り込んでください）`;
        frag.appendChild(more);
    }
    box.appendChild(frag);
};

// 一覧から選んだ測点へ移動して選択する
let _surveyFlash = null; // { x, y, until }
window.zoomToSurveyPoint = function(k) {
    const p = _coordListSnapshot[k];
    if(!p) return;
    // 一覧を作った後に図面が変わっていても、IDで今の位置を探し直す
    let idx = p.id !== null && p.id !== undefined ? entityIndexById(p.id) : -1;
    let x = p.x, y = p.y;
    if(p.kind === 'point' && idx >= 0) { x = entities[idx].x; y = entities[idx].y; }
    else if(p.kind === 'block' && p.gid) {
        const m = entities.findIndex(e => e && e.gid === p.gid && e.ins);
        if(m >= 0) { idx = m; x = entities[m].ins.x; y = entities[m].ins.y; }
    }
    // 1辺 約40m が見える拡大率まで寄る（既にそれ以上拡大していればそのまま）
    const target = Math.min(canvas.width, canvas.height) / (40 * surveyUnitFactor());
    if(view.scale < target) view.scale = target;
    const s = wcsToScreen(x, y);
    view.x += canvas.width / 2 - s.x; view.y += canvas.height / 2 - s.y;
    if(idx >= 0) {
        const members = (window.groupSelectEnabled && entities[idx].gid) ? getGroupMembers(entities[idx].gid) : [];
        cmdState.highlightIdx = idx;
        cmdState.selectedIndices = members.length > 1 ? members : [];
        if(typeof updatePropertiesPanel === 'function') updatePropertiesPanel();
    }
    _surveyFlash = { x, y, until: performance.now() + 2000 };
    setTimeout(() => renderOverlay(), 2050);
    render();
    const sv = wcsToSurvey(x, y);
    if(typeof showToast === 'function') showToast(`${p.name || '(名称なし)'}\nX ${formatSurveyNumber(sv.X)}  Y ${formatSurveyNumber(sv.Y)}`, 3000);
    // スマホ・画面いっぱいのときは一覧が図面を隠すので閉じる（メニューからまた開ける）
    if(panelCoversDrawing()) { const pp = document.getElementById('property-panel'); if(pp) pp.style.display = 'none'; }
};

// ===== GNSS（現在地） =====
// 平面直角座標系（19系）の原点（緯度・経度、度）と主な区域
const JPRCS_ZONES = [
    null,
    { lat: 33, lon: 129.5, area: '長崎県・鹿児島県の一部の島' },
    { lat: 33, lon: 131, area: '福岡・佐賀・熊本・大分・宮崎・鹿児島' },
    { lat: 36, lon: 132 + 10 / 60, area: '山口・島根・広島' },
    { lat: 33, lon: 133.5, area: '香川・愛媛・徳島・高知' },
    { lat: 36, lon: 134 + 20 / 60, area: '兵庫・鳥取・岡山' },
    { lat: 36, lon: 136, area: '京都・大阪・福井・滋賀・三重・奈良・和歌山' },
    { lat: 36, lon: 137 + 10 / 60, area: '石川・富山・岐阜・愛知' },
    { lat: 36, lon: 138.5, area: '新潟・長野・山梨・静岡' },
    { lat: 36, lon: 139 + 50 / 60, area: '東京（島しょ部の一部を除く）・福島・栃木・茨城・埼玉・千葉・群馬・神奈川' },
    { lat: 40, lon: 140 + 50 / 60, area: '青森・秋田・山形・岩手・宮城' },
    { lat: 44, lon: 140.25, area: '北海道（小樽・函館・後志・渡島・檜山など道南）' },
    { lat: 44, lon: 142.25, area: '北海道（XI・XIII系以外）' },
    { lat: 44, lon: 144.25, area: '北海道（北見・帯広・釧路・網走・根室など道東）' },
    { lat: 26, lon: 142, area: '東京都の小笠原諸島など' },
    { lat: 26, lon: 127.5, area: '沖縄県（東経126°〜130°）' },
    { lat: 26, lon: 124, area: '沖縄県（東経126°より西）' },
    { lat: 26, lon: 131, area: '沖縄県（東経130°より東）' },
    { lat: 20, lon: 136, area: '東京都の沖ノ鳥島' },
    { lat: 26, lon: 154, area: '東京都の南鳥島' },
];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX'];

/**
 * 緯度・経度（度、GRS80）→ 平面直角座標（m）。X＝北、Y＝東。
 * 国土地理院の換算式（Krüger 級数、n の5次まで）による。
 */
function latLonToJprcs(latDeg, lonDeg, zoneNo) {
    const z = JPRCS_ZONES[zoneNo];
    if(!z) throw new Error('系番号が正しくありません: ' + zoneNo);
    const a = 6378137, F = 298.257222101, m0 = 0.9999;
    const n = 1 / (2 * F - 1);
    const n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n;
    const rad = Math.PI / 180;
    const phi = latDeg * rad, lam = lonDeg * rad, phi0 = z.lat * rad, lam0 = z.lon * rad;
    const A = [
        1 + n2 / 4 + n4 / 64,
        -1.5 * (n - n3 / 8 - n5 / 64),
        (15 / 16) * (n2 - n4 / 4),
        -(35 / 48) * (n3 - (5 / 16) * n5),
        (315 / 512) * n4,
        -(693 / 1280) * n5,
    ];
    const alpha = [
        0,
        n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4 - (127 / 288) * n5,
        (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4 + (281 / 630) * n5,
        (61 / 240) * n3 - (103 / 140) * n4 + (15061 / 26880) * n5,
        (49561 / 161280) * n4 - (179 / 168) * n5,
        (34729 / 80640) * n5,
    ];
    const Abar = (m0 * a / (1 + n)) * A[0];
    let S = A[0] * phi0;
    for(let j = 1; j <= 5; j++) S += A[j] * Math.sin(2 * j * phi0);
    const Sbar = (m0 * a / (1 + n)) * S;
    const k = 2 * Math.sqrt(n) / (1 + n);
    const sinPhi = Math.sin(phi);
    const t = Math.sinh(Math.atanh(sinPhi) - k * Math.atanh(k * sinPhi));
    const tbar = Math.sqrt(1 + t * t);
    const lc = Math.cos(lam - lam0), ls = Math.sin(lam - lam0);
    const xi = Math.atan(t / lc);
    const eta = Math.atanh(ls / tbar);
    let x = xi, y = eta;
    for(let j = 1; j <= 5; j++) {
        x += alpha[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
        y += alpha[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    return { X: Abar * x - Sbar, Y: Abar * y };
}
/**
 * 平面直角座標（m。X＝北、Y＝東）→ 緯度・経度（度、GRS80）。latLonToJprcs の逆。
 * 国土地理院の換算式（Krüger 級数の逆。β は n の5次、δ は n の6次まで）による。
 */
function jprcsToLatLon(X, Y, zoneNo) {
    const z = JPRCS_ZONES[zoneNo];
    if(!z) throw new Error('系番号が正しくありません: ' + zoneNo);
    const a = 6378137, F = 298.257222101, m0 = 0.9999;
    const n = 1 / (2 * F - 1);
    const n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
    const rad = Math.PI / 180;
    const phi0 = z.lat * rad, lam0 = z.lon * rad;
    const A = [
        1 + n2 / 4 + n4 / 64,
        -1.5 * (n - n3 / 8 - n5 / 64),
        (15 / 16) * (n2 - n4 / 4),
        -(35 / 48) * (n3 - (5 / 16) * n5),
        (315 / 512) * n4,
        -(693 / 1280) * n5,
    ];
    const beta = [
        0,
        n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4 - (81 / 512) * n5,
        (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4 + (46 / 105) * n5,
        (17 / 480) * n3 - (37 / 840) * n4 - (209 / 4480) * n5,
        (4397 / 161280) * n4 - (11 / 504) * n5,
        (4583 / 161280) * n5,
    ];
    const delta = [
        0,
        2 * n - (2 / 3) * n2 - 2 * n3 + (116 / 45) * n4 + (26 / 45) * n5 - (2854 / 675) * n6,
        (7 / 3) * n2 - (8 / 5) * n3 - (227 / 45) * n4 + (2704 / 315) * n5 + (2323 / 945) * n6,
        (56 / 15) * n3 - (136 / 35) * n4 - (1262 / 105) * n5 + (73814 / 2835) * n6,
        (4279 / 630) * n4 - (332 / 35) * n5 - (399572 / 14175) * n6,
        (4174 / 315) * n5 - (144838 / 6237) * n6,
        (601676 / 22275) * n6,
    ];
    const Abar = (m0 * a / (1 + n)) * A[0];
    let S = A[0] * phi0;
    for(let j = 1; j <= 5; j++) S += A[j] * Math.sin(2 * j * phi0);
    const Sbar = (m0 * a / (1 + n)) * S;
    const xi = (X + Sbar) / Abar, eta = Y / Abar;
    let xi2 = xi, eta2 = eta;
    for(let j = 1; j <= 5; j++) {
        xi2 -= beta[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
        eta2 -= beta[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const chi = Math.asin(Math.sin(xi2) / Math.cosh(eta2));
    let phi = chi;
    for(let j = 1; j <= 6; j++) phi += delta[j] * Math.sin(2 * j * chi);
    const lam = lam0 + Math.atan(Math.sinh(eta2) / Math.cos(xi2));
    return { lat: phi / rad, lon: lam / rad };
}
// 緯度・経度に最も近い原点の系（目安。系の境界は都府県単位なので、最終的には利用者が選ぶ）
function guessJprcsZone(latDeg, lonDeg) {
    let best = 9, bestD = Infinity;
    for(let i = 1; i < JPRCS_ZONES.length; i++) {
        const z = JPRCS_ZONES[i];
        const d = Math.hypot((z.lat - latDeg) * 1.2, (z.lon - lonDeg) * Math.cos(latDeg * Math.PI / 180));
        if(d < bestD) { bestD = d; best = i; }
    }
    return best;
}
function getGnssZone() {
    try { const v = parseInt(localStorage.getItem('cad_gnss_zone'), 10); return (v >= 1 && v <= 19) ? v : null; } catch { return null; }
}

const _gnss = { on: false, watchId: null, fix: null, follow: false, centered: false, pendingStart: false, lastLatLon: null };

window.showGnssZonePanel = function(startAfter) {
    _gnss.pendingStart = !!startAfter;
    const cur = getGnssZone();
    const guess = _gnss.lastLatLon ? guessJprcsZone(_gnss.lastLatLon.lat, _gnss.lastLatLon.lon) : null;
    let html = `<div style="font-size:11px;color:#aaa;margin-bottom:8px;">図面の座標がどの系（平面直角座標系）で作られているかを選んでください。${guess ? `<br>現在地からの推定: <b style="color:#528bff;">${ROMAN[guess]}系</b>` : ''}</div>
        <div style="display:flex;flex-direction:column;gap:4px;max-height:52vh;overflow:auto;">`;
    for(let i = 1; i < JPRCS_ZONES.length; i++) {
        const on = i === cur;
        html += `<button class="prop-btn btn-sub" onclick="setGnssZone(${i})" style="text-align:left;display:flex;gap:8px;align-items:center;${on ? 'border-color:#528bff;color:#528bff;' : ''}">
            <b style="min-width:44px;">${ROMAN[i]}系</b><span style="font-size:11px;font-weight:400;color:#bbb;">${JPRCS_ZONES[i].area}</span></button>`;
    }
    html += '</div>';
    showPropertyPanel('🛰 系番号の選択', html);
};
window.setGnssZone = function(no) {
    try { localStorage.setItem('cad_gnss_zone', String(no)); } catch { /* 保存できなくても続行 */ }
    addCommandLog(`-> GNSSの座標系: ${ROMAN[no]}系`);
    const pp = document.getElementById('property-panel'); if(pp) pp.style.display = 'none';
    if(_gnss.fix && _gnss.lastLatLon) _applyGnssFix(_gnss.lastLatLon); // 系を変えたら現在地を計算し直す
    if(typeof render === 'function') render(); // 背景の地図も系番号で位置が変わる
    if(_gnss.pendingStart) { _gnss.pendingStart = false; startGnss(); }
};

function _gnssBar() {
    let bar = document.getElementById('gnss-bar');
    if(!bar) {
        bar = document.createElement('div');
        bar.id = 'gnss-bar';
        bar.className = 'glass-panel';
        bar.setAttribute('role', 'status');
        bar.innerHTML = '<span id="gnss-text">🛰 測位中…</span>' +
            '<button type="button" class="gnss-btn" onclick="centerOnGnss()">中心へ</button>' +
            '<button type="button" class="gnss-btn" id="gnss-follow-btn" onclick="toggleGnssFollow()">追従</button>' +
            '<button type="button" class="gnss-btn" onclick="addPointAtGnss()">＋点</button>' +
            '<button type="button" class="gnss-btn gnss-x" onclick="stopGnss()" aria-label="現在地の表示を終了">✕</button>';
        document.body.appendChild(bar);
    }
    return bar;
}
function _setGnssText(t) { const el = document.getElementById('gnss-text'); if(el) el.textContent = t; }

window.toggleGnss = function() {
    if(_gnss.on) { window.stopGnss(); return; }
    if(!getGnssZone()) { window.showGnssZonePanel(true); return; }
    startGnss();
};
function startGnss() {
    if(!navigator.geolocation) {
        if(typeof showToast === 'function') showToast('この端末・ブラウザでは位置情報を使えません', 4000);
        return;
    }
    _gnss.on = true; _gnss.centered = false;
    _gnssBar().style.display = 'flex';
    _setGnssText(`🛰 測位中…（${ROMAN[getGnssZone()]}系）`);
    _gnss.watchId = navigator.geolocation.watchPosition(_onGnssPosition, _onGnssError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
    addCommandLog(`-> 現在地の表示を開始（${ROMAN[getGnssZone()]}系）`);
}
window.stopGnss = function() {
    if(_gnss.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(_gnss.watchId);
    _gnss.on = false; _gnss.watchId = null; _gnss.fix = null; _gnss.follow = false;
    const bar = document.getElementById('gnss-bar'); if(bar) bar.style.display = 'none';
    renderOverlay();
    if(typeof stakeOnGnss === 'function') stakeOnGnss();
    addCommandLog('-> 現在地の表示を終了');
};
function _applyGnssFix(ll) {
    const zone = getGnssZone();
    if(!zone) return null;
    const p = latLonToJprcs(ll.lat, ll.lon, zone);
    const w = surveyToWcs(p.X, p.Y);
    _gnss.fix = { x: w.x, y: w.y, X: p.X, Y: p.Y, acc: ll.acc, accU: ll.acc * surveyUnitFactor(), time: ll.time };
    _setGnssText(`🛰 ±${ll.acc < 10 ? ll.acc.toFixed(1) : Math.round(ll.acc)}m  X ${formatSurveyNumber(p.X)}  Y ${formatSurveyNumber(p.Y)}`);
    return _gnss.fix;
}
function _onGnssPosition(pos) {
    const c = pos.coords;
    _gnss.lastLatLon = { lat: c.latitude, lon: c.longitude, acc: c.accuracy || 0, time: pos.timestamp || Date.now() };
    const fix = _applyGnssFix(_gnss.lastLatLon);
    if(!fix) return;
    if(typeof stakeOnGnss === 'function') stakeOnGnss(); // 杭打ちナビ（現在地から）
    if(!_gnss.centered) {
        _gnss.centered = true;
        window.centerOnGnss();
        // 図面から大きく離れていれば、系番号や単位の設定違いの可能性を知らせる
        const bb = _drawingExtents();
        if(bb) {
            const span = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY, 100 * surveyUnitFactor());
            const dx = Math.max(bb.minX - fix.x, 0, fix.x - bb.maxX), dy = Math.max(bb.minY - fix.y, 0, fix.y - bb.maxY);
            if(Math.hypot(dx, dy) > span * 3) {
                const guess = guessJprcsZone(c.latitude, c.longitude);
                const hint = guess !== getGnssZone() ? `（現在地からの推定は${ROMAN[guess]}系）` : '';
                if(typeof showToast === 'function') showToast(`現在地が図面から大きく離れています。\n系番号${hint}や単位の設定を確認してください`, 6000);
            }
        }
        return;
    }
    if(_gnss.follow) window.centerOnGnss(); else renderOverlay();
}
function _onGnssError(err) {
    const msg = err && err.code === 1 ? '位置情報の利用が許可されていません。ブラウザ（またはOS）の設定で、このサイトの位置情報を許可してください'
        : err && err.code === 3 ? '位置の取得に時間がかかっています。空の見える場所で待つか、もう一度お試しください'
        : '現在地を取得できません。電波の状況や位置情報の設定を確認してください';
    if(typeof showToast === 'function') showToast(msg, 6000);
    addCommandLog('注意: ' + msg);
    if(err && err.code === 1) window.stopGnss();
}
function _drawingExtents() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    entities.forEach(e => {
        if(!e || e.type === 'DIMENSION') return;
        const b = e.bbox || (e.type !== 'HATCH' ? (e.bbox = calcBBox(e)) : null);
        if(!b || !isFinite(b.minX)) return;
        if(b.minX < minX) minX = b.minX; if(b.minY < minY) minY = b.minY; if(b.maxX > maxX) maxX = b.maxX; if(b.maxY > maxY) maxY = b.maxY;
    });
    return minX === Infinity ? null : { minX, minY, maxX, maxY };
}
window.centerOnGnss = function() {
    const f = _gnss.fix;
    if(!f) { if(typeof showToast === 'function') showToast('まだ現在地を取得していません', 2500); return; }
    const s = wcsToScreen(f.x, f.y);
    view.x += canvas.width / 2 - s.x; view.y += canvas.height / 2 - s.y;
    render();
};
window.toggleGnssFollow = function() {
    _gnss.follow = !_gnss.follow;
    const b = document.getElementById('gnss-follow-btn');
    if(b) b.classList.toggle('on', _gnss.follow);
    if(_gnss.follow) window.centerOnGnss();
};
window.addPointAtGnss = function() {
    const f = _gnss.fix;
    if(!f) { if(typeof showToast === 'function') showToast('まだ現在地を取得していません', 2500); return; }
    saveUndo();
    const n = entities.filter(e => e && e.type === 'POINT' && /^GNSS-\d+$/.test(e.name || '')).length + 1;
    const name = 'GNSS-' + n;
    const h = _autoLabelHeight(entities.filter(e => e && e.type === 'POINT').map(e => ({ x: e.x, y: e.y })).concat([{ x: f.x, y: f.y }]));
    const lp = _ensureSurveyLayer(SURVEY_LAYER_POINT, '#ffff00');
    const ll = _ensureSurveyLayer(SURVEY_LAYER_LABEL, '#ffffff');
    makeSurveyPointEntities({ x: f.x, y: f.y, name, num: '', z: null }, h, lp, ll).forEach(e => entities.push(e));
    ensureEntityIds(); _bumpGeomEpoch(); initLayers();
    render();
    addCommandLog(`-> 現在地に点「${name}」を追加 X ${formatSurveyNumber(f.X)} Y ${formatSurveyNumber(f.Y)}（精度 ±${Math.round(f.acc)}m）`);
    if(typeof showToast === 'function') showToast(`点「${name}」を追加しました（精度 ±${Math.round(f.acc)}m）`, 3000);
};

// ===== 重ね表示（現在地の印・一覧で選んだ点の目印） =====
function drawSurveyOverlays() {
    const now = performance.now();
    if(_surveyFlash && now < _surveyFlash.until) {
        const s = wcsToScreen(_surveyFlash.x, _surveyFlash.y);
        const t = 1 - (_surveyFlash.until - now) / 2000;
        ctx.save();
        ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 2; ctx.globalAlpha = 1 - t * 0.6;
        ctx.beginPath(); ctx.arc(s.x, s.y, 14 + 10 * t, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
    }
    const f = _gnss.on ? _gnss.fix : null;
    if(f) {
        const s = wcsToScreen(f.x, f.y);
        const r = f.accU * view.scale;
        ctx.save();
        if(r > 8) {
            ctx.fillStyle = 'rgba(82,139,255,0.15)'; ctx.strokeStyle = 'rgba(82,139,255,0.6)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = '#528bff'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
    }
}

// ===== コマンド =====
function processSurveyCommand(cmd) {
    if(cmd === 'COORDS' || cmd === 'POINTS' || cmd === 'ZAHYO') { window.showCoordListPanel(); return true; }
    if(cmd === 'SIMAOUT' || cmd === 'EXPORTSIMA') { window.exportSima(); return true; }
    if(cmd === 'CSVOUT' || cmd === 'EXPORTCSV') { window.exportCoordCsv(); return true; }
    if(cmd === 'GPS' || cmd === 'GNSS') { window.toggleGnss(); return true; }
    if(cmd === 'GNSSZONE') { window.showGnssZonePanel(false); return true; }
    return false;
}

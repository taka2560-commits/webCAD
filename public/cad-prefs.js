// ===== Web CAD 表示・操作の設定 =====
// cad-prefs.js - ルーペの大きさ・倍率、座標の文字の大きさ・桁数・単位、寸法の文字の大きさ・桁数、
//                長さの単位（m / mm）、スナップの吸着範囲など、見やすさ・操作しやすさの設定（端末ごとに保存）
//
// ・既定値は以前と同じ見た目・動作（変えなければ何も変わらない）
// ・オプション画面の「表示・操作」で切り替える。変えた瞬間に画面へ反映し、ルーペと吸着範囲は見本を出す

const DISPLAY_PREFS_KEY = 'cad_display_prefs';
// 単位の選択肢（「図面どおり」は図面の1単位のまま）
const DISPLAY_UNIT_OPTIONS = [['auto', '図面どおり', null], ['m', 'm', 'm'], ['mm', 'mm', 'mm']];
// 設定の一覧。options は [保存する値, ボタンの文字, 実際に使う値]
const DISPLAY_PREF_DEFS = {
    loupeSize:     { label: 'ルーペの大きさ', def: 'm',   options: [['s', '小', 55], ['m', '中', 70], ['l', '大', 90], ['xl', '特大', 115]] },
    loupeZoom:     { label: 'ルーペの倍率',   def: '3',   options: [['2', '2倍', 2], ['3', '3倍', 3], ['4', '4倍', 4], ['6', '6倍', 6]] },
    coordFont:     { label: '座標の文字',     def: 'm',   options: [['s', '小', 0.85], ['m', '中', 1], ['l', '大', 1.3], ['xl', '特大', 1.6]] },
    coordDecimals: { label: '座標の桁',       def: 'std', options: [['std', '標準', null], ['0', '1', 0], ['1', '0.1', 1], ['2', '0.01', 2], ['3', '0.001', 3]] },
    coordUnit:     { label: '座標の単位',     def: 'auto', options: DISPLAY_UNIT_OPTIONS },
    dimText:       { label: '寸法の文字',     def: 'm',   options: [['s', '小', 0.8], ['m', '中', 1], ['l', '大', 1.3], ['xl', '特大', 1.6]] },
    dimDecimals:   { label: '寸法の桁',       def: 'auto', options: [['auto', '自動', null], ['0', '1', 0], ['1', '0.1', 1], ['2', '0.01', 2], ['3', '0.001', 3]] },
    lenUnit:       { label: '長さの単位',     def: 'auto', options: DISPLAY_UNIT_OPTIONS },
    snapRange:     { label: '吸着の範囲',     def: 'm',   options: [['s', '狭い', 0.6], ['m', '標準', 1], ['l', '広い', 1.6], ['xl', '最大', 2.4]] },
};

// 保存されている設定を読む（壊れた値・知らない値は無視して既定値を使う）
function _loadDisplayPrefs() {
    try {
        const v = JSON.parse(localStorage.getItem(DISPLAY_PREFS_KEY) || '{}');
        return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    } catch { return {}; }
}
let _displayPrefs = _loadDisplayPrefs();

function _saveDisplayPrefs() {
    try { localStorage.setItem(DISPLAY_PREFS_KEY, JSON.stringify(_displayPrefs)); } catch { /* 保存できなくても今回の表示には反映する */ }
}

// いま選ばれている選択肢（保存値）。不正な値なら既定値
function displayPrefKey(name) {
    const d = DISPLAY_PREF_DEFS[name];
    if(!d) return undefined;
    const k = _displayPrefs[name];
    return d.options.some(o => o[0] === k) ? k : d.def;
}
// 設定の実際の値（ルーペの半径px、倍率、文字の倍率など）
function displayPref(name) {
    const d = DISPLAY_PREF_DEFS[name];
    if(!d) return undefined;
    const k = displayPrefKey(name);
    const o = d.options.find(x => x[0] === k);
    return o ? o[2] : undefined;
}

// ===== 表示の単位（m / mm） =====
// 図面の値は図面の1単位（オプションの測量の欄: 1m か 1mm）で持っている。
// 座標・長さの単位を選ぶと、表示するときに換算し、入力された数は図面の単位へ戻す。
// kind: 'coord'（座標）/ 'len'（長さ: 寸法・測定・半径・距離・間隔など）。「図面どおり」なら換算しない
function drawingUnit() { return (typeof getSurveyUnit === 'function' && getSurveyUnit() === 'mm') ? 'mm' : 'm'; }
function _unitPrefName(kind) { return kind === 'coord' ? 'coordUnit' : 'lenUnit'; }
// 選んだ単位（「図面どおり」なら null）
function displayUnitChosen(kind) { const u = displayPref(_unitPrefName(kind)); return (u === 'm' || u === 'mm') ? u : null; }
// 表示する単位（'m' / 'mm'）
function displayUnit(kind) { return displayUnitChosen(kind) || drawingUnit(); }
// 図面の値 × この倍率 ＝ 表示の値
function displayUnitScale(kind) {
    const d = drawingUnit(), u = displayUnit(kind);
    return d === u ? 1 : (d === 'm' ? 1000 : 0.001);
}
function toDisplayUnit(v, kind) { return v * displayUnitScale(kind); }
// 入力された数（表示の単位）→ 図面の値。0.3 m → 300 mm のような換算の端数（300.00000000000006）は消す
function fromDisplayUnit(v, kind) { const s = displayUnitScale(kind); return s === 1 ? v : +(v / s).toPrecision(12); }
// 入力欄に入れる数の文字（図面の値を表示の単位で）
function displayUnitNum(v, kind) {
    if(typeof v !== 'number' || !isFinite(v)) return '';
    const s = displayUnitScale(kind);
    return String(s === 1 ? v : +(v * s).toPrecision(12));
}
// 入力欄の見出しに付ける単位（「図面どおり」なら何も付けない＝以前と同じ）
function displayUnitTag(kind) { const u = displayUnitChosen(kind); return u ? `(${u})` : ''; }

// 寸法・長さの数の文字（x は表示の単位の値）。桁はオプション「寸法の桁」。
// 「自動」は小数3桁まで（末尾の0は省く）。単位に mm を選んだときは整数（m の小数3桁と同じ細かさ）
function formatDimNumber(x, unitChosen) {
    if(typeof x !== 'number' || !isFinite(x)) return '';
    const d = displayPref('dimDecimals');
    if(d !== null && d !== undefined) { const s = x.toFixed(d); return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s; }
    const r = (unitChosen === 'mm') ? Math.round(x) : Math.round(x * 1000) / 1000;
    return String(Object.is(r, -0) ? 0 : r);
}
// 長さの文字（コマンドの記録・案内用）。単位を選んでいるときは単位も付ける
function lengthText(v) { return formatDimNumber(toDisplayUnit(v, 'len'), displayUnitChosen('len')) + (displayUnitChosen('len') || ''); }

// ===== 座標の表示 =====
// where: 'bar'（ステータスバー・全画面の座標） / 'loupe'（ルーペ・コマンドの記録）
// 「標準」は以前と同じ桁数（ステータスバーなどは整数、ルーペは小数2桁。座標の単位に mm を選んだときはルーペも整数）
function formatCoordValue(v, where) {
    if(typeof v !== 'number' || !isFinite(v)) return '';
    let d = displayPref('coordDecimals');
    if(d === null || d === undefined) d = (where === 'loupe' && displayUnitChosen('coord') !== 'mm') ? 2 : 0;
    return toDisplayUnit(v, 'coord').toFixed(d);
}
// 図面の点を、コマンドの記録の「東,北」（UCS の x,y。以前の記録と同じ並び）の文字にする
function coordLogText(wcs) {
    const u = wcsToUcs(wcs.x, wcs.y);
    return formatCoordValue(u.x, 'loupe') + ',' + formatCoordValue(u.y, 'loupe');
}
// ステータスバーに座標を出す（測量の並び: X＝北＝UCSのy、Y＝東＝UCSのx）。
// X と Y を別の枠に入れ、幅が足りないときは CSS で2段（X が上）に折り返す
let _coordSpanX = null, _coordSpanY = null;
function setCoordsDisplay(ucsX, ucsY) {
    if(typeof coordsDisplay === 'undefined' || !coordsDisplay) return;
    if(!_coordSpanX || !coordsDisplay.contains(_coordSpanX)) {
        coordsDisplay.textContent = '';
        _coordSpanX = document.createElement('span'); _coordSpanX.className = 'coord-x';
        _coordSpanY = document.createElement('span'); _coordSpanY.className = 'coord-y';
        coordsDisplay.append(_coordSpanX, _coordSpanY);
    }
    _coordSpanX.textContent = 'X:' + formatCoordValue(ucsY, 'bar');
    _coordSpanY.textContent = 'Y:' + formatCoordValue(ucsX, 'bar');
}
// 設定を変えたとき、今の位置の座標をすぐ新しい桁数で出し直す
function refreshCoordDisplay() {
    const p = snapActive() ? wcsToUcs(snapResult.wcsX, snapResult.wcsY) : { x: mouse.ucsX, y: mouse.ucsY };
    setCoordsDisplay(p.x, p.y);
}

// ===== 寸法・スナップ =====
// 寸法・測定の文字と矢印の大きさ（画面上のpx）
function dimSizePx(basePx) { return Math.max(1, Math.round(basePx * (displayPref('dimText') || 1))); }
// スナップが吸い付く範囲（画面上の半径px）。タッチ操作は指の位置精度が低いため少し広げる
function snapRadiusPx() {
    const base = (typeof isMobile === 'function' && isMobile()) ? SNAP_R * 1.4 : SNAP_R;
    return base * (displayPref('snapRange') || 1);
}

// 図形を押して選べる範囲（画面上の半径px）。指はマウスより位置がずれるので広げる
function hitRadiusPx() { return (typeof isMobile === 'function' && isMobile()) ? 12 : ERASE_R; }

// ===== 反映 =====
// 座標の文字の大きさは CSS 変数（--coord-scale）で、ステータスバー・全画面の座標表示に効かせる
function applyDisplayPrefs() {
    const root = document.documentElement;
    if(root && root.style) root.style.setProperty('--coord-scale', String(displayPref('coordFont') || 1));
}
applyDisplayPrefs(); // 最初の表示から設定どおりの大きさにする

window.setDisplayPref = function(name, key) {
    const d = DISPLAY_PREF_DEFS[name];
    if(!d || !d.options.some(o => o[0] === key)) return;
    _displayPrefs[name] = key;
    _saveDisplayPrefs();
    applyDisplayPrefs();
    document.querySelectorAll(`.opt-pref-btn[data-pref="${name}"]`).forEach(b => b.classList.toggle('active', b.dataset.key === key));
    if(name === 'coordDecimals' || name === 'coordFont' || name === 'coordUnit') refreshCoordDisplay();
    if(name === 'dimDecimals' || name === 'coordUnit' || name === 'lenUnit') _refreshShownValues(); // 寸法の文字・プロパティの数を描き直す
    if(name === 'coordUnit' || name === 'lenUnit') _updateUnitNote();
    if(name === 'loupeSize' || name === 'loupeZoom') showPrefPreview('loupe');
    else if(name === 'snapRange') showPrefPreview('snap');
    if(typeof render === 'function') render();
};
// 単位・桁を変えたとき: 寸法の文字（図形の描画の控え）と、右のプロパティ欄の数を今の設定で出し直す
function _refreshShownValues() {
    if(typeof _bumpGeomEpoch === 'function') _bumpGeomEpoch();
    if(typeof updatePropertiesPanel === 'function') updatePropertiesPanel();
}

window.resetDisplayPrefs = function() {
    _displayPrefs = {};
    _saveDisplayPrefs();
    applyDisplayPrefs();
    document.querySelectorAll('.opt-pref-btn').forEach(b => b.classList.toggle('active', b.dataset.key === DISPLAY_PREF_DEFS[b.dataset.pref].def));
    refreshCoordDisplay();
    _refreshShownValues();
    _updateUnitNote();
    if(typeof showToast === 'function') showToast('表示・操作の設定を初期値に戻しました');
    if(typeof render === 'function') render();
};

// オプション画面の「表示・操作」欄
function displayPrefsSectionHtml() {
    const rows = Object.keys(DISPLAY_PREF_DEFS).map(name => {
        const d = DISPLAY_PREF_DEFS[name], cur = displayPrefKey(name);
        const btns = d.options.map(o =>
            `<button class="prop-btn opt-bg-btn opt-pref-btn ${o[0] === cur ? 'active' : ''}" data-pref="${name}" data-key="${o[0]}" onclick="setDisplayPref('${name}','${o[0]}')">${o[1]}</button>`
        ).join('');
        return `<div class="opt-pref-row"><span class="opt-pref-label">${d.label}</span><div class="opt-pref-seg">${btns}</div></div>`;
    }).join('');
    return `
        <div style="border-top:1px solid rgba(255,255,255,0.1); margin-top:10px; padding-top:10px; display:flex; flex-direction:column; gap:8px;">
            <div style="font-size:11px;color:#aaa;font-weight:700;">表示・操作（この端末に保存）</div>
            ${rows}
            <div id="opt-unit-note" style="color:#888;font-size:10px;">${_unitNoteText()}</div>
            <div style="color:#888;font-size:10px;">座標の桁「標準」は、ステータスバーが整数・ルーペが小数2桁です。寸法の桁「自動」は小数3桁まで（末尾の0は省く。長さの単位に mm を選んだときは整数）です</div>
            <button class="prop-btn btn-sub" onclick="resetDisplayPrefs()">表示・操作を初期値に戻す</button>
        </div>`;
}
// 単位の説明（いまの図面の単位と、選んだ単位で何が変わるか）
function _unitNoteText() {
    const now = (displayUnitChosen('coord') || displayUnitChosen('len')) ? `（いまは 座標 ${displayUnit('coord')}・長さ ${displayUnit('len')}）` : '';
    return `単位「図面どおり」は、図面の1単位（下の測量の欄。いまは 1${drawingUnit()}）のままです。` +
        `m・mm を選ぶと、座標・寸法・測定・半径・距離などの表示と入力をその単位にします${now}。測量計算・杭打ち・SIMA は m のままです`;
}
function _updateUnitNote() {
    const el = document.getElementById('opt-unit-note');
    if(el) el.textContent = _unitNoteText();
}

// ===== 見本の表示（ルーペ・吸着範囲） =====
// 設定を変えた直後に1.6秒だけ見本を出す。オプション画面に隠れない場所を選び、
// 隠れてしまう場合（スマホなど）はその間だけ画面を透かして見えるようにする。
const PREF_PREVIEW_MS = 1600;
let _prefPreview = null;        // { kind: 'loupe' | 'snap', until }
let _prefPreviewTimer = null;

function showPrefPreview(kind) {
    _prefPreview = { kind, until: performance.now() + PREF_PREVIEW_MS };
    const panel = document.getElementById('property-panel');
    const size = _prefPreviewSize(kind);
    const a = _previewAnchor(size.w, size.h);
    if(panel && a.covered) panel.style.opacity = '0.15'; // 見本がパネルに隠れるときは透かす
    clearTimeout(_prefPreviewTimer);
    _prefPreviewTimer = setTimeout(() => {
        _prefPreview = null;
        if(panel) panel.style.opacity = '';
        if(typeof renderOverlay === 'function') renderOverlay();
    }, PREF_PREVIEW_MS);
    if(typeof renderOverlay === 'function') renderOverlay();
}

function _prefPreviewSize(kind) {
    if(kind === 'loupe') { const r = displayPref('loupeSize') || 70; return { w: r * 2 + 16, h: r * 2 + 56 }; }
    const rad = snapRadiusPx(); return { w: Math.max(rad * 2, 120) + 16, h: rad * 2 + 44 };
}

// 見本を置く場所: オプション画面の上下左右・画面中央のうち、パネルと重なる面積が一番小さい所
function _previewAnchor(w, h) {
    const W = canvas.width, H = canvas.height;
    const center = { x: W / 2, y: H / 2, covered: false };
    const panel = document.getElementById('property-panel');
    if(!panel || panel.style.display === 'none') return center;
    const cr = canvas.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    const r = { left: pr.left - cr.left, right: pr.right - cr.left, top: pr.top - cr.top, bottom: pr.bottom - cr.top };
    const clampX = (x) => Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, x));
    const clampY = (y) => Math.max(h / 2 + 4, Math.min(H - h / 2 - 4, y));
    const overlap = (c) => {
        const ox = Math.max(0, Math.min(c.x + w / 2, r.right) - Math.max(c.x - w / 2, r.left));
        const oy = Math.max(0, Math.min(c.y + h / 2, r.bottom) - Math.max(c.y - h / 2, r.top));
        return ox * oy;
    };
    const cands = [
        { x: W / 2, y: r.bottom + h / 2 + 8 }, { x: W / 2, y: r.top - h / 2 - 8 },
        { x: r.left - w / 2 - 8, y: H / 2 }, { x: r.right + w / 2 + 8, y: H / 2 }, { x: W / 2, y: H / 2 },
    ].map(c => ({ x: clampX(c.x), y: clampY(c.y) }));
    let best = cands[0], bestO = overlap(best);
    for(const c of cands) { const o = overlap(c); if(o < bestO) { best = c; bestO = o; } }
    // 見本の4分の1以上が隠れるなら、画面中央に出してパネルを透かす
    if(bestO > w * h * 0.25) return { x: W / 2, y: H / 2, covered: true };
    return { x: best.x, y: best.y, covered: false };
}

// _drawFrame から毎フレーム呼ばれる（重ね表示）
function drawPrefPreview() {
    if(!_prefPreview) return;
    if(performance.now() > _prefPreview.until) { _prefPreview = null; return; }
    const size = _prefPreviewSize(_prefPreview.kind);
    const a = _previewAnchor(size.w, size.h);
    if(_prefPreview.kind === 'loupe') {
        // 画面中央の図形を、いまの大きさ・倍率のルーペで拡大して見せる
        if(typeof _drawLoupeAt === 'function') _drawLoupeAt(canvas.width / 2, canvas.height / 2, { x: a.x, y: a.y - 20 });
        return;
    }
    // 吸着範囲: この円の中にある点へスナップが吸い付く
    const rad = snapRadiusPx();
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(a.x - size.w / 2, a.y - size.h / 2, size.w, size.h);
    ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(a.x, a.y - 8, rad, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(a.x - 5, a.y - 8); ctx.lineTo(a.x + 5, a.y - 8); ctx.moveTo(a.x, a.y - 13); ctx.lineTo(a.x, a.y - 3); ctx.stroke();
    ctx.fillStyle = '#00ff00'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('この円の中の点に吸着', a.x, a.y + size.h / 2 - 8);
    ctx.restore();
}

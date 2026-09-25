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
    angleFormat:   { label: '角度の表示',     def: 'deg', options: [['deg', '度', 'deg'], ['dms', '度分秒', 'dms']] },
    snapRange:     { label: '吸着の範囲',     def: 'm',   options: [['s', '狭い', 0.6], ['m', '標準', 1], ['l', '広い', 1.6], ['xl', '最大', 2.4]] },
    btnSize:       { label: 'ボタンの大きさ', def: 'm',   options: [['s', '小', 0.85], ['m', '中', 1], ['l', '大', 1.25], ['xl', '特大', 1.5]] },
    outdoor:       { label: '屋外モード',     def: 'off', options: [['off', '切', false], ['on', '入', true]] },
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

// 寸法・長さの数の文字（x は表示の単位の値、unit はその単位 'm' / 'mm'）。桁はオプション「寸法の桁」。
// 「自動」は m なら小数3桁まで（末尾の0は省く）、mm なら整数。どちらも 1mm の細かさ
// （以前は mm の図面でも小数3桁まで出し、座標寸法が「29510.405」のように 0.001mm まで出ていた）
function formatDimNumber(x, unit) {
    if(typeof x !== 'number' || !isFinite(x)) return '';
    const d = displayPref('dimDecimals');
    if(d !== null && d !== undefined) { const s = x.toFixed(d); return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s; }
    const r = (unit === 'mm') ? Math.round(x) : Math.round(x * 1000) / 1000;
    return String(Object.is(r, -0) ? 0 : r);
}
// 長さの文字（コマンドの記録・案内用）。単位を選んでいるときは単位も付ける
function lengthText(v) { return formatDimNumber(toDisplayUnit(v, 'len'), displayUnit('len')) + (displayUnitChosen('len') || ''); }

// 単位を m ⇔ mm に切り替える（お気に入りのボタン・コマンド UNIT / CUNIT）。
// 図面の1単位と同じ単位に戻すときは「図面どおり」にする（2回押すと元の設定に戻る）
window.toggleDisplayUnit = function(kind) {
    const k = (kind === 'coord') ? 'coord' : 'len';
    const next = displayUnit(k) === 'mm' ? 'm' : 'mm';
    setDisplayPref(_unitPrefName(k), next === drawingUnit() ? 'auto' : next);
    const name = (k === 'coord') ? '座標' : '長さ';
    if(typeof addCommandLog === 'function') addCommandLog(`-> ${name}の単位: ${next}`);
    if(typeof showToast === 'function') showToast(`${name}の単位: ${next}`, 1800);
    if(navigator.vibrate) navigator.vibrate(15);
};

// ===== 角度の表示（度 / 度分秒） =====
// 角度寸法・回転などの記録・UCS の角度に使う。測量計算・杭打ちの方向角・夾角は、これまでどおり度分秒
function angleIsDms() { return displayPrefKey('angleFormat') === 'dms'; }
// 度 → 「45°30′15″」（秒は整数。マイナスは左回り）
function formatDmsAngle(deg) {
    if(typeof deg !== 'number' || !isFinite(deg)) return '';
    let u = Math.round(Math.abs(deg) * 3600); // 秒の整数で数える（59.6″ → 1′00″ の繰り上がりを間違えない）
    const sign = (deg < 0 && u > 0) ? '-' : '';
    const D = Math.floor(u / 3600); u -= D * 3600;
    const M = Math.floor(u / 60), S = u - M * 60;
    return `${sign}${D}°${String(M).padStart(2, '0')}′${String(S).padStart(2, '0')}″`;
}
// 角度の文字（コマンドの記録など）。度は小数4桁まで（末尾の0は省く）
function angleText(deg) {
    if(typeof deg !== 'number' || !isFinite(deg)) return '';
    return angleIsDms() ? formatDmsAngle(deg) : String(+deg.toFixed(4)) + '°';
}
// 角度の入力: 「45.5」（度）または「45 30 15」「45-30-15」「45°30′15″」（度 分 秒）。全角でもよい。先頭の - は左回り
function parseAngleInput(text) {
    let s = (typeof cogoHalfWidth === 'function') ? cogoHalfWidth(text) : String(text === undefined || text === null ? '' : text);
    s = s.trim();
    let sign = 1;
    if(s.charAt(0) === '-') { sign = -1; s = s.slice(1).trim(); }
    const v = (typeof parseAzimuth === 'function') ? parseAzimuth(s) : parseFloat(s);
    return sign * v;
}

// ===== 座標の表示 =====
// where: 'bar'（ステータスバー・全画面の座標） / 'loupe'（ルーペ・コマンドの記録）
// 「標準」はステータスバーなどは整数、ルーペは m なら小数2桁、mm なら整数（mm の図面で 0.01mm まで出さない）
function formatCoordValue(v, where) {
    if(typeof v !== 'number' || !isFinite(v)) return '';
    let d = displayPref('coordDecimals');
    if(d === null || d === undefined) d = (where === 'loupe' && displayUnit('coord') !== 'mm') ? 2 : 0;
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

// ===== 屋外モード（日なたでも見やすく） =====
// 図形・寸法の線を太く、文字を太字にして背景色で縁取り、背景に対して色の明るさの差を広げる。
// 画面の部品（パネル・バー）は不透明にして文字を明るく・太くする（CSS の body.outdoor-mode）
function isOutdoor() { return displayPref('outdoor') === true; }
// 線の太さ（画面のpx）。屋外モードでは k 倍（図形・寸法は2倍、カーソル・スナップの印は1.5倍）
function lineWidthPx(px, k) { return isOutdoor() ? px * (k || 2) : px; }
// 屋外モードの文字の太さ（'bold ' か ''）
function outdoorFontWeight() { return isOutdoor() ? 'bold ' : ''; }
// 屋外モードのとき、文字を背景色で縁取る（線の上や地図の上でも読める）。fillText の前に呼ぶ
function outdoorTextHalo(c, text, x, y, px) {
    if(!isOutdoor()) return;
    const lw = c.lineWidth, ss = c.strokeStyle, lj = c.lineJoin;
    c.lineWidth = Math.max(2, Math.min(6, (px || 12) * 0.22));
    c.strokeStyle = (typeof canvasBg !== 'undefined') ? canvasBg : '#000';
    c.lineJoin = 'round';
    c.strokeText(text, x, y);
    c.lineWidth = lw; c.strokeStyle = ss; c.lineJoin = lj;
}
function _hexRgb(col) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(col || '').trim());
    if(!m) return null;
    let h = m[1];
    if(h.length === 3) h = h.split('').map(x => x + x).join('');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
}
function _rgbHex(c) { return '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function _rgbLum(c) { return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; }
// 屋外モードの色: 背景（黒・グレー・白）との明るさの差が小さい色を、色味を残したまま明るく・暗くする
// （黒の背景の青い線・白の背景の水色の線などが、日なたで見えなくなるのを防ぐ）。#rgb・#rrggbb 以外はそのまま
function outdoorColor(col) {
    if(!isOutdoor()) return col;
    const c = _hexRgb(col);
    if(!c) return col;
    const L = _rgbLum(c), B = (typeof bgLuminance === 'function') ? bgLuminance() : 0;
    let target = null;
    if(B < 0.45) { const min = Math.max(B + 0.45, 0.55); if(L < min) target = min; }          // 暗い背景 → 明るく
    else if(B > 0.6) { const max = Math.min(B - 0.45, 0.45); if(L > max) target = max; }      // 明るい背景 → 暗く
    else if(Math.abs(L - B) < 0.3) target = (L >= B) ? Math.min(1, B + 0.3) : Math.max(0, B - 0.3); // グレー → 離す
    if(target === null) return col;
    if(target > L) { const t = (target - L) / (1 - L); return _rgbHex(c.map(v => v + (255 - v) * t)); } // 白に寄せる
    const k = L > 0 ? target / L : 0;
    return _rgbHex(c.map(v => v * k));                                                                  // 黒に寄せる
}
// 屋外モードを入・切（お気に入りのボタン・コマンド OUTDOOR）
window.toggleOutdoorMode = function() {
    const on = !isOutdoor();
    setDisplayPref('outdoor', on ? 'on' : 'off');
    if(typeof addCommandLog === 'function') addCommandLog(`-> 屋外モード: ${on ? '入' : '切'}`);
    if(typeof showToast === 'function') showToast(`☀ 屋外モード: ${on ? '入（線を太く・文字を濃く）' : '切'}`, 2000);
    if(navigator.vibrate) navigator.vibrate(15);
};

// ===== 反映 =====
// 座標の文字の大きさは CSS 変数（--coord-scale）で、ステータスバー・全画面の座標表示に効かせる。
// ボタンの大きさは CSS 変数（--btn-k）、屋外モードは body の outdoor-mode で画面の部品に効かせる
function applyDisplayPrefs() {
    const root = document.documentElement;
    if(root && root.style) {
        root.style.setProperty('--coord-scale', String(displayPref('coordFont') || 1));
        root.style.setProperty('--btn-k', String(displayPref('btnSize') || 1));
    }
    if(document.body) document.body.classList.toggle('outdoor-mode', isOutdoor());
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
    if(name === 'dimDecimals' || name === 'coordUnit' || name === 'lenUnit' || name === 'angleFormat' || name === 'outdoor') _refreshShownValues(); // 寸法の文字・線・プロパティの数を描き直す
    if(name === 'coordUnit' || name === 'lenUnit') _updateUnitNote();
    if(name === 'btnSize') _relayoutForButtons();
    if(name === 'loupeSize' || name === 'loupeZoom') showPrefPreview('loupe');
    else if(name === 'snapRange') showPrefPreview('snap');
    if(typeof render === 'function') render();
};
// ボタンの大きさを変えたとき: バーの大きさが変わるので、浮かぶパネル・お気に入りのバー・別窓の位置を画面に収め直す
function _relayoutForButtons() {
    try { window.dispatchEvent(new window.Event('resize')); } catch { /* 古いブラウザでは次の画面の変化で合う */ }
}
// 単位・桁を変えたとき: 寸法の文字（図形の描画の控え）と、右のプロパティ欄の数、
// お気に入りのバー（単位の切り替えボタンにいまの単位を出す）を今の設定で出し直す
function _refreshShownValues() {
    if(typeof _bumpGeomEpoch === 'function') _bumpGeomEpoch();
    if(typeof updatePropertiesPanel === 'function') updatePropertiesPanel();
    if(typeof favRenderBar === 'function') favRenderBar();
}

window.resetDisplayPrefs = function() {
    _displayPrefs = {};
    _saveDisplayPrefs();
    applyDisplayPrefs();
    document.querySelectorAll('.opt-pref-btn').forEach(b => b.classList.toggle('active', b.dataset.key === DISPLAY_PREF_DEFS[b.dataset.pref].def));
    refreshCoordDisplay();
    _refreshShownValues();
    _updateUnitNote();
    _relayoutForButtons();
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
            <div style="color:#888;font-size:10px;">座標の桁「標準」は、ステータスバーが整数、ルーペが小数2桁（mm のときは整数）です。寸法の桁「自動」は、m なら小数3桁まで（末尾の0は省く）、mm なら整数です（どちらも 1mm まで）</div>
            <div style="color:#888;font-size:10px;">角度の表示: 度は 45.5°、度分秒は 45°30′00″（角度寸法・回転・UCS。測量計算・杭打ちは、これまでどおり度分秒）</div>
            <div style="color:#888;font-size:10px;">ボタンの大きさ: 上・左・下のバー、選んだときのバー、☑確定のバー、お気に入り、右下の ？・コマンドのボタンを大きくします（手袋のままでも押しやすく）。屋外モード: 図形・寸法の線を太く、文字を太字にして縁取り、背景との明るさの差を広げ、パネルを不透明にします（日なたでは背景色を白にするのも効果があります）</div>
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

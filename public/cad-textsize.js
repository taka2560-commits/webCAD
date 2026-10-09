// ===== Web CAD 文字の大きさ（一括）・点名の大きさ =====
// cad-textsize.js - 文字の高さをまとめて変える（☰「🔠 文字の大きさ」・選んだときのバーの「🔠 文字」・コマンド TEXTSIZE）と、
//   座標一覧で読み込む・置く点の点名の大きさ（自動 / 指定）
//
// ・対象: 選んだ文字 / 画層 / すべて。種類（ふつうの文字・点名・区画名・寸法の値・ブロックの文字）と、今の高さで絞れる
// ・変え方: 高さを指定（表示の単位）か、倍率。↩ で戻せる。点名は、点の右上の位置も新しい大きさに合わせる（動かした点名はそのまま）
// ・アプリで描いた寸法（DIMENSION）の文字は画面の大きさで描くので、オプションの「寸法の文字」で変える（ここでは変えない）
// ・点名の大きさ: 「自動」は点の広がりの 1/50（0.2〜20m）、「指定」は決めた高さ（m で覚える）。
//   SIMA・座標CSV・SDR・TS の取り込み、ヘルマート変換、点のコマンド、測量計算の点の追加に使う

const PT_LABEL_KEY = 'cad_pt_label_h';
const TEXTSIZE_TITLE = '🔠 文字の大きさ';
// 文字の種類（絞り込みの順）
const TEXT_KINDS = [['txt', '文字'], ['pt', '点名'], ['lot', '区画名'], ['dim', '寸法の値'], ['blk', 'ブロックの文字']];

// ===== 点名の大きさ（端末に覚える） =====
function ptLabelSetting() {
    try {
        const v = JSON.parse(localStorage.getItem(PT_LABEL_KEY) || 'null');
        const m = (v && typeof v.m === 'number' && v.m > 0 && isFinite(v.m)) ? v.m : 1;
        return { mode: v && v.mode === 'fix' ? 'fix' : 'auto', m };
    } catch { return { mode: 'auto', m: 1 }; }
}
function _ptLabelSave(s) { try { localStorage.setItem(PT_LABEL_KEY, JSON.stringify({ mode: s.mode, m: s.m })); } catch { /* 覚えられなくても今回は使う */ } }
// 指定の高さ（図面の単位）。「自動」なら null
function ptLabelFixedHeight() {
    const s = ptLabelSetting();
    return s.mode === 'fix' ? s.m * surveyUnitFactor() : null;
}
// 点名の大きさの欄（座標一覧・座標CSV の取り込み）。同じ画面に2つあっても同じ設定を見せる
function ptLabelControlHtml() {
    const s = ptLabelSetting();
    const v = displayUnitNum(s.m * surveyUnitFactor(), 'len');
    const b = (mode, label) => `<button type="button" class="prop-btn opt-bg-btn pl-mode${s.mode === mode ? ' active' : ''}" data-mode="${mode}" aria-pressed="${s.mode === mode}" onclick="ptLabelSetMode('${mode}')">${label}</button>`;
    return `<div class="pl-ctl" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:11px;">点名の大きさ</span>
        <div class="opt-pref-seg" style="flex:0 0 auto;min-width:96px;">${b('auto', '自動')}${b('fix', '指定')}</div>
        <input class="prop-val pl-h" type="text" inputmode="decimal" autocomplete="off" value="${escapeHtml(v)}" style="flex:0 0 96px;width:96px;" ${s.mode === 'fix' ? '' : 'disabled'} aria-label="点名の文字の高さ" onchange="ptLabelSetHeight(this)">
        <span style="font-size:11px;color:#888;">${displayUnitTag('len')}</span>
    </div>`;
}
function _ptLabelRefreshControls() {
    const s = ptLabelSetting();
    document.querySelectorAll('.pl-ctl').forEach((c) => {
        c.querySelectorAll('.pl-mode').forEach((b) => { const on = b.dataset.mode === s.mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
        c.querySelectorAll('.pl-h').forEach((el) => { el.disabled = s.mode !== 'fix'; });
    });
}
window.ptLabelSetMode = function(mode) {
    const s = ptLabelSetting();
    s.mode = mode === 'fix' ? 'fix' : 'auto';
    _ptLabelSave(s);
    _ptLabelRefreshControls();
    addCommandLog(s.mode === 'fix' ? `-> 点名の大きさ: 指定（${lengthText(s.m * surveyUnitFactor())}）` : '-> 点名の大きさ: 自動（点の広がりから）');
};
window.ptLabelSetHeight = function(el) {
    const v = fieldNum(el, { gt: 0, what: '点名の大きさ' });
    if(v === undefined || v === null) return;
    const s = ptLabelSetting();
    s.m = fromDisplayUnit(v, 'len') / surveyUnitFactor();
    s.mode = 'fix';
    _ptLabelSave(s);
    document.querySelectorAll('.pl-ctl .pl-h').forEach((x) => { if(x !== el) x.value = el.value; });
    _ptLabelRefreshControls();
    addCommandLog(`-> 点名の大きさ: 指定（${lengthText(s.m * surveyUnitFactor())}）`);
};
// 座標一覧の「今の点名をこの大きさに」: 図面の点名を、指定の高さ（自動なら点の広がりから決めた高さ）にする
window.ptLabelApplyExisting = function() {
    const idx = [];
    entities.forEach((e, i) => { if(e && e.type === 'TEXT' && e.ptLabel) idx.push(i); });
    if(!idx.length) { showToast('図面に点名がありません', { kind: 'warn', ms: 2500 }); return; }
    const h = ptLabelFixedHeight() || _autoLabelHeight(entities.filter((e) => e && e.type === 'POINT').map((e) => ({ x: e.x, y: e.y })));
    const n = textSizeSetHeights(idx, () => h);
    addCommandLog(`-> 点名 ${n}個の大きさを ${lengthText(h)} にしました`);
    showUndoSnack(`点名 ${n}個の大きさを ${lengthText(h)} にしました`);
};

// ===== 文字の高さを変える =====
// 文字の種類
function textKindOf(e) {
    if(e.ptLabel) return 'pt';
    if(e.blockName === '区画') return 'lot';
    if(e.blockName === '寸法') return 'dim';
    if(e.gid && (e.blockName || e.attTag)) return 'blk';
    return 'txt';
}
// 高さの見出し（同じ高さとみなす桁）
function _tsKey(h) { return String(+(+h).toPrecision(6)); }
// idx の文字の高さを heightOf(e) にする（↩ の履歴を1つ作る）。変えた数を返す
function textSizeSetHeights(idx, heightOf) {
    // 新しい高さが決まる文字だけ（高さの無い文字の倍率など、決まらなければ ↩ の履歴も作らない）
    const list = idx.filter((i) => entities[i] && entities[i].type === 'TEXT').map((i) => [i, heightOf(entities[i])]).filter(([, h]) => h > 0 && isFinite(h));
    if(!list.length) return 0;
    saveUndo();
    const pts = new Map(); // 点名のまとまり → 点
    entities.forEach((e) => { if(e && e.type === 'POINT' && e.gid) pts.set(e.gid, e); });
    let n = 0;
    list.forEach(([i, h]) => {
        const e = entities[i], old = e.height || 0;
        const p = e.ptLabel && e.gid ? pts.get(e.gid) : null;
        // 点名は点の右上（高さの 0.5・0.3）に置いている。その位置のままなら、新しい高さの位置に置き直す
        if(p && old > 0) {
            const tol = Math.max(1e-9, old * 1e-6);
            if(Math.abs(e.x - (p.x + old * 0.5)) <= tol && Math.abs(e.y - (p.y + old * 0.3)) <= tol) { e.x = p.x + h * 0.5; e.y = p.y + h * 0.3; }
        }
        e.height = h;
        delete e.bbox;
        n++;
    });
    if(typeof _bumpGeomEpoch === 'function') _bumpGeomEpoch();
    if(typeof updatePropertiesPanel === 'function') updatePropertiesPanel();
    render();
    if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    return n;
}

// ===== 文字の大きさのパネル =====
const _tsz = { scope: 'all', layer: -1, kinds: null, heights: null, how: 'set' };
// 選んでいる図形のうちの文字
function _tszSelected() {
    const sel = (cmdState.selectedIndices && cmdState.selectedIndices.length) ? cmdState.selectedIndices : (cmdState.highlightIdx >= 0 ? [cmdState.highlightIdx] : []);
    return sel.filter((i) => entities[i] && entities[i].type === 'TEXT');
}
// 「選んだ文字」は図形の ID で覚え、使うときに今の番号に直す（パネルを開いたあとに ↩・削除で番号がずれても、同じ文字を変える）
function _tszKeepSel(idx) { _tsz.selIds = idx.map((i) => _idOf(entities[i])); }
function _tszSelIdx() { return (_tsz.selIds || []).map((id) => entityIndexById(id)).filter((i) => i >= 0 && entities[i].type === 'TEXT'); }
// 対象（種類・高さで絞る前）
function _tszBase() {
    if(_tsz.scope === 'sel') return _tszSelIdx();
    const out = [];
    entities.forEach((e, i) => { if(e && e.type === 'TEXT' && (_tsz.scope !== 'layer' || e.layer === _tsz.layer)) out.push(i); });
    return out;
}
// 変える文字（種類・高さで絞ったあと）
function textSizeTargets() {
    return _tszBase().filter((i) => {
        const e = entities[i];
        if(_tsz.kinds && !_tsz.kinds.has(textKindOf(e))) return false;
        if(_tsz.heights && !_tsz.heights.has(_tsKey(e.height || 0))) return false;
        return true;
    });
}
// パネルを開く（scope: 'sel' 選んだ文字 / 'all' / 'layer'）
window.showTextSizePanel = function(scope) {
    const sel = _tszSelected();
    _tszKeepSel(sel);
    _tsz.scope = scope === 'sel' && sel.length ? 'sel' : scope === 'layer' ? 'layer' : (sel.length > 1 ? 'sel' : 'all');
    if(_tsz.layer < 0 || !layers[_tsz.layer]) _tsz.layer = currentLayerIndex;
    _tsz.kinds = null; _tsz.heights = null; _tsz.how = 'set';
    _tszRender();
};
function _tszRender(keepVal) {
    const prevEl = document.getElementById('tsz-val');
    const prev = keepVal && prevEl ? prevEl.value : '';
    const textLayers = new Map(); // 画層 → 文字の数
    entities.forEach((e) => { if(e && e.type === 'TEXT') textLayers.set(e.layer, (textLayers.get(e.layer) || 0) + 1); });
    // 画層で絞るとき、今の画層に文字が無ければ、選ぶ欄の先頭の画層にそろえる（以前は欄の表示と対象がずれて 0個になった）
    if(_tsz.scope === 'layer' && !textLayers.get(_tsz.layer)) { const f = layers.findIndex((l, i) => textLayers.get(i)); if(f >= 0) _tsz.layer = f; }
    const base = _tszBase();
    const kindCount = {};
    base.forEach((i) => { const k = textKindOf(entities[i]); kindCount[k] = (kindCount[k] || 0) + 1; });
    const kinded = base.filter((i) => !_tsz.kinds || _tsz.kinds.has(textKindOf(entities[i])));
    const hc = new Map();
    kinded.forEach((i) => { const k = _tsKey(entities[i].height || 0); hc.set(k, (hc.get(k) || 0) + 1); });
    const targets = textSizeTargets();
    const segBtn = (on, onclick, label, title) => `<button type="button" class="prop-btn opt-bg-btn${on ? ' active' : ''}" aria-pressed="${on}" onclick="${onclick}"${title ? ` title="${escapeHtml(title)}"` : ''}>${label}</button>`;
    const nSel = _tszSelIdx().length;
    let h = `<div class="cogo-note">文字の高さをまとめて変えます（↩ で戻せます）。アプリで描いた寸法の文字は、オプションの「寸法の文字」で変えます。</div>`;
    h += '<div class="ts-sec" style="margin-top:6px;">対象</div><div class="opt-pref-seg" style="margin:4px 0;">' +
        segBtn(_tsz.scope === 'sel', "textSizeScope('sel')", `選んだ文字（${nSel}）`, nSel ? '' : '図面で文字を選んでから開くと使えます') +
        segBtn(_tsz.scope === 'layer', "textSizeScope('layer')", '画層') + segBtn(_tsz.scope === 'all', "textSizeScope('all')", 'すべて') + '</div>';
    if(_tsz.scope === 'layer') {
        const cnt = textLayers;
        const opts = layers.map((l, i) => cnt.get(i) ? `<option value="${i}"${i === _tsz.layer ? ' selected' : ''}>${escapeHtml(l.name)}（${cnt.get(i)}）</option>` : '').join('');
        h += opts ? `<select id="tsz-layer" class="prop-val" style="width:100%;margin-bottom:4px;" onchange="textSizeLayer(this.value)" aria-label="画層">${opts}</select>` : '<div class="cogo-note">文字のある画層がありません</div>';
    }
    h += '<div class="ts-sec" style="margin-top:6px;">種類（押すと、その種類だけ）</div><div class="tsz-chips">' +
        TEXT_KINDS.filter(([k]) => kindCount[k]).map(([k, label]) => segBtn(!!(_tsz.kinds && _tsz.kinds.has(k)), `textSizeKind('${k}')`, `${label}（${kindCount[k]}）`)).join('') + '</div>';
    const hs = [...hc.entries()].sort((a, b) => b[1] - a[1] || (+a[0]) - (+b[0]));
    h += '<div class="ts-sec" style="margin-top:6px;">今の高さ（押すと、その高さの文字だけ）</div><div class="tsz-chips">' +
        hs.slice(0, 16).map(([k, n]) => segBtn(!!(_tsz.heights && _tsz.heights.has(k)), `textSizeHeight('${k}')`, `${escapeHtml(lengthText(+k))} ×${n}`)).join('') +
        (hs.length > 16 ? `<span class="cogo-note">ほか ${hs.length - 16}種類</span>` : '') + '</div>';
    h += '<div class="ts-sec" style="margin-top:6px;">変え方</div><div style="display:flex;gap:6px;align-items:center;margin:4px 0;">' +
        `<div class="opt-pref-seg" style="flex:0 0 auto;min-width:150px;">${segBtn(_tsz.how === 'set', "textSizeHow('set')", '高さを指定')}${segBtn(_tsz.how === 'mul', "textSizeHow('mul')", '倍率')}</div>` +
        `<input id="tsz-val" class="prop-val" type="text" inputmode="decimal" autocomplete="off" style="width:80px;" value="${escapeHtml(prev)}" placeholder="${_tsz.how === 'set' ? '例 1.25' : '例 2'}" aria-label="${_tsz.how === 'set' ? '新しい高さ' : '倍率'}">` +
        `<span style="font-size:11px;color:#888;">${_tsz.how === 'set' ? displayUnitTag('len') : '倍'}</span></div>`;
    h += `<div class="cogo-note" id="tsz-result">変える文字: <b>${targets.length}個</b></div>`;
    h += `<div class="cogo-btns"><button class="prop-btn" onclick="textSizeApply()" ${targets.length ? '' : 'disabled'}>🔠 変える</button><button class="prop-btn btn-sub" onclick="closePropertyPanel()">閉じる</button></div>`;
    showPropertyPanel(TEXTSIZE_TITLE, h);
}
window.textSizeScope = function(s) {
    if(s === 'sel') { const now = _tszSelected(); if(now.length) _tszKeepSel(now); } // パネルを開いたあとに選び直した文字
    if(s === 'sel' && !_tszSelIdx().length) { showToast('図面で文字を選んでから「🔠 文字」を押すと、選んだ文字だけを変えられます', 3500); return; }
    _tsz.scope = s; _tsz.kinds = null; _tsz.heights = null; _tszRender(true);
};
window.textSizeLayer = function(v) { _tsz.layer = parseInt(v, 10); _tsz.kinds = null; _tsz.heights = null; _tszRender(true); }; // 種類の絞りも外す（別の画層に無い種類で 0個にならないよう）
window.textSizeKind = function(k) {
    if(!_tsz.kinds) _tsz.kinds = new Set();
    if(_tsz.kinds.has(k)) _tsz.kinds.delete(k); else _tsz.kinds.add(k);
    if(!_tsz.kinds.size) _tsz.kinds = null;
    _tsz.heights = null;
    _tszRender(true);
};
window.textSizeHeight = function(k) {
    if(!_tsz.heights) _tsz.heights = new Set();
    if(_tsz.heights.has(k)) _tsz.heights.delete(k); else _tsz.heights.add(k);
    if(!_tsz.heights.size) _tsz.heights = null;
    _tszRender(true);
};
window.textSizeHow = function(how) { _tsz.how = how === 'mul' ? 'mul' : 'set'; _tszRender(false); };
window.textSizeApply = function() {
    const el = document.getElementById('tsz-val');
    const v = el ? fieldNum(el, { gt: 0, what: _tsz.how === 'set' ? '高さ' : '倍率' }) : undefined;
    if(v === undefined || v === null) return;
    const idx = textSizeTargets();
    if(!idx.length) { showToast('変える文字がありません', 2500); return; }
    const hNew = _tsz.how === 'set' ? fromDisplayUnit(v, 'len') : null;
    const n = textSizeSetHeights(idx, (e) => hNew !== null ? hNew : (e.height || 0) * v);
    if(!n) { showToast('変えられる文字がありませんでした（高さの無い文字は、倍率では変えられません）', { kind: 'warn', ms: 3500 }); return; }
    const what = hNew !== null ? `高さ ${lengthText(hNew)}` : `${v}倍`;
    addCommandLog(`-> 文字 ${n}個の大きさを変えました（${what}）`);
    showUndoSnack(`文字 ${n}個の大きさを変えました（${what}）`);
    // 選んだ文字は、変えたあとも同じ文字（ID で覚えている）
    _tsz.heights = null;
    _tszRender(true);
};

// コマンド TEXTSIZE
function processTextSizeCommand(cmd) {
    if(cmd !== 'TEXTSIZE') return false;
    window.showTextSizePanel();
    return true;
}

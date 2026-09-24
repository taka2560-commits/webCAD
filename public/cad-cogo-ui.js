// ===== Web CAD 測量計算（COGO）: 画面 =====
// cad-cogo-ui.js - 「🧮 測量計算」パネル（求積・逆計算・点の追加・交点）、図面での点の指定、重ね表示。
//                  計算は cad-cogo.js。
//
// 点の欄は、点名・点番号・「X,Y」を入れるか、📍 で図面の点をなぞって ☑確定（寸法と同じ。PC はクリック）。
// 続けて指定する欄が空いていれば、確定するたびに次の欄の指定へ進む。

const COGO_TITLE = '🧮 測量計算';
const COGO_PICK_MODE = 'WAITING_DIMCOGO_PT'; // 「WAITING_DIM」で始まる段階は、指を離しても決まらず ☑確定 で決まる
const COGO_LOT_MODE = 'WAITING_COGO_LOT';    // 区画はタップで選ぶ
const COGO_TABS = [['area', '求積'], ['inv', '逆計算'], ['pt', '点の追加'], ['int', '交点']];
// 点の欄: [説明, 図面の印]
const COGO_SLOT_LABELS = {
    IA: ['始点', 'A'], IB: ['終点', 'B'],
    PS: ['器械点', '器'], PB: ['後視点', '後'],
    LA1: ['直線1の点1', '1a'], LA2: ['直線1の点2', '1b'], LB1: ['直線2の点1', '2a'], LB2: ['直線2の点2', '2b'],
    AA: ['点A', 'A'], AB: ['点B', 'B'], DA: ['点A', 'A'], DB: ['点B', 'B'],
};
const _cogo = {
    tab: 'area', ptMode: 'xy', intMode: 'll', landMode: 'cm', ddSide: 'right',
    slots: {},    // 点の欄 → { x, y, name, snapped }（図面の座標）
    vals: {},     // 数値・文字の欄（描き直しても入力が消えないように覚えておく）
    pick: null,   // 点の指定中 { keys: [...], i }
    area: null,   // 求積の対象 { id, pts: [{ x, y }] }（図面の座標）
    lastName: '', // 最後に追加した点名（次の名前の案に使う）
};

// 点の欄を持つパネル（測量計算・杭打ち・下絵）。slots: いまの欄の並び、render: パネル全体、update: 結果だけ描き直す、
// raw: スナップせず、指・カーソルの位置そのものを使う欄（下絵の画像の上の点など）
const COGO_PICK_OWNERS = {
    cogo: { slots: () => _cogoTabSlots(), render: () => _cogoRender(), update: () => _cogoUpdateResult() },
};
function cogoRegisterPickOwner(name, def) { COGO_PICK_OWNERS[name] = def; }
function _cogoOwner(name) { return COGO_PICK_OWNERS[name] || COGO_PICK_OWNERS.cogo; }

// ===== パネル =====
window.showCogoPanel = function(tab) {
    if(tab) _cogo.tab = tab;
    // 区画を選んでから開いたときは、それを求積の対象にする
    if(_cogo.tab === 'area' && cmdState.mode === 'IDLE' && cmdState.highlightIdx >= 0) _cogoUseEntity(cmdState.highlightIdx);
    _cogoRender();
    render();
};
function _cogoRender() {
    let body = _cogoSeg(_cogo.tab, COGO_TABS, 'cogoSetTab');
    if(_cogo.tab === 'area') body += _cogoAreaHtml();
    else if(_cogo.tab === 'inv') body += _cogoSlotsHtml();
    else if(_cogo.tab === 'pt') body += _cogoPtHtml();
    else body += _cogoIntHtml();
    body += '<div id="cogo-result" class="cogo-result"></div>';
    showPropertyPanel(COGO_TITLE, body);
    _cogoUpdateResult();
}
function _cogoSeg(cur, list, fn) {
    return `<div class="cogo-seg">${list.map(([k, t]) => `<button class="prop-btn opt-bg-btn ${cur === k ? 'active' : ''}" onclick="${fn}('${k}')">${t}</button>`).join('')}</div>`;
}
// タブ・種類を切り替えたら、指定中の点はやめる（見えない欄に点が入らないように）
function _cogoStopPick() { if(cogoIsPicking()) { _cogo.pick = null; resetCommand(); } }
window.cogoSetTab = function(t) { _cogoStopPick(); _cogo.tab = t; _cogoRender(); render(); };
window.cogoSetPtMode = function(m) { _cogoStopPick(); _cogo.ptMode = m; _cogoRender(); render(); };
window.cogoSetIntMode = function(m) { _cogoStopPick(); _cogo.intMode = m; _cogoRender(); render(); };
// 入力で変わるのは重ね表示だけなので、図形は描き直さない
window.cogoSetDdSide = function(s) { _cogo.ddSide = s === 'left' ? 'left' : 'right'; _cogoUpdateResult(); renderOverlay(); };
window.cogoSetLandMode = function(m) { _cogo.landMode = m === 'm' ? 'm' : 'cm'; _cogoUpdateResult(); };
window.cogoValInput = function(id, v) { _cogo.vals[id] = v; _cogoUpdateResult(); renderOverlay(); };

function _cogoNote(text) { return `<div class="cogo-note">${text}</div>`; }
function _cogoInputHtml(id, label, ph, numeric) {
    return `<div class="prop-row cogo-row"><div class="prop-label cogo-label">${label}</div>
        <input id="cogo-v-${id}" class="prop-val" type="text" autocomplete="off" ${numeric ? 'inputmode="decimal"' : ''} placeholder="${ph}"
            value="${escapeHtml(_cogo.vals[id] || '')}" oninput="cogoValInput('${id}', this.value)" style="min-width:0;"></div>`;
}
function _cogoNameHtml(key) {
    if(!_cogo.vals[key]) _cogo.vals[key] = _cogoSuggestName();
    return _cogoInputHtml(key, '点名', '例 P1', false);
}
function _cogoSuggestName() {
    if(_cogo.lastName) return cogoNextName(_cogo.lastName);
    const pts = collectSurveyPoints().filter((p) => p.name);
    return cogoNextName(pts.length ? pts[pts.length - 1].name : '');
}

// ---- 点の欄 ----
function _cogoTabSlots() {
    if(_cogo.tab === 'inv') return ['IA', 'IB'];
    if(_cogo.tab === 'pt') return _cogo.ptMode === 'azi' ? ['PS'] : _cogo.ptMode === 'bs' ? ['PS', 'PB'] : [];
    if(_cogo.tab === 'int') return _cogo.intMode === 'll' ? ['LA1', 'LA2', 'LB1', 'LB2'] : _cogo.intMode === 'aa' ? ['AA', 'AB'] : ['DA', 'DB'];
    return [];
}
function _cogoSlotSurvey(key) {
    const s = _cogo.slots[key];
    return s ? Object.assign(wcsToSurvey(s.x, s.y), { name: s.name }) : null;
}
function _cogoSlotXyText(key) {
    const s = _cogo.slots[key], sv = _cogoSlotSurvey(key);
    if(!s) return '<span style="color:#666;">点名・点番号・「X,Y」を入れるか、📍 で図面から</span>';
    return `X ${cogoFix(sv.X, 3)}&nbsp;&nbsp;Y ${cogoFix(sv.Y, 3)}` + (s.snapped === false ? '&nbsp;&nbsp;<span style="color:#ffcc00;">スナップなし</span>' : '');
}
function _cogoSlotValue(key) {
    const s = _cogo.slots[key], sv = _cogoSlotSurvey(key);
    return s ? (s.name || `${cogoFix(sv.X, 3)},${cogoFix(sv.Y, 3)}`) : '';
}
function _cogoSlotHtml(key, owner) {
    const own = owner ? `, '${owner}'` : '';
    return `<div class="cogo-slot">
        <div class="prop-row cogo-row"><div class="prop-label cogo-label">${COGO_SLOT_LABELS[key][0]}</div>
            <input id="cogo-slot-${key}" class="prop-val" type="text" autocomplete="off" placeholder="点名 または X,Y" value="${escapeHtml(_cogoSlotValue(key))}"
                onchange="cogoSlotTyped('${key}', this.value${own})" style="min-width:0;">
            <button class="prop-btn btn-sub cogo-pick" onclick="cogoPick('${key}'${own})" title="図面でなぞって指定">📍</button></div>
        <div id="cogo-xy-${key}" class="cogo-xy">${_cogoSlotXyText(key)}</div></div>`;
}
function _cogoSlotsHtml() { return _cogoTabSlots().map((k) => _cogoSlotHtml(k)).join(''); }
function _cogoRefreshSlot(key) {
    const inp = document.getElementById('cogo-slot-' + key); if(inp) inp.value = _cogoSlotValue(key);
    const xy = document.getElementById('cogo-xy-' + key); if(xy) xy.innerHTML = _cogoSlotXyText(key);
}
// 欄に点名・点番号・「X,Y」を入れたとき
window.cogoSlotTyped = function(key, text, owner) {
    const t = String(text || '').trim();
    if(!t) { delete _cogo.slots[key]; }
    else {
        const xy = cogoParseXY(t);
        const p = xy ? { x: xy.x, y: xy.y, name: cogoPointNameAt(xy.x, xy.y) } : cogoFindPoint(t);
        if(!p) { showToast(`点「${t}」が見つかりません（点名・点番号、または X,Y で入れてください）`, 3500); return; }
        _cogo.slots[key] = { x: p.x, y: p.y, name: p.name || '', snapped: true };
    }
    _cogoRefreshSlot(key);
    _cogoOwner(owner).update();
    renderOverlay();
};

// ===== 図面での点の指定 =====
// 押した欄から、そのタブで空いている欄へ順に指定していく
window.cogoPick = function(key, owner) {
    const keys = _cogoOwner(owner).slots(), i0 = keys.indexOf(key);
    const chain = [key].concat(i0 >= 0 ? keys.slice(i0 + 1).filter((k) => !_cogo.slots[k]) : []);
    _cogo.pick = { keys: chain, i: 0, owner: owner || 'cogo' };
    _cogoStartPick();
};
function _cogoShowBar(withConfirm) {
    const ab = document.getElementById('fs-dim-actionbar');
    if(!ab) return;
    ab.style.display = 'flex';
    const cb = ab.querySelector('button[onclick="dimConfirmPoint()"]');
    if(cb) cb.style.display = withConfirm ? '' : 'none';
    ['dim-mode-toggle', 'dim-dir-toggle', 'pline-close-btn'].forEach((id) => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
    if(typeof _hideMeasureButtons === 'function') _hideMeasureButtons();
}
// スマホでは図面が見えるようにパネルを隠す（指定が終わるとまた開く）
function _cogoPanelDuringPick() { if(window.innerWidth >= 700) _cogoOwner(_cogo.pick && _cogo.pick.owner).render(); else hidePropertyPanel(); }
function _cogoStartPick() {
    const p = _cogo.pick, key = p.keys[p.i], label = COGO_SLOT_LABELS[key][0];
    resetCommand();
    cmdState.mode = COGO_PICK_MODE;
    setPrompt(`${label}をなぞって ☑確定`);
    addCommandLog(`-> [測量計算] ${label}を指定（測点に吸い付きます）`);
    _cogoShowBar(true);
    _cogoPanelDuringPick();
    render();
}
window.cogoPickLot = function() {
    resetCommand();
    cmdState.mode = COGO_LOT_MODE;
    setPrompt('求積する区画をタップ');
    addCommandLog('-> [求積] 区画（閉じたポリライン・長方形）の線か内側をタップしてください');
    _cogoShowBar(false);
    _cogoPanelDuringPick();
    render();
};
function cogoIsPicking() { return cmdState.mode === COGO_PICK_MODE || cmdState.mode === COGO_LOT_MODE; }
// ❌終了・Esc で指定をやめたとき: パネルに戻る
function cogoPickCancelled() { const own = _cogoOwner(_cogo.pick && _cogo.pick.owner); _cogo.pick = null; own.render(); render(); }

// 点の入力（cad-command.js の点入力から呼ばれる）。処理したら true
function handleCogoPointInput(mode, wcs) {
    if(mode === COGO_LOT_MODE) { _cogoLotTapped(); return true; }
    if(mode !== COGO_PICK_MODE) return false;
    const p = _cogo.pick;
    if(!p) { resetCommand(); return true; }
    const key = p.keys[p.i];
    const raw = (_cogoOwner(p.owner).raw || []).includes(key);
    if(raw) wcs = { x: mouse.wcsX, y: mouse.wcsY };
    const snapped = !raw && typeof snapActive === 'function' && snapActive() && Math.abs(snapResult.wcsX - wcs.x) < 1e-9 && Math.abs(snapResult.wcsY - wcs.y) < 1e-9;
    const s = _cogo.slots[key] = { x: wcs.x, y: wcs.y, name: cogoPointNameAt(wcs.x, wcs.y), snapped };
    const sv = wcsToSurvey(wcs.x, wcs.y);
    addCommandLog(`-> ${COGO_SLOT_LABELS[key][0]}: ${s.name || '(点名なし)'} X ${cogoFix(sv.X, 3)} Y ${cogoFix(sv.Y, 3)}${snapped || raw ? '' : '（スナップなし）'}`);
    if(navigator.vibrate) navigator.vibrate(20);
    p.i++;
    if(p.i < p.keys.length) { _cogoStartPick(); return true; }
    const own = _cogoOwner(p.owner);
    _cogo.pick = null;
    resetCommand();
    if(p.owner === 'cogo' && _cogo.tab === 'inv') _cogoLogInverse();
    own.render();
    render();
    return true;
}

// ===== 求積 =====
function _cogoLotList() {
    const out = [];
    entities.forEach((e, i) => {
        if(!e || e.type !== 'PLINE' || !e.closed || !e.points || e.points.length < 3) return;
        const ln = layers[e.layer] ? layers[e.layer].name : '';
        if(!e.lotName && !/区画|筆|地番/.test(ln)) return;
        out.push({ idx: i, id: e.id, name: e.lotName || `区画${out.length + 1}` });
    });
    return out;
}
// 閉じた形の頂点（重なった点は1つにする）。形にならなければ null
function _cogoPolygonOf(e) {
    let pts = null;
    if(e.type === 'PLINE' && e.points) pts = e.points.map((p) => ({ x: p.x, y: p.y }));
    else if(e.type === 'RECTANG') pts = [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y1 }, { x: e.x2, y: e.y2 }, { x: e.x1, y: e.y2 }];
    if(!pts) return null;
    const out = [];
    pts.forEach((p) => { const q = out[out.length - 1]; if(!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) out.push(p); });
    if(out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-9) out.pop();
    return out.length >= 3 ? out : null;
}
// 図形を求積の対象にする（区画・ポリライン・長方形・それらの塗りつぶし）
function _cogoUseEntity(idx) {
    const e = entities[idx];
    if(!e) return false;
    const shape = e.type === 'HATCH' ? e.target : e;
    const pts = shape ? _cogoPolygonOf(shape) : null;
    if(!pts) return false;
    if(e.id === undefined || e.id === null) ensureEntityIds();
    _cogo.area = { id: e.id, pts };
    _cogo.vals.areaTitle = e.lotName || (shape.lotName || '');
    return true;
}
// タップした位置を含む閉じた形のうち、いちばん小さいもの（区画の内側をタップしたとき）
function _cogoPolygonAt(wx, wy) {
    let best = -1, bestA = Infinity;
    entities.forEach((e, i) => {
        if(!e || (e.type !== 'PLINE' && e.type !== 'RECTANG') || (e.type === 'PLINE' && !e.closed)) return;
        if(layers[e.layer] && !layers[e.layer].visible) return;
        const pts = _cogoPolygonOf(e);
        if(!pts) return;
        let inside = false;
        for(let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
            const p = pts[a], q = pts[b];
            if((p.y > wy) !== (q.y > wy) && wx < (q.x - p.x) * (wy - p.y) / (q.y - p.y) + p.x) inside = !inside;
        }
        if(!inside) return;
        const area = polygonArea(pts);
        if(area < bestA) { bestA = area; best = i; }
    });
    return best;
}
function _cogoLotTapped() {
    let idx = hitTestEntity(mouse.screenX, mouse.screenY);
    // 区画名などの文字をタップしたときは、同じまとまりの区画の線を使う
    if(idx >= 0 && !_cogoPolygonOf(entities[idx].type === 'HATCH' ? (entities[idx].target || {}) : entities[idx]) && entities[idx].gid) {
        const gid = entities[idx].gid;
        const m = entities.findIndex((e) => e && e.gid === gid && (e.type === 'PLINE' || e.type === 'RECTANG') && _cogoPolygonOf(e));
        if(m >= 0) idx = m;
    }
    if(idx < 0 || !_cogoPolygonOf(entities[idx].type === 'HATCH' ? (entities[idx].target || {}) : entities[idx])) {
        const inner = _cogoPolygonAt(mouse.wcsX, mouse.wcsY);
        if(inner >= 0) idx = inner;
    }
    if(idx < 0 || !_cogoUseEntity(idx)) { showToast('区画（閉じたポリライン・長方形）の線か内側をタップしてください', 3000); return; }
    resetCommand();
    _cogo.tab = 'area';
    _cogoRender();
    render();
}
window.cogoChooseLot = function(id) {
    const idx = entityIndexById(isFinite(+id) ? +id : id);
    if(idx >= 0 && _cogoUseEntity(idx)) { _cogoRender(); render(); }
};
// 求積の計算（図形が動いた・変わったときは今の形で計算し直す）
function _cogoAreaData() {
    const a = _cogo.area;
    if(!a) return null;
    const idx = (a.id !== undefined && a.id !== null) ? entityIndexById(a.id) : -1;
    if(idx >= 0) {
        const e = entities[idx], shape = e.type === 'HATCH' ? e.target : e, pts = shape && _cogoPolygonOf(shape);
        if(pts) a.pts = pts;
    }
    const nameAt = cogoPointNamer();
    const pts = a.pts.map((p, i) => { const s = wcsToSurvey(p.x, p.y); return { name: nameAt(p.x, p.y) || String(i + 1), X: s.X, Y: s.Y }; });
    return { pts, t: cogoAreaTable(pts), twisted: cogoSelfIntersects(pts) };
}
function _cogoAreaTitle() { return String(_cogo.vals.areaTitle || '').trim(); }
function _cogoAreaHtml() {
    const lots = _cogoLotList();
    let h = '<button class="prop-btn" style="margin-top:0;" onclick="cogoPickLot()">👆 求積する区画をタップ</button>';
    if(lots.length) {
        const cur = _cogo.area ? _cogo.area.id : null;
        h += `<select class="prop-val" onchange="cogoChooseLot(this.value)"><option value="">区画から選ぶ（${lots.length}）</option>` +
            lots.slice(0, 500).map((l) => `<option value="${escapeHtml(String(l.id))}" ${l.id === cur ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('') + '</select>';
    }
    if(!_cogo.area) return h + _cogoNote('閉じたポリライン・長方形・SIMA の区画を選ぶと、座標法で面積を計算します。区画の線が無いときは、複線（ポリライン）で測点をなぞって閉じてください。');
    h += `<div class="prop-row cogo-row"><div class="prop-label cogo-label">区画名</div><input class="prop-val" type="text" autocomplete="off" value="${escapeHtml(_cogoAreaTitle())}" oninput="cogoValInput('areaTitle', this.value)" style="min-width:0;"></div>`;
    h += `<div class="prop-row cogo-row"><div class="prop-label cogo-label">地積の端数</div><select class="prop-val" onchange="cogoSetLandMode(this.value)" style="min-width:0;">
        <option value="cm" ${_cogo.landMode === 'cm' ? 'selected' : ''}>0.01㎡未満を切り捨て</option>
        <option value="m" ${_cogo.landMode === 'm' ? 'selected' : ''}>1㎡未満を切り捨て（宅地・鉱泉地以外で10㎡超）</option></select></div>`;
    return h;
}
function _cogoAreaResultHtml() {
    const d = _cogoAreaData();
    if(!d) return '';
    const t = d.t;
    const head = COGO_AREA_COLS.map((c) => `<th>${escapeHtml(c.head)}</th>`).join('');
    const rows = t.rows.map((r) => '<tr>' + COGO_AREA_COLS.map((c) => `<td class="${c.align === 'right' ? 'r' : 'c'}">${escapeHtml(c.v(r))}</td>`).join('') + '</tr>').join('');
    const foot = cogoAreaFooter(t, _cogo.landMode);
    let h = `<div class="cogo-table-wrap"><table class="cogo-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    h += '<div class="cogo-kv">' + foot.map(([k, v], i) => `<div>${k}</div><div class="${i === 2 ? 'cogo-big' : ''}">${v}</div>`).join('') +
        `<div>周長（m）</div><div>${cogoFix(t.perimeter, 3)}（${t.rows.length}点）</div></div>`;
    if(d.twisted) h += '<div class="cogo-warn">⚠ 辺が交わっています。頂点の順番を確かめてください（このままでは面積が正しくありません）</div>';
    h += `<div class="cogo-btns">
        <button class="prop-btn" onclick="cogoPlaceAreaTable()">📋 求積表を図面に置く</button>
        <button class="prop-btn btn-sub" onclick="cogoWriteSides()">📏 辺長を記入</button>
        <button class="prop-btn btn-sub" onclick="cogoWriteArea()">㎡ 面積を記入</button>
        <button class="prop-btn btn-sub" onclick="cogoExportAreaCsv()">📄 CSV出力</button></div>`;
    return h;
}
function _cogoBounds(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    return { minX, minY, maxX, maxY };
}
// 図形をまとめて（1つのグループとして）図面に入れる。元に戻すは1回で
function _cogoPushGroup(ents, prefix, blockName) {
    saveUndo();
    const gid = newGroupId(prefix);
    ents.forEach((e) => { e.gid = gid; e.blockName = blockName; entities.push(e); });
    ensureEntityIds(); _bumpGeomEpoch(); initLayers();
    if(typeof updateLayerPanel === 'function') updateLayerPanel();
    render();
}
function _cogoZoomTo(minX, minY, maxX, maxY) {
    const pad = 40, w = Math.max(maxX - minX, 1e-9), h = Math.max(maxY - minY, 1e-9);
    const s = Math.min((canvas.width - pad * 2) / w, (canvas.height - pad * 2) / h);
    if(!(s > 0) || !isFinite(s)) return;
    view.scale = s;
    _reanchorView(canvas.width / 2, canvas.height / 2, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    render();
}
window.cogoPlaceAreaTable = function() {
    const d = _cogoAreaData();
    if(!d) return;
    const wp = _cogo.area.pts, h = cogoNoteHeight(wp), b = _cogoBounds(wp);
    const layer = _ensureSurveyLayer(COGO_LAYER_TABLE, '#ffffff');
    const r = cogoAreaTableEntities(d.t, { left: b.maxX + h * 3, top: b.maxY, h, layer, title: _cogoAreaTitle(), landMode: _cogo.landMode });
    _cogoPushGroup(r.entities, 'area', '求積表');
    _cogoZoomTo(b.minX, Math.min(b.minY, b.maxY - r.height), b.maxX + h * 3 + r.width, b.maxY);
    addCommandLog(`-> 求積表を置きました${_cogoAreaTitle() ? '（' + _cogoAreaTitle() + '）' : ''} 地積 ${cogoLandArea(d.t.area, _cogo.landMode)}㎡`);
    showToast('求積表を区画の右に置きました（移動で動かせます）', 3500);
    if(window.innerWidth < 700) hidePropertyPanel(); // スマホでは置いた表を見せる
};
window.cogoWriteSides = function() {
    if(!_cogoAreaData()) return;
    const wp = _cogo.area.pts, h = cogoNoteHeight(wp) * 0.8;
    const ents = cogoSideLabelEntities(wp, h, _ensureSurveyLayer(COGO_LAYER_NOTE, '#00ffff'));
    _cogoPushGroup(ents, 'side', '辺長');
    addCommandLog(`-> 辺長を記入しました（${ents.length}辺）`);
    showToast(`辺長を記入しました（${ents.length}辺）`, 2500);
};
window.cogoWriteArea = function() {
    const d = _cogoAreaData();
    if(!d) return;
    const wp = _cogo.area.pts, text = cogoLandArea(d.t.area, _cogo.landMode) + '㎡';
    _cogoPushGroup([cogoAreaLabelEntity(wp, cogoNoteHeight(wp), _ensureSurveyLayer(COGO_LAYER_NOTE, '#00ffff'), text)], 'aream', '面積');
    addCommandLog(`-> 面積を記入しました: ${text}`);
    showToast(`面積 ${text} を記入しました`, 2500);
};
window.cogoExportAreaCsv = function() {
    const d = _cogoAreaData();
    if(!d) return;
    const title = _cogoAreaTitle(), safe = title.replace(/[\\/:*?"<>|\s]+/g, '_');
    downloadBlob(new Blob(['\uFEFF' + cogoAreaCsv(title, d.t, _cogo.landMode)], { type: 'text/csv' }), `${_baseName()}_求積表${safe ? '_' + safe : ''}.csv`);
    addCommandLog(`-> 求積表のCSVを出力しました（${d.t.rows.length}点）`);
};

// ===== 逆計算・点の追加・交点 =====
function _cogoPtHtml() {
    let h = _cogoSeg(_cogo.ptMode, [['xy', '座標で'], ['azi', '方向角・距離'], ['bs', '後視・夾角']], 'cogoSetPtMode');
    // 座標はマイナスを入れることが多いので数字だけのキーボードにしない（iPhone の数字キーボードには − が無い）
    if(_cogo.ptMode === 'xy') h += _cogoInputHtml('X', 'X（北）m', '例 -35012.345') + _cogoInputHtml('Y', 'Y（東）m', '例 20123.456');
    else if(_cogo.ptMode === 'azi') h += _cogoSlotsHtml() + _cogoInputHtml('az', '方向角', '45 30 15 または 45.5') + _cogoInputHtml('dist', '水平距離 m', '例 12.345', true);
    else h += _cogoSlotsHtml() + _cogoInputHtml('ang', '夾角（右回り）', '後視を0°として 45 30 15') + _cogoInputHtml('dist', '水平距離 m', '例 12.345', true);
    return h + _cogoNameHtml('ptName');
}
function _cogoIntHtml() {
    let h = _cogoSeg(_cogo.intMode, [['ll', '2直線'], ['aa', '方向角×2'], ['dd', '距離×2']], 'cogoSetIntMode');
    h += _cogoSlotsHtml();
    if(_cogo.intMode === 'aa') h += _cogoInputHtml('azA', 'Aの方向角', '45 30 15') + _cogoInputHtml('azB', 'Bの方向角', '120 0 0');
    if(_cogo.intMode === 'dd') h += _cogoInputHtml('dA', 'Aからの距離 m', '例 12.345', true) + _cogoInputHtml('dB', 'Bからの距離 m', '例 10.000', true);
    return h + _cogoNameHtml('intName');
}
function _cogoNum(id) { return cogoParseNum(_cogo.vals[id]); }
function _cogoAng(id) { const s = String(_cogo.vals[id] || '').trim(); return s === '' ? NaN : cogoParseAngle(s); }
function _cogoKv(pairs) { return '<div class="cogo-kv">' + pairs.map(([k, v, cls]) => `<div>${k}</div><div class="${cls || ''}">${v}</div>`).join('') + '</div>'; }
function _cogoSigned(v) { return (v > 0 ? '+' : '') + cogoFix(v, 3); }

// いまのタブの計算。{ html, point（追加できる点・測量座標）, lines, rays, circles, alt（もう一方の解）, logNote }
function _cogoCompute() {
    const S = _cogoSlotSurvey;
    const tab = _cogo.tab;
    if(tab === 'area') return { html: _cogoAreaResultHtml() };
    if(tab === 'inv') {
        const a = S('IA'), b = S('IB');
        if(!a || !b) return { html: _cogoNote('始点と終点を指定すると、距離と方向角を計算します。📍 で始点から続けて指定できます。') };
        const r = cogoInverse(a, b);
        return { lines: [[a, b]], html: _cogoKv([['ΔX（北）', _cogoSigned(r.dX) + ' m'], ['ΔY（東）', _cogoSigned(r.dY) + ' m'], ['水平距離', cogoFix(r.dist, 3) + ' m', 'cogo-big'],
            ['方向角', cogoFmtDms(r.az), 'cogo-big'], ['逆方向角', cogoFmtDms(r.az + 180)]]) +
            '<div class="cogo-btns"><button class="prop-btn btn-sub" onclick="cogoInvNext()">終点から次の点へ ▶</button></div>' };
    }
    if(tab === 'pt') {
        let p = null, pairs = [], lines = [], err = '';
        if(_cogo.ptMode === 'xy') {
            const X = _cogoNum('X'), Y = _cogoNum('Y');
            if(isFinite(X) && isFinite(Y)) p = { X, Y }; else err = 'X（北）と Y（東）を入れてください';
        } else {
            const st = S('PS'), d = _cogoNum('dist');
            let az = NaN;
            if(_cogo.ptMode === 'azi') { az = _cogoAng('az'); if(!st) err = '器械点を指定してください'; else if(!isFinite(az)) err = '方向角を入れてください'; }
            else {
                const bs = S('PB'), ang = _cogoAng('ang');
                if(!st || !bs) err = '器械点と後視点を指定してください';
                else if(cogoInverse(st, bs).dist <= 0) err = '器械点と後視点が同じ位置です';
                else if(!isFinite(ang)) err = '夾角を入れてください';
                else { az = cogoAzFromBacksight(st, bs, ang); pairs.push(['後視の方向角', cogoFmtDms(cogoInverse(st, bs).az)]); lines.push([st, bs, 'dash']); }
            }
            if(!err && !(d > 0)) err = '水平距離を入れてください';
            if(!err) { p = cogoPolar(st, az, d); pairs.push(['方向角', cogoFmtDms(az)], ['水平距離', cogoFix(d, 3) + ' m']); lines.push([st, p]); }
        }
        if(!p) return { lines, html: _cogoNote(err) };
        pairs.push(['新しい点', `X ${cogoFix(p.X, 3)}<br>Y ${cogoFix(p.Y, 3)}`, 'cogo-big']);
        return { point: p, lines, html: _cogoKv(pairs) + _cogoAddBtn() };
    }
    // 交点
    let p = null, err = '', lines = [], rays = [], circles = [], alt = null;
    if(_cogo.intMode === 'll') {
        const a1 = S('LA1'), a2 = S('LA2'), b1 = S('LB1'), b2 = S('LB2');
        if(!a1 || !a2 || !b1 || !b2) err = '2本の直線を、それぞれ2点で指定してください（延長線上の交点も出せます）';
        else { p = cogoIntersectLines(a1, a2, b1, b2); if(!p) err = '2本の直線が平行です'; lines = [[a1, a2, 'ext'], [b1, b2, 'ext']]; }
    } else if(_cogo.intMode === 'aa') {
        const a = S('AA'), b = S('AB'), azA = _cogoAng('azA'), azB = _cogoAng('azB');
        if(!a || !b) err = '点A・点Bを指定してください';
        else if(!isFinite(azA) || !isFinite(azB)) err = 'それぞれの方向角を入れてください';
        else { p = cogoIntersectAzimuths(a, azA, b, azB); if(!p) err = '2本の方向が平行です'; rays = [[a, azA], [b, azB]]; }
    } else {
        const a = S('DA'), b = S('DB'), dA = _cogoNum('dA'), dB = _cogoNum('dB');
        if(!a || !b) err = '点A・点Bを指定してください';
        else if(!(dA > 0) || !(dB > 0)) err = 'それぞれの距離を入れてください';
        else {
            circles = [[a, dA], [b, dB]];
            const r = cogoIntersectDistances(a, dA, b, dB);
            if(!r) err = '2つの距離では交わりません（距離の合計が AB 間より短い、または差が長い）';
            else { p = r[_cogo.ddSide]; alt = r[_cogo.ddSide === 'right' ? 'left' : 'right']; }
        }
    }
    if(!p) return { lines, rays, circles, html: _cogoNote(err) };
    // 線は交点まで延ばして見せる
    if(_cogo.intMode === 'll') lines = lines.map(([u, v]) => [u, v, 'ext', p]);
    let html = '';
    if(_cogo.intMode === 'dd') html += _cogoSeg(_cogo.ddSide, [['right', 'A→B の右側'], ['left', 'A→B の左側']], 'cogoSetDdSide');
    html += _cogoKv([['交点', `X ${cogoFix(p.X, 3)}<br>Y ${cogoFix(p.Y, 3)}`, 'cogo-big']]) + _cogoAddBtn();
    return { point: p, alt, lines, rays, circles, html };
}
function _cogoAddBtn() { return '<div class="cogo-btns"><button class="prop-btn" onclick="cogoAddPoint()">＋ 測点として追加</button></div>'; }
function _cogoUpdateResult() {
    const box = document.getElementById('cogo-result');
    if(box) box.innerHTML = _cogoCompute().html || '';
}
function _cogoLogInverse() {
    const a = _cogoSlotSurvey('IA'), b = _cogoSlotSurvey('IB');
    if(!a || !b) return;
    const r = cogoInverse(a, b);
    addCommandLog(`-> 逆計算 ${a.name || 'A'}→${b.name || 'B'}: 距離 ${cogoFix(r.dist, 3)}m 方向角 ${cogoFmtDms(r.az)}（ΔX ${_cogoSigned(r.dX)} ΔY ${_cogoSigned(r.dY)}）`);
}
// 逆計算を続ける: 終点を次の始点にして、次の終点を指定する
window.cogoInvNext = function() {
    if(!_cogo.slots.IB) return;
    _cogo.slots.IA = _cogo.slots.IB;
    delete _cogo.slots.IB;
    _cogo.pick = { keys: ['IB'], i: 0 };
    _cogoStartPick();
};
window.cogoAddPoint = function() {
    const c = _cogoCompute();
    if(!c.point) { showToast('点を計算できません。入力を確かめてください', 3000); return; }
    const key = _cogo.tab === 'int' ? 'intName' : 'ptName';
    const name = String(_cogo.vals[key] || '').trim() || _cogoSuggestName();
    if(collectSurveyPoints().some((p) => p.name === name) && !confirm(`点名「${name}」はすでにあります。同じ名前で追加しますか？`)) return;
    cogoAddSurveyPoint(c.point.X, c.point.Y, name);
    addCommandLog(`-> 点「${name}」を追加 X ${cogoFix(c.point.X, 3)} Y ${cogoFix(c.point.Y, 3)}`);
    showToast(`点「${name}」を追加しました`, 2500);
    _cogo.lastName = name;
    _cogo.vals[key] = cogoNextName(name);
    _cogoRender();
    render();
};

// ===== 重ね表示（点の欄の印・補助線・計算した点） =====
function _cogoOverlayOn() {
    if(cogoIsPicking()) return cmdState.mode === COGO_LOT_MODE || !_cogo.pick || _cogo.pick.owner === 'cogo';
    const p = document.getElementById('property-panel'), t = document.getElementById('property-panel-title');
    return !!(p && p.style.display === 'flex' && t && t.textContent === COGO_TITLE);
}
function _cogoScr(sp) { const w = surveyToWcs(sp.X, sp.Y); return wcsToScreen(w.x, w.y); }
function drawCogoOverlay() {
    if(!_cogoOverlayOn()) return;
    const c = _cogo.tab === 'area' ? {} : _cogoCompute(), cyan = '#00ffff', green = '#00ff88';
    ctx.save();
    ctx.lineWidth = 1.5;
    // 求積の区画
    if(_cogo.tab === 'area' && _cogo.area) {
        const pts = _cogo.area.pts.map((p) => wcsToScreen(p.x, p.y));
        ctx.strokeStyle = cyan; ctx.lineWidth = 3; ctx.globalAlpha = 0.6; ctx.setLineDash([]);
        ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
        ctx.globalAlpha = 1; ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = cyan; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        if(pts.length <= 200) pts.forEach((p, i) => ctx.fillText(String(i + 1), p.x + 4, p.y - 3));
    }
    // 補助線
    ctx.strokeStyle = cyan; ctx.lineWidth = 1.5;
    (c.lines || []).forEach(([u, v, kind, through]) => {
        let a = u, b = v;
        if(kind === 'ext' && through) {
            // 2点と交点を含む範囲まで延ばす
            const dX = v.X - u.X, dY = v.Y - u.Y, L2 = dX * dX + dY * dY || 1;
            const t = ((through.X - u.X) * dX + (through.Y - u.Y) * dY) / L2;
            const t0 = Math.min(0, t), t1 = Math.max(1, t);
            a = { X: u.X + dX * t0, Y: u.Y + dY * t0 }; b = { X: u.X + dX * t1, Y: u.Y + dY * t1 };
        }
        const sa = _cogoScr(a), sb = _cogoScr(b);
        ctx.setLineDash(kind === 'dash' || kind === 'ext' ? [6, 4] : []);
        ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    });
    ctx.setLineDash([6, 4]);
    (c.rays || []).forEach(([a, az]) => {
        // 方向角の線: 交点があれば少し先まで、無ければ画面の対角の長さ
        const sa = _cogoScr(a), f = surveyUnitFactor();
        const len = c.point ? cogoInverse(a, c.point).dist * 1.2 : Math.hypot(canvas.width, canvas.height) / (view.scale * f);
        const sb = _cogoScr(cogoPolar(a, az, Math.max(len, 1e-9)));
        ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    });
    (c.circles || []).forEach(([a, r]) => {
        const sa = _cogoScr(a), rr = r * surveyUnitFactor() * view.scale;
        if(rr > 2 && rr < 1e6) { ctx.beginPath(); ctx.arc(sa.x, sa.y, rr, 0, Math.PI * 2); ctx.stroke(); }
    });
    ctx.setLineDash([]);
    // 点の欄の印（緑＝指定した点）
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    _cogoTabSlots().forEach((k) => {
        const s = _cogo.slots[k];
        if(!s) return;
        const p = wcsToScreen(s.x, s.y);
        ctx.strokeStyle = green; ctx.fillStyle = green; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.fillText(COGO_SLOT_LABELS[k][1], p.x + 8, p.y - 4);
    });
    // 計算した点（水色の二重丸と十字）。距離交会のもう一方の解は薄く
    const mark = (sp, alpha) => {
        const p = _cogoScr(sp);
        ctx.globalAlpha = alpha; ctx.strokeStyle = cyan; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x - 13, p.y); ctx.lineTo(p.x + 13, p.y); ctx.moveTo(p.x, p.y - 13); ctx.lineTo(p.x, p.y + 13); ctx.stroke();
    };
    if(c.alt) mark(c.alt, 0.35);
    if(c.point) mark(c.point, 1);
    ctx.restore();
}

// ===== コマンド =====
function processCogoCommand(cmd) {
    if(cmd === 'COGO' || cmd === 'CALC') { window.showCogoPanel(); return true; }
    if(cmd === 'AREA' || cmd === 'AA' || cmd === 'KYUSEKI') { window.showCogoPanel('area'); return true; }
    if(cmd === 'INV' || cmd === 'INVERSE') { window.showCogoPanel('inv'); return true; }
    if(cmd === 'PTADD' || cmd === 'RADIATE') { window.showCogoPanel('pt'); return true; }
    if(cmd === 'INTERS' || cmd === 'KOUTEN') { window.showCogoPanel('int'); return true; }
    return false;
}

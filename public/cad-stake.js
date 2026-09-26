// ===== Web CAD 杭打ちナビ =====
// cad-stake.js - 「📍 杭打ち」パネル。打つ杭（測点）を順に選び、2つの方法で案内する。
//   現在地から: スマホの現在地（GNSS）から杭までの距離・向き・北へ／東へ。🧭 で矢印を端末の向きに合わせる（磁北の目安）。
//               スマホの GNSS は数 m ずれるので、杭のおおよその場所を探す用途（境界標を探す など）。
//   器械点から: 器械点と後視点から、杭の夾角（後視を 0° とした右回り）・方向角・水平距離・高低差。杭打ち表（CSV・図面に置く）。
// 点の欄（器械点・後視点・杭）は測量計算（cad-cogo-ui.js）と同じ: 📍 でなぞって ☑確定、または点名・「X,Y」。
// 杭打ちの記録: 「✓ 済」で、現在地から案内しているときは現在地と杭の差（実測 − 計画）・精度・日時を、その測点の図形（e.stake）に残す。
//   図面と一緒に保存され、↩ で戻せる。済みの印もこの記録から決まる。記録は CSV に出せる。

const STAKE_TITLE = '📍 杭打ち';
const STAKE_DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
Object.assign(COGO_SLOT_LABELS, { KT: ['杭', '杭'], KS: ['器械点', '器'], KB: ['後視点', '後'] });
const _stake = {
    mode: 'gnss',     // 'gnss'（現在地から）| 'ts'（器械点から）
    list: [],         // 打つ杭の順番 [{ x, y, name, z, id（測点の図形） }]（図面の座標）
    idx: -1,
    loose: new Map(), // 測点の図形が無い杭（座標で入れた杭）の記録（座標のキー → 記録。図面には残らない）
    compass: false, heading: null, orientTimer: null,
    near: false,      // 杭の近く（精度の範囲内）に入ったか（入ったときだけ振動する）
};
cogoRegisterPickOwner('stake', { slots: () => _stakeSlots(), render: () => _stakeRender(), update: () => _stakeUpdate() });
function _stakeSlots() { return _stake.mode === 'ts' ? ['KS', 'KB', 'KT'] : ['KT']; }
function _stakeKey(p) { return Math.round(p.x * 1e4) + ',' + Math.round(p.y * 1e4); }
function _stakeTarget() { return _cogo.slots.KT || null; }
function _stakeFmtTime(iso) {
    const d = new Date(iso);
    if(isNaN(d.getTime())) return '';
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
// ---- 杭打ちの記録 ----
// 杭（順番の点・点の欄）の測点の図形
function _stakeEntityOf(p) {
    if(!p) return null;
    let id = p.id;
    if(id === undefined || id === null) { const q = _stake.list.find((l) => _stakeKey(l) === _stakeKey(p)); if(q) id = q.id; }
    const i = (id === undefined || id === null) ? -1 : entityIndexById(id);
    return i >= 0 ? entities[i] : null;
}
// 記録 { time, X, Y（実測・m）, dX, dY（実測 − 計画）, dist, acc } または { time }（位置を測らずに済みにしたとき）
function _stakeRec(p) { const e = _stakeEntityOf(p); return e ? (e.stake || null) : (_stake.loose.get(_stakeKey(p)) || null); }
function _stakeIsDone(p) { return !!_stakeRec(p); }
function _stakeSetRec(p, rec) {
    const e = _stakeEntityOf(p);
    if(e) {
        saveUndo();
        if(rec) e.stake = rec; else delete e.stake;
        if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    } else if(rec) _stake.loose.set(_stakeKey(p), rec);
    else _stake.loose.delete(_stakeKey(p));
}

// 打つ杭の順番: 範囲選択した測点、無ければ図面のすべての測点（座標一覧と同じ並び）
function _stakeBuildList() {
    const sel = new Set(cmdState.selectedIndices || []);
    if(cmdState.highlightIdx >= 0) sel.add(cmdState.highlightIdx);
    const all = collectSurveyPoints();
    const picked = sel.size ? all.filter((p) => sel.has(p.idx)) : [];
    return (picked.length ? picked : all).map((p) => ({ x: p.x, y: p.y, name: p.name || String(p.num || ''), z: p.z, id: p.id }));
}
window.showStakePanel = function() {
    _stake.list = _stakeBuildList();
    const t = _stakeTarget();
    const i = t ? _stake.list.findIndex((p) => _stakeKey(p) === _stakeKey(t)) : -1;
    if(i >= 0) _stake.idx = i;
    else if(_stake.list.length) _stakeGo(0);
    _stakeRender();
    render();
};
// 順番の i 番目の杭にする
function _stakeGo(i) {
    const n = _stake.list.length;
    if(!n) return;
    _stake.idx = ((i % n) + n) % n;
    const p = _stake.list[_stake.idx];
    _cogo.slots.KT = { x: p.x, y: p.y, name: p.name, snapped: true, id: p.id };
    _stake.near = false;
}
window.stakeStep = function(d) { _stakeGo(_stake.idx + d); _stakeRender(); renderOverlay(); };
// 済みにして記録を残し、次の済んでいない杭へ（済んだ杭でもう一度押すと、記録を消して取り消す）。
// 現在地から案内しているときは、現在地と杭の差（実測 − 計画）・精度も記録する
window.stakeToggleDone = function() {
    const t = _stakeTarget();
    if(!t) return;
    if(_stakeIsDone(t)) {
        if(!confirm(`${t.name || 'この杭'} の記録を消して、済みを取り消しますか？`)) return;
        _stakeSetRec(t, null);
        _stakeRender(); renderOverlay();
        return;
    }
    const rec = { time: new Date().toISOString() };
    const f = (_stake.mode === 'gnss' && typeof _gnss !== 'undefined' && _gnss.on) ? _gnss.fix : null;
    if(f) {
        const m = wcsToSurvey(f.x, f.y), d = wcsToSurvey(t.x, t.y);
        Object.assign(rec, { X: m.X, Y: m.Y, dX: m.X - d.X, dY: m.Y - d.Y, dist: Math.hypot(m.X - d.X, m.Y - d.Y), acc: f.acc || 0 });
    }
    _stakeSetRec(t, rec);
    addCommandLog(`-> 杭打ち: ${t.name || '(点名なし)'} を済みにしました` +
        (rec.dist !== undefined ? `（差 ΔX ${_cogoSigned(rec.dX)} ΔY ${_cogoSigned(rec.dY)}・${cogoFix(rec.dist, 3)}m、精度 ±${cogoFix(rec.acc, 1)}m）` : ''));
    const n = _stake.list.length;
    for(let s = 1; s <= n; s++) {
        const j = (_stake.idx + s) % n;
        if(!_stakeIsDone(_stake.list[j])) { _stakeGo(j); break; }
    }
    if(n && _stake.list.every((p) => _stakeIsDone(p))) showToast('順番の杭はすべて済みました', 3000);
    _stakeRender();
    renderOverlay();
};
// 杭打ちの記録を CSV に出す（順番の杭のうち記録のあるもの）
window.stakeExportRecords = function() {
    const rows = _stake.list.map((p) => ({ p, r: _stakeRec(p) })).filter((x) => x.r);
    if(!rows.length) { showToast('杭打ちの記録がありません', 2500); return; }
    const q = (s) => /[",\r\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s);
    const L = ['杭,計画X,計画Y,実測X,実測Y,ΔX(実測-計画),ΔY(実測-計画),差,精度,日時'];
    rows.forEach(({ p, r }) => {
        const d = wcsToSurvey(p.x, p.y), has = r.dist !== undefined;
        L.push([q(p.name || ''), cogoFix(d.X, 3), cogoFix(d.Y, 3), has ? cogoFix(r.X, 3) : '', has ? cogoFix(r.Y, 3) : '', has ? cogoFix(r.dX, 3) : '', has ? cogoFix(r.dY, 3) : '',
            has ? cogoFix(r.dist, 3) : '', has ? cogoFix(r.acc, 1) : '', q(_stakeFmtTime(r.time))].join(','));
    });
    downloadBlob(new Blob(['\uFEFF' + L.join('\r\n') + '\r\n'], { type: 'text/csv' }), `${_baseName()}_杭打ち記録.csv`);
    addCommandLog(`-> 杭打ちの記録を CSV に出しました（${rows.length}点）`);
};
window.stakeSetMode = function(m) {
    if(cogoIsPicking() && _cogo.pick && _cogo.pick.owner === 'stake') { _cogo.pick = null; resetCommand(); }
    _stake.mode = m === 'ts' ? 'ts' : 'gnss';
    _stakeRender();
    renderOverlay();
};
// 杭を画面の中央に出す（拡大しすぎず、1辺 約40m が見えるまで寄る）
window.stakeShowTarget = function() {
    const t = _stakeTarget();
    if(!t) return;
    const target = Math.min(canvas.width, canvas.height) / (40 * surveyUnitFactor());
    if(view.scale < target) view.scale = target;
    _reanchorView(canvas.width / 2, canvas.height / 2, { x: t.x, y: t.y });
    render();
    if(panelCoversDrawing()) hidePropertyPanel();
};

// ===== パネル =====
function _stakeCountText() {
    const n = _stake.list.length;
    if(!n) return '順番の杭はありません（点名で指定）';
    const d = _stake.list.filter((p) => _stakeIsDone(p)).length;
    return `${_stake.idx + 1} / ${n}（済 ${d}）`;
}
function _stakeRender() {
    let h = _cogoSeg(_stake.mode, [['gnss', '現在地から'], ['ts', '器械点から']], 'stakeSetMode');
    if(_stake.mode === 'ts') h += _cogoSlotHtml('KS', 'stake') + _cogoSlotHtml('KB', 'stake');
    h += _cogoSlotHtml('KT', 'stake');
    const t = _stakeTarget(), dis = _stake.list.length ? '' : 'disabled';
    const isDone = t && _stakeIsDone(t);
    h += `<div class="stake-nav">
        <button class="prop-btn btn-sub" onclick="stakeStep(-1)" ${dis} aria-label="前の杭">◀</button>
        <div id="stake-count" class="stake-count">${_stakeCountText()}</div>
        <button class="prop-btn btn-sub" onclick="stakeStep(1)" ${dis} aria-label="次の杭">▶</button>
        <button class="prop-btn ${isDone ? '' : 'btn-sub'}" onclick="stakeToggleDone()" ${t ? '' : 'disabled'}>✓ 済</button>
        <button class="prop-btn btn-sub" onclick="stakeShowTarget()" ${t ? '' : 'disabled'} title="杭を画面の中央に">🔍</button></div>`;
    h += '<div id="stake-result" class="cogo-result"></div>';
    showPropertyPanel(STAKE_TITLE, h);
    _stakeUpdate();
}
function _stakeUpdate() {
    const box = document.getElementById('stake-result');
    if(!box) return;
    const t = _stakeTarget();
    if(!t) { box.innerHTML = _cogoNote('打つ杭を、点名・「X,Y」で入れるか 📍 で図面から指定します。範囲選択した測点を順番に打てます（◀ ▶）。'); return; }
    box.innerHTML = (_stake.mode === 'ts' ? _stakeTsHtml(t) : _stakeGnssHtml(t)) + _stakeRecHtml(t) +
        (_stake.list.some((p) => _stakeIsDone(p)) ? '<div class="cogo-btns"><button class="prop-btn btn-sub" onclick="stakeExportRecords()">📄 杭打ち記録 CSV</button></div>' : '');
}
// いまの杭の記録
function _stakeRecHtml(t) {
    const r = _stakeRec(t);
    if(!r) return '';
    if(r.dist === undefined) return `<div class="stake-rec">✓ 済（${_stakeFmtTime(r.time)}）</div>`;
    return `<div class="stake-rec">✓ 記録 ${_stakeFmtTime(r.time)}<br>実測 X ${cogoFix(r.X, 3)}&nbsp;&nbsp;Y ${cogoFix(r.Y, 3)}<br>` +
        `差（実測−計画） ΔX ${_cogoSigned(r.dX)}&nbsp;&nbsp;ΔY ${_cogoSigned(r.dY)}（${cogoFix(r.dist, 3)} m）・精度 ±${cogoFix(r.acc, 1)} m</div>`;
}
// 現在地（GNSS）が更新されたとき（cad-survey.js から）
function stakeOnGnss() { if(_stakePanelOpen() && _stake.mode === 'gnss') { _stakeUpdate(); } }

// ---- 現在地から ----
function _stakeDirName(az) { return STAKE_DIRS[Math.round(cogoNormDeg(az) / 45) % 8]; }
function _stakeArrowDeg(az) { return (_stake.compass && _stake.heading !== null) ? cogoNormDeg(az - _stake.heading) : cogoNormDeg(az); }
function _stakeGnssHtml(t) {
    if(typeof _gnss === 'undefined' || !_gnss.on) {
        return _cogoNote('スマホの現在地から、杭までの距離と向きを案内します（GNSS の精度は数 m です。杭のおおよその場所を探すときに使います）。') +
            '<button class="prop-btn" onclick="stakeUseGnss()">🛰 現在地を使う</button>';
    }
    const f = _gnss.fix;
    if(!f) return _cogoNote('🛰 測位中…（空の見える場所で少し待ちます）');
    const a = wcsToSurvey(f.x, f.y), b = wcsToSurvey(t.x, t.y), inv = cogoInverse(a, b);
    const acc = f.acc || 0, here = inv.dist <= Math.max(1, acc);
    if(here && !_stake.near) { _stake.near = true; if(navigator.vibrate) navigator.vibrate([80, 60, 80]); }
    else if(!here && inv.dist > Math.max(1, acc) * 1.5) _stake.near = false;
    const deg = _stakeArrowDeg(inv.az);
    const north = !(_stake.compass && _stake.heading !== null);
    return `<div class="stake-big">
            <svg class="stake-arrow" viewBox="-50 -50 100 100" aria-hidden="true">
                <circle r="46" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
                ${north ? '<text y="-34" text-anchor="middle" font-size="12" fill="#9aa3ad">北</text>' : ''}
                <g id="stake-arrow-g" transform="rotate(${deg.toFixed(1)})"><path d="M0,-40 L17,12 L0,2 L-17,12 Z" fill="#00ffff"/></g>
            </svg>
            <div><div class="stake-dist">${inv.dist < 100 ? cogoFix(inv.dist, 1) : Math.round(inv.dist)} m</div>
                <div class="stake-dir">${_stakeDirName(inv.az)}（方向角 ${cogoFmtDms(inv.az)}）</div></div></div>` +
        (here ? `<div class="stake-here">📍 このあたりです（現在地の精度 ±${acc < 10 ? cogoFix(acc, 1) : Math.round(acc)}m の範囲）</div>` : '') +
        _cogoKv([['北へ', _cogoSigned(inv.dX) + ' m'], ['東へ', _cogoSigned(inv.dY) + ' m'], ['現在地の精度', '±' + (acc < 10 ? cogoFix(acc, 1) : Math.round(acc)) + ' m']]) +
        `<div class="cogo-btns"><button class="prop-btn ${_stake.compass ? '' : 'btn-sub'}" onclick="stakeToggleCompass()">🧭 向きに合わせる${_stake.compass ? '（ON）' : ''}</button></div>` +
        _cogoNote(north ? '矢印は北が上です。🧭 で、スマホの向きに合わせた矢印になります（磁北の目安で、数度ずれます）。' : '矢印はスマホの上の方向を基準にしています（磁北の目安）。');
}
window.stakeUseGnss = function() { if(typeof _gnss !== 'undefined' && !_gnss.on) window.toggleGnss(); _stakeUpdate(); };
window.stakeToggleCompass = async function() {
    if(_stake.compass) {
        _stake.compass = false; _stake.heading = null;
        window.removeEventListener('deviceorientationabsolute', _stakeOnOrient);
        window.removeEventListener('deviceorientation', _stakeOnOrient);
        _stakeUpdate();
        return;
    }
    try {
        // iPhone は、端末の向きを使う許可をボタンの操作で求める
        const DOE = window.DeviceOrientationEvent;
        if(DOE && typeof DOE.requestPermission === 'function') {
            const r = await DOE.requestPermission();
            if(r !== 'granted') { showToast('端末の向きを使う許可がありません', 3000); return; }
        }
    } catch(e) { showToast('端末の向きを使えませんでした: ' + e.message, 3500); return; }
    window.addEventListener('deviceorientationabsolute', _stakeOnOrient);
    window.addEventListener('deviceorientation', _stakeOnOrient);
    _stake.compass = true; _stake.heading = null;
    _stakeUpdate();
    setTimeout(() => { if(_stake.compass && _stake.heading === null) showToast('この端末では向きを取得できませんでした（矢印は北が上のままです）', 3500); }, 3000);
};
// 端末の向き（北から時計回りの度）。iPhone は webkitCompassHeading、Android は絶対の向き（alpha は反時計回り）
function _stakeOnOrient(e) {
    let h = null;
    if(typeof e.webkitCompassHeading === 'number' && isFinite(e.webkitCompassHeading)) h = e.webkitCompassHeading;
    else if(e.absolute && typeof e.alpha === 'number' && isFinite(e.alpha)) h = 360 - e.alpha;
    if(h === null) return;
    const scr = window.screen;
    const so = (scr && scr.orientation && typeof scr.orientation.angle === 'number') ? scr.orientation.angle : (window.orientation || 0);
    _stake.heading = cogoNormDeg(h + so);
    if(_stake.orientTimer) return;
    _stake.orientTimer = setTimeout(() => {
        _stake.orientTimer = null;
        // 矢印だけを回す（パネル全体は描き直さない）
        const g = document.getElementById('stake-arrow-g'), t = _stakeTarget(), f = typeof _gnss !== 'undefined' ? _gnss.fix : null;
        if(!g || !t || !f) { _stakeUpdate(); return; }
        const inv = cogoInverse(wcsToSurvey(f.x, f.y), wcsToSurvey(t.x, t.y));
        g.setAttribute('transform', `rotate(${_stakeArrowDeg(inv.az).toFixed(1)})`);
    }, 100);
}

// ---- 器械点から ----
// 図面の点の標高（同じ位置の測点。無ければ null）
function _stakeZAt(x, y) {
    const tol = 1e-6 * surveyUnitFactor();
    const p = collectSurveyPoints().find((q) => Math.abs(q.x - x) <= tol && Math.abs(q.y - y) <= tol && q.z !== null && q.z !== undefined);
    return p ? p.z : null;
}
// 器械点・後視点から見た杭の値
function stakeFromStation(st, bs, tg) {
    const azB = cogoInverse(st, bs).az, r = cogoInverse(st, tg);
    return { az: r.az, ang: cogoNormDeg(r.az - azB), dist: r.dist, dX: r.dX, dY: r.dY };
}
function _stakeTsData() {
    const s = _cogo.slots.KS, b = _cogo.slots.KB;
    if(!s || !b) return null;
    const st = wcsToSurvey(s.x, s.y), bs = wcsToSurvey(b.x, b.y);
    if(cogoInverse(st, bs).dist <= 0) return { error: '器械点と後視点が同じ位置です' };
    return { s, b, st, bs, stZ: _stakeZAt(s.x, s.y) };
}
function _stakeTsHtml(t) {
    const d = _stakeTsData();
    if(!d) return _cogoNote('器械点と後視点を指定すると、杭の夾角（後視を 0° とした右回り）と水平距離を出します。');
    if(d.error) return _cogoNote(d.error);
    const tg = wcsToSurvey(t.x, t.y), r = stakeFromStation(d.st, d.bs, tg), tz = _stakeZAt(t.x, t.y);
    const pairs = [['夾角（右回り）', cogoFmtDms(r.ang), 'cogo-big'], ['水平距離', cogoFix(r.dist, 3) + ' m', 'cogo-big'], ['方向角', cogoFmtDms(r.az)],
        ['後視の方向角', cogoFmtDms(cogoInverse(d.st, d.bs).az)]];
    if(d.stZ !== null && tz !== null) pairs.push(['高低差（地盤）', _cogoSigned(tz - d.stZ) + ' m']);
    let h = _cogoKv(pairs);
    if(_stake.list.length) {
        const cur = _stakeKey(t);
        const rows = _stake.list.slice(0, 300).map((p) => {
            const q = stakeFromStation(d.st, d.bs, wcsToSurvey(p.x, p.y));
            const k = _stakeKey(p);
            return `<tr class="${k === cur ? 'stake-cur' : ''}"><td class="c">${_stakeIsDone(p) ? '✓ ' : ''}${escapeHtml(p.name || '')}</td><td class="r">${cogoFmtDms(q.ang)}</td><td class="r">${cogoFix(q.dist, 3)}</td></tr>`;
        }).join('');
        h += `<div class="cogo-table-wrap"><table class="cogo-table"><thead><tr><th>杭</th><th>夾角</th><th>水平距離</th></tr></thead><tbody>${rows}</tbody></table></div>`;
        h += `<div class="cogo-btns"><button class="prop-btn" onclick="stakePlaceTable()">📋 杭打ち表を図面に置く</button><button class="prop-btn btn-sub" onclick="stakeExportCsv()">📄 CSV出力</button></div>`;
    }
    return h;
}
// 杭打ち表の中身（点名・X・Y・方向角・夾角・水平距離）
function _stakeTableRows(d) {
    return _stake.list.map((p) => {
        const s = wcsToSurvey(p.x, p.y), q = stakeFromStation(d.st, d.bs, s);
        return [p.name || '', cogoFix(s.X, 3), cogoFix(s.Y, 3), cogoFmtDms(q.az), cogoFmtDms(q.ang), cogoFix(q.dist, 3)];
    });
}
const STAKE_COLS = [{ head: '杭', align: 'center' }, { head: 'X', align: 'right' }, { head: 'Y', align: 'right' }, { head: '方向角', align: 'right' }, { head: '夾角', align: 'right' }, { head: '水平距離', align: 'right' }];
function _stakeTitle(d) { return '杭打ち表　器械点 ' + (d.s.name || '(点名なし)') + '・後視点 ' + (d.b.name || '(点名なし)'); }
window.stakePlaceTable = function() {
    const d = _stakeTsData();
    if(!d || d.error || !_stake.list.length) return;
    const pts = _stake.list.map((p) => ({ x: p.x, y: p.y })).concat([{ x: d.s.x, y: d.s.y }]);
    const b = _cogoBounds(pts), h = cogoNoteHeight(pts);
    const r = cogoGridTable({ left: b.maxX + h * 3, top: b.maxY, h, layer: _ensureSurveyLayer('杭打ち表', '#ffffff'), title: _stakeTitle(d), cols: STAKE_COLS, rows: _stakeTableRows(d) });
    _cogoPushGroup(r.entities, 'stake', '杭打ち表');
    _cogoZoomTo(b.minX, Math.min(b.minY, b.maxY - r.height), b.maxX + h * 3 + r.width, b.maxY);
    addCommandLog(`-> 杭打ち表を置きました（${_stake.list.length}点、器械点 ${d.s.name || ''}・後視点 ${d.b.name || ''}）`);
    showToast('杭打ち表を置きました（移動で動かせます）', 3000);
    if(panelCoversDrawing()) hidePropertyPanel();
};
window.stakeExportCsv = function() {
    const d = _stakeTsData();
    if(!d || d.error || !_stake.list.length) return;
    const q = (s) => /[",\r\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s);
    const L = [['杭打ち表', '器械点 ' + (d.s.name || ''), '後視点 ' + (d.b.name || '')].map(q).join(','), STAKE_COLS.map((c) => q(c.head)).join(',')];
    _stakeTableRows(d).forEach((r) => L.push(r.map(q).join(',')));
    downloadBlob(new Blob(['\uFEFF' + L.join('\r\n') + '\r\n'], { type: 'text/csv' }), `${_baseName()}_杭打ち表.csv`);
    addCommandLog(`-> 杭打ち表のCSVを出力しました（${_stake.list.length}点）`);
};

// ===== 重ね表示（順番の杭・済み・いまの杭・案内の線） =====
function _stakePanelOpen() {
    const p = document.getElementById('property-panel'), t = document.getElementById('property-panel-title');
    return !!(p && p.style.display === 'flex' && t && t.textContent === STAKE_TITLE);
}
function drawStakeOverlay() {
    const picking = cogoIsPicking() && _cogo.pick && _cogo.pick.owner === 'stake';
    if(!_stakePanelOpen() && !picking) return;
    const cyan = '#00ffff', green = '#00ff88', t = _stakeTarget();
    ctx.save();
    ctx.lineWidth = 1.5; ctx.setLineDash([]);
    // 順番の杭（済みは緑のチェック）
    if(_stake.list.length <= 2000) _stake.list.forEach((p) => {
        const s = wcsToScreen(p.x, p.y);
        if(s.x < -20 || s.y < -20 || s.x > canvas.width + 20 || s.y > canvas.height + 20) return;
        if(_stakeIsDone(p)) {
            ctx.strokeStyle = green; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x - 2, s.y + 5); ctx.lineTo(s.x + 7, s.y - 6); ctx.stroke();
        } else {
            ctx.strokeStyle = 'rgba(0,255,255,0.6)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.stroke();
        }
    });
    // 案内の線: 器械点から（器械点→後視は薄い点線）・現在地から
    const line = (a, b, dash, color) => { const sa = wcsToScreen(a.x, a.y), sb = wcsToScreen(b.x, b.y); ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke(); };
    if(t) {
        if(_stake.mode === 'ts' && _cogo.slots.KS) {
            if(_cogo.slots.KB) line(_cogo.slots.KS, _cogo.slots.KB, [2, 4], 'rgba(255,255,255,0.5)');
            line(_cogo.slots.KS, t, [6, 4], cyan);
        } else if(_stake.mode === 'gnss' && typeof _gnss !== 'undefined' && _gnss.on && _gnss.fix) {
            line(_gnss.fix, t, [6, 4], cyan);
        }
    }
    ctx.setLineDash([]);
    // 器械点・後視点の印
    if(_stake.mode === 'ts') {
        ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ['KS', 'KB'].forEach((k) => {
            const p = _cogo.slots[k];
            if(!p) return;
            const s = wcsToScreen(p.x, p.y);
            ctx.strokeStyle = green; ctx.fillStyle = green; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.stroke();
            ctx.fillText(COGO_SLOT_LABELS[k][1], s.x + 8, s.y - 4);
        });
    }
    // いまの杭（水色の二重丸と十字、点名）
    if(t) {
        const s = wcsToScreen(t.x, t.y);
        ctx.strokeStyle = cyan; ctx.fillStyle = cyan; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(s.x, s.y, 15, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.x - 20, s.y); ctx.lineTo(s.x + 20, s.y); ctx.moveTo(s.x, s.y - 20); ctx.lineTo(s.x, s.y + 20); ctx.stroke();
        if(t.name) { ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(t.name, s.x + 17, s.y - 15); }
    }
    ctx.restore();
}

// ===== コマンド =====
function processStakeCommand(cmd) {
    if(cmd === 'STAKE' || cmd === 'KUI' || cmd === 'SETOUT') { window.showStakePanel(); return true; }
    return false;
}

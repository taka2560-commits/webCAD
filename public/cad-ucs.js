// ===== Web CAD UCS（座標系）の登録・管理 =====
// cad-ucs.js - UCS を名前を付けて登録し、切り替える（v5.42）。通常の画面でも全画面（座標読取）でも使える。
//
// ・今の UCS の名前: 下の欄の左（UCS: 名前）と、全画面の上の座標の左に出す。押すと UCS 管理
// ・原点移動・2点UCS・数値・点・線で UCS を決めたら、画面の下に「＋ 登録」を出す（押すと名前を付けて登録）
// ・UCS 管理（コマンド UCSMAN・UC）: 一覧から押して切り替え（今のものに印）、名前の変更、今の UCS で上書き、消す。
//   作る: 原点をタップ・2点・数値（原点の座標と回転角）・点を決めた座標に合わせる・線の向き
// ・登録したものは保存・図面一式に入る（{ name, x, y, angle }。x・y は本来の座標 WCS の原点、angle は左回りのラジアン）

const UCS_MGR_TITLE = '🎯 UCS 管理';
let ucsCurrentName = null; // 今の UCS が登録したもののどれか（その名前）。原点移動などで作り直したら null
let _ucsForm = false;      // UCS 管理の「数値で作る」を開いているか

function ucsIsWcs() { return ucs.originX === 0 && ucs.originY === 0 && !ucs.angle; }
// 登録した UCS の原点・角度（以前の図面一式は originX・originY の形で入っていた）
function ucsEntry(u) {
    const n = (v) => (typeof v === 'number' && isFinite(v)) ? v : 0;
    return { name: String(u && u.name || ''), x: n(u && (u.x !== undefined ? u.x : u.originX)), y: n(u && (u.y !== undefined ? u.y : u.originY)), angle: n(u && u.angle) };
}
function ucsSetCurrentName(name) { ucsCurrentName = (typeof name === 'string' && name) ? name : null; ucsStatusUpdate(); }
// 今の座標系の見出し: WCS・UCS・UCS: 名前
function ucsLabelText() { return ucsIsWcs() && !ucsCurrentName ? 'WCS' : (ucsCurrentName ? `UCS: ${ucsCurrentName}` : 'UCS'); }
// 下の欄・全画面の見出し・UCS読込の欄を今の UCS に合わせる
function ucsStatusUpdate() {
    const text = ucsLabelText(), isW = text === 'WCS', color = isW ? 'var(--coord-color)' : 'var(--ucs-color)';
    ['ucs-label', 'ucs-status-display'].forEach((id) => { const el = document.getElementById(id); if(el) { el.textContent = text; el.style.color = color; el.title = `${text}（押すと UCS 管理）`; } });
    const hud = document.getElementById('fs-hud-ucs');
    if(hud) { hud.textContent = text; hud.classList.toggle('on', !isW); }
    const i = ucsCurrentName ? savedUCSList.findIndex((u) => u.name === ucsCurrentName) : -1;
    ['ucs-select', 'fs-ucs-select'].forEach((id) => { const s = document.getElementById(id); if(s) s.value = i >= 0 ? String(i) : ''; });
}
// 登録した UCS の説明（原点は本来の座標 WCS。X＝北・Y＝東）
function _ucsDesc(u) {
    return `原点 X ${formatCoordValue(u.y, 'loupe')}・Y ${formatCoordValue(u.x, 'loupe')}${u.angle ? `・回転 ${angleText(u.angle * 180 / Math.PI)}` : ''}`;
}

// ===== 登録 =====
// 今の UCS を登録する（name が無ければ名前を聞く。同じ名前があれば上書きするか聞く）
function ucsRegister(name) {
    const save = (nm) => {
        const n = String(nm || '').trim().slice(0, 60);
        if(!n) return;
        const put = () => {
            const e = { name: n, x: ucs.originX, y: ucs.originY, angle: ucs.angle };
            const i = savedUCSList.findIndex((u) => u.name === n);
            if(i >= 0) savedUCSList[i] = e; else savedUCSList.push(e);
            ucsAfterListChange();
            ucsSetCurrentName(n);
            addCommandLog(`-> UCS を登録しました: ${n}（${_ucsDesc(e)}）`);
            if(typeof showToast === 'function') showToast(`UCS「${n}」を登録しました`, 2000);
            _ucsRefreshPanel();
        };
        if(savedUCSList.some((u) => u.name === n)) cadConfirm({ title: 'UCS を上書き', message: `「${n}」はもう登録されています。今の UCS で上書きしますか？`, ok: '上書き' }, (ok) => { if(ok) put(); });
        else put();
    };
    if(name) { save(name); return; }
    cadPrompt({ title: '＋ UCS を登録', message: `今の UCS に名前を付けて登録します（${_ucsDesc({ x: ucs.originX, y: ucs.originY, angle: ucs.angle })}）。`,
        value: ucsCurrentName || `UCS_${savedUCSList.length + 1}`, ok: '登録' }, (raw) => { if(raw !== null) save(raw); });
}
// UCS を決めた直後（原点移動・2点・数値・点・線）: 下に「＋ 登録」を出す
function ucsOfferRegister() {
    if(ucsIsWcs() || typeof showSnack !== 'function') return;
    showSnack('UCS を決めました。名前を付けて登録すると、あとで切り替えられます', { kind: 'success', ms: 8000, action: { label: '＋ 登録', run: () => ucsRegister() } });
}
function ucsAfterListChange() {
    if(typeof updateUCSDropdowns === 'function') updateUCSDropdowns();
    if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
}

// ===== 管理（一覧・切り替え・名前・上書き・消す） =====
// 切り替えても UCS 管理は開いたまま（setUCS がコマンドを終えるときにパネルを閉じるので、開き直す）
function ucsUse(i) {
    if(!savedUCSList[i]) return;
    loadUCS(String(i));
    _ucsRender();
}
function ucsRename(i) {
    const u = savedUCSList[i];
    if(!u) return;
    cadPrompt({ title: 'UCS の名前', message: `「${u.name}」の新しい名前`, value: u.name, ok: '変える' }, (raw) => {
        const n = raw === null ? '' : String(raw).trim().slice(0, 60);
        if(!n || n === u.name) return;
        if(savedUCSList.some((x) => x !== u && x.name === n)) { showToast(`「${n}」はもうあります`, { kind: 'warn', ms: 2500 }); return; }
        const wasCur = ucsCurrentName === u.name;
        addCommandLog(`-> UCS の名前を変えました: ${u.name} → ${n}`);
        u.name = n;
        if(wasCur) ucsCurrentName = n;
        ucsAfterListChange(); ucsStatusUpdate(); _ucsRefreshPanel();
    });
}
function ucsOverwrite(i) {
    const u = savedUCSList[i];
    if(!u) return;
    cadConfirm({ title: 'UCS を上書き', message: `「${u.name}」を、今の UCS（${_ucsDesc({ x: ucs.originX, y: ucs.originY, angle: ucs.angle })}）で上書きしますか？`, ok: '上書き' }, (ok) => {
        if(!ok || savedUCSList[i] !== u) return;
        Object.assign(u, { x: ucs.originX, y: ucs.originY, angle: ucs.angle });
        ucsCurrentName = u.name;
        addCommandLog(`-> UCS「${u.name}」を今の UCS で上書きしました`);
        ucsAfterListChange(); ucsStatusUpdate(); _ucsRefreshPanel();
    });
}
// 登録を消す（今の UCS はそのまま。以前は消すと WCS に戻っていた）
function ucsDeleteAt(i) {
    const u = savedUCSList[i];
    if(!u) return;
    cadConfirm({ title: 'UCS を消す', message: `登録した UCS「${u.name}」を消しますか？（今の座標系はそのままです）`, ok: '消す', danger: true }, (ok) => {
        const k = savedUCSList.indexOf(u);
        if(!ok || k < 0) return;
        savedUCSList.splice(k, 1);
        if(ucsCurrentName === u.name) ucsCurrentName = null;
        addCommandLog(`-> UCS「${u.name}」を消しました`);
        ucsAfterListChange(); ucsStatusUpdate(); _ucsRefreshPanel();
    });
}
function ucsBackToWcs() { resetUCS(); _ucsRender(); }

// UCS 管理の窓
function showUcsManager() {
    _ucsForm = false;
    _ucsRender();
}
function _ucsRefreshPanel() {
    const t = document.getElementById('property-panel-title'), p = document.getElementById('property-panel');
    if(p && p.style.display === 'flex' && t && t.textContent === UCS_MGR_TITLE) _ucsRender();
}
function _ucsRender() {
    const cur = { x: ucs.originX, y: ucs.originY, angle: ucs.angle };
    let h = `<div class="cogo-note">今: <b style="color:${ucsIsWcs() && !ucsCurrentName ? 'var(--coord-color)' : 'var(--ucs-color)'};">${escapeHtml(ucsLabelText())}</b>${ucsIsWcs() ? '（本来の座標）' : `（${escapeHtml(_ucsDesc(cur))}）`}</div>`;
    if(_ucsForm) { h += _ucsFormHtml(cur); showPropertyPanel(UCS_MGR_TITLE, h); return; }
    h += '<div class="ts-sec" style="margin-top:6px;">登録した UCS（押すと切り替え）</div><div class="ucs-list">';
    if(!savedUCSList.length) h += '<div class="cogo-note" style="padding:6px 2px;">まだありません。UCS を決めてから「＋ 今の UCS を登録」を押します。</div>';
    savedUCSList.forEach((u0, i) => {
        const u = ucsEntry(u0), on = u.name === ucsCurrentName;
        h += `<div class="ucs-row${on ? ' on' : ''}"><button type="button" class="ucs-use" onclick="ucsUse(${i})" aria-pressed="${on}" title="この UCS にする"><span class="ucs-name">${on ? '● ' : ''}${escapeHtml(u.name)}</span><span class="ucs-desc">${escapeHtml(_ucsDesc(u))}</span></button>` +
            `<button type="button" class="ucs-act" onclick="ucsRename(${i})" title="名前を変える" aria-label="「${escapeHtml(u.name)}」の名前を変える">✏</button>` +
            `<button type="button" class="ucs-act" onclick="ucsOverwrite(${i})" title="今の UCS で上書き" aria-label="「${escapeHtml(u.name)}」を今の UCS で上書き">⤓</button>` +
            `<button type="button" class="ucs-act danger" onclick="ucsDeleteAt(${i})" title="消す" aria-label="「${escapeHtml(u.name)}」を消す">🗑</button></div>`;
    });
    h += '</div>';
    h += `<div class="cogo-btns"><button class="prop-btn" onclick="ucsRegister()" ${ucsIsWcs() ? 'disabled title="WCS（本来の座標）は登録しなくても ↩ WCS で戻せます"' : ''}>＋ 今の UCS を登録</button><button class="prop-btn btn-sub" onclick="ucsBackToWcs()">↩ WCS</button></div>`;
    h += '<div class="ts-sec" style="margin-top:8px;">UCS を作る</div><div class="ucs-make">' +
        '<button type="button" class="prop-btn btn-sub" onclick="closePropertyPanel(); issueCommand(\'UCS\');">🎯 原点をタップ</button>' +
        '<button type="button" class="prop-btn btn-sub" onclick="closePropertyPanel(); issueCommand(\'UCS2P\');">📈 2点（原点と向き）</button>' +
        '<button type="button" class="prop-btn btn-sub" onclick="ucsOpenForm()">🔢 数値で</button>' +
        '<button type="button" class="prop-btn btn-sub" onclick="ucsStartMatch()">📍 点を決めた座標に</button>' +
        '<button type="button" class="prop-btn btn-sub" onclick="ucsStartLine()">／ 線の向きで</button>' +
        '<button type="button" class="prop-btn btn-sub" onclick="togglePlanView(); _ucsRefreshPanel();">🧭 PLAN</button></div>';
    showPropertyPanel(UCS_MGR_TITLE, h);
}

// ===== 数値で作る（原点の座標と回転角） =====
function ucsOpenForm() { _ucsForm = true; _ucsRender(); }
function ucsCloseForm() { _ucsForm = false; _ucsRender(); }
function _ucsFormHtml(cur) {
    const num = (v) => String(+toDisplayUnit(v, 'coord').toFixed(4));
    const deg = cur.angle * 180 / Math.PI;
    const angVal = (typeof angleIsDms === 'function' && angleIsDms() && typeof formatDmsAngle === 'function') ? formatDmsAngle(deg) : String(+deg.toFixed(6));
    const row = (id, label, val, mode, unit) => `<div class="prop-row"><label for="${id}" style="width:auto;min-width:96px;">${label}</label><input id="${id}" class="prop-val" type="text" inputmode="${mode}" autocomplete="off" value="${escapeHtml(val)}"><span style="font-size:11px;color:#888;">${unit}</span></div>`;
    return '<div class="ts-sec" style="margin-top:6px;">🔢 数値で作る</div>' +
        '<div class="cogo-note">原点は本来の座標（WCS）で入れます。回転角は、本来の座標から左回り（反時計回り）に回す角度です（度、または 30 15 20 のように度分秒）。</div>' +
        row('ucs-f-x', '原点 X（北）', num(cur.y), 'decimal', displayUnitTag('coord')) +
        row('ucs-f-y', '原点 Y（東）', num(cur.x), 'decimal', displayUnitTag('coord')) +
        row('ucs-f-a', '回転角', angVal, 'text', '') +
        row('ucs-f-n', '登録する名前', '', 'text', '') +
        '<div class="cogo-note" style="margin-top:-4px;">名前を入れると、そのまま登録します（空なら登録しない）。</div>' +
        '<div class="cogo-btns"><button class="prop-btn" onclick="ucsApplyForm()">この UCS にする</button><button class="prop-btn btn-sub" onclick="ucsCloseForm()">戻る</button></div>';
}
function ucsApplyForm() {
    const ex = document.getElementById('ucs-f-x'), ey = document.getElementById('ucs-f-y'), ea = document.getElementById('ucs-f-a'), en = document.getElementById('ucs-f-n');
    const X = fieldNum(ex, { what: '原点 X' }), Y = fieldNum(ey, { what: '原点 Y' });
    if(X === undefined || Y === undefined || X === null || Y === null) return;
    const aText = ea ? String(ea.value).trim() : '';
    const deg = aText === '' ? 0 : parseAngleInput(aText);
    if(!isFinite(deg)) { if(typeof fieldError === 'function') fieldError(ea, '角度を読めません（例 30.5 または 30 30 00）'); return; }
    if(typeof fieldOk === 'function') fieldOk(ea);
    const name = en ? String(en.value).trim() : '';
    setUCS(fromDisplayUnit(Y, 'coord'), fromDisplayUnit(X, 'coord'), deg * Math.PI / 180);
    _ucsForm = false;
    _ucsRender();
    if(name) ucsRegister(name); else ucsOfferRegister();
}

// ===== 点を決めた座標に合わせる・線の向き（図面をタップ） =====
function ucsStartMatch() {
    closePropertyPanel();
    resetCommand();
    cmdState.mode = 'WAITING_UCS_MATCH';
    setPrompt('UCS: 座標を決めたい点をタップ（測点に吸い付きます）');
    addCommandLog('-> 点を決めた座標に合わせる: 点をタップ（向きは今の UCS のまま）');
    if(typeof showActionbarControls === 'function') showActionbarControls({ hideConfirm: true });
    render();
}
function ucsStartLine() {
    closePropertyPanel();
    resetCommand();
    cmdState.mode = 'WAITING_UCS_LINE';
    setPrompt('UCS: 向きにする線をタップ（タップした側の端が原点）');
    addCommandLog('-> 線の向きで UCS: 線・ポリライン・長方形の辺をタップ');
    if(typeof showActionbarControls === 'function') showActionbarControls({ hideConfirm: true });
    render();
}
// 点を入れたとき（cad-command.js の _handlePointInputCore から）。点・線の UCS なら処理して true
function ucsHandlePoint(wcs) {
    const m = cmdState.mode;
    if(m === 'WAITING_UCS_MATCH') {
        const P = { x: wcs.x, y: wcs.y }, u = wcsToUcs(P.x, P.y), f = (v) => String(+toDisplayUnit(v, 'coord').toFixed(4));
        resetCommand();
        const parse = (v) => { const mm = /^\s*(-?\d+(?:\.\d+)?)\s*[,，、\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec((typeof cogoHalfWidth === 'function') ? cogoHalfWidth(String(v)) : String(v)); return mm ? { X: parseFloat(mm[1]), Y: parseFloat(mm[2]) } : null; };
        cadPrompt({ title: '📍 この点の座標', message: `この点が、UCS でいくつになるようにしますか（「X,Y」。X＝北・Y＝東、${displayUnitTag('coord')}）。向きは今の UCS のままです。`,
            value: `${f(u.y)},${f(u.x)}`, ok: '合わせる', inputmode: 'text', validate: (v) => parse(v) ? '' : '「X,Y」の形で入れてください（例 100,200）' }, (raw) => {
            const t = raw === null ? null : parse(raw);
            if(!t) return;
            const ux = fromDisplayUnit(t.Y, 'coord'), uy = fromDisplayUnit(t.X, 'coord'), a = ucs.angle, c = Math.cos(a), s = Math.sin(a);
            setUCS(P.x - (ux * c - uy * s), P.y - (ux * s + uy * c), a); // 原点 = 点 − 回転(UCS の座標)
            ucsOfferRegister();
        });
        return true;
    }
    if(m === 'WAITING_UCS_LINE') {
        const idx = hitTestEntity(mouse.screenX, mouse.screenY), pick = screenToWcs(mouse.screenX, mouse.screenY);
        const s = idx >= 0 && typeof circleTanShape === 'function' ? circleTanShape(entities[idx], pick) : null;
        if(!s || s.k !== 'line') { if(typeof showToast === 'function') showToast('線・ポリライン・長方形の辺をタップしてください', 2500); return true; }
        const da = Math.hypot(pick.x - s.a.x, pick.y - s.a.y), db = Math.hypot(pick.x - s.b.x, pick.y - s.b.y);
        const o = da <= db ? s.a : s.b, q = da <= db ? s.b : s.a;
        setUCS(o.x, o.y, Math.atan2(q.y - o.y, q.x - o.x));
        ucsOfferRegister();
        return true;
    }
    return false;
}

// コマンド UCSMAN・UC（UCS 管理）・UCSSAVE（今の UCS を登録）
function processUcsCommand(cmd) {
    if(cmd === 'UCSMAN' || cmd === 'UC') { showUcsManager(); return true; }
    if(cmd === 'UCSSAVE') { if(ucsIsWcs()) showToast('今は WCS（本来の座標）です。UCS を決めてから登録します', 3000); else ucsRegister(); return true; }
    return false;
}

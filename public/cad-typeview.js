// ===== Web CAD 種類で絞る（見たい種類の図形だけを表示する） =====
// cad-typeview.js - 画層管理（👁）のパネルの「種類で絞る」。v5.60
//   もらったばかりの図面を、線だけ・円だけ・文字だけ…と種類を絞って、すっきり見るためのもの。
//   ・種類のボタンを押すと、その種類だけを表示する。絞っているあいだは、押すたびにその種類を足す・外す。「すべて表示」で元に戻す
//   ・しくみは、今ある「🚫 隠す」と同じ図形ごとの非表示（e.hidden）。この機能で隠した図形には e.hiddenBy = 'type' を付けて、
//     取り込みで隠した円弧・塗りつぶし（'arc'・'fill'）や、自分で隠した図形とは別に扱う（「すべて表示」で戻すのは 'type' だけ）。
//     自分で隠す・出す操作（🚫 隠す・ブロック管理の 👁・プロパティの表示）は、hiddenBy を消す（cad-panels.js。v5.60.1）
//   ・非表示の図形は、今までどおり、選べない・吸い付かない・印刷に出ない。↩ で戻せる。保存すると、絞ったまま残る
//   ・画層の表示・非表示とは別（両方で見えているものだけが出る）
// （ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

const TYPE_VIEW_BY = 'type';
// 種類（上から、ボタンの並び順）
const TYPE_VIEW_CATS = [
    { key: 'line', label: '線', icon: '／', title: '線分・ポリライン・四角（引出線の矢印も）' },
    { key: 'circle', label: '円', icon: '○', title: '円・楕円' },
    { key: 'arc', label: '円弧', icon: '◠', title: '円弧' },
    { key: 'text', label: '文字', icon: 'A', title: '文字（測点の点名は「点」、寸法の数字は「寸法」）' },
    { key: 'point', label: '点', icon: '⊙', title: '点・測点（点名の文字・ブロックの測点も）' },
    { key: 'dim', label: '寸法', icon: '↔', title: '寸法（取り込んだ寸法の線・数字も）' },
    { key: 'fill', label: '塗りつぶし', icon: '▨', title: '塗りつぶし（ハッチング）' },
    { key: 'other', label: 'その他', icon: '…', title: 'そのほかの図形' },
];
// ブロックの測点（属性の文字を持つブロック。座標一覧では測点）のまとまりの番号。その部品（記号の円・点名の文字）は「点」に入れる
function _typeViewPointGids() {
    const s = new Set();
    if(typeof collectSurveyPoints !== 'function') return s;
    collectSurveyPoints().forEach((p) => { if(p.kind === 'block' && p.gid) s.add(p.gid); });
    return s;
}
// 図形の種類（絞る対象でない図形は null: 写真のピン）。pg: ブロックの測点のまとまり（_typeViewPointGids。省くと見ない）
function typeViewCatOf(e, pg) {
    if(!e || e.type === 'PIN') return null;
    if(e.type === 'DIMENSION' || e.blockName === '寸法') return 'dim'; // 取り込んだ寸法は、線と数字に分けて「寸法」のまとまりにしてある
    if(pg && e.gid && pg.has(e.gid)) return 'point';                  // ブロックの測点（記号・点名）
    switch(e.type) {
        case 'LINE': case 'PLINE': case 'RECTANG': return 'line';
        case 'CIRCLE': case 'ELLIPSE': return 'circle';
        case 'ARC': return 'arc';
        case 'TEXT': return e.ptLabel ? 'point' : 'text'; // 測点の点名は、点と一緒に出す・隠す
        case 'POINT': return 'point';
        case 'HATCH': case 'SOLID': return e.arrow ? 'line' : 'fill'; // 引出線の矢印（塗り）は、線と一緒に出す・隠す
        default: return 'other';
    }
}
/**
 * 今の様子。{ active: 絞っているか, cats: { 種類: { n: その種類の図形の数, hidden: うち、この機能で隠している数 } }, hidden: 隠している数の合計 }
 *   ほかの理由で隠れている図形（取り込みで隠した円弧・塗りつぶし、🚫 隠す）は、数えない（この機能では出し入れしない）
 */
function typeViewState() {
    const cats = {}, pg = _typeViewPointGids();
    TYPE_VIEW_CATS.forEach((c) => { cats[c.key] = { n: 0, hidden: 0 }; });
    let hidden = 0;
    for(let i = 0; i < entities.length; i++) {
        const e = entities[i], k = typeViewCatOf(e, pg);
        if(!k) continue;
        const mine = !!e.hidden && e.hiddenBy === TYPE_VIEW_BY;
        if(e.hidden && !mine) continue;
        cats[k].n++;
        if(mine) { cats[k].hidden++; hidden++; }
    }
    return { active: hidden > 0, cats, hidden };
}
// 絞っているか（この機能で隠した図形が1つでもあるか）。見つけたらそこでやめるので、図形が多くても軽い
function typeViewActive() {
    for(let i = 0; i < entities.length; i++) { const e = entities[i]; if(e && e.hidden && e.hiddenBy === TYPE_VIEW_BY) return true; }
    return false;
}
// いま表示している種類（図形のある種類のうち、この機能で1つも隠していないもの）
function _typeViewShown(st) { return TYPE_VIEW_CATS.filter((c) => st.cats[c.key].n > 0 && st.cats[c.key].hidden === 0).map((c) => c.key); }
function _typeViewLabel(keys) { return TYPE_VIEW_CATS.filter((c) => keys.includes(c.key)).map((c) => c.label).join('・'); }
/**
 * 表示する種類を決める。shown: 種類の名前の配列（null・空・全部なら、絞るのをやめて元に戻す）。変えた図形の数を返す（↩ 1回分）
 */
function typeViewApply(shown) {
    const st = typeViewState(), pg = _typeViewPointGids();
    const exist = TYPE_VIEW_CATS.filter((c) => st.cats[c.key].n > 0).map((c) => c.key);
    let keep = Array.isArray(shown) ? exist.filter((k) => shown.includes(k)) : null;
    if(keep && (keep.length === 0 || keep.length === exist.length)) keep = null; // 何も出さない・全部出す ＝ 絞らない
    const change = [];
    entities.forEach((e) => {
        const k = typeViewCatOf(e, pg);
        if(!k) return;
        const mine = !!e.hidden && e.hiddenBy === TYPE_VIEW_BY;
        if(e.hidden && !mine) return; // ほかの理由で隠れている図形は、そのまま
        const hide = !!keep && !keep.includes(k);
        if(hide !== mine) change.push([e, hide]);
    });
    if(!change.length) { typeViewSync(); return 0; }
    // コマンドの途中（移動で対象を選んだあと など）で絞ると、隠した図形にその操作が届いてしまうので、先にコマンドを終える。
    // タッチで非表示（同じパネルの操作）は続ける。パネルが閉じたら出し直す
    if(cmdState.mode !== 'IDLE' && cmdState.mode !== 'WAITING_LAYOFF_TOUCH') {
        const open = _typeViewPanelOpen();
        resetCommand();
        if(open && !_typeViewPanelOpen() && typeof window.showLayerManagerPanel === 'function') window.showLayerManagerPanel();
    }
    saveUndo();
    change.forEach(([e, hide]) => { if(hide) { e.hidden = true; e.hiddenBy = TYPE_VIEW_BY; } else { e.hidden = false; delete e.hiddenBy; } });
    // 隠した図形を選んだままにしない
    const gone = (i) => i >= 0 && entities[i] && entities[i].hidden;
    if((cmdState.selectedIndices || []).some(gone) || gone(cmdState.highlightIdx)) { cmdState.selectedIndices = []; cmdState.highlightIdx = -1; if(typeof updatePropertiesPanel === 'function') updatePropertiesPanel(); }
    if(typeof _bumpGeomEpoch === 'function') _bumpGeomEpoch();
    if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    const after = typeViewState();
    if(keep) {
        const msg = `${_typeViewLabel(keep)} だけ表示しています（ほかの ${after.hidden}個 を隠しました）`;
        addCommandLog(`-> [種類で絞る] ${msg}。👁 画層管理の「すべて表示」で戻ります`);
        if(typeof showToast === 'function') showToast(`${msg}。👁 →「すべて表示」で戻ります`, 3200);
    } else {
        addCommandLog('-> [種類で絞る] すべての種類を表示しました');
        if(typeof showToast === 'function') showToast('すべての種類を表示しました', 1800);
    }
    typeViewSync();
    render();
    return change.length;
}
function _typeViewPanelOpen() {
    const p = document.getElementById('property-panel'), t = document.getElementById('property-panel-title');
    return !!p && p.style.display === 'flex' && !!t && t.textContent === '画層一括管理';
}
// 種類のボタン: 絞っていないときは、その種類だけを表示。絞っているときは、その種類を足す・外す（最後の1つを外す・全部になる → 元に戻す）
window.typeViewTap = function(key) {
    const st = typeViewState();
    if(!st.cats[key] || !st.cats[key].n) return 0;
    if(!st.active) return typeViewApply([key]);
    const shown = _typeViewShown(st);
    return typeViewApply(shown.includes(key) ? shown.filter((k) => k !== key) : shown.concat(key));
};
// すべて表示（絞るのをやめる）
window.typeViewClear = function() { return typeViewApply(null); };
// パネルの中身（画層管理のパネルに入れる。cad-panels.js の updateLayerManagerContent から）
function typeViewHtml() {
    const st = typeViewState();
    const list = TYPE_VIEW_CATS.filter((c) => st.cats[c.key].n > 0);
    if(list.length < 2 && !st.active) return ''; // 種類が1つしか無い図面では出さない
    const shown = _typeViewShown(st);
    const chips = list.map((c) => {
        const s = st.cats[c.key], on = st.active && s.hidden === 0, off = st.active && s.hidden > 0;
        const tip = st.active ? (on ? `${c.title}: 表示中。押すと隠す` : `${c.title}: 隠しています。押すと表示`) : `${c.title} だけを表示する`;
        return `<button class="tv-chip${on ? ' on' : ''}${off ? ' off' : ''}" data-tv="${c.key}" onclick="typeViewTap('${c.key}')" aria-pressed="${on ? 'true' : 'false'}" title="${escapeHtml(tip)}">` +
            `<span aria-hidden="true">${c.icon}</span>${c.label}<b>${s.n}</b></button>`;
    }).join('');
    const note = !st.active ? '種類を押すと、その種類だけを表示します（もらった図面を、線だけ・文字だけ…と分けて見るとき）。'
        : (shown.length ? `<b>${escapeHtml(_typeViewLabel(shown))}</b> だけ表示しています（ほかの ${st.hidden}個 を隠しています）。` : `いま表示している種類はありません（${st.hidden}個 を隠しています）。`) +
            '種類を押すと、足す・外す。隠した図形は選べないので、動かす・消すなどは見えている図形だけに効きます。';
    return `<div class="tv-box" id="tv-box"><div class="tv-head"><span>🔎 種類で絞る</span>` +
        (st.active ? '<button class="status-btn tv-all" id="tv-all" onclick="typeViewClear()" title="種類で絞るのをやめて、隠した図形を表示する">すべて表示</button>' : '') +
        `</div><div class="tv-chips">${chips}</div><div class="tv-note">${note}</div></div>`;
}
// 絞っているあいだは、上のバーの 👁（画層管理）と、全画面の引き出しの「👁 画層管理」に印を付ける（パネルを閉じても、絞っていることが分かるように）。
// パネルが出ていれば描き直す（skipPanel でなければ）
function typeViewSync(skipPanel) {
    const active = typeViewActive();
    document.querySelectorAll('.top-btn[onclick^="toggleLayerPanel()"], .fsd-btn[onclick^="toggleLayerPanel()"]').forEach((b) => {
        b.classList.toggle('tv-on', active);
        if(b.classList.contains('top-btn')) b.title = active ? '画層一括管理（種類で絞っています）' : '画層一括管理';
    });
    if(!skipPanel && typeof window.updateLayerManagerContent === 'function') window.updateLayerManagerContent();
}
// 図形を変える操作のあとで、印を合わせる（↩ の記録を取る saveUndo・図面を開く applyProjectData から。続けて何度呼ばれても、あとで1回だけ）
let _typeViewSoon = false;
function typeViewSyncSoon() {
    if(_typeViewSoon) return;
    _typeViewSoon = true;
    setTimeout(() => { _typeViewSoon = false; typeViewSync(true); }, 0);
}
// 絞っていることを思い出させる（全画面の座標読取に入ったとき。そこでは上のバーの印が見えない）
function typeViewRemind() {
    if(!typeViewActive()) return false;
    const st = typeViewState(), shown = _typeViewShown(st);
    if(typeof showToast === 'function') showToast(`種類で絞っています（${shown.length ? _typeViewLabel(shown) + ' だけ表示' : st.hidden + '個 を隠しています'}）。隠した図形は、読めません・吸い付きません。戻すには ☰ → 👁 画層管理 →「すべて表示」`, 4500);
    return true;
}

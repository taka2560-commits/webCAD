// ===== Web CAD お気に入りのボタン =====
// cad-fav.js - よく使うコマンドを登録して、画面の端に浮かぶバーのボタンから始める。
//   登録: ⋯ メニューの「⭐ お気に入り」の画面で ☆ を押す。左のツールバー・⋯ メニューのボタンを長押ししても登録できる。
//   バー: ⠿ をつまんで動かす（位置を覚える・ダブルタップで戻す）、⭐ でたたむ・広げる、＋ で登録の画面。
//         向き（縦・横）と名前の有無を選べる。座標読取モードでは出さない。
//   押したとき: 描く・直す・寸法のコマンドは左のツールバーと同じ（もう一度押すとやめる）。パネルの機能は、開いていれば閉じる。
//   使っているコマンド・開いているパネルのボタンは光らせる。
// （ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

const FAV_KEY = 'cad_favorites';
const FAV_POS_KEY = 'cad_fav_pos';
const FAV_MAX = 16;
const FAV_LONG_MS = 600; // 長押しで登録するまでの時間
const FAV_TITLE = '⭐ お気に入り';
const FAV_CATS = [['draw', '描く'], ['edit', '直す'], ['dim', '測る・寸法'], ['survey', '測量'], ['view', '図面・表示']];
// 登録できるコマンド。run が無ければ左のツールバーと同じ toggleCommand、panel はそのパネルの題（開いていれば閉じる・光らせる）
const FAV_CATALOG = [
    { id: 'LINE', label: '線分', icon: '／', cat: 'draw' },
    { id: 'PLINE', label: '複線', icon: '∧', cat: 'draw' },
    { id: 'RECTANG', label: '四角', icon: '□', cat: 'draw' },
    { id: 'CIRCLE', label: '円', icon: '◯', cat: 'draw' },
    { id: 'ARC', label: '円弧', icon: '⌒', cat: 'draw' },
    { id: 'ELLIPSE', label: '楕円', icon: '⬭', cat: 'draw' },
    { id: 'TEXT', label: '文字', icon: 'A', cat: 'draw' },
    { id: 'HATCH', label: '塗潰', icon: '▨', cat: 'draw' },
    { id: 'TRIM', label: 'トリム', icon: '✂', color: '#ff6b6b', cat: 'edit' },
    { id: 'EXTEND', label: '延長', icon: '↗', color: '#33ff99', cat: 'edit' },
    { id: 'ERASE', label: '削除', icon: '✖', color: '#ff6b6b', cat: 'edit' },
    { id: 'MOVE', label: '移動', icon: '✥', color: '#ffff00', cat: 'edit' },
    { id: 'COPY', label: '複写', icon: '⊞', color: '#ffff00', cat: 'edit' },
    { id: 'OFFSET', label: 'オフセ', icon: '◱', color: '#ffff00', cat: 'edit' },
    { id: 'ROTATE', label: '回転', icon: '↻', color: '#ffff00', cat: 'edit' },
    { id: 'MIRROR', label: '鏡像', icon: '⇋', color: '#ffff00', cat: 'edit' },
    { id: 'SCALE', label: '尺度', icon: '⤢', color: '#ffff00', cat: 'edit' },
    { id: 'ARRAY', label: '配列', icon: '▦', color: '#ffff00', cat: 'edit' },
    { id: 'BREAK', label: '分割', icon: '÷', color: '#ffff00', cat: 'edit' },
    { id: 'JOIN', label: '結合', icon: '⋈', color: '#ffff00', cat: 'edit' },
    { id: 'FILLET', label: '角処理', icon: '╭', color: '#ffff00', cat: 'edit' },
    { id: 'UNDO', label: '戻す', icon: '↩', cat: 'edit', run: () => undo() },
    { id: 'REDO', label: 'やり直し', icon: '↪', cat: 'edit', run: () => redo() },
    { id: 'DIMLINEAR', label: '平行', icon: '↔', color: '#00ffff', cat: 'dim' },
    { id: 'DIMALIGNED', label: '整列', icon: '⤢', color: '#00ffff', cat: 'dim' },
    { id: 'DIMRADIUS', label: '半径', icon: 'R', color: '#00ffff', cat: 'dim' },
    { id: 'DIMDIAMETER', label: '直径', icon: '⌀', color: '#00ffff', cat: 'dim' },
    { id: 'DIMANGULAR', label: '角度', icon: '∠', color: '#00ffff', cat: 'dim' },
    { id: 'DIMORDINATE', label: '座標', icon: 'XY', color: '#00ffff', cat: 'dim' },
    { id: 'DIMCONT', label: '連続', icon: '📏', color: '#00ffff', cat: 'dim' },
    { id: 'MEASURE', label: '測定', icon: '📐', color: '#00ffff', cat: 'dim' },
    { id: 'COORDS', label: '座標一覧', icon: '📍', cat: 'survey', panel: '📍 座標一覧', run: () => showCoordListPanel() },
    { id: 'COGO', label: '測量計算', icon: '🧮', cat: 'survey', panel: '🧮 測量計算', run: () => showCogoPanel() },
    { id: 'AREA', label: '求積', icon: '🧮', cat: 'survey', panel: '🧮 測量計算', tab: 'area', run: () => showCogoPanel('area') },
    { id: 'INV', label: '逆計算', icon: '🧮', cat: 'survey', panel: '🧮 測量計算', tab: 'inv', run: () => showCogoPanel('inv') },
    { id: 'PTADD', label: '点の追加', icon: '🧮', cat: 'survey', panel: '🧮 測量計算', tab: 'pt', run: () => showCogoPanel('pt') },
    { id: 'INTERS', label: '交点', icon: '🧮', cat: 'survey', panel: '🧮 測量計算', tab: 'int', run: () => showCogoPanel('int') },
    { id: 'HELMERT', label: '変換', icon: '🧮', cat: 'survey', panel: '🧮 測量計算', tab: 'helm', run: () => showCogoPanel('helm') },
    { id: 'STAKE', label: '杭打ち', icon: '📍', cat: 'survey', panel: '📍 杭打ち', run: () => showStakePanel() },
    { id: 'TS', label: 'TS連携', icon: '📡', cat: 'survey', panel: '📡 TS連携', run: () => showTsPanel() },
    { id: 'PHOTO', label: '写真', icon: '📷', cat: 'survey', panel: '📷 写真・メモ', run: () => showPhotoPanel() },
    { id: 'GNSS', label: '現在地', icon: '🛰', color: '#528bff', cat: 'survey', run: () => toggleGnss() },
    { id: 'SIMAOUT', label: 'SIMA出力', icon: '📄', cat: 'survey', run: () => exportSima() },
    { id: 'CSVOUT', label: 'CSV出力', icon: '📄', cat: 'survey', run: () => exportCoordCsv() },
    { id: 'SAVE', label: '保存', icon: '💾', color: '#00ff88', cat: 'view', run: () => saveProject() },
    { id: 'PROJECTS', label: '保存一覧', icon: '📂', cat: 'view', run: () => showProjectList() },
    { id: 'EXPORTDXF', label: 'DXF出力', icon: '📄', cat: 'view', run: () => exportDxf() },
    { id: 'PRINT', label: '印刷', icon: '🖨', cat: 'view', panel: '🖨 印刷・PDF', run: () => showPrintPanel() },
    { id: 'MAP', label: '地図・下絵', icon: '🗺', cat: 'view', panel: '🗺 地図・下絵', run: () => showUnderlayPanel() },
    { id: 'ZOOM', label: '全体', icon: '🔍', cat: 'view', run: () => zoomExtents() },
    { id: 'ZOOMORIGIN', label: '原点へ', icon: '🔍', cat: 'view', run: () => zoomToOrigin() },
    { id: 'COORDREAD', label: '座標読取', icon: '🎯', cat: 'view', run: () => { if(typeof window.toggleFullscreen === 'function') window.toggleFullscreen(); } }, // index.html の関数
    { id: 'LAYERS', label: '画層', icon: '👁', color: '#00ff88', cat: 'view', panel: '画層一括管理', run: () => toggleLayerPanel() },
    { id: 'LAYOFF', label: '画層を隠す', icon: '👆', cat: 'view' },
    { id: 'BLOCKS', label: 'ブロック', icon: '🧩', cat: 'view', panel: 'ブロック管理', run: () => showBlockManagerPanel() },
    { id: 'UCS', label: '原点移動', icon: '🎯', color: '#528bff', cat: 'view' },
    { id: 'UCS2P', label: '2点UCS', icon: '📈', color: '#528bff', cat: 'view' },
    { id: 'PLAN', label: 'PLAN', icon: '🧭', color: '#528bff', cat: 'view', run: () => togglePlanView() },
    { id: 'WCS', label: 'WCS', icon: '↩', color: '#528bff', cat: 'view', run: () => issueCommand('WCS') },
    { id: 'OPTIONS', label: 'オプション', icon: '⚙', cat: 'view', panel: 'オプション', run: () => showOptionsPanel() },
    { id: 'HELP', label: 'ヘルプ', icon: '❓', cat: 'view', panel: '❓ ヘルプ・操作ガイド', run: () => showGuideHelp() },
    // 単位の切り替え（押すたびに m ⇔ mm）。ボタンにはいまの単位を出す（iconFn）
    { id: 'LENUNIT', label: '長さ単位', icon: 'mm', color: '#00ffff', cat: 'view', run: () => toggleDisplayUnit('len'), iconFn: () => displayUnit('len') },
    { id: 'COORDUNIT', label: '座標単位', icon: 'm', color: '#528bff', cat: 'view', run: () => toggleDisplayUnit('coord'), iconFn: () => displayUnit('coord') },
    // 屋外モードの入・切（入のあいだはボタンを光らせる: activeFn）
    { id: 'OUTDOOR', label: '屋外', icon: '☀', color: '#ffcc00', cat: 'view', run: () => toggleOutdoorMode(), activeFn: () => isOutdoor() },
];
// ボタンに出す印（いまの状態で変わるものは iconFn）
function favIcon(d) {
    if(typeof d.iconFn === 'function') { try { return String(d.iconFn()); } catch { /* 出せなければ既定の印 */ } }
    return d.icon;
}

// ===== 状態（端末に覚える） =====
function _favLoad() {
    try { const v = JSON.parse(localStorage.getItem(FAV_KEY) || '{}'); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; } catch { return {}; }
}
const _fav = Object.assign({ items: [], show: true, dir: 'v', labels: true, folded: false }, _favLoad());
_fav.items = (Array.isArray(_fav.items) ? _fav.items : []).filter((id, i, a) => FAV_CATALOG.some((c) => c.id === id) && a.indexOf(id) === i).slice(0, FAV_MAX);
function _favSave() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify({ items: _fav.items, show: _fav.show, dir: _fav.dir, labels: _fav.labels, folded: _fav.folded })); } catch { /* 保存できなくても続行 */ }
}
function favDef(id) { return FAV_CATALOG.find((c) => c.id === id) || null; }
function _favPanelOpen(title) {
    const p = document.getElementById('property-panel'), t = document.getElementById('property-panel-title');
    return !!(p && p.style.display === 'flex' && t && t.textContent === title);
}

// ===== 実行 =====
window.favRun = function(id) {
    const d = favDef(id);
    if(!d) return;
    try {
        if(d.panel && _favPanelOpen(d.panel) && (!d.tab || _cogo.tab === d.tab)) {
            // 開いているパネルは閉じる（▁ でたたんでいたら広げる）
            if(document.getElementById('property-panel').classList.contains('win-min')) setPropertyPanelMinimized(false);
            else closePropertyPanel();
        } else if(typeof d.run === 'function') d.run();
        else toggleCommand(d.id); // 左のツールバーと同じ（もう一度押すとやめる）
    } catch(e) {
        showToast(`「${d.label}」を始められませんでした: ${e.message}`, 3500);
    }
    favUpdateActive();
};
function _favIsActive(d) {
    if(!d) return false;
    if(typeof d.activeFn === 'function') { try { return !!d.activeFn(); } catch { return false; } } // 入・切の設定（屋外モードなど）
    if(d.panel) return _favPanelOpen(d.panel) && (!d.tab || _cogo.tab === d.tab);
    if(d.run) return false;
    return cmdState.mode !== 'IDLE' && activeCommandName === d.id;
}
// 使っているコマンド・開いているパネルのボタンを光らせる（コマンドの表示が変わるたび・パネルが変わるたびに呼ばれる）
function favUpdateActive() {
    const bar = document.getElementById('fav-bar');
    if(!bar || bar.style.display === 'none') return;
    bar.querySelectorAll('.fav-btn[data-id]').forEach((b) => b.classList.toggle('active', _favIsActive(favDef(b.dataset.id))));
}

// ===== 浮かぶバー =====
function _favBar() {
    let bar = document.getElementById('fav-bar');
    if(bar) return bar;
    bar = document.createElement('div');
    bar.id = 'fav-bar';
    bar.className = 'glass-panel';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'お気に入りのボタン');
    bar.innerHTML = '<div class="fav-head" title="つまんで動かす（ダブルタップで元の位置）"><span class="fav-grip">⠿</span>' +
        '<button type="button" class="fav-fold" title="たたむ・広げる">⭐</button></div><div class="fav-list"></div>';
    document.body.appendChild(bar);
    bar.querySelector('.fav-fold').addEventListener('click', (e) => { e.stopPropagation(); favFold(); });
    bar.querySelector('.fav-list').addEventListener('click', (e) => {
        const b = e.target.closest('.fav-btn');
        if(!b) return;
        if(b.classList.contains('fav-add')) showFavPanel(); else favRun(b.dataset.id);
    });
    makePanelDraggable(bar, bar.querySelector('.fav-head'), FAV_POS_KEY);
    window.addEventListener('resize', () => { if(bar.style.display !== 'none') applyPanelPosition(bar); });
    return bar;
}
function favRenderBar() {
    const has = _fav.items.length > 0;
    if(!has && !document.getElementById('fav-bar')) return;
    const bar = _favBar();
    bar.classList.toggle('fav-v', _fav.dir !== 'h');
    bar.classList.toggle('fav-h', _fav.dir === 'h');
    bar.classList.toggle('no-labels', !_fav.labels);
    bar.classList.toggle('folded', !!_fav.folded);
    bar.querySelector('.fav-list').innerHTML = _fav.items.map((id) => {
        const d = favDef(id);
        return `<button type="button" class="fav-btn" data-id="${d.id}" title="${escapeHtml(d.label)}（${d.id}）">` +
            `<span class="fav-icon${d.iconFn ? ' fav-icon-txt' : ''}"${d.color ? ` style="color:${d.color}"` : ''}>${escapeHtml(favIcon(d))}</span><span class="fav-lbl">${escapeHtml(d.label)}</span></button>`;
    }).join('') + '<button type="button" class="fav-btn fav-add" title="お気に入りの登録・並べ替え"><span class="fav-icon">＋</span><span class="fav-lbl">登録</span></button>';
    const show = has && _fav.show;
    bar.style.display = show ? 'flex' : 'none';
    if(show) { applyPanelPosition(bar); favUpdateActive(); }
}
window.favFold = function() { _fav.folded = !_fav.folded; _favSave(); favRenderBar(); };

// ===== 登録 =====
window.favToggle = function(id) {
    const d = favDef(id);
    if(!d) return false;
    const k = _fav.items.indexOf(id);
    if(k >= 0) _fav.items.splice(k, 1);
    else {
        if(_fav.items.length >= FAV_MAX) { showToast(`お気に入りは ${FAV_MAX}個までです（使わないボタンを外してください）`, 3500); return false; }
        _fav.items.push(id);
        _fav.show = true;
    }
    _favSave();
    favRenderBar();
    _favRerenderPanel();
    return true;
};
window.favMove = function(k, d) {
    const j = k + d;
    if(k < 0 || j < 0 || k >= _fav.items.length || j >= _fav.items.length) return;
    [_fav.items[k], _fav.items[j]] = [_fav.items[j], _fav.items[k]];
    _favSave(); favRenderBar(); _favRerenderPanel();
};
window.favSetShow = function(v) { _fav.show = v !== 'off'; _favSave(); favRenderBar(); _favRerenderPanel(); };
window.favSetDir = function(v) { _fav.dir = v === 'h' ? 'h' : 'v'; _favSave(); favRenderBar(); _favRerenderPanel(); };
window.favSetLabels = function(v) { _fav.labels = v !== 'off'; _favSave(); favRenderBar(); _favRerenderPanel(); };
window.favResetPos = function() {
    const bar = document.getElementById('fav-bar');
    if(bar) resetPanelPosition(bar); else { try { localStorage.removeItem(FAV_POS_KEY); } catch { /* 保存できなくても続行 */ } }
    showToast('お気に入りのバーを元の位置に戻しました', 2500);
};
// 長押しで登録したとき
function _favAddFromPress(id) {
    const d = favDef(id);
    if(!d) return;
    if(navigator.vibrate) navigator.vibrate(30);
    if(_fav.items.includes(id)) { showToast(`⭐「${d.label}」は登録してあります（外すときは ⋯ →「⭐ お気に入り」）`, 3500); return; }
    if(favToggle(id)) {
        addCommandLog(`-> ⭐ お気に入りに「${d.label}」を登録しました`);
        showToast(`⭐ お気に入りに「${d.label}」を登録しました\n並べ替えは、バーの ＋ から`, 3500);
    }
}

// ===== 登録の画面（⋯ →「⭐ お気に入り」） =====
window.showFavPanel = function() {
    const n = _fav.items.length;
    let h = `<div class="prop-row cogo-row"><div class="prop-label cogo-label">バー</div>${_cogoSeg(_fav.show ? 'on' : 'off', [['on', '出す'], ['off', '隠す']], 'favSetShow')}</div>` +
        `<div class="prop-row cogo-row"><div class="prop-label cogo-label">向き</div>${_cogoSeg(_fav.dir === 'h' ? 'h' : 'v', [['v', '縦'], ['h', '横']], 'favSetDir')}</div>` +
        `<div class="prop-row cogo-row"><div class="prop-label cogo-label">名前</div>${_cogoSeg(_fav.labels ? 'on' : 'off', [['on', '出す'], ['off', 'アイコンだけ']], 'favSetLabels')}</div>`;
    h += `<div class="ts-sec">登録したボタン（${n} / ${FAV_MAX}）</div>`;
    if(!n) h += _cogoNote('下の一覧の ☆ を押すと登録します。左のツールバー・⋯ メニューのボタンを長押ししても登録できます。登録したボタンは、画面の右の浮かぶバーに並びます。');
    else {
        h += '<div class="fav-rows">' + _fav.items.map((id, k) => {
            const d = favDef(id);
            return `<div class="fav-row"><span class="fav-row-ic"${d.color ? ` style="color:${d.color}"` : ''}>${escapeHtml(favIcon(d))}</span><span class="fav-row-name">${escapeHtml(d.label)}</span>` +
                `<button onclick="favMove(${k}, -1)" ${k === 0 ? 'disabled' : ''} title="上へ">▲</button><button onclick="favMove(${k}, 1)" ${k === n - 1 ? 'disabled' : ''} title="下へ">▼</button>` +
                `<button class="fav-row-x" onclick="favToggle('${id}')" title="外す">✕</button></div>`;
        }).join('') + '</div>';
        h += _cogoNote('バーの ⠿ をつまむと動かせます（ダブルタップで元の位置）。⭐ でたたむ・広げる。');
    }
    FAV_CATS.forEach(([cat, title]) => {
        h += `<div class="ts-sec">${escapeHtml(title)}</div><div class="fav-grid">` + FAV_CATALOG.filter((c) => c.cat === cat).map((c) => {
            const on = _fav.items.includes(c.id);
            return `<button class="fav-chip${on ? ' on' : ''}" onclick="favToggle('${c.id}')" title="${on ? '外す' : '登録する'}"><span class="fav-star">${on ? '★' : '☆'}</span>` +
                `<span class="fav-chip-ic"${c.color ? ` style="color:${c.color}"` : ''}>${escapeHtml(favIcon(c))}</span><span class="fav-chip-name">${escapeHtml(c.label)}</span></button>`;
        }).join('') + '</div>';
    });
    h += '<div class="cogo-btns"><button class="prop-btn btn-sub" onclick="favResetPos()">バーの位置を元に戻す</button></div>';
    showPropertyPanel(FAV_TITLE, h);
};
// 登録の画面を開いていれば描き直す（スクロールの位置はそのまま）
function _favRerenderPanel() {
    if(!_favPanelOpen(FAV_TITLE)) return;
    const c = document.getElementById('property-panel-content'), top = c ? c.scrollTop : 0;
    showFavPanel();
    const c2 = document.getElementById('property-panel-content');
    if(c2) c2.scrollTop = top;
}

// ===== 長押しで登録（左のツールバー・⋯ メニューのボタン） =====
let _favPress = null, _favSuppress = null;
function _favLongPress(el, id) {
    el.addEventListener('pointerdown', (e) => {
        if(e.button !== undefined && e.button !== 0) return;
        if(_favPress) clearTimeout(_favPress.timer);
        const p = { el, x: e.clientX, y: e.clientY };
        p.timer = setTimeout(() => {
            if(_favPress !== p) return;
            _favPress = null;
            _favSuppress = el; // 指を離したときのクリック（コマンドを始める）は止める
            setTimeout(() => { if(_favSuppress === el) _favSuppress = null; }, 1500);
            _favAddFromPress(id);
        }, FAV_LONG_MS);
        _favPress = p;
    });
    const cancel = () => { if(_favPress && _favPress.el === el) { clearTimeout(_favPress.timer); _favPress = null; } };
    el.addEventListener('pointermove', (e) => { if(_favPress && _favPress.el === el && Math.hypot(e.clientX - _favPress.x, e.clientY - _favPress.y) > 10) cancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, cancel));
    el.addEventListener('contextmenu', (e) => { if(_favSuppress === el || (_favPress && _favPress.el === el)) e.preventDefault(); }); // スマホの長押しのメニューを出さない
}
document.addEventListener('click', (e) => {
    if(_favSuppress && _favSuppress.contains(e.target)) { e.stopPropagation(); e.preventDefault(); _favSuppress = null; }
}, true);
function _favSetupLongPress() {
    document.querySelectorAll('#toolbar .tool-btn').forEach((b) => {
        const m = /toggleCommand\('([A-Z0-9]+)'\)/.exec(b.getAttribute('onclick') || '');
        if(m && favDef(m[1])) _favLongPress(b, m[1]);
    });
    document.querySelectorAll('[data-fav]').forEach((b) => { if(favDef(b.dataset.fav)) _favLongPress(b, b.dataset.fav); });
}

// ===== コマンド =====
function processFavCommand(cmd) {
    if(cmd === 'FAV' || cmd === 'FAVORITE' || cmd === 'OKINI') { window.showFavPanel(); return true; }
    // 単位の切り替え（お気に入りのボタンと同じ）: UNIT＝長さ、CUNIT＝座標
    if(cmd === 'UNIT' || cmd === 'LENUNIT') { toggleDisplayUnit('len'); return true; }
    if(cmd === 'CUNIT' || cmd === 'COORDUNIT') { toggleDisplayUnit('coord'); return true; }
    if(cmd === 'OUTDOOR' || cmd === 'SUN') { toggleOutdoorMode(); return true; } // 屋外モードの入・切
    return false;
}

// パネルが変わったら、パネルのボタンの光り方を合わせる（パネルを出す・閉じる関数を通らない変更にも合わせる）
(function _favWatchPanel() {
    const p = document.getElementById('property-panel'), t = document.getElementById('property-panel-title');
    if(!p || typeof window.MutationObserver !== 'function') return;
    const mo = new window.MutationObserver(() => favUpdateActive());
    mo.observe(p, { attributes: true, attributeFilter: ['style'] });
    if(t) mo.observe(t, { childList: true, characterData: true, subtree: true });
})();
_favSetupLongPress();
favRenderBar();

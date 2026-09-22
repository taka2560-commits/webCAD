// ===== Web CAD コア（状態と共通の土台） =====
// cad-core.js - 図形・画層・表示位置などの状態、図形の固有ID、グループ、
//               画面まわりの共通処理（トースト・パネル・コマンド欄）、初期化、元に戻す/やり直し
//
// 画面描画は cad-render.js、座標変換とUCSは cad-view.js、スナップとタップ判定は cad-geom.js、
// コマンド処理は cad-command.js、入力イベントは cad-input.js、各パネルは cad-panels.js、
// 起動処理は cad-boot.js にあります（すべて同じスコープに読み込まれます）。

// ===== DOM参照 =====
const canvas = document.getElementById('cad-canvas'), ctx = canvas.getContext('2d');
const container = document.getElementById('canvas-container'), coordsDisplay = document.getElementById('coords-display');
const commandInput = document.getElementById('command-input'), commandLog = document.getElementById('command-log');

// ===== キャンバス背景色（オプション: 黒/グレー/白） =====
let canvasBg = (function(){ try { return localStorage.getItem('cad_canvas_bg') || '#000'; } catch(e){ return '#000'; } })();
(function(){ if(container) container.style.backgroundColor = canvasBg; })();
function bgLuminance(){
    let c = String(canvasBg).replace('#','');
    if(c.length===3) c=c.split('').map(x=>x+x).join('');
    const r=parseInt(c.substr(0,2),16), g=parseInt(c.substr(2,2),16), b=parseInt(c.substr(4,2),16);
    if(isNaN(r)) return 0;
    return (0.299*r + 0.587*g + 0.114*b)/255;
}
function isLightCanvasBg(){ return bgLuminance() > 0.6; }
function colorLum(col){
    if(!col) return 1;
    if(col[0]==='#'){ let c=col.slice(1); if(c.length===3)c=c.split('').map(x=>x+x).join('');
        const r=parseInt(c.substr(0,2),16),g=parseInt(c.substr(2,2),16),b=parseInt(c.substr(4,2),16);
        if(isNaN(r)) return 1; return (0.299*r+0.587*g+0.114*b)/255; }
    if(col==='white') return 1;
    return 0.5; // 不明（rgb()や名前色）はフリップしない
}
// 明るい背景では白系の図形色を黒に置き換えて視認性を確保
function adjustColorForBg(col){ if(isLightCanvasBg() && colorLum(col) > 0.8) return '#111'; return col; }
function setCanvasBackground(c){
    canvasBg = c;
    try { localStorage.setItem('cad_canvas_bg', c); } catch(e){}
    if(container) container.style.backgroundColor = c;
    render();
    document.querySelectorAll('.opt-bg-btn').forEach(b=>b.classList.toggle('active', b.dataset.bg===c));
}
function showOptionsPanel(){
    const opts = [['#000','黒'],['#808080','グレー'],['#ffffff','白']];
    const btns = opts.map(o=>`<button class="prop-btn opt-bg-btn ${canvasBg===o[0]?'active':''}" data-bg="${o[0]}" onclick="setCanvasBackground('${o[0]}')" style="flex:1;">${o[1]}</button>`).join('');
    const hideArcs = (typeof shouldHideImportedArcs === 'function') ? shouldHideImportedArcs() : true;
    const html = `
        <div class="prop-row"><label>背景色:</label></div>
        <div style="display:flex;gap:6px;">${btns}</div>
        ${(typeof displayPrefsSectionHtml === 'function') ? displayPrefsSectionHtml() : ''}
        <div style="border-top:1px solid rgba(255,255,255,0.1); margin-top:10px; padding-top:10px; display:flex; flex-direction:column; gap:8px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:#ddd;"><input type="checkbox" ${window.groupSelectEnabled?'checked':''} onchange="setGroupSelectEnabled(this.checked)" style="width:16px;height:16px;"> タップでブロック全体を選択</label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:#ddd;"><input type="checkbox" ${hideArcs?'checked':''} onchange="setImportHideArcs(this.checked)" style="width:16px;height:16px;"> 取り込み時に円弧を非表示にする</label>
            <div style="color:#888;font-size:10px;">非表示にした円弧は、画層管理の「隠れ図形を再表示」で表示できます</div>
        </div>
        <div style="border-top:1px solid rgba(255,255,255,0.1); margin-top:10px; padding-top:10px; display:flex; flex-direction:column; gap:8px;">
            <div style="font-size:11px;color:#aaa;font-weight:700;">オフライン・データ</div>
            <div id="opt-dwg-status" style="font-size:11px;color:#ddd;">DWG読込エンジン: 確認中…</div>
            <button class="prop-btn btn-sub" id="opt-dwg-cache-btn" onclick="cacheDwgEngine()" style="display:none;">DWG読込エンジンを端末に保存（初回のみ数MB）</button>
            <div id="opt-autosave-status" style="font-size:11px;color:#ddd;">自動保存: 確認中…</div>
            <div id="opt-storage-status" style="font-size:11px;color:#888;">保存領域: 確認中…</div>
            <button class="prop-btn btn-warn" onclick="if(window.cadErrors) window.cadErrors.show()">⚠ エラーログ（<span class="cad-err-count">${window.cadErrors ? window.cadErrors.count() : 0}</span>件）</button>
            <div id="opt-build-info" style="font-size:10px;color:#666;"></div>
        </div>
        <div style="border-top:1px solid rgba(255,255,255,0.1); margin-top:10px; padding-top:10px; display:flex; flex-direction:column; gap:8px;">
            <div style="font-size:11px;color:#aaa;font-weight:700;">測量（SIMA・座標CSV・現在地）</div>
            <div style="font-size:11px;color:#ddd;">図面の1単位の長さ:</div>
            <div id="opt-survey-unit" style="display:flex;gap:6px;">
                <button class="prop-btn opt-bg-btn ${(typeof getSurveyUnit === 'function' && getSurveyUnit() === 'm') ? 'active' : ''}" style="flex:1;" onclick="setSurveyUnit('m')">1 = 1m</button>
                <button class="prop-btn opt-bg-btn ${(typeof getSurveyUnit === 'function' && getSurveyUnit() === 'mm') ? 'active' : ''}" style="flex:1;" onclick="setSurveyUnit('mm')">1 = 1mm</button>
            </div>
            <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#ddd;">
                <span style="flex:1;">現在地の座標系: ${(typeof getGnssZone === 'function' && getGnssZone()) ? ROMAN[getGnssZone()] + '系' : '未設定'}</span>
                <button class="prop-btn btn-sub" style="margin-top:0;" onclick="showGnssZonePanel(false)">系番号を選ぶ</button>
            </div>
        </div>
    `;
    showPropertyPanel('オプション', html);
    refreshOfflineStatus();
}

// ===== オフライン・データの状態表示 =====
function _swRequest(type) {
    return new Promise((resolve, reject) => {
        const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
        if(!ctrl) { reject(new Error('no-sw')); return; }
        const ch = new MessageChannel();
        const timer = setTimeout(() => reject(new Error('timeout')), type === 'lazy-cache' ? 180000 : 5000);
        ch.port1.onmessage = (ev) => { clearTimeout(timer); resolve(ev.data || {}); };
        ctrl.postMessage({ type }, [ch.port2]);
    });
}
function _fmtBytes(n) {
    if(n == null) return '?';
    if(n >= 1073741824) return (n / 1073741824).toFixed(1) + 'GB';
    if(n >= 1048576) return (n / 1048576).toFixed(1) + 'MB';
    return Math.max(1, Math.round(n / 1024)) + 'KB';
}
function _setDwgStatus(text, showBtn) {
    const st = document.getElementById('opt-dwg-status');
    const btn = document.getElementById('opt-dwg-cache-btn');
    if(st) st.textContent = text;
    if(btn) btn.style.display = showBtn ? '' : 'none';
}
async function refreshOfflineStatus() {
    const bi = window.cadErrors ? window.cadErrors.buildInfo() : { id: '?', at: '' };
    const binfo = document.getElementById('opt-build-info');
    if(binfo) binfo.textContent = `バージョン: build ${bi.id}${bi.at ? '（' + new Date(bi.at).toLocaleString('ja-JP') + '）' : ''}`;

    _swRequest('lazy-status').then(r => {
        if(!r.ok) { _setDwgStatus('DWG読込エンジン: 状態を確認できません', true); return; }
        if(r.total === 0) _setDwgStatus('DWG読込エンジン: 同梱済み', false);
        else if(r.cached >= r.total) _setDwgStatus('DWG読込エンジン: 端末に保存済み（オフラインでもDWGを開けます）', false);
        else _setDwgStatus('DWG読込エンジン: 未保存（電波のある場所で1回DWGを開くか、下のボタンで保存）', true);
    }).catch(() => _setDwgStatus('DWG読込エンジン: オフライン機能が無効です（開発版、または初回表示）', false));

    if(typeof window.getStorageStatus === 'function') {
        const s = await window.getStorageStatus();
        const as = document.getElementById('opt-autosave-status');
        if(as) {
            const t = s.lastAutoSave ? new Date(s.lastAutoSave).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : null;
            as.textContent = '自動保存: ' + (t ? `${t} に保存` : 'この起動ではまだ保存していません') + (s.unsaved ? '（未保存の変更あり・まもなく保存）' : '');
        }
        const el = document.getElementById('opt-storage-status');
        if(el) {
            const used = s.usage != null ? `使用 ${_fmtBytes(s.usage)}${s.quota ? ' / 上限 ' + _fmtBytes(s.quota) : ''}` : '使用量不明';
            const keep = s.persisted === true ? '自動削除されない設定' : (s.persisted === false ? '容量不足時にブラウザが削除する可能性あり。重要な図面はDXFでも保存してください' : '');
            el.textContent = `保存領域: ${used}${keep ? '（' + keep + '）' : ''}`;
        }
    }
}
window.cacheDwgEngine = async function() {
    _setDwgStatus('DWG読込エンジン: 保存中…（数MBの通信があります）', false);
    try {
        const r = await _swRequest('lazy-cache');
        if(!r.ok) throw new Error(r.error || '保存に失敗しました');
        _setDwgStatus('DWG読込エンジン: 端末に保存済み（オフラインでもDWGを開けます）', false);
        showToast('DWG読込エンジンを端末に保存しました');
    } catch(err) {
        _setDwgStatus('DWG読込エンジン: 保存に失敗しました（電波を確認してください）', true);
        if(window.cadErrors) window.cadErrors.record('offline', 'DWG読込エンジンの保存に失敗: ' + (err && err.message || err), '', { silent: true });
    }
};
window.setImportHideArcs = function(v) {
    try { localStorage.setItem('cad_import_hide_arcs', v ? '1' : '0'); } catch(e) {}
    addCommandLog(`-> 取り込み時の円弧非表示: ${v ? 'ON' : 'OFF'}`);
};

// ===== 作図設定の永続化（localStorage連携） =====
const DEFAULT_LAST_PARAMS = {
    circleMode: 'auto', // 'auto' (固定半径で連続配置) or 'manual' (2点指定で手動)
    radius: '50',
    rectW: '100',
    rectH: '50',
    offset: '10',
    angle: '90',
    textStr: 'テキスト',
    textHeight: '20',
    textCont: true
};

let lastParams = (function() {
    try {
        const saved = localStorage.getItem('webcad_last_params');
        if (saved) return Object.assign({}, DEFAULT_LAST_PARAMS, JSON.parse(saved));
    } catch(e) {}
    return Object.assign({}, DEFAULT_LAST_PARAMS);
})();

function saveLastParams() {
    try {
        localStorage.setItem('webcad_last_params', JSON.stringify(lastParams));
    } catch(e) {}
}

// 円モード切り替え（自動・固定半径 ⇔ 手動・2点指定）
window.toggleCircleMode = function() {
    lastParams.circleMode = (lastParams.circleMode === 'auto') ? 'manual' : 'auto';
    saveLastParams();
    if(navigator.vibrate) navigator.vibrate(15);
    updateCircleActionBar();
    const isAuto = lastParams.circleMode === 'auto';
    const rVal = parseFloat(lastParams.radius) || 50;
    if (isAuto) {
        cmdState.presetRadius = rVal;
        cmdState.startWcs = null;
        setPrompt(`円 (自動・半径${rVal}): 中心をタップ → 「確定」`);
        addCommandLog(`-> 円作図モード: 【固定半径 (自動)】 半径=${rVal}`);
    } else {
        cmdState.presetRadius = 0;
        cmdState.startWcs = null;
        setPrompt('円 (手動): 1点目(中心)をタップ');
        addCommandLog('-> 円作図モード: 【手動 (2点指定)】');
    }
    render();
};

function updateCircleActionBar() {
    const isAuto = lastParams.circleMode === 'auto';
    const modeBtn = document.getElementById('dim-mode-toggle');
    if(modeBtn && (cmdState.mode === 'WAITING_CIRCLE_CENTER' || cmdState.mode === 'WAITING_CIRCLE_RADIUS')) {
        modeBtn.style.display = '';
        modeBtn.innerHTML = isAuto ? `🔄 自動 (半径:${lastParams.radius || 50})` : '🔄 手動 (2点)';
        modeBtn.onclick = window.toggleCircleMode;
    }
}

function showCirclePanel() {
    const isAuto = lastParams.circleMode === 'auto';
    const html = `
        <div class="prop-row" style="gap:12px; margin-bottom:8px;">
            <label style="cursor:pointer; display:flex; align-items:center; gap:4px; font-size:12px;">
                <input type="radio" name="circle-mode-radio" value="auto" ${isAuto ? 'checked' : ''} onchange="onCircleModeRadioChange('auto')"> 固定半径 (自動)
            </label>
            <label style="cursor:pointer; display:flex; align-items:center; gap:4px; font-size:12px;">
                <input type="radio" name="circle-mode-radio" value="manual" ${!isAuto ? 'checked' : ''} onchange="onCircleModeRadioChange('manual')"> 手動 (2点)
            </label>
        </div>
        <div class="prop-row" id="circle-r-row" style="${isAuto ? '' : 'opacity:0.5;'}">
            <label>半径:</label>
            <input type="number" id="prop-circle-r" value="${lastParams.radius || 50}" min="0.1" step="any" placeholder="半径を入力">
        </div>
        <button class="prop-btn" onclick="applyCirclePreset()">この設定で作図開始</button>
    `;
    showPropertyPanel('円 作図設定', html);
}

window.onCircleModeRadioChange = function(mode) {
    lastParams.circleMode = mode;
    const rRow = document.getElementById('circle-r-row');
    if (rRow) rRow.style.opacity = (mode === 'auto') ? '1' : '0.5';
};

// 円: 半径を確定して作図開始
function applyCirclePreset(){
    const el=document.getElementById('prop-circle-r'); const v=el?parseFloat(el.value):NaN;
    if(v>0){ lastParams.radius=String(v); }
    saveLastParams();
    hidePropertyPanel();
    
    const isAuto = lastParams.circleMode === 'auto';
    const rVal = parseFloat(lastParams.radius) || 50;
    if (isAuto) {
        cmdState.presetRadius = rVal;
        cmdState.mode = 'WAITING_CIRCLE_CENTER';
        setPrompt(`円 (自動・半径${rVal}): 中心をタップ → 「確定」`);
        addCommandLog(`-> 半径 ${rVal} の固定円モード。中心を指定して「確定」`);
    } else {
        cmdState.presetRadius = 0;
        cmdState.mode = 'WAITING_CIRCLE_CENTER';
        setPrompt('円 (手動): 1点目(中心)をタップ');
        addCommandLog('-> 手動円モード。中心を指定');
    }
    showActionbarControls({ showMode: true });
    updateCircleActionBar();
    render();
}
// 長方形: 幅・高さを確定して1点クリックで作図
function applyRectPreset(){
    const ew=document.getElementById('prop-rect-w'), eh=document.getElementById('prop-rect-h');
    const w=ew?parseFloat(ew.value):NaN, h=eh?parseFloat(eh.value):NaN;
    if(w>0&&h>0){ cmdState.presetW=w; cmdState.presetH=h; lastParams.rectW=String(w); lastParams.rectH=String(h); saveLastParams(); addCommandLog(`-> ${w}×${h} を設定。基準点をクリック`); }
    setPrompt('1点目:'); hidePropertyPanel();
}
// オフセット: 距離を確定して対象選択へ
function applyOffsetPreset(){
    const el=document.getElementById('prop-offset-d'); const v=el?parseFloat(el.value):NaN;
    if(!(v>0)){ addCommandLog('-> 有効な距離を入力してください'); return; }
    cmdState.offsetDist=Math.abs(v); lastParams.offset=String(v); saveLastParams();
    cmdState.mode='WAITING_OFFSET_SELECT'; setPrompt('オフセット対象:');
    addCommandLog(`-> 距離 ${v} を設定。対象を選択`); hidePropertyPanel();
}
// 回転: 角度を確定し、対象選択→基点クリックで確定
function applyRotatePreset(){
    const el=document.getElementById('prop-rotate-a'); const v=el?parseFloat(el.value):NaN;
    if(!isNaN(v)){ cmdState.presetAngleDeg=v; lastParams.angle=String(v); saveLastParams(); addCommandLog(`-> 角度 ${v}° を設定。対象を選択→基点で確定`); }
    hidePropertyPanel();
}
const ucsStatusDisplay = document.getElementById('ucs-status-display'), ucsLabel = document.getElementById('ucs-label');
const snapIndicator = document.getElementById('snap-indicator');

// ===== 状態変数// グローバル状態
let layers = [{name:'0', color:'#00ffff', visible:true}];
let currentLayerIndex = 0;
window.ghostLayerMode = false; // 非表示画層をうっすら表示するモード
window.areaSelectEnabled = false; // 交差・範囲選択を有効化するフラグ（基本OFF）
let entities = [];

// ===== 図形の固有ID =====
// 選択状態を「配列の何番目か」で持つと、削除・トリム・元に戻す等で配列が詰まったとき別の図形を指してしまう
// （例: 長押しで文字を消した後に選択中の図形がずれ、続けて ERASE すると違う図形が消える）。
// そこで各図形に固有ID(e.id)を付け、選択・ハイライト・移動対象などは内部的にIDで保持する。
// 既存コードの cmdState.selectedIndices / highlightIdx は「その時点の配列番号」を返すアクセサとして残す。
let _nextEntityId = 1;
// 図形データの変更世代。編集（saveUndo）・元に戻す・読込・外形の更新のたびに増やし、
// 空間索引（タップ判定・スナップ用）や描画キャッシュを作り直す合図にする
let _geomEpoch = 0;
function _bumpGeomEpoch() { _geomEpoch++; }
let _idIndexCache = null; // Map<id, 配列番号>（配列が変わったら参照時に検出して作り直す）

// IDが無い図形・重複したID（JSON 複製で生じる）に新しいIDを付ける。既存の正しいIDは変えない
function ensureEntityIds() {
    for(const e of entities) {
        if(e && typeof e.id === 'number' && isFinite(e.id) && e.id >= _nextEntityId) _nextEntityId = Math.floor(e.id) + 1;
    }
    const seen = new Set();
    let changed = false;
    for(const e of entities) {
        if(!e) continue;
        if(typeof e.id !== 'number' || !isFinite(e.id) || seen.has(e.id)) { e.id = _nextEntityId++; changed = true; }
        seen.add(e.id);
    }
    if(changed) _idIndexCache = null;
}
// IDから現在の配列番号を求める（見つからなければ -1）
function entityIndexById(id) {
    if(id === null || id === undefined) return -1;
    if(_idIndexCache) {
        const i = _idIndexCache.get(id);
        if(i !== undefined && entities[i] && entities[i].id === id) return i;
    }
    _idIndexCache = new Map();
    entities.forEach((e, i) => { if(e && !_idIndexCache.has(e.id)) _idIndexCache.set(e.id, i); });
    const j = _idIndexCache.get(id);
    return (j !== undefined && entities[j] && entities[j].id === id) ? j : -1;
}
function getEntityById(id) { const i = entityIndexById(id); return i >= 0 ? entities[i] : null; }
// 図形のIDを返す（未設定・重複なら先に付け直す）
function _idOf(e) {
    if(typeof e.id !== 'number' || entities[entityIndexById(e.id)] !== e) ensureEntityIds();
    return e.id;
}
// obj[prop] を「図形の配列番号」として読み書きできるようにし、内部ではIDで保持する
function _defineEntityRef(obj, prop, emptyValue) {
    let id = null;
    Object.defineProperty(obj, prop, {
        enumerable: true, configurable: true,
        get() {
            if(id === null) return emptyValue;
            const i = entityIndexById(id);
            if(i < 0) { id = null; return emptyValue; } // 削除された図形は選択から外す
            return i;
        },
        set(i) { id = (typeof i === 'number' && i >= 0 && entities[i]) ? _idOf(entities[i]) : null; }
    });
}
// 複数選択（配列番号の配列として読み書き。内部はIDの配列）
function _defineEntityRefList(obj, prop) {
    let ids = [];
    Object.defineProperty(obj, prop, {
        enumerable: true, configurable: true,
        get() {
            if(!ids.length) return [];
            const out = [], keep = [];
            for(const id of ids) { const i = entityIndexById(id); if(i >= 0) { out.push(i); keep.push(id); } }
            if(keep.length !== ids.length) ids = keep;
            return out;
        },
        set(arr) {
            ids = [];
            if(!Array.isArray(arr)) return;
            const seen = new Set();
            for(const i of arr) {
                if(typeof i !== 'number' || !entities[i]) continue;
                const id = _idOf(entities[i]);
                if(!seen.has(id)) { seen.add(id); ids.push(id); }
            }
        }
    });
}
function _makeCmdState() {
    const st = { mode: 'IDLE', startWcs: null, points: [] };
    _defineEntityRef(st, 'highlightIdx', -1);
    _defineEntityRefList(st, 'selectedIndices');
    _defineEntityRef(st, 'moveTarget', undefined);
    _defineEntityRef(st, 'offsetTarget', undefined);
    return st;
}

let view = { x:0, y:0, scale:1, rotation:0 };
let mouse = { screenX:0, screenY:0, wcsX:0, wcsY:0, ucsX:0, ucsY:0, isPanning:false, isSelecting:false, selStartX:0, selStartY:0 };
let ucs = { originX:0, originY:0, angle:0 }; // angle: ラジアン（WCSからの回転角）
let undoStack = [], redoStack = [];
let savedUCSList = [];
let cmdState = _makeCmdState();
let snapResult = null;
const SNAP_R = 10, ERASE_R = 5;
// スナップ・直交状態
// 端点・中点・中心・交点・近接点・垂線・接線・挿入点・四半円点・延長は既定でON、図心・等分点はOFF（cad-snap.js で端末に保存）
let osnapState = { main: true, end: true, mid: true, cen: true, int: true, near: true, perp: true,
    tan: true, ins: true, qua: true, ext: true, gce: false, div: false, divN: 3 };
let orthoMode = false;
let touchState = {
    lastDist: 0, lastMid: null, isPinch: false,
    startX: 0, startY: 0, isDragging: false, hasMoved: false,
    pressTimer: null,
    selStartX: 0, selStartY: 0, isSelecting: false,
    showLoupe: false, loupeX: 0, loupeY: 0
};
const DRAG_THRESHOLD = 8;

// ===== ブロック / グループ =====
// インポートしたブロック(INSERT)や寸法は、展開後の図形に gid（グループID）と blockName を付けて
// 「1つのまとまり」として扱えるようにしている。ユーザーが選択図形をグループ化することもできる。
let _gidCounter = 0;
function newGroupId(prefix) { _gidCounter++; return (prefix || 'g') + Date.now().toString(36) + '_' + _gidCounter; }
// タップでブロック全体を選択するか（スマホでは部品を個別に拾うのが難しいため既定ON）
window.groupSelectEnabled = (function() { try { const v = localStorage.getItem('cad_group_select'); return v === null ? true : v === '1'; } catch(e) { return true; } })();
function getGroupMembers(gid) {
    const out = [];
    if(!gid) return out;
    entities.forEach((e, i) => { if(e.gid === gid) out.push(i); });
    return out;
}
// 図形1つの index から、グループ選択ONなら同じグループの全 index を返す
function expandGroupTargets(idx) {
    const e = entities[idx];
    if(!e) return [];
    if(window.groupSelectEnabled && e.gid) { const m = getGroupMembers(e.gid); if(m.length) return m; }
    return [idx];
}
function escapeHtml(s) {
    if(s === undefined || s === null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
// 画面上部に一時的なメッセージを出す（コマンドラインが畳まれているスマホ向け）
function showToast(msg, ms) {
    let t = document.getElementById('cad-toast');
    if(!t) { t = document.createElement('div'); t.id = 'cad-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), ms || 3000);
}
function clearSelection() {
    cmdState.highlightIdx = -1;
    cmdState.selectedIndices = [];
    updatePropertiesPanel();
}
// IDLE時のタップ/クリック選択。グループ選択ONならブロック全体（同じgid）を選択し、同じ対象の再タップで解除
function selectEntityAt(sx, sy) {
    const idx = hitTestEntity(sx, sy);
    if(idx < 0) { clearSelection(); return; }
    const e = entities[idx];
    const members = (window.groupSelectEnabled && e.gid) ? getGroupMembers(e.gid) : [];
    const sel = cmdState.selectedIndices || [];
    const sameSingle = cmdState.highlightIdx === idx && sel.length === 0;
    const sameGroup = members.length > 1 && sel.length === members.length && sel.includes(idx);
    if(sameSingle || sameGroup) { clearSelection(); return; }
    cmdState.highlightIdx = idx;
    cmdState.selectedIndices = members.length > 1 ? members : [];
    updatePropertiesPanel();
}
// 回転の対象（複数選択があれば全部、無ければハイライト1つ）
function _getRotateTargets() {
    if(cmdState.selectedIndices && cmdState.selectedIndices.length > 0) return cmdState.selectedIndices.slice();
    return cmdState.highlightIdx >= 0 ? [cmdState.highlightIdx] : [];
}
// 文字のローカル矩形（WCS単位、文字方向x・下向きy）。描画の textAlign/textBaseline と対応させる
function textLocalBox(e) {
    const h = e.height || 10;
    const lines = String(e.text === undefined ? '' : e.text).split('\n');
    let w = 0;
    try {
        ctx.save(); ctx.font = `${h}px sans-serif`;
        lines.forEach(l => { w = Math.max(w, ctx.measureText(l).width); });
        ctx.restore();
    } catch(err) { w = Math.max(...lines.map(l => l.length)) * h * 0.7; }
    let xMin = 0, xMax = w;
    if(e.halign === 'center') { xMin = -w / 2; xMax = w / 2; }
    else if(e.halign === 'right') { xMin = -w; xMax = 0; }
    let yMin, yMax;
    if(e.valign === 'top') { yMin = 0; yMax = h; }
    else if(e.valign === 'middle') { yMin = -h / 2; yMax = h / 2; }
    else { yMin = -h; yMax = h * 0.25; }
    yMax += (lines.length - 1) * h * 1.4; // 複数行は下に伸びる
    return { xMin, xMax, yMin, yMax, w, h };
}

// 文字のヒット距離（画面px）。文字の矩形内なら0、外なら矩形までの距離
function textHitDistance(e, sx, sy) {
    const p = wcsToScreen(e.x, e.y);
    const b = textLocalBox(e);
    const th = -(view.rotation + (e.rotation || 0)); // 描画時の canvas 回転角
    const c = Math.cos(th), s = Math.sin(th);
    const dx = sx - p.x, dy = sy - p.y;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;   // 文字ローカル座標（画面px）
    const k = view.scale;
    const x0 = b.xMin * k, x1 = b.xMax * k, y0 = b.yMin * k, y1 = b.yMax * k;
    const ex = lx < x0 ? x0 - lx : (lx > x1 ? lx - x1 : 0);
    const ey = ly < y0 ? y0 - ly : (ly > y1 ? ly - y1 : 0);
    return Math.hypot(ex, ey);
}

// ===== ユーティリティ =====
function isMobile() { return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window); }
function addCommandLog(t) { const d=document.createElement('div'); d.textContent=t; commandLog.appendChild(d); commandLog.scrollTop=commandLog.scrollHeight; }
function setPrompt(t) { document.getElementById('command-prompt').textContent=t; updateCommandPill(); if(typeof guideNotify === 'function') guideNotify('mode'); }
function resetCommand() {
    cmdState=_makeCmdState();
    if(typeof snapToolsReset === 'function') snapToolsReset(); // 次の1点だけの指定・2点の中点を解除
    if(typeof guideNotify === 'function') guideNotify('reset');  // 操作ガイド: コマンドの区切り
    setPrompt('コマンド:'); activeCommandName=''; setActiveTool(null);
    
    // 画層管理・ブロック管理のフローティングパネルは閉じずに内容だけ更新する
    const panel = document.getElementById('property-panel');
    const title = document.getElementById('property-panel-title');
    const titleText = title ? title.textContent : '';
    if (panel && panel.style.display === 'flex' && (titleText === '画層一括管理' || titleText === 'ブロック管理')) {
        if (titleText === '画層一括管理' && typeof window.updateLayerManagerContent === 'function') window.updateLayerManagerContent();
        if (titleText === 'ブロック管理' && typeof window.updateBlockManagerContent === 'function') window.updateBlockManagerContent();
    } else {
        hidePropertyPanel();
    }

    // 寸法・非表示アクションバーを確実に隠す＆ボタン状態を復元
    const actionbar = document.getElementById('fs-dim-actionbar');
    if(actionbar) {
        const plineClose = document.getElementById('pline-close-btn'); if (plineClose) plineClose.style.display = 'none';
        actionbar.style.display = 'none';
        const confirmBtn = actionbar.querySelector('button[onclick="dimConfirmPoint()"]');
        if (confirmBtn) confirmBtn.style.display = '';
        const cancelBtn = document.getElementById('dim-cancel-btn');
        if (cancelBtn) { cancelBtn.textContent = '❌ 終了'; cancelBtn.style.background = 'transparent'; cancelBtn.style.padding = ''; cancelBtn.style.borderRadius = ''; }
        const writeBtn = document.getElementById('dim-meas-write'); if (writeBtn) writeBtn.style.display = 'none';
        const measBaseBtn = document.getElementById('dim-meas-base'); if (measBaseBtn) measBaseBtn.style.display = 'none';
    }
    if(typeof updateSelectionBar === 'function') updateSelectionBar();
    render();
}
// IDLE でタップして選んだ1図形（ハイライト）を、編集コマンドの対象（選択）として採用する。
// （以前はボタンから編集コマンドを出すとハイライトが先に消され、1つだけ選んだ図形は
//   選択アクションバーの「削除・移動・複写・回転」で引き継がれず、もう一度タップが必要だった）
// ※ IDLE 中のハイライトはタップ選択でのみ付く（選択待ちモード中のマウス通過では付かない）
function _adoptIdleHighlight() {
    if(cmdState.mode === 'IDLE' && cmdState.highlightIdx >= 0 && !(cmdState.selectedIndices && cmdState.selectedIndices.length)) {
        cmdState.selectedIndices = [cmdState.highlightIdx];
    }
}
const _SELECTION_EDIT_COMMANDS = ['E', 'ERASE', 'M', 'MOVE', 'CO', 'COPY', 'RO', 'ROTATE'];
function issueCommand(cmd) {
    if(_SELECTION_EDIT_COMMANDS.includes(String(cmd).toUpperCase())) _adoptIdleHighlight();
    cmdState.highlightIdx=-1; addCommandLog(`コマンド: ${cmd}`); processCommand(cmd);
}
function setActiveTool(name) { document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active')); if(name){document.querySelectorAll('.tool-cmd').forEach(el=>{if(el.textContent===name)el.parentElement.classList.add('active');});} updateCommandPill(); }

// === 新UI: ツールバー展開 / コマンドピル ===
// 左ツールバーを 44pxレール ⇔ 148pxオーバーレイ で切り替える
function toggleToolbar() {
    const tb = document.getElementById('toolbar');
    if (tb) tb.classList.toggle('expanded');
}
// コマンドラインを 32pxピル ⇔ 展開（ログ+入力）で切り替える
function toggleCommandLine() {
    const area = document.getElementById('command-line-area');
    if (!area) return;
    area.classList.toggle('collapsed');
    const hint = document.getElementById('cmd-pill-hint');
    if (hint) hint.textContent = area.classList.contains('collapsed') ? 'コマンド ▲' : 'コマンド ▼';
}
// ピルに現在のコマンド名・プロンプト文を反映する（setPrompt / setActiveTool から呼ばれる）
function updateCommandPill() {
    const nameEl = document.getElementById('cmd-pill-name');
    if (!nameEl) return;
    const pEl = document.getElementById('cmd-pill-prompt');
    const promptEl = document.getElementById('command-prompt');
    const promptText = promptEl ? promptEl.textContent : '';
    const active = (typeof activeCommandName !== 'undefined') && activeCommandName && activeCommandName.length;
    nameEl.textContent = active ? activeCommandName : 'READY';
    if (pEl) pEl.textContent = (promptText && promptText !== 'コマンド:') ? promptText : 'コマンド入力';
}

// ===== プロパティパネル制御 =====
function hidePropertyPanel() {
    const p = document.getElementById('property-panel');
    if(p) p.style.display = 'none';
}
function showPropertyPanel(title, htmlContent) {
    const p = document.getElementById('property-panel');
    if(!p) return;
    document.getElementById('property-panel-title').textContent = title;
    document.getElementById('property-panel-content').innerHTML = htmlContent;
    p.style.display = 'flex';
    applyPanelPosition(p); // 前に動かした位置を覚えている場合はそこに出す
}

// ===== フローティングパネルの移動 =====
// パネルが図面の見たい場所を隠すことがあるため、見出し部分をつまんで動かせるようにする。
// ・パネル全体が必ず画面の中に収まるように位置を制限する（画面外に出て見失わない）
// ・置いた場所は次に開いたときも覚えている（端末に保存。保存できない環境でも動く）
// ・画面の回転やサイズ変更のときは、はみ出した分だけ画面内に戻す
const PANEL_POS_KEY = 'cad_panel_pos';
function _panelSavedPos() {
    try { const v = JSON.parse(localStorage.getItem(PANEL_POS_KEY) || 'null'); return (v && isFinite(v.left) && isFinite(v.top)) ? v : null; } catch { return null; }
}
// 指定した位置をパネルが画面内に収まる範囲へ丸める
function _panelClampPos(panel, left, top) {
    const w = panel.offsetWidth || 320, h = panel.offsetHeight || 100;
    const maxL = Math.max(0, window.innerWidth - w), maxT = Math.max(0, window.innerHeight - h);
    return { left: Math.min(Math.max(0, left), maxL), top: Math.min(Math.max(0, top), maxT) };
}
function _panelApplyPos(panel, left, top) {
    const p = _panelClampPos(panel, left, top);
    panel.style.left = p.left + 'px';
    panel.style.top = p.top + 'px';
    panel.style.right = 'auto';
    panel.style.transform = 'none';   // 既定の「中央寄せ(translateX(-50%))」を解除する
    panel.style.animation = 'none';   // 表示アニメーションも中央寄せを使うため切る
    panel.dataset.moved = '1';
    return p;
}
// 動かしたパネルを、いまの画面サイズに合わせて置き直す（表示時・画面サイズ変更時）
function applyPanelPosition(panel) {
    if(!panel) return;
    const pos = (panel.dataset.moved === '1') ? { left: parseFloat(panel.style.left) || 0, top: parseFloat(panel.style.top) || 0 } : _panelSavedPos();
    if(!pos) return;
    _panelApplyPos(panel, pos.left, pos.top);
}
// パネルを画面中央の初期位置へ戻す
function resetPanelPosition(panel) {
    if(!panel) return;
    panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; panel.style.transform = ''; panel.style.animation = '';
    delete panel.dataset.moved;
    try { localStorage.removeItem(PANEL_POS_KEY); } catch { /* 保存できなくても続行 */ }
}
// handle をつまんで panel を動かせるようにする（マウス・指・ペン共通）
function makePanelDraggable(panel, handle) {
    if(!panel || !handle || handle.dataset.dragReady === '1') return;
    handle.dataset.dragReady = '1';
    let drag = null;
    handle.addEventListener('pointerdown', (e) => {
        if(e.button !== undefined && e.button !== 0) return;
        if(e.target.closest('button, input, select, textarea, a')) return; // 閉じるボタンなどの操作を邪魔しない
        const r = panel.getBoundingClientRect();
        drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
        _panelApplyPos(panel, r.left, r.top); // つまんだ瞬間の見た目の位置をそのまま引き継ぐ
        try { handle.setPointerCapture(e.pointerId); } catch { /* 取得できなくても続行 */ }
        e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
        if(!drag || e.pointerId !== drag.id) return;
        drag.moved = true;
        _panelApplyPos(panel, e.clientX - drag.dx, e.clientY - drag.dy);
        e.preventDefault();
    });
    const end = (e) => {
        if(!drag || e.pointerId !== drag.id) return;
        if(drag.moved) {
            const pos = _panelClampPos(panel, parseFloat(panel.style.left) || 0, parseFloat(panel.style.top) || 0);
            try { localStorage.setItem(PANEL_POS_KEY, JSON.stringify(pos)); } catch { /* 保存できなくても続行 */ }
        }
        try { handle.releasePointerCapture(drag.id); } catch { /* 解放できなくても続行 */ }
        drag = null;
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    // 見出しのダブルタップで元の位置（画面中央）に戻す
    handle.addEventListener('dblclick', (e) => {
        if(e.target.closest('button')) return;
        resetPanelPosition(panel);
        showToast('パネルの位置を戻しました');
    });
}
window.makePanelDraggable = makePanelDraggable;
window.resetPanelPosition = resetPanelPosition;

// アクションバー表示制御ヘルパー
function showActionbarControls(options = {}) {
    const ab = document.getElementById('fs-dim-actionbar');
    if(!ab) return;
    ab.style.display = 'flex';
    const confirmBtn = ab.querySelector('button[onclick="dimConfirmPoint()"]');
    const modeToggle = document.getElementById('dim-mode-toggle');
    const dirToggle = document.getElementById('dim-dir-toggle');
    if(confirmBtn) confirmBtn.style.display = options.hideConfirm ? 'none' : '';
    if(modeToggle) modeToggle.style.display = options.showMode ? '' : 'none';
    if(dirToggle) dirToggle.style.display = options.showDir ? '' : 'none';
    // 基点測定・ポリラインのボタンは他のコマンドでは出さない
    const plineClose = document.getElementById('pline-close-btn'); if(plineClose) plineClose.style.display = 'none';
    const writeBtn = document.getElementById('dim-meas-write'); if(writeBtn) writeBtn.style.display = 'none';
    const measBaseBtn = document.getElementById('dim-meas-base'); if(measBaseBtn) measBaseBtn.style.display = 'none';
}

// テキスト用パネル開始関数
function startTextPlacement() {
    const txtInput = document.getElementById('prop-text-val');
    const hInput = document.getElementById('prop-text-h');
    const contInput = document.getElementById('prop-text-cont');
    
    if(!txtInput.value) { alert("文字を入力してください"); return; }
    
    cmdState.textStr = txtInput.value;
    cmdState.textHeight = parseFloat(hInput.value) || 20;
    cmdState.isContinuous = contInput ? contInput.checked : true;
    cmdState.previewWcs = { x: mouse.wcsX || 0, y: mouse.wcsY || 0 };
    
    cmdState.mode = 'WAITING_TEXT_PLACE';
    setPrompt('文字の配置点をタップ → 「確定」で配置');
    addCommandLog('-> 配置点をタップし、画面下の「確定」を押してください');
    hidePropertyPanel();
    showActionbarControls({ showMode: false });
    
    // カーソルにプレビューを出したいので再描画
    render();
}

let activeCommandName = '';

// トグルコマンド: 同じコマンドを再押しでキャンセル（エスケープ動作）
function toggleCommand(cmd) {
    if(cmdState.mode === 'WAITING_PLINE_NEXT' && activeCommandName === cmd && cmdState.points.length >= 2) { finishPline(false); return; }
    if(cmdState.mode !== 'IDLE' && activeCommandName === cmd) {
        addCommandLog('* キャンセル *');
        resetCommand();
        return;
    }
    activeCommandName = cmd;
    issueCommand(cmd);
}

// 図面を閉じる（全オブジェクト削除 + 新規作成）
function closeDrawing() {
    if(entities.length === 0) { addCommandLog('図面は空です'); return; }
    saveUndo();
    entities.length = 0;
    layers.splice(0, layers.length, {name:'0', color:'#00ffff', visible:true});
    currentLayerIndex = 0;
    initLayers();
    if(typeof window.updateLayerPanel === 'function') window.updateLayerPanel();
    if(typeof window.setCurrentProjectName === 'function') window.setCurrentProjectName(null);
    resetCommand();
    setDrawingName('新規図面');
    resetUCS();
    addCommandLog('-> 図面を閉じました（全オブジェクト削除）');
    render();
}

// 図面名の表示更新
function setDrawingName(name) {
    window._drawingName = name || ''; // 新UIでは表示欄が無いため、エクスポート名などに使う
    const el = document.getElementById('drawing-name');
    if(el) { el.textContent = name; el.title = name; }
}


// ===== 初期化 =====
function resizeCanvas() {
    const w = container.clientWidth || window.innerWidth || 800;
    const h = container.clientHeight || window.innerHeight || 600;
    if(canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    if(view.x === 0 && view.y === 0 && w > 0 && h > 0) {
        view.x = w / 2;
        view.y = h / 2;
    }
    render();
}

function init() {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    // フローティングパネルは見出しをつまんで移動できる
    makePanelDraggable(document.getElementById('property-panel'), document.getElementById('property-panel-header'));
    window.addEventListener('resize', () => applyPanelPosition(document.getElementById('property-panel')));
    if(view.x === 0 && view.y === 0) {
        view.x = (canvas.width || window.innerWidth) / 2;
        view.y = (canvas.height || window.innerHeight) / 2;
    }
    initLayers();
    setupEventListeners();
    render();
}
function initLayers() {
    const s = document.getElementById('layer-select'); 
    const fsS = document.getElementById('fs-layer-select');
    if(s) s.innerHTML='';
    if(fsS) fsS.innerHTML='';
    
    layers.forEach((l,i) => {
        if(s) { const o = document.createElement('option'); o.value=i; o.textContent=l.name; s.appendChild(o); }
        if(fsS) { const o2 = document.createElement('option'); o2.value=i; o2.textContent=l.name; fsS.appendChild(o2); }
    });

    // 現在の画層を選択状態に反映
    if(!layers[currentLayerIndex]) currentLayerIndex = 0;
    if(s) s.value = currentLayerIndex;
    if(fsS) fsS.value = currentLayerIndex;

    updateLayerColorDisplay();

    // onchange代入にすることで、initLayersが複数回呼ばれてもリスナーが多重登録されない
    const handleChange = (e) => { window.changeCurrentLayer(e.target.value); };
    if(s) s.onchange = handleChange;
    if(fsS) fsS.onchange = handleChange;
}
window.changeCurrentLayer = function(val) {
    const idx = parseInt(val);
    if(isNaN(idx)) return;
    currentLayerIndex = idx;
    updateLayerColorDisplay();
    const s = document.getElementById('layer-select');
    if(s && s.value != val) s.value = val;
    const fsS = document.getElementById('fs-layer-select');
    if(fsS && fsS.value != val) fsS.value = val;
    
    // 画層管理フローティングパネルの内容を更新
    if (typeof window.updateLayerManagerContent === 'function') {
        window.updateLayerManagerContent();
    }
    
    commandInput.focus();
};
function updateLayerColorDisplay() { document.getElementById('current-layer-color').style.backgroundColor=layers[currentLayerIndex].color; }


// ===== Undo/Redo =====
// 画層の表示/非表示・色などもUndo対象にするため、entitiesとlayersをセットで記録する
// ===== 元に戻す（Undo）の履歴 =====
// 以前は編集のたびに全図形を丸ごと複製していたため、3万図形の図面では20回の編集で約200MBを使い、
// 50回分の履歴でスマホのブラウザが落ちる恐れがあった。
// 今は図形を1つずつ文字列（JSON）にして保存し、前の履歴から変わっていない図形は同じ文字列を共有する。
// → メモリは「図面1枚分 ＋ 変更した図形の分」だけで済む。
let _undoStrCache = null; // Map<図形ID, 文字列>: 直近の履歴（重複排除の比較用）

// 履歴に残す文字列。bbox（外形）と _hits（寸法の画面上の当たり判定）は描画時に作り直す派生データなので含めない
function _serializeEntity(e) {
    const bb = e.bbox, hh = e._hits;
    if(bb === undefined && hh === undefined) return JSON.stringify(e);
    if(bb !== undefined) e.bbox = undefined; // JSON.stringify は値が undefined のキーを出力しない
    if(hh !== undefined) e._hits = undefined;
    try { return JSON.stringify(e); }
    finally { if(bb !== undefined) e.bbox = bb; if(hh !== undefined) e._hits = hh; }
}
function _undoSnapshot() {
    ensureEntityIds();
    const n = entities.length;
    const ids = new Array(n), strs = new Array(n);
    const prev = _undoStrCache;
    const next = new Map();
    for(let i = 0; i < n; i++) {
        const e = entities[i];
        let s = _serializeEntity(e);
        const old = prev ? prev.get(e.id) : undefined;
        if(old === s) s = old; // 内容が同じなら前の履歴の文字列を共有（新しい文字列はすぐ捨てられる）
        ids[i] = e.id; strs[i] = s; next.set(e.id, s);
    }
    _undoStrCache = next;
    return { v: 2, ids, strs, layers: JSON.stringify(layers) };
}
function _applyUndoSnapshot(s) {
    if(Array.isArray(s)) { entities = s; } // 旧形式（entities配列のみ）との互換
    else if(s.v === 2) {
        // 直前に _undoSnapshot() した「今の状態」と同じ内容の図形は、オブジェクトをそのまま使う（外形の再計算も不要）
        const curStr = _undoStrCache || new Map();
        const curObj = new Map();
        for(const e of entities) if(e && !curObj.has(e.id)) curObj.set(e.id, e);
        const next = new Array(s.ids.length);
        const cache = new Map();
        for(let i = 0; i < s.ids.length; i++) {
            const id = s.ids[i], str = s.strs[i];
            const keep = curObj.get(id);
            next[i] = (keep && curStr.get(id) === str) ? keep : JSON.parse(str);
            cache.set(id, str);
        }
        entities = next;
        layers = JSON.parse(s.layers);
        _undoStrCache = cache;
    }
    else { entities = s.entities; layers = s.layers; }
    // 選択はIDで保持しているため、戻した後も同じ図形を指す（存在しなくなった図形は自動で外れる）
    _idIndexCache = null;
    ensureEntityIds();
    // 画層UIを同期
    initLayers();
    if(typeof window.updateLayerPanel === 'function') window.updateLayerPanel();
    updatePropertiesPanel();
}
function saveUndo() {
    ensureEntityIds(); // 履歴にもIDを残し、元に戻した後も選択が同じ図形を指すようにする
    _bumpGeomEpoch();
    undoStack.push(_undoSnapshot());
    if(undoStack.length>50) undoStack.shift();
    redoStack=[];
    // 自動保存トリガー
    if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
}
function undo() { if(typeof guideNotify === 'function') guideNotify('undo'); if(!undoStack.length){addCommandLog('元に戻す操作がありません');return;} _bumpGeomEpoch(); redoStack.push(_undoSnapshot()); _applyUndoSnapshot(undoStack.pop()); render(); addCommandLog('-> 元に戻す'); if(typeof scheduleAutoSave === 'function') scheduleAutoSave(); }
function redo() { if(!redoStack.length){addCommandLog('やり直す操作がありません');return;} _bumpGeomEpoch(); undoStack.push(_undoSnapshot()); _applyUndoSnapshot(redoStack.pop()); render(); addCommandLog('-> やり直し'); if(typeof scheduleAutoSave === 'function') scheduleAutoSave(); }

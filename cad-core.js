// ===== Web CAD コアエンジン =====
// cad-core.js - 座標変換、描画、コマンド処理、イベント管理

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
    const html = `
        <div class="prop-row"><label>背景色:</label></div>
        <div style="display:flex;gap:6px;">${btns}</div>
    `;
    showPropertyPanel('オプション', html);
}

// ===== コマンド別フローティング入力パネル（TEXT設定と同方式） =====
let lastParams = { radius:'', rectW:'', rectH:'', offset:'10', angle:'90' };
// 円: 半径を確定して中心クリック1回で作図
function applyCirclePreset(){
    const el=document.getElementById('prop-circle-r'); const v=el?parseFloat(el.value):NaN;
    if(v>0){ cmdState.presetRadius=v; lastParams.radius=String(v); addCommandLog(`-> 半径 ${v} を設定。中心をクリック`); }
    setPrompt('中心:'); hidePropertyPanel();
}
// 長方形: 幅・高さを確定して1点クリックで作図
function applyRectPreset(){
    const ew=document.getElementById('prop-rect-w'), eh=document.getElementById('prop-rect-h');
    const w=ew?parseFloat(ew.value):NaN, h=eh?parseFloat(eh.value):NaN;
    if(w>0&&h>0){ cmdState.presetW=w; cmdState.presetH=h; lastParams.rectW=String(w); lastParams.rectH=String(h); addCommandLog(`-> ${w}×${h} を設定。基準点をクリック`); }
    setPrompt('1点目:'); hidePropertyPanel();
}
// オフセット: 距離を確定して対象選択へ
function applyOffsetPreset(){
    const el=document.getElementById('prop-offset-d'); const v=el?parseFloat(el.value):NaN;
    if(!(v>0)){ addCommandLog('-> 有効な距離を入力してください'); return; }
    cmdState.offsetDist=Math.abs(v); lastParams.offset=String(v);
    cmdState.mode='WAITING_OFFSET_SELECT'; setPrompt('オフセット対象:');
    addCommandLog(`-> 距離 ${v} を設定。対象を選択`); hidePropertyPanel();
}
// 回転: 角度を確定し、対象選択→基点クリックで確定
function applyRotatePreset(){
    const el=document.getElementById('prop-rotate-a'); const v=el?parseFloat(el.value):NaN;
    if(!isNaN(v)){ cmdState.presetAngleDeg=v; lastParams.angle=String(v); addCommandLog(`-> 角度 ${v}° を設定。対象を選択→基点で確定`); }
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
let view = { x:0, y:0, scale:1, rotation:0 };
let mouse = { screenX:0, screenY:0, wcsX:0, wcsY:0, ucsX:0, ucsY:0, isPanning:false, isSelecting:false, selStartX:0, selStartY:0 };
let ucs = { originX:0, originY:0, angle:0 }; // angle: ラジアン（WCSからの回転角）
let undoStack = [], redoStack = [];
let savedUCSList = [];
let cmdState = { mode:'IDLE', startWcs:null, points:[], highlightIdx:-1, selectedIndices:[] };
let snapResult = null;
const SNAP_R = 10, ERASE_R = 5;
// スナップ・直交状態
let osnapState = { main: true, end: true, mid: true, cen: true, int: true, near: true, perp: true };
let orthoMode = false;

// ===== ユーティリティ =====
function isMobile() { return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window); }
function addCommandLog(t) { const d=document.createElement('div'); d.textContent=t; commandLog.appendChild(d); commandLog.scrollTop=commandLog.scrollHeight; }
function setPrompt(t) { document.getElementById('command-prompt').textContent=t; updateCommandPill(); }
function resetCommand() { 
    cmdState={mode:'IDLE',startWcs:null,points:[],highlightIdx:-1,selectedIndices:[]}; 
    setPrompt('コマンド:'); activeCommandName=''; setActiveTool(null);
    
    // 画層管理フローティングパネルが表示されている場合は閉じずに、表示状態（ボタンのアクティブ状態等）を更新するだけにする
    const panel = document.getElementById('property-panel');
    const title = document.getElementById('property-panel-title');
    if (panel && panel.style.display === 'flex' && title && title.textContent === '画層一括管理') {
        if (typeof window.updateLayerManagerContent === 'function') {
            window.updateLayerManagerContent();
        }
    } else {
        hidePropertyPanel();
    }
    
    // 寸法・非表示アクションバーを確実に隠す＆ボタン状態を復元
    const actionbar = document.getElementById('fs-dim-actionbar');
    if(actionbar) {
        actionbar.style.display = 'none';
        const confirmBtn = actionbar.querySelector('button[onclick="dimConfirmPoint()"]');
        if (confirmBtn) confirmBtn.style.display = '';
        const cancelBtn = actionbar.querySelector('button[onclick="resetCommand()"]');
        if (cancelBtn) cancelBtn.textContent = '✖ キャンセル';
    }
    render(); 
}
function issueCommand(cmd) { cmdState.highlightIdx=-1; addCommandLog(`コマンド: ${cmd}`); processCommand(cmd); }
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
}

// プロパティパネルのドラッグ実装
let isDraggingPanel = false, panelDragStartX, panelDragStartY, panelStartLeft, panelStartTop;
document.addEventListener('DOMContentLoaded', () => {
    const header = document.getElementById('property-panel-header');
    const panel = document.getElementById('property-panel');
    if(!header || !panel) return;

    header.addEventListener('mousedown', (e) => {
        isDraggingPanel = true;
        panelDragStartX = e.clientX; panelDragStartY = e.clientY;
        const rect = panel.getBoundingClientRect();
        panelStartLeft = rect.left; panelStartTop = rect.top;
        e.preventDefault();
    });
    header.addEventListener('touchstart', (e) => {
        if(e.touches.length !== 1) return;
        isDraggingPanel = true;
        panelDragStartX = e.touches[0].clientX; panelDragStartY = e.touches[0].clientY;
        const rect = panel.getBoundingClientRect();
        panelStartLeft = rect.left; panelStartTop = rect.top;
        // preventDefaultはボタン押下などを妨げるので最小限に
    }, {passive:false});

    document.addEventListener('mousemove', (e) => {
        if(!isDraggingPanel) return;
        const dx = e.clientX - panelDragStartX;
        const dy = e.clientY - panelDragStartY;
        panel.style.left = (panelStartLeft + dx) + 'px';
        panel.style.top = (panelStartTop + dy) + 'px';
        panel.style.right = 'auto'; // override right if set
    });
    document.addEventListener('touchmove', (e) => {
        if(!isDraggingPanel) return;
        const dx = e.touches[0].clientX - panelDragStartX;
        const dy = e.touches[0].clientY - panelDragStartY;
        panel.style.left = (panelStartLeft + dx) + 'px';
        panel.style.top = (panelStartTop + dy) + 'px';
        panel.style.right = 'auto';
        e.preventDefault();
    }, {passive:false});

    document.addEventListener('mouseup', () => { isDraggingPanel = false; });
    document.addEventListener('touchend', () => { isDraggingPanel = false; });
});

// テキスト用パネル開始関数
function startTextPlacement() {
    const txtInput = document.getElementById('prop-text-val');
    const hInput = document.getElementById('prop-text-h');
    const contInput = document.getElementById('prop-text-cont');
    
    if(!txtInput.value) { alert("文字を入力してください"); return; }
    
    cmdState.textStr = txtInput.value;
    cmdState.textHeight = parseFloat(hInput.value) || 20;
    cmdState.isContinuous = contInput.checked;
    
    cmdState.mode = 'WAITING_TEXT_PLACE';
    setPrompt('文字の配置点を指定 (連続: ' + (cmdState.isContinuous ? 'ON' : 'OFF') + ')');
    addCommandLog('-> 配置点をタップしてください');
    
    // カーソルにプレビューを出したいので再描画
    render();
}

// コマンド名とツールバーラベルのマッピング
let activeCommandName = '';
const CMD_TO_TOOL = {
    'LINE':'LINE','PLINE':'PLINE','RECTANG':'RECT','CIRCLE':'CIRCLE','ARC':'ARC',
    'ELLIPSE':'ELLIP','TEXT':'TEXT','HATCH':'HATCH',
    'ERASE':'ERASE','MOVE':'MOVE','COPY':'COPY','OFFSET':'OFFSET','ROTATE':'ROTATE','RO':'ROTATE',
    'DIMLINEAR':'DIMLIN','DIMALIGNED':'DIMALN','DIMRADIUS':'DIMRAD',
    'DIMDIAMETER':'DIMDIA','DIMANGULAR':'DIMANG','DIMORDINATE':'DIMORD'
};

// トグルコマンド: 同じコマンドを再押しでキャンセル（エスケープ動作）
function toggleCommand(cmd) {
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
    resetCommand();
    setDrawingName('新規図面');
    resetUCS();
    addCommandLog('-> 図面を閉じました（全オブジェクト削除）');
    render();
}

// 図面名の表示更新
function setDrawingName(name) {
    const el = document.getElementById('drawing-name');
    if(el) { el.textContent = name; el.title = name; }
}


// ===== 初期化 =====
function init() {
    resizeCanvas(); window.addEventListener('resize',resizeCanvas);
    view.x=canvas.width/2; view.y=canvas.height/2;
    initLayers(); setupEventListeners(); render();
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
function resizeCanvas() { canvas.width=container.clientWidth; canvas.height=container.clientHeight; render(); }

// ===== 座標変換 =====
function screenToWcs(sx, sy) {
    let rwx = (sx - view.x) / view.scale;
    let rwy = -(sy - view.y) / view.scale;
    if (view.rotation !== 0) {
        const c = Math.cos(-view.rotation), s = Math.sin(-view.rotation);
        return { x: rwx*c - rwy*s, y: rwx*s + rwy*c };
    }
    return { x: rwx, y: rwy };
}
function wcsToScreen(wx, wy) {
    let dx = wx, dy = wy;
    if (view.rotation !== 0) {
        const c = Math.cos(view.rotation), s = Math.sin(view.rotation);
        dx = wx*c - wy*s;
        dy = wx*s + wy*c;
    }
    return { x: dx*view.scale + view.x, y: -dy*view.scale + view.y };
}
// ズーム時のビュー再配置: WCS座標(wb)が画面座標(sx,sy)に来るようにview.x/yを計算
function _reanchorView(sx, sy, wb) {
    let dx = wb.x, dy = wb.y;
    if (view.rotation !== 0) {
        const c = Math.cos(view.rotation), s = Math.sin(view.rotation);
        dx = wb.x*c - wb.y*s;
        dy = wb.x*s + wb.y*c;
    }
    view.x = sx - dx * view.scale;
    view.y = sy + dy * view.scale;
}
function ucsToWcs(ux,uy) {
    // 回転→平行移動
    const c=Math.cos(ucs.angle), s=Math.sin(ucs.angle);
    return { x: ux*c - uy*s + ucs.originX, y: ux*s + uy*c + ucs.originY };
}
function wcsToUcs(wx,wy) {
    // 平行移動→逆回転
    const dx=wx-ucs.originX, dy=wy-ucs.originY;
    const c=Math.cos(-ucs.angle), s=Math.sin(-ucs.angle);
    return { x: dx*c - dy*s, y: dx*s + dy*c };
}
function screenToUcs(sx,sy) { const w=screenToWcs(sx,sy); return wcsToUcs(w.x,w.y); }

// ===== UCS管理 =====
function setUCS(wx, wy, angle) {
    ucs.originX = wx; ucs.originY = wy; ucs.angle = angle || 0;
    ucsStatusDisplay.textContent = 'UCS';
    ucsStatusDisplay.style.color = 'var(--ucs-color)';
    ucsLabel.textContent = 'UCS';
    ucsLabel.style.color = 'var(--ucs-color)';
    const degStr = ucs.angle !== 0 ? ` ∠${(ucs.angle * 180 / Math.PI).toFixed(1)}°` : '';
    addCommandLog(`-> 原点設定: WCS(${wx.toFixed(2)},${wy.toFixed(2)})${degStr}`);
    resetCommand();
    render();
}
function resetUCS() {
    ucs.originX = 0; ucs.originY = 0; ucs.angle = 0;
    ucsStatusDisplay.textContent = 'WCS';
    ucsStatusDisplay.style.color = 'var(--highlight-color)';
    ucsLabel.textContent = 'WCS';
    ucsLabel.style.color = 'var(--highlight-color)';
    resetCommand();
    addCommandLog('-> WCSにリセット');
    render();
}

// ===== UCS保存・読込処理 =====
function saveUCS() {
    const name = prompt("現在のUCSに名前を付けて保存します:", `UCS_${savedUCSList.length + 1}`);
    if(!name) return;
    savedUCSList.push({ name: name, x: ucs.originX, y: ucs.originY, angle: ucs.angle });
    updateUCSDropdowns();
    addCommandLog(`-> UCS保存: ${name}`);
}

function deleteUCS() {
    if(navigator.vibrate) navigator.vibrate([20, 20, 20]);
    const fsSel = document.getElementById('fs-ucs-select');
    const ucsSel = document.getElementById('ucs-select');
    // 全画面のセレクトボックス、または通常のセレクトボックスから値を取得
    const idxStr = (fsSel && fsSel.value !== '') ? fsSel.value : (ucsSel && ucsSel.value !== '' ? ucsSel.value : '');
    
    if(idxStr === '') {
        alert("ドロップダウンから消去するUCSを選択してください。");
        return;
    }
    const idx = parseInt(idxStr);
    if(savedUCSList[idx]) {
        if(confirm(`保存されたUCS「${savedUCSList[idx].name}」を消去しますか？`)) {
            savedUCSList.splice(idx, 1);
            updateUCSDropdowns();
            resetUCS(); // 消去した場合は元のWCSにリセット
            addCommandLog('-> UCS消去完了');
        }
    }
}
function loadUCS(indexStr) {
    if(indexStr === '') return;
    const idx = parseInt(indexStr);
    if(savedUCSList[idx]) {
        const u = savedUCSList[idx];
        setUCS(u.x, u.y, u.angle);
        addCommandLog(`-> UCS読込: ${u.name}`);
        // もしPLAN機能がON（view.rotationが0以外）なら、自動的に新しいUCSに合わせる
        if(view.rotation !== 0) {
            view.rotation = -ucs.angle;
        }
        render();
    }
}

function updateUCSDropdowns() {
    ['ucs-select', 'fs-ucs-select'].forEach(id => {
        const sel = document.getElementById(id);
        if(!sel) return;
        sel.innerHTML = '<option value="">--読込--</option>';
        savedUCSList.forEach((u, i) => {
            const opt = document.createElement('option');
            opt.value = i; opt.textContent = u.name;
            sel.appendChild(opt);
        });
    });
}

// ===== 画面方向合わせ (PLAN) =====
function togglePlanView() {
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const targetWcs = screenToWcs(cx, cy); // 画面中央のWCSを維持する

    // rotation のトグル：既にUCSに合致しているなら WCS(0)に戻す、違えばUCSの回転幅に合わせる
    const targetRot = (view.rotation === -ucs.angle && ucs.angle !== 0) ? 0 : -ucs.angle;
    view.rotation = targetRot;

    // targetWcs が再度 cx, cy にマッピングされるよう view.x, view.y を逆算
    _reanchorView(cx, cy, targetWcs);

    addCommandLog(`-> 画面方向: ${targetRot === 0 ? 'リセット(WCS)' : 'UCS方向(PLAN)'}`);
    render();
}

function zoomToOrigin() { view.scale=1; _reanchorView(canvas.width/2, canvas.height/2, {x:ucs.originX, y:ucs.originY}); render(); addCommandLog('原点へズーム'); }
function zoomExtents() {
    if(entities.length===0){zoomToOrigin();return;}
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    const isVisible = (e) => (e.layer === undefined || !layers[e.layer] || layers[e.layer].visible) && !e.hidden;
    const growPt = (x, y) => { if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y; };
    const growBox = (b) => { if(b) { growPt(b.minX, b.minY); growPt(b.maxX, b.maxY); } };
    entities.forEach(e=>{
        if(!isVisible(e)) return;
        if(e.type==='DIMENSION'){
            if(e.p1){growPt(e.p1.x,e.p1.y);growPt(e.p2.x,e.p2.y);}
            if(e.center){growPt(e.center.x-(e.radius||0),e.center.y-(e.radius||0));growPt(e.center.x+(e.radius||0),e.center.y+(e.radius||0));}
            if(e.vertex){growPt(e.vertex.x,e.vertex.y);growPt(e.arm1.x,e.arm1.y);growPt(e.arm2.x,e.arm2.y);}
            if(e.point){growPt(e.point.x,e.point.y);}
            if(e.leaderCoord){growPt(e.leaderCoord.x,e.leaderCoord.y);}
        }
        else if(e.type==='HATCH'){ if(e.target) growBox(calcBBox(e.target)); }
        else { growBox(e.bbox || (e.bbox = calcBBox(e))); }
    });
    if(!isFinite(minX)){zoomToOrigin();return;}
    const pad=50, w=maxX-minX||1, h=maxY-minY||1;
    const sx=(canvas.width-pad*2)/w, sy=(canvas.height-pad*2)/h;
    view.scale=Math.min(sx,sy);
    const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
    _reanchorView(canvas.width/2, canvas.height/2, {x:cx, y:cy});
    render(); addCommandLog('全体表示');
}

// ===== Undo/Redo =====
// 画層の表示/非表示・色などもUndo対象にするため、entitiesとlayersをセットで記録する
function _undoSnapshot() {
    return {
        entities: JSON.parse(JSON.stringify(entities)),
        layers: JSON.parse(JSON.stringify(layers))
    };
}
function _applyUndoSnapshot(s) {
    if(Array.isArray(s)) { entities = s; } // 旧形式（entities配列のみ）との互換
    else { entities = s.entities; layers = s.layers; }
    // 選択中インデックスが範囲外になった場合をクリア
    if(cmdState.highlightIdx >= entities.length) cmdState.highlightIdx = -1;
    if(cmdState.selectedIndices) cmdState.selectedIndices = cmdState.selectedIndices.filter(i => i < entities.length);
    // 画層UIを同期
    initLayers();
    if(typeof window.updateLayerPanel === 'function') window.updateLayerPanel();
    updatePropertiesPanel();
}
function saveUndo() {
    undoStack.push(_undoSnapshot());
    if(undoStack.length>50) undoStack.shift();
    redoStack=[];
    // 自動保存トリガー
    if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
}
function undo() { if(!undoStack.length){addCommandLog('元に戻す操作がありません');return;} redoStack.push(_undoSnapshot()); _applyUndoSnapshot(undoStack.pop()); render(); addCommandLog('-> 元に戻す'); }
function redo() { if(!redoStack.length){addCommandLog('やり直す操作がありません');return;} undoStack.push(_undoSnapshot()); _applyUndoSnapshot(redoStack.pop()); render(); addCommandLog('-> やり直し'); }

// ===== 数学ユーティリティ =====
function dist(x1,y1,x2,y2) { return Math.sqrt((x2-x1)**2+(y2-y1)**2); }
function normalizeAngle(a) { while(a<0)a+=Math.PI*2; while(a>=Math.PI*2)a-=Math.PI*2; return a; }
function isAngleBetweenCCW(a,s,e) { a=normalizeAngle(a-s); e=normalizeAngle(e-s); return a<=e; }
function circumcenter(x1,y1,x2,y2,x3,y3) {
    const D=2*(x1*(y2-y3)+x2*(y3-y1)+x3*(y1-y2)); if(Math.abs(D)<1e-10) return null;
    const ux=((x1*x1+y1*y1)*(y2-y3)+(x2*x2+y2*y2)*(y3-y1)+(x3*x3+y3*y3)*(y1-y2))/D;
    const uy=((x1*x1+y1*y1)*(x3-x2)+(x2*x2+y2*y2)*(x1-x3)+(x3*x3+y3*y3)*(x2-x1))/D;
    return {x:ux,y:uy};
}

// ===== オブジェクトスナップ =====
// 交点計算ヘルパー (線分と円)
function intersectSegCircle(x1,y1,x2,y2, cx,cy,r) {
    const dx=x2-x1, dy=y2-y1;
    const fx=x1-cx, fy=y1-cy;
    const a=dx*dx+dy*dy;
    if(a===0) return [];
    const b=2*(fx*dx+fy*dy), c=fx*fx+fy*fy-r*r;
    let disc=b*b-4*a*c;
    if(disc<0) return [];
    disc=Math.sqrt(disc);
    const out=[];
    [(-b-disc)/(2*a), (-b+disc)/(2*a)].forEach(t => {
        if(t>=0 && t<=1) out.push({x:x1+t*dx, y:y1+t*dy});
    });
    // 接する場合（判別式0）は同一点が2つ返るので1つに
    if(out.length===2 && Math.abs(out[0].x-out[1].x)<1e-9 && Math.abs(out[0].y-out[1].y)<1e-9) out.pop();
    return out;
}
// 交点計算ヘルパー (円と円)
function intersectCircleCircle(c1, c2) {
    const dx=c2.cx-c1.cx, dy=c2.cy-c1.cy;
    const d=Math.sqrt(dx*dx+dy*dy);
    if(d===0 || d>c1.radius+c2.radius || d<Math.abs(c1.radius-c2.radius)) return [];
    const a=(c1.radius*c1.radius - c2.radius*c2.radius + d*d)/(2*d);
    const h2=c1.radius*c1.radius - a*a;
    const h=h2>0?Math.sqrt(h2):0;
    const mx=c1.cx + a*dx/d, my=c1.cy + a*dy/d;
    if(h===0) return [{x:mx, y:my}];
    return [
        {x:mx + h*dy/d, y:my - h*dx/d},
        {x:mx - h*dy/d, y:my + h*dx/d}
    ];
}
// 交点計算ヘルパー (線分と線分)
function intersectLineLine(x1,y1,x2,y2, x3,y3,x4,y4) {
    const denom = (y4-y3)*(x2-x1) - (x4-x3)*(y2-y1);
    if(denom===0) return null;
    const ua = ((x4-x3)*(y1-y3) - (y4-y3)*(x1-x3)) / denom;
    const ub = ((x2-x1)*(y1-y3) - (y2-y1)*(x1-x3)) / denom;
    if(ua>=0 && ua<=1 && ub>=0 && ub<=1) return {x: x1+ua*(x2-x1), y: y1+ua*(y2-y1)};
    return null;
}

function collectSnapPoints(wx, wy, baseWcs) {
    if(!osnapState.main) return [];
    const pts = [];
    
    // Nearest 計算用ヘルパー
    const addNear = (px, py) => { 
        if(osnapState.near) {
            if(cmdState.mode === 'WAITING_UCS_2P_ORIGIN' || cmdState.mode === 'WAITING_UCS_2P_ORIGIN_PREVIEW') return;
            pts.push({x:px, y:py, t:'近接点'}); 
        }
    };
    const addPerp = (px, py) => { if(osnapState.perp) pts.push({x:px, y:py, t:'垂線'}); };
    const isVisible = (e) => (e.layer === undefined || !layers[e.layer] || layers[e.layer].visible) && !e.hidden;

    // マウスカーソル周辺でのみ検索するカリング
    let wxMin, wxMax, wyMin, wyMax;
    if (wx !== undefined && wy !== undefined) {
        const searchRad = 100 / view.scale; // 画面上100px程度の範囲
        wxMin = wx - searchRad; wxMax = wx + searchRad;
        wyMin = wy - searchRad; wyMax = wy + searchRad;
    }

    entities.forEach(e => {
        if(!isVisible(e)) return;
        
        // スナップ検索のカリング
        if(e.bbox && wxMin !== undefined) {
            if(e.bbox.maxX < wxMin || e.bbox.minX > wxMax || e.bbox.maxY < wyMin || e.bbox.minY > wyMax) return;
        }

        if(e.type==='LINE') { 
            if(osnapState.end) pts.push({x:e.x1,y:e.y1,t:'端点'},{x:e.x2,y:e.y2,t:'端点'}); 
            if(osnapState.mid) pts.push({x:(e.x1+e.x2)/2,y:(e.y1+e.y2)/2,t:'中点'}); 
            // Nearest & Perp
            if(osnapState.near || osnapState.perp) {
                const dx=e.x2-e.x1, dy=e.y2-e.y1, len2=dx*dx+dy*dy;
                if(len2 > 0) {
                    if(osnapState.near && wx!==undefined) {
                        let t = ((wx-e.x1)*dx + (wy-e.y1)*dy) / len2;
                        t = Math.max(0, Math.min(1, t));
                        addNear(e.x1 + t*dx, e.y1 + t*dy);
                    }
                    if(osnapState.perp && baseWcs) {
                        let t = ((baseWcs.x-e.x1)*dx + (baseWcs.y-e.y1)*dy) / len2;
                        if(t>=0 && t<=1) addPerp(e.x1 + t*dx, e.y1 + t*dy);
                    }
                }
            }
        }
        else if(e.type==='CIRCLE') { 
            if(osnapState.cen) pts.push({x:e.cx,y:e.cy,t:'中心'});
            if(osnapState.near && wx!==undefined) {
                const a = Math.atan2(wy-e.cy, wx-e.cx);
                addNear(e.cx + e.radius*Math.cos(a), e.cy + e.radius*Math.sin(a));
            }
            if(osnapState.perp && baseWcs) {
                const a = Math.atan2(baseWcs.y-e.cy, baseWcs.x-e.cx);
                addPerp(e.cx + e.radius*Math.cos(a), e.cy + e.radius*Math.sin(a)); // Outside perp
                addPerp(e.cx - e.radius*Math.cos(a), e.cy - e.radius*Math.sin(a)); // Inside perp
            }
        }
        else if(e.type==='ARC') { 
            if(osnapState.cen) pts.push({x:e.cx,y:e.cy,t:'中心'}); 
            if(osnapState.end) { const r=e.radius; pts.push({x:e.cx+r*Math.cos(e.startAngle),y:e.cy+r*Math.sin(e.startAngle),t:'端点'}); pts.push({x:e.cx+r*Math.cos(e.endAngle),y:e.cy+r*Math.sin(e.endAngle),t:'端点'}); }
            // Near & Perp for Arc
            if((osnapState.near && wx!==undefined) || (osnapState.perp && baseWcs)) {
                const checkArcPt = (px, py, type) => {
                    const a = Math.atan2(py-e.cy, px-e.cx);
                    const ccw = e.counterclockwise;
                    if(isAngleBetweenCCW(ccw?a:-a, ccw?e.startAngle:-e.startAngle, ccw?e.endAngle:-e.endAngle)) {
                        if(type==='near') addNear(e.cx+e.radius*Math.cos(a), e.cy+e.radius*Math.sin(a));
                        if(type==='perp') addPerp(e.cx+e.radius*Math.cos(a), e.cy+e.radius*Math.sin(a));
                    }
                };
                if(osnapState.near && wx!==undefined) checkArcPt(wx, wy, 'near');
                if(osnapState.perp && baseWcs) checkArcPt(baseWcs.x, baseWcs.y, 'perp');
            }
        }
        else if(e.type==='ELLIPSE') {
            if(osnapState.cen) pts.push({x:e.cx,y:e.cy,t:'中心'});
            if(osnapState.end) { // 四半円点 (Quadrants)
                pts.push({x:e.cx+e.rx*Math.cos(e.rotation), y:e.cy+e.rx*Math.sin(e.rotation), t:'端点'});
                pts.push({x:e.cx-e.rx*Math.cos(e.rotation), y:e.cy-e.rx*Math.sin(e.rotation), t:'端点'});
                pts.push({x:e.cx-e.ry*Math.sin(e.rotation), y:e.cy+e.ry*Math.cos(e.rotation), t:'端点'});
                pts.push({x:e.cx+e.ry*Math.sin(e.rotation), y:e.cy-e.ry*Math.cos(e.rotation), t:'端点'});
            }
        }
        else if(e.type==='RECTANG') { 
            if(osnapState.end) pts.push({x:e.x1,y:e.y1,t:'端点'},{x:e.x2,y:e.y1,t:'端点'},{x:e.x2,y:e.y2,t:'端点'},{x:e.x1,y:e.y2,t:'端点'});
            if(osnapState.mid) pts.push({x:(e.x1+e.x2)/2,y:(e.y1+e.y2)/2,t:'中点'}); 
            // Nearest on RECTANG sides
            if(osnapState.near && wx!==undefined) {
                // To keep it simple, treat it as 4 lines
                const lines = [
                    {x1:e.x1,y1:e.y1, x2:e.x2,y2:e.y1}, {x1:e.x2,y1:e.y1, x2:e.x2,y2:e.y2},
                    {x1:e.x2,y1:e.y2, x2:e.x1,y2:e.y2}, {x1:e.x1,y1:e.y2, x2:e.x1,y2:e.y1}
                ];
                lines.forEach(l => {
                    let dx=l.x2-l.x1, dy=l.y2-l.y1, len2=dx*dx+dy*dy;
                    if(len2>0) { let t=((wx-l.x1)*dx+(wy-l.y1)*dy)/len2; t=Math.max(0,Math.min(1,t)); addNear(l.x1+t*dx, l.y1+t*dy); }
                });
            }
        }
        else if(e.type==='PLINE') { 
            e.points.forEach((p,i)=>{
                if(osnapState.end) pts.push({x:p.x,y:p.y,t:'端点'}); 
                if(i>0) {
                    if(osnapState.mid) pts.push({x:(p.x+e.points[i-1].x)/2,y:(p.y+e.points[i-1].y)/2,t:'中点'});
                    if(osnapState.near && wx!==undefined) {
                        let l = {x1:e.points[i-1].x, y1:e.points[i-1].y, x2:p.x, y2:p.y};
                        let dx=l.x2-l.x1, dy=l.y2-l.y1, len2=dx*dx+dy*dy;
                        if(len2>0) { let t=((wx-l.x1)*dx+(wy-l.y1)*dy)/len2; t=Math.max(0,Math.min(1,t)); addNear(l.x1+t*dx, l.y1+t*dy); }
                    }
                }
            }); 
            if(e.closed && e.points.length>2) {
                let last = e.points[e.points.length-1], first = e.points[0];
                if(osnapState.mid) pts.push({x:(first.x+last.x)/2, y:(first.y+last.y)/2, t:'中点'});
                if(osnapState.near && wx!==undefined) {
                    let dx=first.x-last.x, dy=first.y-last.y, len2=dx*dx+dy*dy;
                    if(len2>0) { let t=((wx-last.x)*dx+(wy-last.y)*dy)/len2; t=Math.max(0,Math.min(1,t)); addNear(last.x+t*dx, last.y+t*dy); }
                }
            }
        }
        else if(e.type==='POINT') { if(osnapState.end) pts.push({x:e.x,y:e.y,t:'端点'}); }
    });
    // 交点（線分・ポリライン・長方形・円・円弧に対応。ブロック展開後のPLINE等も対象）
    if(osnapState.int) {
        // カーソル周辺のカリング窓に重なるか
        const inWin = (minX, minY, maxX, maxY) => {
            if(wxMin === undefined) return true;
            return !(maxX < wxMin || minX > wxMax || maxY < wyMin || minY > wyMax);
        };
        // 1) 交点計算に使う線分と円・弧を収集（線分は個々の区間単位でカリング）
        const segs = [], circles = [];
        const MAX_SEGS = 300, MAX_CIRCLES = 60;
        const addSeg = (x1,y1,x2,y2) => {
            if(segs.length >= MAX_SEGS) return;
            if(!inWin(Math.min(x1,x2), Math.min(y1,y2), Math.max(x1,x2), Math.max(y1,y2))) return;
            segs.push({x1,y1,x2,y2});
        };
        entities.forEach(e => {
            if(!isVisible(e)) return;
            if(e.bbox && wxMin !== undefined) {
                if(e.bbox.maxX < wxMin || e.bbox.minX > wxMax || e.bbox.maxY < wyMin || e.bbox.minY > wyMax) return;
            }
            if(e.type==='LINE') addSeg(e.x1,e.y1,e.x2,e.y2);
            else if(e.type==='RECTANG') {
                addSeg(e.x1,e.y1,e.x2,e.y1); addSeg(e.x2,e.y1,e.x2,e.y2);
                addSeg(e.x2,e.y2,e.x1,e.y2); addSeg(e.x1,e.y2,e.x1,e.y1);
            }
            else if(e.type==='PLINE' && e.points && e.points.length>1) {
                for(let i=1;i<e.points.length;i++) addSeg(e.points[i-1].x,e.points[i-1].y,e.points[i].x,e.points[i].y);
                if(e.closed && e.points.length>2) addSeg(e.points[e.points.length-1].x,e.points[e.points.length-1].y,e.points[0].x,e.points[0].y);
            }
            else if((e.type==='CIRCLE'||e.type==='ARC') && circles.length < MAX_CIRCLES) circles.push(e);
        });
        // 円弧なら角度範囲内かをチェック（円なら常にtrue）
        const onArc = (e, px, py) => {
            if(e.type!=='ARC') return true;
            const a = Math.atan2(py-e.cy, px-e.cx);
            const ccw = e.counterclockwise;
            return isAngleBetweenCCW(ccw?a:-a, ccw?e.startAngle:-e.startAngle, ccw?e.endAngle:-e.endAngle);
        };
        // 2) 線分×線分
        for(let i=0; i<segs.length; i++) {
            for(let j=i+1; j<segs.length; j++) {
                const a=segs[i], b=segs[j];
                const pt = intersectLineLine(a.x1,a.y1,a.x2,a.y2, b.x1,b.y1,b.x2,b.y2);
                if(pt) pts.push({x:pt.x, y:pt.y, t:'交点'});
            }
        }
        // 3) 線分×円/円弧
        segs.forEach(s => circles.forEach(c => {
            intersectSegCircle(s.x1,s.y1,s.x2,s.y2, c.cx,c.cy,c.radius).forEach(p => {
                if(onArc(c, p.x, p.y)) pts.push({x:p.x, y:p.y, t:'交点'});
            });
        }));
        // 4) 円/円弧×円/円弧
        for(let i=0; i<circles.length; i++) {
            for(let j=i+1; j<circles.length; j++) {
                intersectCircleCircle(circles[i], circles[j]).forEach(p => {
                    if(onArc(circles[i],p.x,p.y) && onArc(circles[j],p.x,p.y)) pts.push({x:p.x, y:p.y, t:'交点'});
                });
            }
        }
    }
    return pts;
}
function getBaseWcs() {
    const m = cmdState.mode;
    if(m==='WAITING_LINE_P2' || m==='WAITING_CIRCLE_RADIUS' || m==='WAITING_RECT_P2') return cmdState.startWcs;
    if(m==='WAITING_PLINE_NEXT' && cmdState.points.length>0) return cmdState.points[cmdState.points.length-1];
    if(m==='WAITING_MOVE_DEST' || m==='WAITING_COPY_DEST') return cmdState.moveBase;
    return null;
}

function findSnap(sx, sy, wx, wy) {
    if(!osnapState.main) return null;
    const baseWcs = getBaseWcs();
    let pts = collectSnapPoints(wx, wy, baseWcs); 
    
    // UCS設定時は「近接点」スナップを無効化
    if (cmdState.mode.startsWith('WAITING_UCS_')) {
        pts = pts.filter(p => p.t !== '近接点');
    }

    let best=null, bestD=SNAP_R;
    
    // スナップ優先順位: 1.端点/中点/中心/交点/垂線  2.近接点
    pts.forEach(p=>{ 
        const sp=wcsToScreen(p.x,p.y); 
        const d=dist(sx,sy,sp.x,sp.y); 
        if(d<bestD){
            // 近接点は少し吸着範囲を狭めるか優先度を下げる（同じ距離なら他のスナップを優先）
            if(p.t==='近接点' && best && best.type!=='近接点' && Math.abs(d-bestD)<3) return;
            bestD=d; best={wcsX:p.x, wcsY:p.y, type:p.t};
        } 
    });
    return best;
}

// ===== ヒットテスト =====
function distPointToSeg(px,py,x1,y1,x2,y2) {
    const dx=x2-x1,dy=y2-y1,len2=dx*dx+dy*dy;
    if(len2===0) return dist(px,py,x1,y1);
    let t=((px-x1)*dx+(py-y1)*dy)/len2; t=Math.max(0,Math.min(1,t));
    return dist(px,py,x1+t*dx,y1+t*dy);
}
function hitTestEntity(sx,sy) {
    let bestIdx=-1, bestD=ERASE_R;
    const isVisible = (e) => (e.layer === undefined || !layers[e.layer] || layers[e.layer].visible) && !e.hidden;
    const wcs = screenToWcs(sx, sy);
    const tolWcs = ERASE_R / view.scale;

    entities.forEach((e,i) => {
        if(!isVisible(e)) return;

        // BBoxカリング
        if(e.bbox && e.type !== 'HATCH') {
            if(e.bbox.maxX < wcs.x - tolWcs || e.bbox.minX > wcs.x + tolWcs ||
               e.bbox.maxY < wcs.y - tolWcs || e.bbox.minY > wcs.y + tolWcs) return;
        }

        let d = Infinity;
        if(e.type==='LINE') { const p1=wcsToScreen(e.x1,e.y1),p2=wcsToScreen(e.x2,e.y2); d=distPointToSeg(sx,sy,p1.x,p1.y,p2.x,p2.y); }
        else if(e.type==='CIRCLE') { const c=wcsToScreen(e.cx,e.cy); d=Math.abs(dist(sx,sy,c.x,c.y)-e.radius*view.scale); }
        else if(e.type==='ARC') { const c=wcsToScreen(e.cx,e.cy); const ad=dist(sx,sy,c.x,c.y); const rd=e.radius*view.scale; d=Math.abs(ad-rd); const a=Math.atan2(-(sy-c.y),sx-c.x); const ccw=e.counterclockwise; if(!isAngleBetweenCCW(ccw?a:-a,ccw?e.startAngle:-e.startAngle,ccw?e.endAngle:-e.endAngle))d=Infinity; }
        else if(e.type==='RECTANG') { const p1=wcsToScreen(e.x1,e.y1),p2=wcsToScreen(e.x2,e.y1),p3=wcsToScreen(e.x2,e.y2),p4=wcsToScreen(e.x1,e.y2); d=Math.min(distPointToSeg(sx,sy,p1.x,p1.y,p2.x,p2.y),distPointToSeg(sx,sy,p2.x,p2.y,p3.x,p3.y),distPointToSeg(sx,sy,p3.x,p3.y,p4.x,p4.y),distPointToSeg(sx,sy,p4.x,p4.y,p1.x,p1.y)); }
        else if(e.type==='PLINE') { for(let j=1;j<e.points.length;j++){const a=wcsToScreen(e.points[j-1].x,e.points[j-1].y),b=wcsToScreen(e.points[j].x,e.points[j].y);d=Math.min(d,distPointToSeg(sx,sy,a.x,a.y,b.x,b.y));} if(e.closed&&e.points.length>2){const a=wcsToScreen(e.points[e.points.length-1].x,e.points[e.points.length-1].y),b=wcsToScreen(e.points[0].x,e.points[0].y);d=Math.min(d,distPointToSeg(sx,sy,a.x,a.y,b.x,b.y));} }
        else if(e.type==='ELLIPSE') { const c=wcsToScreen(e.cx,e.cy); d=Math.abs(dist(sx,sy,c.x,c.y)-(e.rx+e.ry)/2*view.scale); }
        else if(e.type==='TEXT') { const p=wcsToScreen(e.x,e.y); d=dist(sx,sy,p.x,p.y-5); }
        else if(e.type==='POINT') { const p=wcsToScreen(e.x,e.y); d=dist(sx,sy,p.x,p.y); }
        else if(e.type==='HATCH') {
            const tgt = e.target;
            if(tgt.type==='RECTANG') { const p1=wcsToScreen(tgt.x1,tgt.y1),p2=wcsToScreen(tgt.x2,tgt.y1),p3=wcsToScreen(tgt.x2,tgt.y2),p4=wcsToScreen(tgt.x1,tgt.y2); d=Math.min(distPointToSeg(sx,sy,p1.x,p1.y,p2.x,p2.y),distPointToSeg(sx,sy,p2.x,p2.y,p3.x,p3.y),distPointToSeg(sx,sy,p3.x,p3.y,p4.x,p4.y),distPointToSeg(sx,sy,p4.x,p4.y,p1.x,p1.y)); }
            else if(tgt.type==='CIRCLE') { const c=wcsToScreen(tgt.cx,tgt.cy); d=Math.abs(dist(sx,sy,c.x,c.y)-tgt.radius*view.scale); }
            else if(tgt.type==='PLINE' && tgt.closed) {
                for(let j=1;j<tgt.points.length;j++){const a=wcsToScreen(tgt.points[j-1].x,tgt.points[j-1].y),b=wcsToScreen(tgt.points[j].x,tgt.points[j].y);d=Math.min(d,distPointToSeg(sx,sy,a.x,a.y,b.x,b.y));}
                if(tgt.points.length>2){const a=wcsToScreen(tgt.points[tgt.points.length-1].x,tgt.points[tgt.points.length-1].y),b=wcsToScreen(tgt.points[0].x,tgt.points[0].y);d=Math.min(d,distPointToSeg(sx,sy,a.x,a.y,b.x,b.y));}
            }
        }
        else if(e.type==='DIMENSION') {
            if(e._hits) {
                e._hits.forEach(h => {
                    if(h.type==='seg') d = Math.min(d, distPointToSeg(sx,sy,h.p1.x,h.p1.y,h.p2.x,h.p2.y));
                    else if(h.type==='circle') d = Math.min(d, Math.abs(dist(sx,sy,h.c.x,h.c.y)-h.r));
                    else if(h.type==='text') d = Math.min(d, Math.max(0, dist(sx,sy,h.p.x,h.p.y)-15));
                });
            }
        }
        if(d<bestD){bestD=d;bestIdx=i;}
    });
    return bestIdx;
}
// 円/弧のヒット検出（寸法コマンド用）
function hitTestCircleArc(sx,sy) {
    let bestIdx=-1, bestD=ERASE_R*2;
    const isVisible = (e) => (e.layer === undefined || !layers[e.layer] || layers[e.layer].visible) && !e.hidden;
    const wcs = screenToWcs(sx, sy);
    const tolWcs = (ERASE_R*2) / view.scale;

    entities.forEach((e,i) => {
        if(!isVisible(e)) return;
        // BBoxカリング
        if(e.bbox) {
            if(e.bbox.maxX < wcs.x - tolWcs || e.bbox.minX > wcs.x + tolWcs ||
               e.bbox.maxY < wcs.y - tolWcs || e.bbox.minY > wcs.y + tolWcs) return;
        }
        let d = Infinity;
        if(e.type==='CIRCLE') { const c=wcsToScreen(e.cx,e.cy); d=Math.abs(dist(sx,sy,c.x,c.y)-e.radius*view.scale); }
        else if(e.type==='ARC') { const c=wcsToScreen(e.cx,e.cy); d=Math.abs(dist(sx,sy,c.x,c.y)-e.radius*view.scale); }
        if(d<bestD){bestD=d;bestIdx=i;}
    });
    return bestIdx;
}

// ===== 描画 =====
let _renderPending = false;
function render() {
    if(_renderPending) return;
    _renderPending = true;
    requestAnimationFrame(() => {
        _renderPending = false;
        ctx.fillStyle=canvasBg; ctx.fillRect(0,0,canvas.width,canvas.height);
        drawAxes(); drawEntities(); drawDimensions(); drawRubberBand(); drawSnapMarker(); drawCrosshair();
    });
}
// 即時描画版（ルーペ等、rAF待たずに描画したい場合）
function renderImmediate() {
    _renderPending = false;
    ctx.fillStyle=canvasBg; ctx.fillRect(0,0,canvas.width,canvas.height);
    drawAxes(); drawEntities(); drawDimensions(); drawRubberBand(); drawSnapMarker(); drawCrosshair();
}

function drawAxes() {
    ctx.save(); ctx.lineWidth=1;
    const ws=wcsToScreen(0,0); ctx.strokeStyle=isLightCanvasBg()?'rgba(0,0,0,0.12)':'rgba(255,255,255,0.1)';
    ctx.beginPath();ctx.moveTo(0,ws.y);ctx.lineTo(canvas.width,ws.y);ctx.stroke();
    ctx.beginPath();ctx.moveTo(ws.x,0);ctx.lineTo(ws.x,canvas.height);ctx.stroke();
    const us=wcsToScreen(ucs.originX,ucs.originY);
    // UCS軸の回転対応描画
    const axLen = 20;
    const totalAngle = ucs.angle + view.rotation;
    const cosA = Math.cos(totalAngle), sinA = Math.sin(totalAngle);
    // X軸方向 (画面座標ではY反転)
    const xAxisDx = axLen * cosA, xAxisDy = -axLen * sinA;
    // Y軸方向 (X軸から90度反時計回り)
    const yAxisDx = -axLen * sinA, yAxisDy = -axLen * cosA;

    // UCS軸線（半透明の全画面ライン）
    ctx.strokeStyle='rgba(255,50,50,0.4)';
    ctx.beginPath(); ctx.moveTo(us.x - xAxisDx*500, us.y - xAxisDy*500); ctx.lineTo(us.x + xAxisDx*500, us.y + xAxisDy*500); ctx.stroke();
    ctx.strokeStyle='rgba(50,255,50,0.4)';
    ctx.beginPath(); ctx.moveTo(us.x - yAxisDx*500, us.y - yAxisDy*500); ctx.lineTo(us.x + yAxisDx*500, us.y + yAxisDy*500); ctx.stroke();

    const isWcs=ucs.originX===0&&ucs.originY===0&&ucs.angle===0; ctx.strokeStyle=isWcs?'#528bff':'#ffcc00'; ctx.fillStyle=ctx.strokeStyle; ctx.lineWidth=2;
    ctx.strokeRect(us.x-5,us.y-5,10,10);
    // 回転した軸矢印
    ctx.beginPath();ctx.moveTo(us.x,us.y);ctx.lineTo(us.x+xAxisDx,us.y+xAxisDy);ctx.stroke();
    ctx.beginPath();ctx.moveTo(us.x,us.y);ctx.lineTo(us.x+yAxisDx,us.y+yAxisDy);ctx.stroke();
    ctx.font='10px sans-serif';
    ctx.fillText('X',us.x+xAxisDx+2,us.y+xAxisDy+4);
    ctx.fillText('Y',us.x+yAxisDx-4,us.y+yAxisDy-2);
    ctx.fillText(isWcs?'WCS':'UCS',us.x+5,us.y+15); ctx.restore();
}

// ByLayer色解決: e.color が null/undefined ならレイヤー色を返す
function getEntityColor(e) {
    if(e.color) return e.color;
    if(e.layer !== undefined && layers[e.layer]) return layers[e.layer].color;
    return '#FFFFFF';
}

function drawOneEntity(e, color) {
    ctx.strokeStyle = adjustColorForBg(color || getEntityColor(e)); ctx.lineWidth = 1;
    if(e.type==='LINE') { const a=wcsToScreen(e.x1,e.y1),b=wcsToScreen(e.x2,e.y2); ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke(); }
    else if(e.type==='CIRCLE') { const c=wcsToScreen(e.cx,e.cy); ctx.beginPath();ctx.arc(c.x,c.y,e.radius*view.scale,0,Math.PI*2);ctx.stroke(); }
    else if(e.type==='ARC') { const c=wcsToScreen(e.cx,e.cy); ctx.beginPath();ctx.arc(c.x,c.y,e.radius*view.scale,-e.startAngle + view.rotation,-e.endAngle + view.rotation,!e.counterclockwise);ctx.stroke(); }
    else if(e.type==='RECTANG') { 
        const p1=wcsToScreen(e.x1,e.y1), p2=wcsToScreen(e.x2,e.y1);
        const p3=wcsToScreen(e.x2,e.y2), p4=wcsToScreen(e.x1,e.y2);
        ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y); ctx.lineTo(p4.x,p4.y); ctx.closePath(); ctx.stroke();
    }
    else if(e.type==='PLINE'&&e.points.length>1) { ctx.beginPath(); const f=wcsToScreen(e.points[0].x,e.points[0].y); ctx.moveTo(f.x,f.y); for(let i=1;i<e.points.length;i++){const p=wcsToScreen(e.points[i].x,e.points[i].y);ctx.lineTo(p.x,p.y);} if(e.closed)ctx.closePath(); ctx.stroke(); }
    else if(e.type==='POINT') { const r=4; const p=wcsToScreen(e.x,e.y); ctx.beginPath();ctx.arc(p.x,p.y,r*0.4,0,Math.PI*2);ctx.stroke(); ctx.beginPath();ctx.moveTo(p.x-r,p.y);ctx.lineTo(p.x+r,p.y);ctx.moveTo(p.x,p.y-r);ctx.lineTo(p.x,p.y+r);ctx.stroke(); }
    else if(e.type==='ELLIPSE') {
        const c=wcsToScreen(e.cx,e.cy);
        ctx.beginPath(); ctx.ellipse(c.x, c.y, e.rx*view.scale, e.ry*view.scale, -e.rotation, 0, Math.PI*2); ctx.stroke();
    }
    else if(e.type==='TEXT') {
        const p=wcsToScreen(e.x,e.y);
        const px=(e.height||10)*view.scale;
        ctx.font = `${px}px sans-serif`;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.save();
        ctx.translate(p.x, p.y);
        if(view.rotation !== 0) ctx.rotate(-view.rotation);
        // DXF/DWGインポート時の文字整列を反映（未指定なら従来通り左・ベースライン基準）
        ctx.textAlign = (e.halign === 'center' || e.halign === 'right') ? e.halign : 'left';
        ctx.textBaseline = (e.valign === 'top') ? 'top' : (e.valign === 'middle') ? 'middle' : 'alphabetic';
        // MTEXT由来の改行(\n)を複数行として描画
        String(e.text).split('\n').forEach((line, i) => ctx.fillText(line, 0, i * px * 1.4));
        ctx.restore();
    }
    else if(e.type==='HATCH') {
        ctx.fillStyle = ctx.strokeStyle; ctx.globalAlpha = 0.5;
        const tgt = e.target;
        if(tgt.type==='RECTANG') {
            const p1=wcsToScreen(tgt.x1,tgt.y1), p2=wcsToScreen(tgt.x2,tgt.y1);
            const p3=wcsToScreen(tgt.x2,tgt.y2), p4=wcsToScreen(tgt.x1,tgt.y2);
            ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y); ctx.lineTo(p4.x,p4.y); ctx.closePath(); ctx.fill();
        } else if(tgt.type==='CIRCLE') {
            const c=wcsToScreen(tgt.cx,tgt.cy); ctx.beginPath(); ctx.arc(c.x,c.y,tgt.radius*view.scale,0,Math.PI*2); ctx.fill();
        } else if(tgt.type==='PLINE' && tgt.closed) {
            ctx.beginPath();
            tgt.points.forEach((pt,i)=>{ const p=wcsToScreen(pt.x,pt.y); if(i===0)ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); });
            ctx.closePath(); ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }
}

// 図形のバウンディングボックスを計算 (初回のみ実行される)
function calcBBox(e) {
    let minX=0, minY=0, maxX=0, maxY=0;
    if(e.type==='LINE') {
        minX = Math.min(e.x1, e.x2); maxX = Math.max(e.x1, e.x2);
        minY = Math.min(e.y1, e.y2); maxY = Math.max(e.y1, e.y2);
    } else if(e.type==='CIRCLE' || e.type==='ARC') {
        minX = e.cx - e.radius; maxX = e.cx + e.radius;
        minY = e.cy - e.radius; maxY = e.cy + e.radius;
    } else if(e.type==='RECTANG') {
        minX = Math.min(e.x1, e.x2); maxX = Math.max(e.x1, e.x2);
        minY = Math.min(e.y1, e.y2); maxY = Math.max(e.y1, e.y2);
    } else if(e.type==='PLINE' && e.points && e.points.length > 0) {
        minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
        for(let i=0; i<e.points.length; i++) {
            const p = e.points[i];
            if(p.x < minX) minX = p.x; if(p.y < minY) minY = p.y;
            if(p.x > maxX) maxX = p.x; if(p.y > maxY) maxY = p.y;
        }
    } else if(e.type==='POINT' || e.type==='TEXT') {
        minX = e.x; maxX = e.x; minY = e.y; maxY = e.y;
    } else if(e.type==='ELLIPSE') {
        const r = Math.max(e.rx||0, e.ry||0) || e.radius || 0;
        minX = e.cx - r; maxX = e.cx + r; minY = e.cy - r; maxY = e.cy + r;
    } else {
        return null; // カリングなし
    }
    return { minX, minY, maxX, maxY };
}

function drawEntities() {
    ctx.save();
    const selSet = new Set(cmdState.selectedIndices || []);

    // カリング用の画面の表示範囲 (WCS座標)。100ピクセルずつ余裕をもたせる
    const tl = screenToWcs(-100, -100);
    const tr = screenToWcs(canvas.width + 100, -100);
    const bl = screenToWcs(-100, canvas.height + 100);
    const br = screenToWcs(canvas.width + 100, canvas.height + 100);
    const viewMinX = Math.min(tl.x, tr.x, bl.x, br.x);
    const viewMaxX = Math.max(tl.x, tr.x, bl.x, br.x);
    const viewMinY = Math.min(tl.y, tr.y, bl.y, br.y);
    const viewMaxY = Math.max(tl.y, tr.y, bl.y, br.y);

    entities.forEach((e,i) => {
        const lyrVisible = e.layer === undefined || !layers[e.layer] || layers[e.layer].visible;
        const entityVisible = !e.hidden;

        if (!entityVisible) return;
        if (!lyrVisible && !window.ghostLayerMode) return; // ghostLayerModeがOFFで画層非表示なら描画をスキップ
        if (e.type === 'DIMENSION') return;

        // BBoxカリング（事前計算＆画面外をスキップ）
        if(e.bbox === undefined && e.type !== 'HATCH') {
            e.bbox = calcBBox(e);
        }
        if(e.bbox) {
            if(e.bbox.maxX < viewMinX || e.bbox.minX > viewMaxX || 
               e.bbox.maxY < viewMinY || e.bbox.minY > viewMaxY) {
                return; // 画面内にないためスキップ
            }
        }

        ctx.save();
        if (!lyrVisible) {
            ctx.globalAlpha = 0.15; // 非表示レイヤーはうっすら（15%不透明度）表示
        }

        let color = null;
        if (lyrVisible) {
            if(i === cmdState.highlightIdx) color = '#ff6b6b';
            else if(selSet.has(i)) color = '#ffaa33'; // 複数選択時はオレンジ
        }
        drawOneEntity(e, color);
        ctx.restore();
    });
    ctx.restore();
}

// 寸法描画は cad-dimension.js の drawDimensions() へ委譲
function drawDimensions() { if(typeof drawAllDimensions==='function') drawAllDimensions(); }

function drawRubberBand() {
    ctx.save(); ctx.strokeStyle=isLightCanvasBg()?'rgba(0,0,0,0.5)':'rgba(255,255,255,0.5)'; ctx.setLineDash([6,4]); ctx.lineWidth=1;
    const m=cmdState.mode, sw=cmdState.startWcs, mp={x:mouse.wcsX,y:mouse.wcsY};
    if(m==='WAITING_LINE_P2'&&sw) { const a=wcsToScreen(sw.x,sw.y),b=wcsToScreen(mp.x,mp.y); ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke(); }
    else if(m==='WAITING_CIRCLE_RADIUS'&&sw) { const c=wcsToScreen(sw.x,sw.y),r=dist(sw.x,sw.y,mp.x,mp.y)*view.scale; ctx.beginPath();ctx.arc(c.x,c.y,r,0,Math.PI*2);ctx.stroke(); }
    else if(m==='WAITING_RECT_P2'&&sw) { const a=wcsToScreen(sw.x,sw.y),b=wcsToScreen(mp.x,mp.y); ctx.beginPath();ctx.rect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y));ctx.stroke(); }
    else if(m==='WAITING_ARC_P3'&&cmdState.points.length===2) {
        const p1=cmdState.points[0],p2=cmdState.points[1],p3=mp;
        const cc=circumcenter(p1.x,p1.y,p2.x,p2.y,p3.x,p3.y);
        if(cc){ const r=dist(cc.x,cc.y,p1.x,p1.y),sa=Math.atan2(p1.y-cc.y,p1.x-cc.x),ea=Math.atan2(p3.y-cc.y,p3.x-cc.x),ma=Math.atan2(p2.y-cc.y,p2.x-cc.x); const ccw=isAngleBetweenCCW(ma,sa,ea); const sc=wcsToScreen(cc.x,cc.y); ctx.beginPath();ctx.arc(sc.x,sc.y,r*view.scale,-sa,-ea,!ccw);ctx.stroke(); }
    }
    else if(m==='WAITING_PLINE_NEXT'&&cmdState.points.length>0) {
        ctx.beginPath(); const pts=cmdState.points; const f=wcsToScreen(pts[0].x,pts[0].y); ctx.moveTo(f.x,f.y);
        for(let i=1;i<pts.length;i++){const p=wcsToScreen(pts[i].x,pts[i].y);ctx.lineTo(p.x,p.y);}
        const b=wcsToScreen(mp.x,mp.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
    else if(m==='WAITING_ELLIPSE_X'&&sw) {
        const a=wcsToScreen(sw.x,sw.y),b=wcsToScreen(mp.x,mp.y); ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
    else if(m==='WAITING_ELLIPSE_Y'&&cmdState.points.length>0) {
        const cx=sw.x, cy=sw.y, ex=cmdState.points[0].x, ey=cmdState.points[0].y;
        const rx=dist(cx,cy,ex,ey), rot=Math.atan2(ey-cy, ex-cx);
        const ry=dist(cx,cy,mp.x,mp.y);
        const c=wcsToScreen(cx,cy);
        ctx.beginPath(); ctx.ellipse(c.x, c.y, rx*view.scale, ry*view.scale, -rot, 0, Math.PI*2); ctx.stroke();
    }
    else if(m==='WAITING_TEXT_PLACE' && cmdState.textStr) {
        const p = wcsToScreen(mp.x, mp.y);
        ctx.save();
        ctx.font = `${cmdState.textHeight * view.scale}px sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        
        // UCSに合わせて回転してプレビュー
        ctx.translate(p.x, p.y);
        ctx.rotate(-view.rotation);
        // 通常のTEXTエンティティは left/bottom で描画しているか確認 (通常は左下基準)
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'left';
        ctx.fillText(cmdState.textStr, 0, 0);
        
        ctx.restore();
    }
    else if(m==='WAITING_ROTATE_REF1'&&cmdState.rotateBase) {
        const a=wcsToScreen(cmdState.rotateBase.x, cmdState.rotateBase.y), b=wcsToScreen(mp.x, mp.y);
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
    else if(m==='WAITING_ROTATE_REF2'&&cmdState.rotateBase&&cmdState.rotateRef1) {
        const a=wcsToScreen(cmdState.rotateRef1.x, cmdState.rotateRef1.y), b=wcsToScreen(mp.x, mp.y);
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
    else if(m==='WAITING_ROTATE_DEST'&&cmdState.rotateBase&&cmdState.rotateRef1) {
        const destA = Math.atan2(mp.y - cmdState.rotateRef1.y, mp.x - cmdState.rotateRef1.x);
        const deltaAngle = destA - cmdState.refAngle;
        const a=wcsToScreen(cmdState.rotateRef1.x, cmdState.rotateRef1.y), b=wcsToScreen(mp.x, mp.y);
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
        
        if(cmdState.highlightIdx>=0 && entities[cmdState.highlightIdx]) {
            ctx.save();
            const bscr = wcsToScreen(cmdState.rotateBase.x, cmdState.rotateBase.y);
            ctx.translate(bscr.x, bscr.y);
            ctx.rotate(-deltaAngle); // Canvas Y is down, WCS Y is up
            ctx.translate(-bscr.x, -bscr.y);
            ctx.setLineDash([2,2]);
            drawOneEntity(entities[cmdState.highlightIdx], '#ffff00');
            ctx.restore();
        }
    }
    // 寸法ゴムバンドは cad-dimension.js で追加
    if(typeof drawDimRubberBand==='function') drawDimRubberBand(m, sw, mp);
    ctx.setLineDash([]); ctx.restore();
    if(cmdState.mode==='WAITING_UCS_ORIGIN'||cmdState.mode==='WAITING_UCS_2P_ORIGIN'){
        ctx.strokeStyle='#ffcc00';ctx.strokeRect(mouse.screenX-4,mouse.screenY-4,8,8);
    }
    else if(cmdState.mode==='WAITING_UCS_2P_ORIGIN_PREVIEW') {
        const p = wcsToScreen(cmdState.startWcs.x, cmdState.startWcs.y);
        ctx.strokeStyle='#ffcc00';ctx.strokeRect(p.x-4, p.y-4, 8, 8);
    }
    else if(cmdState.mode==='WAITING_UCS_2P_XDIR'){
        const p = wcsToScreen(cmdState.startWcs.x, cmdState.startWcs.y);
        const pt = getInputPoint(); const pts = wcsToScreen(pt.x, pt.y);
        ctx.strokeStyle='#ffcc00'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(pts.x, pts.y); ctx.stroke();
    }
    else if(cmdState.mode==='WAITING_UCS_2P_XDIR_PREVIEW'){
        const p1 = wcsToScreen(cmdState.startWcs.x, cmdState.startWcs.y);
        const p2 = wcsToScreen(cmdState.endWcs.x, cmdState.endWcs.y);
        ctx.strokeStyle='#ffcc00'; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
}

function drawSnapMarker() {
    if(!snapResult || !osnapState.main) { snapIndicator.textContent=''; return; }
    snapIndicator.textContent=snapResult.type;
    const s=wcsToScreen(snapResult.wcsX,snapResult.wcsY); ctx.save(); ctx.strokeStyle='#00ff00'; ctx.lineWidth=2;
    if(snapResult.type==='端点') { ctx.beginPath();ctx.moveTo(s.x,s.y-6);ctx.lineTo(s.x+6,s.y+4);ctx.lineTo(s.x-6,s.y+4);ctx.closePath();ctx.stroke(); }
    else if(snapResult.type==='中点') { ctx.strokeRect(s.x-5,s.y-5,10,10); ctx.beginPath();ctx.moveTo(s.x-5,s.y+5);ctx.lineTo(s.x,s.y-5);ctx.lineTo(s.x+5,s.y+5);ctx.stroke(); }
    else if(snapResult.type==='中心') { ctx.beginPath();ctx.arc(s.x,s.y,6,0,Math.PI*2);ctx.stroke(); }
    else if(snapResult.type==='交点') { ctx.beginPath();ctx.moveTo(s.x-6,s.y-6);ctx.lineTo(s.x+6,s.y+6);ctx.moveTo(s.x+6,s.y-6);ctx.lineTo(s.x-6,s.y+6);ctx.stroke(); }
    else if(snapResult.type==='近接点') { ctx.beginPath();ctx.moveTo(s.x-5,s.y-5);ctx.lineTo(s.x+5,s.y+5);ctx.moveTo(s.x-5,s.y+5);ctx.lineTo(s.x+5,s.y-5);ctx.strokeRect(s.x-5,s.y-5,10,10); } // 砂時計っぽく
    else if(snapResult.type==='垂線') { ctx.beginPath();ctx.moveTo(s.x-5,s.y-5);ctx.lineTo(s.x-5,s.y+5);ctx.lineTo(s.x+5,s.y+5);ctx.moveTo(s.x-5,s.y);ctx.lineTo(s.x-1,s.y);ctx.moveTo(s.x,s.y+5);ctx.lineTo(s.x,s.y+1);ctx.stroke(); } // Ｌ字
    ctx.restore();
}

function drawCrosshair() {
    ctx.save(); ctx.strokeStyle=isLightCanvasBg()?'#555':'#e2c288'; ctx.lineWidth=1;
    const totalAngle = ucs.angle + view.rotation;
    const c = Math.cos(totalAngle), s = Math.sin(totalAngle);
    const mx = mouse.screenX, my = mouse.screenY;
    const clen = Math.max(canvas.width, canvas.height) * 2;
    // Screen coords, Y is inverted vertically:
    // Dir1: angle. dx=c, dy=-s
    ctx.beginPath();
    ctx.moveTo(mx - clen*c, my - clen*-s);
    ctx.lineTo(mx + clen*c, my + clen*-s);
    ctx.stroke();
    // Dir2: angle+90. dx=-s, dy=-c
    ctx.beginPath();
    ctx.moveTo(mx - clen*-s, my - clen*-c);
    ctx.lineTo(mx + clen*-s, my + clen*-c);
    ctx.stroke();
    if(cmdState.mode==='WAITING_UCS_ORIGIN'||cmdState.mode==='WAITING_UCS_2P_ORIGIN'){ctx.strokeStyle='#ffcc00';ctx.strokeRect(mouse.screenX-4,mouse.screenY-4,8,8);}
    else if(cmdState.mode==='WAITING_UCS_2P_XDIR'){
        // 2点目指定中: 基点→カーソル方向の線を描画
        ctx.strokeStyle='#ffcc00'; ctx.lineWidth=1;
        const p1s = wcsToScreen(cmdState.startWcs.x, cmdState.startWcs.y);
        const pt = getInputPoint(); const pts = wcsToScreen(pt.x, pt.y);
        ctx.setLineDash([5,5]); ctx.beginPath(); ctx.moveTo(p1s.x,p1s.y); ctx.lineTo(pts.x,pts.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeRect(pts.x-4,pts.y-4,8,8);
    }
    else{ctx.strokeRect(mouse.screenX-3,mouse.screenY-3,6,6);}
    ctx.restore();
}

// ===== コマンド・入力補正処理 =====
function applyOrtho(wcs) {
    if(!orthoMode) return wcs;
    let base = null;
    const m = cmdState.mode;
    if(m==='WAITING_LINE_P2' || m==='WAITING_CIRCLE_RADIUS' || m==='WAITING_RECT_P2') base = cmdState.startWcs;
    else if(m==='WAITING_PLINE_NEXT' && cmdState.points.length>0) base = cmdState.points[cmdState.points.length-1];
    else if(m==='WAITING_MOVE_DEST' || m==='WAITING_COPY_DEST') base = cmdState.moveBase;
    
    if(!base) return wcs;
    
    const ucsW = wcsToUcs(wcs.x, wcs.y);
    const ucsBase = wcsToUcs(base.x, base.y);
    const dx = Math.abs(ucsW.x - ucsBase.x), dy = Math.abs(ucsW.y - ucsBase.y);
    let finalUcs;
    if(dx > dy) finalUcs = {x: ucsW.x, y: ucsBase.y}; // UCS水平固定
    else finalUcs = {x: ucsBase.x, y: ucsW.y}; // UCS垂直固定
    
    return ucsToWcs(finalUcs.x, finalUcs.y);
}

function getInputPoint() {
    if(snapResult && osnapState.main) return {x:snapResult.wcsX, y:snapResult.wcsY};
    return applyOrtho({x:mouse.wcsX, y:mouse.wcsY});
}

function handlePointInput(wcs, fromMouse = false) {
    const m = cmdState.mode;
    if(m==='WAITING_LAYOFF_TOUCH') {
        const idx = hitTestEntity(mouse.screenX, mouse.screenY);
        if(idx >= 0) {
            const e = entities[idx];
            const layerIdx = e.layer;
            if(layerIdx !== undefined && layers[layerIdx]) {
                saveUndo();
                layers[layerIdx].visible = false;
                addCommandLog(`-> タッチされた図形の画層「${layers[layerIdx].name}」を非表示にしました`);
                
                if (typeof window.updateLayerManagerContent === 'function') {
                    window.updateLayerManagerContent();
                }
                
                if(cmdState.highlightIdx === idx) {
                    cmdState.highlightIdx = -1;
                    updatePropertiesPanel();
                }
                if(cmdState.selectedIndices) {
                    cmdState.selectedIndices = cmdState.selectedIndices.filter(i => entities[i] && entities[i].layer !== layerIdx);
                }
                
                updateLayerPanel();
                render();
                if(navigator.vibrate) navigator.vibrate(30); // 振動フィードバック
            }
        } else {
            addCommandLog('-> 図形がタッチされませんでした');
        }
        return;
    }
    if(m==='WAITING_UCS_ORIGIN') { setUCS(wcs.x, wcs.y, 0); return; }
    if(m==='WAITING_UCS_2P_ORIGIN') { 
        cmdState.startWcs={x:wcs.x,y:wcs.y}; 
        if(fromMouse) {
            cmdState.mode = 'WAITING_UCS_2P_XDIR';
            setPrompt('X軸方向の点:');
            const u = wcsToUcs(wcs.x, wcs.y);
            addCommandLog(`-> 原点: (${dimFormat(u.x)},${dimFormat(u.y)})`);
            const ab = document.getElementById('fs-dim-actionbar');
            if(ab) ab.style.display = 'none';
        } else {
            cmdState.mode='WAITING_UCS_2P_ORIGIN_PREVIEW'; 
            setPrompt('基点（新しい原点）: (☑️確定)'); 
            const u=wcsToUcs(wcs.x,wcs.y); 
            addCommandLog(`-> 仮原点: (${dimFormat(u.x)},${dimFormat(u.y)}) - 確定してください`); 
            const ab = document.getElementById('fs-dim-actionbar');
            if(ab) { ab.style.display = 'flex'; const tb = document.getElementById('dim-mode-toggle'); if(tb) tb.style.display='none'; }
        }
        render(); 
        return; 
    }
    if(m==='WAITING_UCS_2P_ORIGIN_PREVIEW') {
        cmdState.startWcs={x:wcs.x,y:wcs.y}; 
        const u=wcsToUcs(wcs.x,wcs.y); 
        addCommandLog(`-> 仮原点: (${dimFormat(u.x)},${dimFormat(u.y)}) - 確定してください`); 
        render(); 
        return;
    }
    if(m==='WAITING_UCS_2P_XDIR') {
        if(fromMouse) {
            const ox = cmdState.startWcs.x, oy = cmdState.startWcs.y;
            const angle = Math.atan2(wcs.y - oy, wcs.x - ox);
            setUCS(ox, oy, angle);
            const ab = document.getElementById('fs-dim-actionbar');
            if(ab) ab.style.display = 'none';
        } else {
            cmdState.endWcs={x:wcs.x,y:wcs.y};
            cmdState.mode='WAITING_UCS_2P_XDIR_PREVIEW';
            setPrompt('X軸方向の点: (☑️確定)');
            addCommandLog('-> 仮X軸方向 - 確定してください');
            const ab = document.getElementById('fs-dim-actionbar');
            if(ab) { ab.style.display = 'flex'; const tb = document.getElementById('dim-mode-toggle'); if(tb) tb.style.display='none'; }
        }
        render();
        return;
    }
    if(m==='WAITING_UCS_2P_XDIR_PREVIEW') {
        cmdState.endWcs={x:wcs.x,y:wcs.y};
        addCommandLog('-> 仮X軸方向 - 確定してください');
        render();
        return;
    }
    if(m==='WAITING_LINE_P1') { cmdState.startWcs={x:wcs.x,y:wcs.y}; cmdState.mode='WAITING_LINE_P2'; setPrompt('次の点:'); const u=wcsToUcs(wcs.x,wcs.y); addCommandLog(`-> 1点目: (${u.x.toFixed(2)},${u.y.toFixed(2)})`); render(); return; }
    if(m==='WAITING_LINE_P2') { saveUndo(); entities.push({type:'LINE',layer:currentLayerIndex,color:null,x1:cmdState.startWcs.x,y1:cmdState.startWcs.y,x2:wcs.x,y2:wcs.y}); const u=wcsToUcs(wcs.x,wcs.y); addCommandLog(`-> 線分作成 終点: (${u.x.toFixed(2)},${u.y.toFixed(2)})`); cmdState.startWcs={x:wcs.x,y:wcs.y}; render(); return; }
    if(m==='WAITING_CIRCLE_CENTER') {
        if(cmdState.presetRadius>0){ saveUndo(); entities.push({type:'CIRCLE',layer:currentLayerIndex,color:null,cx:wcs.x,cy:wcs.y,radius:cmdState.presetRadius}); addCommandLog(`-> 円作成 半径: ${cmdState.presetRadius}`); resetCommand(); return; }
        cmdState.startWcs={x:wcs.x,y:wcs.y}; cmdState.mode='WAITING_CIRCLE_RADIUS'; setPrompt('半径:'); hidePropertyPanel(); const u=wcsToUcs(wcs.x,wcs.y); addCommandLog(`-> 中心: (${u.x.toFixed(2)},${u.y.toFixed(2)})`); render(); return;
    }
    if(m==='WAITING_CIRCLE_RADIUS') { const r=dist(cmdState.startWcs.x,cmdState.startWcs.y,wcs.x,wcs.y); saveUndo(); entities.push({type:'CIRCLE',layer:currentLayerIndex,color:null,cx:cmdState.startWcs.x,cy:cmdState.startWcs.y,radius:r}); addCommandLog(`-> 円作成 半径: ${r.toFixed(2)}`); resetCommand(); return; }
    if(m==='WAITING_RECT_P1') {
        if(cmdState.presetW>0 && cmdState.presetH>0){ saveUndo(); entities.push({type:'RECTANG',layer:currentLayerIndex,color:null,x1:wcs.x,y1:wcs.y,x2:wcs.x+cmdState.presetW,y2:wcs.y+cmdState.presetH}); addCommandLog(`-> 長方形作成 ${cmdState.presetW}×${cmdState.presetH}`); resetCommand(); return; }
        cmdState.startWcs={x:wcs.x,y:wcs.y}; cmdState.mode='WAITING_RECT_P2'; setPrompt('対角:'); hidePropertyPanel(); const u=wcsToUcs(wcs.x,wcs.y); addCommandLog(`-> 1点目: (${u.x.toFixed(2)},${u.y.toFixed(2)})`); render(); return;
    }
    if(m==='WAITING_RECT_P2') { saveUndo(); entities.push({type:'RECTANG',layer:currentLayerIndex,color:null,x1:cmdState.startWcs.x,y1:cmdState.startWcs.y,x2:wcs.x,y2:wcs.y}); addCommandLog('-> 長方形作成'); resetCommand(); return; }
    if(m==='WAITING_ARC_P1') { cmdState.points=[{x:wcs.x,y:wcs.y}]; cmdState.mode='WAITING_ARC_P2'; setPrompt('2点目:'); render(); return; }
    if(m==='WAITING_ARC_P2') { cmdState.points.push({x:wcs.x,y:wcs.y}); cmdState.mode='WAITING_ARC_P3'; setPrompt('終点:'); render(); return; }
    if(m==='WAITING_ARC_P3') {
        const p1=cmdState.points[0],p2=cmdState.points[1],p3={x:wcs.x,y:wcs.y};
        const cc=circumcenter(p1.x,p1.y,p2.x,p2.y,p3.x,p3.y);
        if(!cc){addCommandLog('エラー: 3点が直線上です'); resetCommand(); return;}
        const r=dist(cc.x,cc.y,p1.x,p1.y), sa=Math.atan2(p1.y-cc.y,p1.x-cc.x), ea=Math.atan2(p3.y-cc.y,p3.x-cc.x), ma=Math.atan2(p2.y-cc.y,p2.x-cc.x);
        const ccw=isAngleBetweenCCW(ma,sa,ea);
        saveUndo(); entities.push({type:'ARC',layer:currentLayerIndex,color:null,cx:cc.x,cy:cc.y,radius:r,startAngle:sa,endAngle:ea,counterclockwise:ccw});
        addCommandLog('-> 円弧作成'); resetCommand(); return;
    }
    if(m==='WAITING_PLINE_NEXT') { cmdState.points.push({x:wcs.x,y:wcs.y}); const u=wcsToUcs(wcs.x,wcs.y); addCommandLog(`-> 点追加: (${u.x.toFixed(2)},${u.y.toFixed(2)}) [Enter:確定/C:閉合]`); render(); return; }

    if(m==='WAITING_ELLIPSE_CENTER') { cmdState.startWcs={x:wcs.x,y:wcs.y}; cmdState.mode='WAITING_ELLIPSE_X'; setPrompt('X方向の端点:'); addCommandLog(`-> 中心: (${wcs.x.toFixed(2)},${wcs.y.toFixed(2)})`); render(); return; }
    if(m==='WAITING_ELLIPSE_X') { cmdState.points=[{x:wcs.x,y:wcs.y}]; cmdState.mode='WAITING_ELLIPSE_Y'; setPrompt('Y方向の端点 (または距離):'); addCommandLog(`-> X端点: (${wcs.x.toFixed(2)},${wcs.y.toFixed(2)})`); render(); return; }
    if(m==='WAITING_ELLIPSE_Y') {
        const cx=cmdState.startWcs.x, cy=cmdState.startWcs.y, ex=cmdState.points[0].x, ey=cmdState.points[0].y;
        const rx=dist(cx,cy,ex,ey), rot=Math.atan2(ey-cy, ex-cx), ry=dist(cx,cy,wcs.x,wcs.y);
        saveUndo(); entities.push({type:'ELLIPSE',layer:currentLayerIndex,color:null,cx:cx,cy:cy,rx:rx,ry:ry,rotation:rot});
        addCommandLog(`-> 楕円作成 X半径: ${rx.toFixed(2)} Y半径: ${ry.toFixed(2)}`); resetCommand(); return;
    }
    if(m==='WAITING_TEXT_PLACE') {
        saveUndo(); 
        entities.push({type:'TEXT', layer:currentLayerIndex, color:null, x:wcs.x, y:wcs.y, text:cmdState.textStr, height:cmdState.textHeight});
        addCommandLog(`-> テキスト配置: "${cmdState.textStr}"`); 
        
        if(cmdState.isContinuous) {
            // 連続配置の場合はそのまま
            addCommandLog('-> 続けて配置点をタップしてください。終了するにはEsc/キャンセル');
        } else {
            resetCommand(); 
        }
        render(); 
        return; 
    }
    if(m==='WAITING_HATCH_SELECT') {
        const idx=hitTestEntity(mouse.screenX,mouse.screenY);
        if(idx>=0) {
            const tgt=entities[idx];
            if(tgt.type==='RECTANG'||tgt.type==='CIRCLE'||(tgt.type==='PLINE'&&tgt.closed)) {
                saveUndo(); entities.push({type:'HATCH',layer:currentLayerIndex,color:null,target:JSON.parse(JSON.stringify(tgt))});
                addCommandLog('-> ハッチング(塗りつぶし)作成'); resetCommand(); return;
            } else { addCommandLog('閉じた図形(長方形, 円, 閉じたポリライン)ではありません'); }
        } else { addCommandLog('図形が見つかりません'); }
        return;
    }
    if(m==='WAITING_ERASE_SELECT') {
        const idx=hitTestEntity(mouse.screenX,mouse.screenY);
        if(idx>=0){saveUndo(); entities.splice(idx,1); addCommandLog('-> エンティティ削除'); cmdState.highlightIdx=-1; render();}
        else addCommandLog('エンティティが見つかりません');
        return;
    }
    if(m==='WAITING_ROTATE_SELECT') {
        const idx=hitTestEntity(mouse.screenX,mouse.screenY);
        if(idx>=0) {
            cmdState.highlightIdx = idx;
            cmdState.mode = 'WAITING_ROTATE_BASE'; setPrompt('回転: 中心となる基点を指定');
            addCommandLog('-> 対象を選択。基点を指定'); render(); return;
        } else { addCommandLog('エンティティが見つかりません'); return; }
    }
    // -- OFFSET --
    if(m==='WAITING_OFFSET_DIST' || m==='WAITING_OFFSET_SELECT') {
        if(m==='WAITING_OFFSET_DIST') {
            // マウスで2点指定による距離入力の1点目とするなどできるが、現状は直接選択へ
            const idx=hitTestEntity(mouse.screenX,mouse.screenY);
            if(idx>=0 && isOffsetable(entities[idx])) {
                cmdState.offsetDist = 10; // デフォルト10
                cmdState.offsetTarget = idx; cmdState.mode = 'WAITING_OFFSET_SIDE'; setPrompt('オフセットする側:');
                cmdState.highlightIdx = idx; addCommandLog('-> 対象を選択。オフセット方向(側)を指定 (デフォルト距離10)'); render(); return;
            }
        } else {
            const idx=hitTestEntity(mouse.screenX,mouse.screenY);
            if(idx>=0 && isOffsetable(entities[idx])) {
                cmdState.offsetTarget = idx; cmdState.mode = 'WAITING_OFFSET_SIDE'; setPrompt('オフセットする側:');
                cmdState.highlightIdx = idx; addCommandLog('-> 対象を選択。オフセット方向(側)を指定'); render(); return;
            } else { addCommandLog('オフセットできないエンティティです'); return; }
        }
    }
    if(m==='WAITING_OFFSET_SIDE') {
        const e = entities[cmdState.offsetTarget];
        const res = createOffsetEntity(e, cmdState.offsetDist, wcs.x, wcs.y);
        if(res) { saveUndo(); entities.push(res); addCommandLog('-> オフセット完了'); }
        cmdState.mode = 'WAITING_OFFSET_SELECT'; cmdState.highlightIdx = -1; setPrompt('オフセット対象 (右クリックで終了):');
        render(); return;
    }
    // -- ROTATE --
    if(m==='WAITING_ROTATE_BASE') {
        // 角度プリセットがあれば基点クリックで即確定
        if(cmdState.presetAngleDeg !== undefined && !isNaN(cmdState.presetAngleDeg)) {
            saveUndo();
            rotateEntity(entities[cmdState.highlightIdx], wcs.x, wcs.y, cmdState.presetAngleDeg * Math.PI/180);
            addCommandLog(`-> 回転完了 (角度: ${cmdState.presetAngleDeg}度)`);
            cmdState.highlightIdx = -1; resetCommand(); return;
        }
        cmdState.rotateBase = {x:wcs.x, y:wcs.y};
        cmdState.mode = 'WAITING_ROTATE_REF1'; setPrompt('回転: 参照角度の始点となる参照点を選択');
        addCommandLog(`-> 基点: (${wcs.x.toFixed(2)}, ${wcs.y.toFixed(2)})。参照始点を指定`);
        render(); return;
    }
    if(m==='WAITING_ROTATE_REF1') {
        cmdState.rotateRef1 = {x:wcs.x, y:wcs.y};
        cmdState.mode = 'WAITING_ROTATE_REF2'; setPrompt('回転: 参照角度の終点となる参照点を選択');
        addCommandLog(`-> 参照始点: (${wcs.x.toFixed(2)}, ${wcs.y.toFixed(2)})。参照終点を指定`);
        render(); return;
    }
    if(m==='WAITING_ROTATE_REF2') {
        cmdState.rotateRef2 = {x:wcs.x, y:wcs.y};
        cmdState.refAngle = Math.atan2(wcs.y - cmdState.rotateRef1.y, wcs.x - cmdState.rotateRef1.x);
        cmdState.mode = 'WAITING_ROTATE_DEST'; setPrompt('回転: 新しい角度の方向を指定（始点から目的点）');
        addCommandLog(`-> 参照終点: (${wcs.x.toFixed(2)}, ${wcs.y.toFixed(2)})。新しい角度の基準点を指定`);
        render(); return;
    }
    if(m==='WAITING_ROTATE_DEST') {
        const destAngle = Math.atan2(wcs.y - cmdState.rotateRef1.y, wcs.x - cmdState.rotateRef1.x);
        const deltaAngle = destAngle - cmdState.refAngle;
        saveUndo();
        const e = entities[cmdState.highlightIdx];
        rotateEntity(e, cmdState.rotateBase.x, cmdState.rotateBase.y, deltaAngle);
        addCommandLog(`-> 回転完了 (角度: ${(deltaAngle * 180 / Math.PI).toFixed(2)}度)`);
        cmdState.highlightIdx = -1;
        resetCommand();
        return;
    }

    // 寸法コマンドの入力処理は cad-dimension.js へ委譲
    if(typeof handleDimPointInput==='function') handleDimPointInput(m, wcs);
}

// ===== オフセット処理 =====
function isOffsetable(e) { return e.type==='LINE'||e.type==='CIRCLE'||e.type==='ARC'||e.type==='RECTANG'; }
function createOffsetEntity(e, d, wx, wy) {
    const copy = JSON.parse(JSON.stringify(e));
    delete copy.bbox; // 元図形のbboxを引き継ぐとスナップ/描画カリングが誤判定する
    if(e.type==='CIRCLE'||e.type==='ARC') {
        const dc = dist(e.cx, e.cy, wx, wy);
        if(dc > e.radius) copy.radius += d; else { copy.radius -= d; if(copy.radius<=0) return null; }
        return copy;
    } else if(e.type==='LINE') {
        const dx = e.x2 - e.x1, dy = e.y2 - e.y1, len = Math.sqrt(dx*dx+dy*dy);
        const nx = -dy/len, ny = dx/len; // 左側法線
        // クリック点が線分のどちら側か
        const vx = wx - e.x1, vy = wy - e.y1;
        const cross = dx*vy - dy*vx; // Z成分：正なら左側
        const sign = cross > 0 ? 1 : -1;
        copy.x1 += nx*d*sign; copy.y1 += ny*d*sign; copy.x2 += nx*d*sign; copy.y2 += ny*d*sign;
        return copy;
    } else if(e.type==='RECTANG') {
        const cx=(e.x1+e.x2)/2, cy=(e.y1+e.y2)/2;
        const rx=Math.abs(e.x2-e.x1)/2, ry=Math.abs(e.y2-e.y1)/2;
        const dcx=Math.abs(wx-cx), dcy=Math.abs(wy-cy);
        const isOutside = (dcx > rx || dcy > ry);
        const sign = isOutside ? 1 : -1;
        if(!isOutside && (rx-d<=0 || ry-d<=0)) return null;
        if(e.x1<e.x2) { copy.x1-=d*sign; copy.x2+=d*sign; } else { copy.x1+=d*sign; copy.x2-=d*sign; }
        if(e.y1<e.y2) { copy.y1-=d*sign; copy.y2+=d*sign; } else { copy.y1+=d*sign; copy.y2-=d*sign; }
        return copy;
    }
    return null;
}

// ===== 回転処理 =====
function rotateEntity(e, cx, cy, angle) {
    delete e.bbox; // 座標変更後は次回描画時に再計算させる
    const rx = (x, y) => (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle) + cx;
    const ry = (x, y) => (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle) + cy;
    if(e.type === 'LINE' || e.type === 'RECTANG') {
        const nx1 = rx(e.x1, e.y1), ny1 = ry(e.x1, e.y1);
        const nx2 = rx(e.x2, e.y2), ny2 = ry(e.x2, e.y2);
        if(e.type === 'RECTANG') {
            e.type = 'PLINE';
            e.points = [
                {x: nx1, y: ny1}, {x: rx(e.x2, e.y1), y: ry(e.x2, e.y1)},
                {x: nx2, y: ny2}, {x: rx(e.x1, e.y2), y: ry(e.x1, e.y2)}
            ];
            e.closed = true;
            delete e.x1; delete e.y1; delete e.x2; delete e.y2;
        } else { e.x1 = nx1; e.y1 = ny1; e.x2 = nx2; e.y2 = ny2; }
    } else if(e.type === 'CIRCLE' || e.type === 'ARC' || e.type === 'ELLIPSE') {
        // cx更新後の値でcyを計算しないよう、両方を計算してから代入する
        const ncx = rx(e.cx, e.cy), ncy = ry(e.cx, e.cy);
        e.cx = ncx; e.cy = ncy;
        if(e.type === 'ARC') { e.startAngle += angle; e.endAngle += angle; }
        if(e.type === 'ELLIPSE') { e.rotation = (e.rotation || 0) + angle; }
    } else if(e.type === 'PLINE') {
        e.points.forEach(p => { const np = {x: Math.round(rx(p.x, p.y)*1000)/1000, y: Math.round(ry(p.x, p.y)*1000)/1000}; p.x = np.x; p.y = np.y; });
    } else if(e.type === 'POINT' || e.type === 'TEXT') {
        const nx = rx(e.x, e.y), ny = ry(e.x, e.y);
        e.x = nx; e.y = ny;
    }
}

function finishPline(close) {
    if(cmdState.points.length>=2) { saveUndo(); entities.push({type:'PLINE',layer:currentLayerIndex,color:null,points:cmdState.points.slice(),closed:!!close}); addCommandLog(close?'-> ポリライン閉合':'-> ポリライン確定'); }
    else addCommandLog('-> キャンセル（点が不足）');
    resetCommand();
}

function processCommand(cmdText) {
    const cmd = cmdText.toUpperCase().trim();
    const coordMatch = cmd.match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
    if(coordMatch) { const ux=parseFloat(coordMatch[1]),uy=parseFloat(coordMatch[3]); const w=ucsToWcs(ux,uy); handlePointInput(w, true); return; }
    const numMatch = cmd.match(/^(-?\d+(\.\d+)?)$/);
    if(numMatch) {
        const val = parseFloat(numMatch[1]);
        if(cmdState.mode==='WAITING_CIRCLE_RADIUS') {
            saveUndo(); entities.push({type:'CIRCLE',layer:currentLayerIndex,color:null,cx:cmdState.startWcs.x,cy:cmdState.startWcs.y,radius:val});
            addCommandLog(`-> 円作成 半径: ${val}`); resetCommand(); return;
        }
        if(cmdState.mode==='WAITING_OFFSET_DIST') {
            cmdState.offsetDist = Math.abs(val);
            cmdState.mode = 'WAITING_OFFSET_SELECT'; setPrompt('オフセット対象:');
            addCommandLog(`-> 距離 ${cmdState.offsetDist} に設定。対象を選択`); return;
        }
    }
    // WAITING_TEXT_STR was removed
    if(cmd==='C' && cmdState.mode==='WAITING_PLINE_NEXT' && cmdState.points.length>=2) { finishPline(true); return; }
    if(cmd==='LAYOFF') {
        if (cmdState.mode === 'WAITING_LAYOFF_TOUCH') {
            resetCommand();
            addCommandLog('-> タッチ非表示モードを終了しました');
            return;
        }
        cmdState.mode='WAITING_LAYOFF_TOUCH';
        setPrompt('タッチ非表示: 非表示にする画層の図形をタッチしてください');
        addCommandLog('-> 画層タッチ非表示モード: 図面上のオブジェクトをタッチするとその画層が非表示になります（終了するには画面下の終了ボタン、Esc、またはもう一度タッチ非表示ボタンを押す）');
        
        if (typeof window.showLayerManagerPanel === 'function') {
            window.showLayerManagerPanel();
        }

        // スマホなどのタッチデバイス向けに、画面下部に終了アクションバーを表示
        const ab = document.getElementById('fs-dim-actionbar');
        if (ab) {
            ab.style.display = 'flex';
            const confirmBtn = ab.querySelector('button[onclick="dimConfirmPoint()"]');
            if (confirmBtn) confirmBtn.style.display = 'none'; // 確定ボタンは不要
            const toggleBtn = document.getElementById('dim-mode-toggle');
            if (toggleBtn) toggleBtn.style.display = 'none'; // 設定ボタンも不要
            
            const cancelBtn = ab.querySelector('button[onclick="resetCommand()"]');
            if (cancelBtn) {
                cancelBtn.textContent = '✖ 非表示終了';
                cancelBtn.style.background = '#ff6b6b';
                cancelBtn.style.padding = '8px 20px';
                cancelBtn.style.borderRadius = '16px';
            }
        }
        return;
    }
    // 寸法コマンドの処理（cad-dimension.js から登録）
    if(typeof processDimCommand==='function' && processDimCommand(cmd)) return;
    // ファイル入出力（cad-io.js から登録）
    if(typeof processIOCommand==='function' && processIOCommand(cmd)) return;
    if(cmd==='L'||cmd==='LINE') { cmdState.mode='WAITING_LINE_P1'; setPrompt('1点目:'); setActiveTool('LINE'); addCommandLog('-> 1点目を指定'); }
    else if(cmd==='C'||cmd==='CIRCLE') {
        cmdState.mode='WAITING_CIRCLE_CENTER'; setPrompt('中心:'); setActiveTool('CIRCLE'); addCommandLog('-> 中心を指定（または半径を入力）');
        showPropertyPanel('円 設定', `
            <div class="prop-row"><label>半径:</label><input type="number" id="prop-circle-r" value="${lastParams.radius}" min="0" placeholder="クリックで指定"></div>
            <button class="prop-btn" onclick="applyCirclePreset()">この半径で配置</button>
            <div style="color:#888;font-size:10px;margin-top:4px;">空欄ならクリックで半径指定</div>
        `);
    }
    else if(cmd==='REC'||cmd==='RECTANG') {
        cmdState.mode='WAITING_RECT_P1'; setPrompt('1点目:'); setActiveTool('RECT'); addCommandLog('-> 1つ目の角を指定（または寸法を入力）');
        showPropertyPanel('長方形 設定', `
            <div class="prop-row"><label>幅:</label><input type="number" id="prop-rect-w" value="${lastParams.rectW}" placeholder="クリックで指定"></div>
            <div class="prop-row"><label>高さ:</label><input type="number" id="prop-rect-h" value="${lastParams.rectH}" placeholder="クリックで指定"></div>
            <button class="prop-btn" onclick="applyRectPreset()">この寸法で配置</button>
            <div style="color:#888;font-size:10px;margin-top:4px;">空欄なら2点クリックで作図</div>
        `);
    }
    else if(cmd==='A'||cmd==='ARC') { cmdState.mode='WAITING_ARC_P1'; cmdState.points=[]; setPrompt('始点:'); setActiveTool('ARC'); addCommandLog('-> 始点を指定'); }
    else if(cmd==='PL'||cmd==='PLINE') { cmdState.mode='WAITING_PLINE_NEXT'; cmdState.points=[]; setPrompt('始点:'); setActiveTool('PLINE'); addCommandLog('-> 始点を指定'); }
    else if(cmd==='EL'||cmd==='ELLIPSE') { cmdState.mode='WAITING_ELLIPSE_CENTER'; setPrompt('中心:'); setActiveTool('ELLIPSE'); addCommandLog('-> 楕円の中心を指定'); }
    else if(cmd==='T'||cmd==='TEXT') { 
        cmdState.mode='WAITING_TEXT_INPUT'; 
        setPrompt('文字設定を入力'); 
        setActiveTool('TEXT'); 
        addCommandLog('-> 文字の内容と高さを設定');
        
        // 過去の値を保持
        const lastH = cmdState.textHeight || 20;
        const lastStr = cmdState.textStr || '';
        
        const html = `
            <div class="prop-row">
                <label>文字内容:</label>
                <input type="text" id="prop-text-val" value="${lastStr}" placeholder="入力...">
            </div>
            <div class="prop-row">
                <label>高さ:</label>
                <input type="number" id="prop-text-h" value="${lastH}" min="1">
            </div>
            <div class="prop-row">
                <label><input type="checkbox" id="prop-text-cont" checked> 連続配置</label>
            </div>
            <button class="prop-btn" onclick="startTextPlacement()">これで配置する</button>
        `;
        showPropertyPanel('テキスト設定', html);
    }
    else if(cmd==='H'||cmd==='HATCH') { cmdState.mode='WAITING_HATCH_SELECT'; setPrompt('閉じた図形を選択:'); setActiveTool('HATCH'); addCommandLog('-> 塗りつぶす閉じた図形を選択'); }
    else if(cmd==='E'||cmd==='ERASE') {
        // IDLE時の選択を引き継ぎ
        if(cmdState.selectedIndices && cmdState.selectedIndices.length > 0) {
            const si = cmdState.selectedIndices.slice();
            saveUndo();
            si.sort((a,b) => b-a).forEach(i => entities.splice(i, 1));
            addCommandLog(`-> ${si.length}個のオブジェクトを削除`);
            cmdState.selectedIndices = []; cmdState.highlightIdx = -1;
            setActiveTool('ERASE'); resetCommand(); return;
        }
        cmdState.mode='WAITING_ERASE_SELECT'; setPrompt('削除対象:'); setActiveTool('ERASE'); addCommandLog('-> 削除するエンティティをクリック');
    }
    else if(cmd==='O'||cmd==='OFFSET') {
        cmdState.mode='WAITING_OFFSET_DIST'; setPrompt('オフセット距離:'); setActiveTool('OFFSET'); addCommandLog('-> [オフセット] 距離を入力');
        showPropertyPanel('オフセット 設定', `
            <div class="prop-row"><label>距離:</label><input type="number" id="prop-offset-d" value="${lastParams.offset}" min="0"></div>
            <button class="prop-btn" onclick="applyOffsetPreset()">この距離で対象選択へ</button>
        `);
    }
    else if(cmd==='RO'||cmd==='ROTATE') {
        showPropertyPanel('回転 設定', `
            <div class="prop-row"><label>角度(°):</label><input type="number" id="prop-rotate-a" value="${lastParams.angle}"></div>
            <button class="prop-btn" onclick="applyRotatePreset()">この角度で回転</button>
            <div style="color:#888;font-size:10px;margin-top:4px;">確定後: 対象を選択→基点をクリックで回転。空欄なら参照点方式</div>
        `);
        // IDLE時の選択を引き継ぎ
        if(cmdState.highlightIdx >= 0 || (cmdState.selectedIndices && cmdState.selectedIndices.length > 0)) {
            const keepIdx = cmdState.highlightIdx >= 0 ? cmdState.highlightIdx : cmdState.selectedIndices[0];
            cmdState.highlightIdx = keepIdx;
            cmdState.mode = 'WAITING_ROTATE_BASE'; setPrompt('回転: 中心となる基点を指定');
            setActiveTool('ROTATE'); addCommandLog('-> IDLE選択を引き継ぎ。基点を指定'); render(); return;
        }
        cmdState.mode='WAITING_ROTATE_SELECT'; setPrompt('回転対象:'); setActiveTool('ROTATE'); addCommandLog('-> 回転させる図形を選択');
    }
    else if(cmd==='UCS') { cmdState.mode='WAITING_UCS_ORIGIN'; setPrompt('新しい原点 [2点(2P)]:'); addCommandLog('-> 新しい原点を指定 (クリック or 座標), 2P: 2点指定'); render(); }
    else if(cmd==='UCS2P'||cmd==='2P') {
        if(cmdState.mode==='WAITING_UCS_ORIGIN') {
            // UCSコマンドの中で2P入力された場合
            cmdState.mode='WAITING_UCS_2P_ORIGIN'; setPrompt('基点（新しい原点）:'); addCommandLog('-> 2点指定: 基点を指定'); render();
        } else {
            // 直接UCS2Pコマンド
            cmdState.mode='WAITING_UCS_2P_ORIGIN'; setPrompt('基点（新しい原点）:'); addCommandLog('-> UCS 2点指定: 基点を指定してください'); render();
        }
    }
    else if(cmd==='WCS') { resetUCS(); }
    else if(cmd==='SHOWALL') { window.showHiddenEntities(); }
    else if(cmd==='U'||cmd==='UNDO') { undo(); }
    else if(cmd==='REDO') { redo(); }
    else if(cmd==='ZE'||cmd==='ZOOM') { zoomExtents(); }
    else if(cmd==='CANCEL') { resetCommand(); }
    else if(typeof processStorageCommand === 'function' && processStorageCommand(cmd)) { /* ストレージコマンド処理済み */ }
    else { addCommandLog(`不明なコマンドです "${cmdText}"`); resetCommand(); }
}

// ===== イベントリスナー =====
let lastTouchTime = 0;
function setupEventListeners() {
    // 全てのボタンに対するグローバルハプティクス（短い振動）
    document.addEventListener('click', (e) => {
        let target = e.target;
        while(target && target !== document.body) {
            if(target.tagName === 'BUTTON') {
                if(navigator.vibrate) navigator.vibrate(10);
                break;
            }
            target = target.parentNode;
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        const rect=canvas.getBoundingClientRect(); mouse.screenX=e.clientX-rect.left; mouse.screenY=e.clientY-rect.top;
        const wcs=screenToWcs(mouse.screenX,mouse.screenY); mouse.wcsX=wcs.x; mouse.wcsY=wcs.y;
        const uc=wcsToUcs(wcs.x,wcs.y); mouse.ucsX=uc.x; mouse.ucsY=uc.y;
        if(mouse.isPanning){view.x+=e.movementX;view.y+=e.movementY;}
        // コマンドモード中のみスナップ計算（IDLE時は軽量化のためスキップ）
        const isSelectMode = ['WAITING_ERASE_SELECT','WAITING_MOVE_SELECT','WAITING_COPY_SELECT','WAITING_OFFSET_SELECT','WAITING_OFFSET_SIDE'].includes(cmdState.mode);
        if(cmdState.mode !== 'IDLE' && !isSelectMode && !mouse.isSelecting) {
            snapResult = findSnap(mouse.screenX, mouse.screenY, mouse.wcsX, mouse.wcsY);
        } else { snapResult = null; }
        if(snapResult){ const su=wcsToUcs(snapResult.wcsX,snapResult.wcsY); coordsDisplay.textContent=`X:${su.y.toFixed(0)}  Y:${su.x.toFixed(0)}`; if(window.updateFsCoordTooltip) window.updateFsCoordTooltip(e.clientX, e.clientY, su.x, su.y, snapResult.type); }
        else { coordsDisplay.textContent=`X:${mouse.ucsY.toFixed(0)}  Y:${mouse.ucsX.toFixed(0)}`; if(window.updateFsCoordTooltip) window.updateFsCoordTooltip(e.clientX, e.clientY, mouse.ucsX, mouse.ucsY, null); }
        if(cmdState.mode==='WAITING_ERASE_SELECT'||cmdState.mode==='WAITING_MOVE_SELECT'||cmdState.mode==='WAITING_COPY_SELECT'||cmdState.mode==='WAITING_OFFSET_SELECT') {
            if(!mouse.isSelecting) cmdState.highlightIdx=hitTestEntity(mouse.screenX,mouse.screenY);
        }
        render();
        if(mouse.isSelecting) drawSelectionRect();
    });
    canvas.addEventListener('mousedown', (e) => {
        if(Date.now() - lastTouchTime < 500) return; // タッチイベントに起因する疑似マウスイベントを無視
        if(e.button===1){mouse.isPanning=true;e.preventDefault();return;} // Middle click for panning
        if(e.button===0) {
            const selectModes = ['IDLE', 'WAITING_ERASE_SELECT', 'WAITING_MOVE_SELECT', 'WAITING_COPY_SELECT', 'WAITING_ROTATE_SELECT'];
            const isSelectMode = selectModes.includes(cmdState.mode);

            if (cmdState.mode!=='IDLE' && !isSelectMode) { // Left click for point input when not in IDLE and not select mode
                const pt=getInputPoint(); handlePointInput(pt, true);
            } else {
                const idx = hitTestEntity(mouse.screenX, mouse.screenY);
                if(idx >= 0) {
                    if (cmdState.mode === 'IDLE') {
                        cmdState.highlightIdx = (cmdState.highlightIdx === idx) ? -1 : idx;
                    } else {
                        const pt=getInputPoint(); handlePointInput(pt, true);
                    }
                } else {
                    if (cmdState.mode === 'IDLE') cmdState.highlightIdx = -1;
                    if (window.areaSelectEnabled) {
                        mouse.isSelecting = true;
                        mouse.selStartX = mouse.screenX;
                        mouse.selStartY = mouse.screenY;
                    }
                }
                updatePropertiesPanel();
                render();
                if(mouse.isSelecting) drawSelectionRect();
            }
        }
        if(e.button===2) { // Right click
            e.preventDefault();
            if(cmdState.mode==='IDLE') {
                cmdState.highlightIdx = -1; updatePropertiesPanel(); render();
            }
            // Original contextmenu logic
            if(cmdState.mode==='WAITING_LINE_P2'){resetCommand();addCommandLog('-> LINE終了');}
            else if(cmdState.mode==='WAITING_PLINE_NEXT'){finishPline(false);}
            else if(cmdState.mode==='WAITING_ERASE_SELECT'){resetCommand();addCommandLog('-> ERASE終了');}
            else if(cmdState.mode==='WAITING_MOVE_SELECT'){resetCommand();addCommandLog('-> MOVE終了');}
            else if(cmdState.mode==='WAITING_COPY_SELECT'){resetCommand();addCommandLog('-> COPY終了');}
            else if(cmdState.mode==='WAITING_OFFSET_SELECT'||cmdState.mode==='WAITING_OFFSET_SIDE'){resetCommand();addCommandLog('-> OFFSET終了');}
            else if(cmdState.mode!=='IDLE'){resetCommand();addCommandLog('-> コマンド終了');}
        }
    });
    window.addEventListener('mouseup',(e)=>{
        if(e.button===1)mouse.isPanning=false;
        if(e.button===0 && mouse.isSelecting) {
            performSelection(mouse.selStartX, mouse.selStartY, mouse.screenX, mouse.screenY);
            mouse.isSelecting = false;
            render();
        }
    });
    canvas.addEventListener('contextmenu',(e)=>{
        e.preventDefault();
        if(cmdState.mode==='WAITING_LINE_P2'){resetCommand();addCommandLog('-> LINE終了');}
        else if(cmdState.mode==='WAITING_PLINE_NEXT'){finishPline(false);}
        else if(cmdState.mode==='WAITING_ERASE_SELECT'){resetCommand();addCommandLog('-> ERASE終了');}
        else if(cmdState.mode==='WAITING_MOVE_SELECT'){resetCommand();addCommandLog('-> MOVE終了');}
        else if(cmdState.mode==='WAITING_COPY_SELECT'){resetCommand();addCommandLog('-> COPY終了');}
        else if(cmdState.mode==='WAITING_OFFSET_SELECT'||cmdState.mode==='WAITING_OFFSET_SIDE'){resetCommand();addCommandLog('-> OFFSET終了');}
        else if(cmdState.mode!=='IDLE'){resetCommand();addCommandLog('-> コマンド終了');}
    });
    canvas.addEventListener('wheel',(e)=>{
        e.preventDefault(); const zf=e.deltaY>0?0.9:1.1; const wb=screenToWcs(mouse.screenX,mouse.screenY);
        view.scale=Math.max(0.0001,Math.min(view.scale*zf,10000));
        _reanchorView(mouse.screenX, mouse.screenY, wb);
        render();
    },{passive:false});

    // ===== タッチイベント（スマホ対応 - AutoCADライクUX） =====
    canvas.style.touchAction = 'none';
    let touchState = {
        lastDist: 0, lastMid: null, isPinch: false,
        // ルーペ・長押し描画用
        startX: 0, startY: 0, isDragging: false, hasMoved: false,
        pressTimer: null,
        // 範囲選択用
        selStartX: 0, selStartY: 0, isSelecting: false,
        // ルーペ表示フラグ
        showLoupe: false, loupeX: 0, loupeY: 0
    };
    const DRAG_THRESHOLD = 8; // ドラッグ判定の閾値(px)

    // ルーペ（拡大鏡）描画
    function drawLoupe() {
        if(!touchState.showLoupe) return;
        const lx = touchState.loupeX, ly = touchState.loupeY;
        const loupeR = 70; // ルーペの半径（半分の幅）
        const loupeY = ly - 140; // 指の140px上に表示して隠れにくくする
        const loupeX = Math.max(loupeR + 5, Math.min(canvas.width - loupeR - 5, lx));
        const finalY = Math.max(loupeR + 5, loupeY);
        const zoom = 3; // 拡大倍率

        ctx.save();
        // 四角いクリッピング
        ctx.beginPath();
        ctx.rect(loupeX - loupeR, finalY - loupeR, loupeR * 2, loupeR * 2);
        ctx.clip();

        // ルーペ内の背景描画（拡大表示）
        ctx.fillStyle = '#111';
        ctx.fillRect(loupeX - loupeR, finalY - loupeR, loupeR * 2, loupeR * 2);

        // 拡大表示: 元のビューに対してzoom倍の描画を行う
        ctx.translate(loupeX, finalY);
        ctx.scale(zoom, zoom);
        ctx.translate(-lx, -ly);

        // 軸線（簡易描画）
        const ws = wcsToScreen(0, 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0, ws.y); ctx.lineTo(canvas.width, ws.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ws.x, 0); ctx.lineTo(ws.x, canvas.height); ctx.stroke();

        // エンティティ描画
        ctx.lineWidth = 0.5;
        const isVisible = (e) => (e.layer === undefined || !layers[e.layer] || layers[e.layer].visible) && !e.hidden;
        entities.forEach((e, i) => { if(!isVisible(e)) return; if(e.type !== 'DIMENSION') drawOneEntity(e, i === cmdState.highlightIdx ? '#ff6b6b' : null); });

        // スナップマーカー（ルーペ内で大きく表示）
        if(snapResult && osnapState.main) {
            const s = wcsToScreen(snapResult.wcsX, snapResult.wcsY);
            const mk = 6; // マーカーサイズ（zoom倍されるので実質18px相当）
            ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 1.5;
            if(snapResult.type === '端点') {
                ctx.beginPath(); ctx.moveTo(s.x, s.y-mk); ctx.lineTo(s.x+mk, s.y+mk*0.7); ctx.lineTo(s.x-mk, s.y+mk*0.7); ctx.closePath(); ctx.stroke();
            } else if(snapResult.type === '中点') {
                ctx.strokeRect(s.x-mk, s.y-mk, mk*2, mk*2);
                ctx.beginPath(); ctx.moveTo(s.x-mk, s.y+mk); ctx.lineTo(s.x, s.y-mk); ctx.lineTo(s.x+mk, s.y+mk); ctx.stroke();
            } else if(snapResult.type === '中心') {
                ctx.beginPath(); ctx.arc(s.x, s.y, mk, 0, Math.PI*2); ctx.stroke();
            } else if(snapResult.type === '交点') {
                ctx.beginPath(); ctx.moveTo(s.x-mk,s.y-mk); ctx.lineTo(s.x+mk,s.y+mk); ctx.moveTo(s.x+mk,s.y-mk); ctx.lineTo(s.x-mk,s.y+mk); ctx.stroke();
            } else if(snapResult.type === '近接点') {
                ctx.beginPath(); ctx.moveTo(s.x-mk,s.y-mk); ctx.lineTo(s.x+mk,s.y+mk); ctx.moveTo(s.x-mk,s.y+mk); ctx.lineTo(s.x+mk,s.y-mk); ctx.strokeRect(s.x-mk,s.y-mk,mk*2,mk*2);
            } else if(snapResult.type === '垂線') {
                ctx.beginPath(); ctx.moveTo(s.x-mk,s.y-mk); ctx.lineTo(s.x-mk,s.y+mk); ctx.lineTo(s.x+mk,s.y+mk); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(s.x-mk,s.y); ctx.lineTo(s.x-mk+mk*0.5,s.y); ctx.moveTo(s.x,s.y+mk); ctx.lineTo(s.x,s.y+mk-mk*0.5); ctx.stroke();
            }
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0); // リセット

        // ルーペ内のクロスヘア
        ctx.strokeStyle = 'rgba(255,255,0,0.8)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(loupeX - loupeR, finalY); ctx.lineTo(loupeX + loupeR, finalY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(loupeX, finalY - loupeR); ctx.lineTo(loupeX, finalY + loupeR); ctx.stroke();

        ctx.restore();

        // ルーペ外枠 (四角形)
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.strokeRect(loupeX - loupeR, finalY - loupeR, loupeR * 2, loupeR * 2);

        // 座標テキスト + スナップ種別
        const ucsCoord = wcsToUcs(mouse.wcsX, mouse.wcsY);
        const snapLabelText = snapResult && osnapState.main ? ` [${snapResult.type}]` : '';
        // 背景
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(loupeX - loupeR, finalY + loupeR + 2, loupeR * 2, snapResult && osnapState.main ? 32 : 18);
        // 座標値
        ctx.fillStyle = '#00ff88'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
        ctx.fillText(`X:${ucsCoord.y.toFixed(2)}  Y:${ucsCoord.x.toFixed(2)}`, loupeX, finalY + loupeR + 14);
        // スナップ種別（2行目）
        if(snapResult && osnapState.main) {
            ctx.fillStyle = '#ffff00'; ctx.font = 'bold 11px monospace';
            ctx.fillText(`SNAP: ${snapResult.type}`, loupeX, finalY + loupeR + 28);
        }
        ctx.restore();
    }

    // 範囲選択矩形の描画
    function drawSelectionRect() {
        if(!touchState.isSelecting && !mouse.isSelecting) return;
        const isTouch = touchState.isSelecting;
        const sx = isTouch ? touchState.selStartX : mouse.selStartX;
        const sy = isTouch ? touchState.selStartY : mouse.selStartY;
        const ex = mouse.screenX, ey = mouse.screenY;
        const isWindow = ex >= sx; // 左→右 = 窓選択、右→左 = 交差選択

        ctx.save();
        if(isWindow) {
            // 窓選択: 青枠・実線・薄い青塗り
            ctx.strokeStyle = '#3399ff'; ctx.fillStyle = 'rgba(51,153,255,0.15)';
            ctx.setLineDash([]);
        } else {
            // 交差選択: 緑枠・破線・薄い緑塗り
            ctx.strokeStyle = '#33ff99'; ctx.fillStyle = 'rgba(51,255,153,0.15)';
            ctx.setLineDash([6, 3]);
        }
        ctx.lineWidth = 2;
        const x = Math.min(sx, ex), y = Math.min(sy, ey);
        const w = Math.abs(ex - sx), h = Math.abs(ey - sy);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        ctx.restore();
    }

    // 範囲選択の実行
    function performSelection(sx, sy, ex, ey) {
        const isWindow = ex >= sx;
        const minSx = Math.min(sx, ex), maxSx = Math.max(sx, ex);
        const minSy = Math.min(sy, ey), maxSy = Math.max(sy, ey);
        const selected = [];
        const isVisible = (e) => (e.layer === undefined || !layers[e.layer] || layers[e.layer].visible) && !e.hidden;

        entities.forEach((e, i) => {
            if(!isVisible(e)) return;
            const bbox = getEntityScreenBBox(e);
            if(!bbox) return;
            if(isWindow) {
                // 窓選択: エンティティが完全に矩形内に収まる
                if(bbox.minX >= minSx && bbox.maxX <= maxSx && bbox.minY >= minSy && bbox.maxY <= maxSy) {
                    selected.push(i);
                }
            } else {
                // 交差選択: エンティティが矩形と重なる
                if(bbox.maxX >= minSx && bbox.minX <= maxSx && bbox.maxY >= minSy && bbox.minY <= maxSy) {
                    selected.push(i);
                }
            }
        });

        if(selected.length > 0) {
            // 編集コマンド中の範囲選択処理
            if(cmdState.mode === 'WAITING_ERASE_SELECT') {
                // 一括削除
                saveUndo();
                const toRemove = selected.sort((a,b) => b-a);
                toRemove.forEach(i => entities.splice(i, 1));
                addCommandLog(`-> ${selected.length}個のオブジェクトを削除 (${isWindow ? '窓選択' : '交差選択'})`);
                cmdState.highlightIdx = -1;
            } else if(cmdState.mode === 'WAITING_MOVE_SELECT' || cmdState.mode === 'WAITING_COPY_SELECT') {
                cmdState.selectedIndices = selected;
                cmdState.moveTarget = undefined; // 複数選択を優先させる
                cmdState.highlightIdx = selected[0];
                addCommandLog(`-> ${selected.length}個のオブジェクトを選択 (${isWindow ? '窓選択' : '交差選択'})。基点を指定`);
                cmdState.mode = (cmdState.mode === 'WAITING_MOVE_SELECT') ? 'WAITING_MOVE_BASE' : 'WAITING_COPY_BASE';
                setPrompt('基点:');
            } else if(cmdState.mode === 'WAITING_ROTATE_SELECT') {
                cmdState.highlightIdx = selected[0];
                cmdState.mode = 'WAITING_ROTATE_BASE'; setPrompt('回転: 中心となる基点を指定');
                addCommandLog(`-> 対象選択。基点を指定`);
            } else {
                // IDLEモード: 範囲選択で複数ハイライト
                cmdState.selectedIndices = selected;
                cmdState.highlightIdx = selected[0];
                addCommandLog(`-> ${selected.length}個のオブジェクトを選択 (${isWindow ? '窓選択' : '交差選択'})`);
            }
            updatePropertiesPanel();
        } else {
            cmdState.selectedIndices = [];
            cmdState.highlightIdx = -1;
        }
        render();
    }

    // エンティティのスクリーン座標バウンディングボックスを取得
    function getEntityScreenBBox(e) {
        let pts = [];
        if(e.type === 'LINE') { pts = [wcsToScreen(e.x1, e.y1), wcsToScreen(e.x2, e.y2)]; }
        else if(e.type === 'CIRCLE') { const c = wcsToScreen(e.cx, e.cy); const r = e.radius * view.scale; return {minX:c.x-r, minY:c.y-r, maxX:c.x+r, maxY:c.y+r}; }
        else if(e.type === 'ARC') { const c = wcsToScreen(e.cx, e.cy); const r = e.radius * view.scale; return {minX:c.x-r, minY:c.y-r, maxX:c.x+r, maxY:c.y+r}; }
        else if(e.type === 'RECTANG') { pts = [wcsToScreen(e.x1, e.y1), wcsToScreen(e.x2, e.y1), wcsToScreen(e.x2, e.y2), wcsToScreen(e.x1, e.y2)]; }
        else if(e.type === 'PLINE' && e.points.length > 0) { pts = e.points.map(p => wcsToScreen(p.x, p.y)); }
        else if(e.type === 'ELLIPSE') { const c = wcsToScreen(e.cx, e.cy); const rx = e.rx * view.scale, ry = e.ry * view.scale; return {minX:c.x-rx, minY:c.y-ry, maxX:c.x+rx, maxY:c.y+ry}; }
        else if(e.type === 'TEXT') { const p = wcsToScreen(e.x, e.y); return {minX:p.x, minY:p.y-20, maxX:p.x+100, maxY:p.y}; }
        else if(e.type === 'POINT') { const p = wcsToScreen(e.x, e.y); return {minX:p.x-5, minY:p.y-5, maxX:p.x+5, maxY:p.y+5}; }
        else return null;

        if(pts.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pts.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
        return {minX, minY, maxX, maxY};
    }

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        lastTouchTime = Date.now();
        if(e.touches.length === 1) {
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            const tx = touch.clientX - rect.left, ty = touch.clientY - rect.top;

            touchState.startX = tx; touchState.startY = ty;
            touchState.isDragging = false; touchState.hasMoved = false;
            touchState.isPinch = false; touchState.isSelecting = false;
            touchState.showLoupe = false;

            // 座標更新
            mouse.screenX = tx; mouse.screenY = ty;
            const wcs = screenToWcs(tx, ty);
            mouse.wcsX = wcs.x; mouse.wcsY = wcs.y;
            const uc = wcsToUcs(wcs.x, wcs.y);
            mouse.ucsX = uc.x; mouse.ucsY = uc.y;

            // スナップ
            const isSelectMode2 = ['WAITING_ERASE_SELECT','WAITING_MOVE_SELECT','WAITING_COPY_SELECT','WAITING_OFFSET_SELECT','WAITING_OFFSET_SIDE'].includes(cmdState.mode);
            if(!isSelectMode2) {
                snapResult = findSnap(tx, ty, mouse.wcsX, mouse.wcsY);
            } else { snapResult = null; }

            // ハイライト更新
            if(cmdState.mode==='WAITING_ERASE_SELECT'||cmdState.mode==='WAITING_MOVE_SELECT'||cmdState.mode==='WAITING_COPY_SELECT'||cmdState.mode==='WAITING_OFFSET_SELECT') {
                cmdState.highlightIdx = hitTestEntity(tx, ty);
            }

            // 長押しタイマーの設定 (0.6秒)
            touchState.pressTimer = setTimeout(() => {
                if(!touchState.hasMoved && !touchState.isPinch) {
                    const idx = hitTestEntity(touchState.startX, touchState.startY);
                    if(idx >= 0) {
                        const hitEnt = entities[idx];
                        if(hitEnt.type === 'DIMENSION') {
                            saveUndo();
                            entities.splice(idx, 1);
                            addCommandLog(`-> 長押しにより寸法 (${hitEnt.subType || '不明'}) を削除しました`);
                            cmdState.highlightIdx = -1;
                            if(window.hideFsCoordTooltip) window.hideFsCoordTooltip();
                            render();
                            if(navigator.vibrate) navigator.vibrate([50, 50, 50]); // 長押し成功時は少し違うパターンの振動
                            touchState.hasMoved = true;
                        }
                    }
                }
            }, 600);

            // 全画面座標ツールチップ更新
            if(snapResult && osnapState.main) {
                const su = wcsToUcs(snapResult.wcsX, snapResult.wcsY);
                if(window.updateFsCoordTooltip) window.updateFsCoordTooltip(touch.clientX, touch.clientY, su.x, su.y, snapResult.type);
            } else {
                if(window.updateFsCoordTooltip) window.updateFsCoordTooltip(touch.clientX, touch.clientY, mouse.ucsX, mouse.ucsY, null);
            }
            render();
        } else if(e.touches.length === 2) {
            touchState.isPinch = true; touchState.showLoupe = false; touchState.isSelecting = false;
            const t1 = e.touches[0], t2 = e.touches[1];
            touchState.lastDist = Math.hypot(t2.clientX-t1.clientX, t2.clientY-t1.clientY);
            touchState.lastMid = { x: (t1.clientX+t2.clientX)/2, y: (t1.clientY+t2.clientY)/2 };
        }
    }, {passive:false});

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if(e.touches.length === 1 && !touchState.isPinch) {
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            const tx = touch.clientX - rect.left, ty = touch.clientY - rect.top;
            const dx = tx - touchState.startX, dy = ty - touchState.startY;
            const moved = Math.hypot(dx, dy);

            // ドラッグ判定
            if(!touchState.hasMoved && moved > DRAG_THRESHOLD) {
                touchState.hasMoved = true;
                touchState.isDragging = true;
                // 全画面モード中は範囲選択しない（座標読取専用）
                const isFullscreen = document.body.classList.contains('fullscreen-mode');
                if(!isFullscreen) {
                    // IDLEモードまたは編集コマンドのオブジェクト選択待ちの場合は範囲選択開始
                    const selectModes = ['IDLE', 'WAITING_ERASE_SELECT', 'WAITING_MOVE_SELECT', 'WAITING_COPY_SELECT', 'WAITING_ROTATE_SELECT'];
                    if(selectModes.includes(cmdState.mode) && window.areaSelectEnabled) {
                        touchState.isSelecting = true;
                        touchState.selStartX = touchState.startX;
                        touchState.selStartY = touchState.startY;
                    }
                }
            }

            // 座標更新
            mouse.screenX = tx; mouse.screenY = ty;
            const wcs = screenToWcs(tx, ty);
            mouse.wcsX = wcs.x; mouse.wcsY = wcs.y;
            const uc = wcsToUcs(wcs.x, wcs.y);
            mouse.ucsX = uc.x; mouse.ucsY = uc.y;

            if(touchState.isDragging) {
                // ルーペ表示
                touchState.showLoupe = true;
                touchState.loupeX = tx; touchState.loupeY = ty;

                // 全画面モード中は常にスナップ検索（座標読取でオブジェクトを探す用）
                const isFullscreen = document.body.classList.contains('fullscreen-mode');
                if(isFullscreen) {
                    snapResult = findSnap(tx, ty, mouse.wcsX, mouse.wcsY);
                } else if(cmdState.mode !== 'IDLE' && !touchState.isSelecting) {
                    // 通常モード: コマンドモード中のみスナップ
                    if(cmdState.mode!=='WAITING_ERASE_SELECT'&&cmdState.mode!=='WAITING_MOVE_SELECT'&&cmdState.mode!=='WAITING_COPY_SELECT'&&cmdState.mode!=='WAITING_OFFSET_SELECT'&&cmdState.mode!=='WAITING_OFFSET_SIDE') {
                        snapResult = findSnap(tx, ty, mouse.wcsX, mouse.wcsY);
                    }
                }
            }

            // 座標表示更新
            if(snapResult && osnapState.main) {
                const su = wcsToUcs(snapResult.wcsX, snapResult.wcsY);
                coordsDisplay.textContent = `X:${su.y.toFixed(0)}  Y:${su.x.toFixed(0)}`;
                if(window.updateFsCoordTooltip) window.updateFsCoordTooltip(touch.clientX, touch.clientY, su.x, su.y, snapResult.type);
            } else {
                coordsDisplay.textContent = `X:${mouse.ucsY.toFixed(0)}  Y:${mouse.ucsX.toFixed(0)}`;
                if(window.updateFsCoordTooltip) window.updateFsCoordTooltip(touch.clientX, touch.clientY, mouse.ucsX, mouse.ucsY, null);
            }

            renderImmediate();
            // ルーペと範囲選択は render() 後に上書き描画
            drawLoupe();
            drawSelectionRect();

        } else if(e.touches.length === 2) {
            touchState.showLoupe = false;
            const t1 = e.touches[0], t2 = e.touches[1];
            const newDist = Math.hypot(t2.clientX-t1.clientX, t2.clientY-t1.clientY);
            const newMid = { x: (t1.clientX+t2.clientX)/2, y: (t1.clientY+t2.clientY)/2 };
            if(touchState.lastDist > 0 && touchState.lastMid) {
                const rect = canvas.getBoundingClientRect();
                // 変更前の中点のWCS座標を取得
                const omx = touchState.lastMid.x - rect.left;
                const omy = touchState.lastMid.y - rect.top;
                const wb = screenToWcs(omx, omy);
                // スケール更新
                const zf = newDist / touchState.lastDist;
                view.scale = Math.max(0.0001, Math.min(view.scale * zf, 10000));
                // 新しい中点に同じWCS座標が来るようにviewを再配置
                const nmx = newMid.x - rect.left;
                const nmy = newMid.y - rect.top;
                _reanchorView(nmx, nmy, wb);
            }
            touchState.lastDist = newDist;
            touchState.lastMid = newMid;
            render();
        }
    }, {passive:false});

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        lastTouchTime = Date.now();
        
        if(touchState.pressTimer) { clearTimeout(touchState.pressTimer); touchState.pressTimer = null; }

        if(e.touches.length === 0 && !touchState.isPinch) {
            touchState.showLoupe = false;
            // 全画面座標ツールチップ: 寸法モード中は消さない（スナップ位置を確認できるように）
            const isDimModeActive = cmdState.mode.startsWith('WAITING_DIM');
            if(!isDimModeActive) {
                if(window.hideFsCoordTooltip) window.hideFsCoordTooltip();
            }

            if(touchState.isSelecting) {
                // 範囲選択完了
                performSelection(touchState.selStartX, touchState.selStartY, mouse.screenX, mouse.screenY);
                touchState.isSelecting = false;
            } else if(cmdState.mode !== 'IDLE') {
                // コマンドモード中: 指を離した位置でポイント確定
                const isDimMode = cmdState.mode.startsWith('WAITING_DIM');
                
                if(isDimMode) {
                    // 寸法コマンド: 全画面・通常画面問わず自動確定しない。アクションバーの「確定」を待つ
                    // ルーペは消すが、スナップ位置は保持・表示する
                    render();
                    drawSnapMarker();
                } else {
                    // 通常コマンド: 指を離した位置で即時に確定
                    const pt = getInputPoint();
                    handlePointInput(pt, false);
                }
            } else if(!touchState.hasMoved) {
                // 短いタップでIDLEモード: エンティティ選択/選択解除
                const idx = hitTestEntity(mouse.screenX, mouse.screenY);
                if(idx >= 0) {
                    cmdState.highlightIdx = (cmdState.highlightIdx === idx) ? -1 : idx;
                } else {
                    cmdState.highlightIdx = -1;
                }
                updatePropertiesPanel();
            }

            touchState.isDragging = false;
            touchState.hasMoved = false;
            render();
        }

        if(e.touches.length < 2) {
            touchState.isPinch = false;
            touchState.lastDist = 0;
            touchState.lastMid = null;
        }
    }, {passive:false});

    commandInput.addEventListener('keydown',(e)=>{
        if(e.key==='Enter'){const v=commandInput.value.trim(); if(v){addCommandLog(v);processCommand(v);commandInput.value='';} else{if(cmdState.mode==='WAITING_LINE_P2'){resetCommand();addCommandLog('-> LINE終了');}else if(cmdState.mode==='WAITING_PLINE_NEXT'){finishPline(false);}}}
        if(e.key==='Escape'){if(cmdState.mode!=='IDLE'){addCommandLog('* キャンセル *');resetCommand();}}
    });
    window.addEventListener('keydown',(e)=>{
        if(e.ctrlKey&&e.key==='z'){e.preventDefault();undo();}
        if(e.ctrlKey&&e.key==='y'){e.preventDefault();redo();}
    });
}

// 非表示フラグ付き図形（インポートされた円弧など）の一括再表示
window.showHiddenEntities = function() {
    const hiddenCount = entities.filter(e => e.hidden).length;
    if(hiddenCount === 0) { addCommandLog('-> 非表示の図形はありません'); return; }
    saveUndo();
    entities.forEach(e => { if(e.hidden) e.hidden = false; });
    addCommandLog(`-> 非表示だった図形 ${hiddenCount}個 を再表示しました（元に戻すにはUndo）`);
    if (typeof window.updateLayerManagerContent === 'function') window.updateLayerManagerContent();
    render();
};

// 非表示画層のうっすら表示切り替え
window.toggleGhostLayerMode = function(enabled) {
    window.ghostLayerMode = !!enabled;
    render();
    addCommandLog(`-> 非表示画層のうっすら表示を ${window.ghostLayerMode ? '有効' : '無効'} にしました`);
};

// 全画層の表示・非表示一括設定
window.setAllLayersVisibility = function(visible) {
    saveUndo();
    layers.forEach((l) => {
        l.visible = !!visible;
    });
    // 非表示にした場合、選択中オブジェクトが非表示画層にあれば選択解除
    if (!visible) {
        cmdState.highlightIdx = -1;
        cmdState.selectedIndices = [];
        updatePropertiesPanel();
    }
    if (typeof window.updateLayerManagerContent === 'function') {
        window.updateLayerManagerContent();
    }
    updateLayerPanel();
    render();
    addCommandLog(`-> すべての画層を${visible ? '表示' : '非表示'}にしました`);
};

// 全画層の表示状態反転
window.invertLayersVisibility = function() {
    saveUndo();
    layers.forEach((l) => {
        l.visible = (l.visible === false) ? true : false;
    });
    // 非表示になった画層にある選択中オブジェクトをクリア
    layers.forEach((l, i) => {
        if (l.visible === false) {
            if (cmdState.highlightIdx >= 0 && entities[cmdState.highlightIdx] && entities[cmdState.highlightIdx].layer == i) {
                cmdState.highlightIdx = -1;
            }
            if (cmdState.selectedIndices) {
                cmdState.selectedIndices = cmdState.selectedIndices.filter(idx => entities[idx] && entities[idx].layer !== i);
            }
        }
    });
    updatePropertiesPanel();
    if (typeof window.updateLayerManagerContent === 'function') {
        window.updateLayerManagerContent();
    }
    updateLayerPanel();
    render();
    addCommandLog('-> 画層の表示状態を反転しました');
};

// 画層管理フローティングパネルの表示
window.showLayerManagerPanel = function() {
    showPropertyPanel('画層一括管理', '<div id="layer-manager-container"></div>');
    window.updateLayerManagerContent();
};

// 画層管理フローティングパネルのコンテンツ更新
window.updateLayerManagerContent = function() {
    const container = document.getElementById('layer-manager-container');
    if (!container) return;

    // 表示中・非表示中の画層を分類
    const visibleLayers = [];
    const hiddenLayers = [];
    layers.forEach((l, i) => {
        const item = { ...l, index: i };
        if (l.visible !== false) {
            visibleLayers.push(item);
        } else {
            hiddenLayers.push(item);
        }
    });

    // タッチ非表示モードのアクティブ状態チェック
    const isLayoffActive = cmdState.mode === 'WAITING_LAYOFF_TOUCH';
    const layoffBtnStyle = isLayoffActive 
        ? 'background:#00ff88; color:#1e2228; border:1px solid #00ff88; font-weight:bold; padding:6px 12px; border-radius:14px; cursor:pointer; flex:1;'
        : 'background:rgba(40,44,52,0.9); color:#ffcc00; border:1px solid #ffcc00; font-weight:bold; padding:6px 12px; border-radius:14px; cursor:pointer; flex:1;';

    let html = '';

    // 1. グローバル設定・操作エリア
    html += `
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.1);">
        <div style="display:flex; align-items:center; gap:8px; padding:4px 8px; background:rgba(255,255,255,0.05); border-radius:6px;">
            <input type="checkbox" id="ghost-layer-toggle" ${window.ghostLayerMode ? 'checked' : ''} onchange="toggleGhostLayerMode(this.checked)" style="cursor:pointer; width:16px; height:16px;">
            <label for="ghost-layer-toggle" style="cursor:pointer; font-weight:bold; color:#ddd; font-size:12px; user-select:none;">非表示画層をうっすら表示する</label>
        </div>
        <div style="display:flex; gap:8px;">
            <button class="prop-btn" style="${layoffBtnStyle}" onclick="issueCommand('LAYOFF')" title="キャンバス上の図形をタッチして、その画層を即座に非表示にします（連続操作可能）">
                ${isLayoffActive ? '👆 タッチ非表示中' : '👆 タッチで非表示'}
            </button>
            <button class="prop-btn" style="background:rgba(40,44,52,0.9); color:#00ff88; border:1px solid #00ff88; font-weight:bold; padding:6px 12px; border-radius:14px; cursor:pointer; flex:1;" onclick="invertLayersVisibility()" title="すべての画層の表示・非表示を反転します">
                🔄 表示反転
            </button>
        </div>
        ${(() => {
            const hiddenEntCount = entities.filter(en => en.hidden).length;
            if(hiddenEntCount === 0) return '';
            return `<button class="prop-btn" style="background:rgba(40,44,52,0.9); color:#61afef; border:1px solid #61afef; font-weight:bold; padding:6px 12px; border-radius:14px; cursor:pointer;" onclick="showHiddenEntities()" title="インポート時に非表示化された円弧などを再表示します">⭕ 隠れ図形を再表示 (${hiddenEntCount}個)</button>`;
        })()}
        ${isLayoffActive ? '<div style="color:#ffcc00; font-size:10px; text-align:center; margin-top:2px; font-weight:bold;">図面上の図形をタップして画層を消せます (Escで終了)</div>' : ''}
    </div>
    `;

    // 2. スクロール可能な画層リストエリア（MAX高さを持たせてスクロール）
    html += `<div style="max-height: 250px; overflow-y: auto; display:flex; flex-direction:column; gap:8px; padding-right:4px;">`;

    // A. 表示中の画層セクション
    html += `
    <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:3px;">
            <span style="font-weight:bold; color:#00ff88; font-size:12px;">👁️ 表示中 (${visibleLayers.length})</span>
            <button class="status-btn" style="font-size:10px; padding:1px 5px; border-radius:3px; background:rgba(255,107,107,0.15); border:1px solid rgba(255,107,107,0.3); color:#ff6b6b; cursor:pointer;" onclick="setAllLayersVisibility(false)">すべて非表示</button>
        </div>
    `;
    if (visibleLayers.length === 0) {
        html += `<div style="color:#666; font-size:11px; font-style:italic; padding:6px 8px;">表示中の画層はありません</div>`;
    } else {
        visibleLayers.forEach(l => {
            const isCurrent = l.index === currentLayerIndex;
            const currentMark = isCurrent ? '<span style="color:#00ff88; font-weight:bold; margin-right:4px;" title="現在の作図画層">📌</span>' : '';
            const textStyle = isCurrent ? 'font-weight:bold; color:#00ff88;' : 'color:#ddd;';
            html += `
            <div class="prop-row" style="margin-bottom:6px; display:flex; align-items:center; background:rgba(255,255,255,0.02); padding:4px 6px; border-radius:4px;">
                <button class="status-btn" style="padding:2px 5px; margin-right:6px; font-size:12px; width:28px; text-align:center; background:rgba(0,255,136,0.1); border:1px solid rgba(0,255,136,0.3); color:#00ff88; border-radius:3px; cursor:pointer;" onclick="toggleLayerVisibility(${l.index})" title="非表示にする">👁️</button>
                <div style="width:12px;height:12px;background-color:${l.color};border:1px solid rgba(255,255,255,0.2);border-radius:2px;margin-right:8px;box-shadow:0 0 3px rgba(0,0,0,0.5);"></div>
                <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; font-size:12px; ${textStyle}" onclick="changeCurrentLayer('${l.index}')" title="クリックで作図画層に設定: ${l.name}">
                    ${currentMark}${l.name}
                </div>
            </div>`;
        });
    }
    html += `</div>`;

    // B. 非表示の画層セクション
    html += `
    <div style="margin-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:3px;">
            <span style="font-weight:bold; color:#aaa; font-size:12px;">➖ 非表示中 (${hiddenLayers.length})</span>
            <button class="status-btn" style="font-size:10px; padding:1px 5px; border-radius:3px; background:rgba(97,175,239,0.15); border:1px solid rgba(97,175,239,0.3); color:#61afef; cursor:pointer;" onclick="setAllLayersVisibility(true)">すべて表示</button>
        </div>
    `;
    if (hiddenLayers.length === 0) {
        html += `<div style="color:#666; font-size:11px; font-style:italic; padding:6px 8px;">非表示の画層はありません</div>`;
    } else {
        hiddenLayers.forEach(l => {
            const isCurrent = l.index === currentLayerIndex;
            const currentMark = isCurrent ? '<span style="color:#ffcc00; font-weight:bold; margin-right:4px;" title="現在の作図画層">📌</span>' : '';
            const textStyle = isCurrent ? 'font-weight:bold; color:#ffcc00;' : 'color:#888;';
            html += `
            <div class="prop-row" style="margin-bottom:6px; display:flex; align-items:center; background:rgba(255,255,255,0.01); padding:4px 6px; border-radius:4px;">
                <button class="status-btn" style="padding:2px 5px; margin-right:6px; font-size:12px; width:28px; text-align:center; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:#888; border-radius:3px; cursor:pointer;" onclick="toggleLayerVisibility(${l.index})" title="表示する">➖</button>
                <div style="width:12px;height:12px;background-color:${l.color};border:1px solid rgba(255,255,255,0.1);border-radius:2px;margin-right:8px;opacity:0.5;"></div>
                <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; font-size:12px; ${textStyle}" onclick="changeCurrentLayer('${l.index}')" title="クリックで作図画層に設定: ${l.name}">
                    ${currentMark}${l.name}
                </div>
            </div>`;
        });
    }
    html += `</div>`;

    html += `</div>`; // スクロール領域の閉じタグ

    container.innerHTML = html;
};

// 画層パネルの追加関数
window.toggleLayerPanel = function() {
    // 従来のサイドパネルを開く代わりに、フローティング形式の画層管理パネルをトグル表示
    const panel = document.getElementById('property-panel');
    if (panel && panel.style.display === 'flex' && document.getElementById('property-panel-title').textContent === '画層一括管理') {
        hidePropertyPanel();
    } else {
        window.showLayerManagerPanel();
    }
};
window.updateLayerPanel = function() {
    // フローティングパネルの表示内容を更新
    if (typeof window.updateLayerManagerContent === 'function') {
        window.updateLayerManagerContent();
    }

    const list = document.getElementById('layer-list');
    if(!list) return;
    let html = '';
    layers.forEach((l, i) => {
        const eyeIcon = l.visible !== false ? '👁️' : '➖';
        html += `<div class="prop-row" style="margin-bottom:8px; display:flex; align-items:center;">
            <button class="status-btn" style="padding:2px 5px; margin-right:5px; font-size:14px; width:30px; text-align:center;" onclick="toggleLayerVisibility(${i})" title="表示/非表示切替">${eyeIcon}</button>
            <div style="width:12px;height:12px;background-color:${l.color};border:1px solid #777;border-radius:2px;margin-right:5px;"></div>
            <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${l.name}">${l.name}</div>
        </div>`;
    });
    list.innerHTML = html;
};
window.toggleLayerVisibility = function(idx) {
    if(layers[idx]) {
        layers[idx].visible = (layers[idx].visible === false) ? true : false;
        if(layers[idx].visible === false && cmdState.highlightIdx >= 0) {
            if(entities[cmdState.highlightIdx] && entities[cmdState.highlightIdx].layer == idx) {
                cmdState.highlightIdx = -1;
                updatePropertiesPanel();
            }
        }
        updateLayerPanel();
        render();
    }
};
window.hideLayerOfSelected = function() {
    if(cmdState.highlightIdx < 0 || !entities[cmdState.highlightIdx]) return;
    const layerIdx = entities[cmdState.highlightIdx].layer;
    if(layerIdx === undefined || !layers[layerIdx]) return;
    layers[layerIdx].visible = false;
    cmdState.highlightIdx = -1;
    // 選択解除されたインデックスも含め、同じ画層の選択をすべてクリア
    if(cmdState.selectedIndices) {
        cmdState.selectedIndices = cmdState.selectedIndices.filter(i => entities[i] && entities[i].layer !== layerIdx);
    }
    updateLayerPanel();
    updatePropertiesPanel();
    render();
    addCommandLog(`-> 画層「${layers[layerIdx].name}」を非表示にしました`);
};

// プロパティパネルの更新
window.togglePropertiesPanel = function() {
    const p = document.getElementById('properties-panel');
    if(p) p.classList.toggle('collapsed');
};

function updatePropertiesPanel() {
    const p = document.getElementById('props-content');
    if(!p) return;
    if(cmdState.mode === 'IDLE' && cmdState.highlightIdx >= 0 && entities[cmdState.highlightIdx]) {
        const e = entities[cmdState.highlightIdx];
        const layerColor = layers[e.layer] ? layers[e.layer].color : '#ffffff';
        let html = `<div style="font-weight:bold;margin-bottom:10px;color:var(--highlight-color);">${e.type}</div>`;
        html += `<div class="prop-row"><div class="prop-label">画層</div>
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                <input class="prop-val" style="width:60px;" type="text" value="${layers[e.layer]?layers[e.layer].name:e.layer}" readonly title="画層名">
                <input class="prop-val" type="color" value="${layerColor}" onchange="changeLayerColorGlobal('${e.layer}', this.value)" title="この画層の色を変更">
                <button class="status-btn" style="font-size:10px;padding:2px 6px;border:1px solid #666;border-radius:3px;" onclick="hideLayerOfSelected()" title="この画層のオブジェクトをすべて非表示">🚫画層非表示</button>
            </div>
        </div>`;
        html += `<div class="prop-row"><div class="prop-label">色</div><div style="display:flex;align-items:center;gap:5px;">
            <input class="prop-val" type="color" value="${getEntityColor(e)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'color', this.value)">
            ${e.color ? `<button class="prop-btn" style="font-size:10px;padding:2px 4px;" onclick="changeEntityProp(${cmdState.highlightIdx}, 'color', null)">ByLayer</button>` : `<span style="font-size:10px;color:#888;">ByLayer</span>`}
        </div></div>`;
        html += `<div class="prop-row"><div class="prop-label">表示</div><input class="prop-val" type="checkbox" ${e.hidden?'':'checked'} onchange="changeEntityProp(${cmdState.highlightIdx}, 'hidden', !this.checked)"></div>`;
        if(e.type === 'POINT' || e.size !== undefined) {
            html += `<div class="prop-row"><div class="prop-label">サイズ</div><input class="prop-val" type="number" step="0.1" value="${e.size||10}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'size', this.value)"></div>`;
        }
        
        const escapeHtml = (unsafe) => {
            if(typeof unsafe !== 'string') return unsafe;
            return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        };
        
        if(e.type === 'LINE') {
            const p1 = wcsToUcs(e.x1, e.y1); const p2 = wcsToUcs(e.x2, e.y2);
            html += `<div class="prop-row"><div class="prop-label">始点 X</div><input class="prop-val" type="number" step="1" value="${p1.y.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'y1', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">始点 Y</div><input class="prop-val" type="number" step="1" value="${p1.x.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'x1', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">終点 X</div><input class="prop-val" type="number" step="1" value="${p2.y.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'y2', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">終点 Y</div><input class="prop-val" type="number" step="1" value="${p2.x.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'x2', this.value)"></div>`;
        } else if(e.type === 'CIRCLE' || e.type === 'ARC') {
            const c = wcsToUcs(e.cx, e.cy);
            html += `<div class="prop-row"><div class="prop-label">中心 X</div><input class="prop-val" type="number" step="1" value="${c.y.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'cy', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">中心 Y</div><input class="prop-val" type="number" step="1" value="${c.x.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'cx', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">半径</div><input class="prop-val" type="number" step="1" value="${e.radius.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'radius', this.value)"></div>`;
        } else if(e.type === 'RECTANG') {
            const p1 = wcsToUcs(e.x1, e.y1); const p2 = wcsToUcs(e.x2, e.y2);
            html += `<div class="prop-row"><div class="prop-label">角1 X</div><input class="prop-val" type="number" step="1" value="${p1.y.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'y1', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">角1 Y</div><input class="prop-val" type="number" step="1" value="${p1.x.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'x1', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">角2 X</div><input class="prop-val" type="number" step="1" value="${p2.y.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'y2', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">角2 Y</div><input class="prop-val" type="number" step="1" value="${p2.x.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'x2', this.value)"></div>`;
        } else if(e.type === 'ELLIPSE') {
            const c = wcsToUcs(e.cx, e.cy);
            html += `<div class="prop-row"><div class="prop-label">中心 X</div><input class="prop-val" type="number" step="1" value="${c.y.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'cy', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">中心 Y</div><input class="prop-val" type="number" step="1" value="${c.x.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'cx', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">X半径</div><input class="prop-val" type="number" step="1" value="${e.rx.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'rx', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">Y半径</div><input class="prop-val" type="number" step="1" value="${e.ry.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'ry', this.value)"></div>`;
        } else if(e.type === 'TEXT') {
            const p = wcsToUcs(e.x, e.y);
            html += `<div class="prop-row"><div class="prop-label">始点 X</div><input class="prop-val" type="number" step="1" value="${p.y.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'y', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">始点 Y</div><input class="prop-val" type="number" step="1" value="${p.x.toFixed(1)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'x', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">テキスト</div><input class="prop-val" type="text" value="${escapeHtml(e.text)}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'text', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">高さ</div><input class="prop-val" type="number" step="1" value="${e.height}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'height', this.value)"></div>`;
        } else if(e.type === 'HATCH') {
            html += `<div class="prop-row"><div class="prop-label">対象図形</div><input class="prop-val" type="text" value="${e.target.type}" readonly></div>`;
            html += `<div class="prop-row"><div class="prop-label">透過度</div><input class="prop-val" type="number" step="0.1" min="0" max="1" value="${e.alpha!==undefined?e.alpha:0.5}" onchange="changeEntityProp(${cmdState.highlightIdx}, 'alpha', this.value)"></div>`;
        } else if(e.type === 'DIMENSION') {
            html += `<div class="prop-row"><div class="prop-label">種類</div><input class="prop-val" type="text" value="${e.subType}" readonly></div>`;
            html += `<div class="prop-row"><div class="prop-label">文字上書き</div><input class="prop-val" type="text" value="${escapeHtml(e.textOverride||'')}" placeholder="自動" onchange="changeEntityProp(${cmdState.highlightIdx}, 'textOverride', this.value)"></div>`;
        }
        p.innerHTML = html;
    } else {
        p.innerHTML = '<div style="color:#888; text-align:center; padding:20px 0;">図形が選択されていません</div>';
    }
}

window.changeEntityProp = function(idx, prop, val) {
    if(!entities[idx]) return;
    saveUndo();
    if(prop==='color') {
        entities[idx].color = (val === '' || val === 'null' || val === null) ? null : val;
    }
    else if(prop==='text') entities[idx].text = val;
    else if(prop==='textOverride') entities[idx].textOverride = val===''?null:val;
    else if(prop==='hidden') entities[idx].hidden = (val === 'true' || val === true);
    else {
        const num = parseFloat(val);
        // UCSで入力された座標をWCSに変換して格納する
        // 回転UCSでは1成分の変更が両WCS成分に影響するため、ペア座標と合わせて変換する
        const pairMap = { x:['x','y'], y:['x','y'], x1:['x1','y1'], y1:['x1','y1'], x2:['x2','y2'], y2:['x2','y2'], cx:['cx','cy'], cy:['cx','cy'] };
        const pair = pairMap[prop];
        if(pair) {
            const [xk, yk] = pair;
            const e2 = entities[idx];
            const u = wcsToUcs(e2[xk], e2[yk]);
            if(prop === xk) u.x = num; else u.y = num;
            const w = ucsToWcs(u.x, u.y);
            e2[xk] = w.x; e2[yk] = w.y;
        } else {
            entities[idx][prop] = num;
        }
    }
    delete entities[idx].bbox; // 座標・寸法が変わった可能性があるのでbboxを再計算させる
    render();
};

init();

// 交差・範囲選択モードの切り替え
window.toggleAreaSelect = function() {
    window.areaSelectEnabled = !window.areaSelectEnabled;
    const btn = document.getElementById('btn-area-select');
    if(btn) {
        btn.className = window.areaSelectEnabled ? 'status-btn active' : 'status-btn';
        btn.textContent = window.areaSelectEnabled ? '範囲選択: ON' : '範囲選択: OFF';
    }
    const fsBtn = document.getElementById('fs-btn-area-select');
    if(fsBtn) {
        fsBtn.className = window.areaSelectEnabled ? 'fs-active' : '';
    }
    addCommandLog(`-> 交差選択（範囲選択）: ${window.areaSelectEnabled ? 'ON' : 'OFF'}`);
};

// UI連携関数(グローバル)
window.toggleOrtho = function() {
    orthoMode = !orthoMode;
    const btn = document.getElementById('btn-ortho');
    if(btn) btn.className = orthoMode ? 'status-btn active' : 'status-btn';
    addCommandLog(`-> 直交モード: ${orthoMode?'ON':'OFF'}`);
    render();
};
window.toggleOsnapMain = function() {
    osnapState.main = !osnapState.main;
    const btn = document.getElementById('btn-osnap');
    if(btn) btn.className = osnapState.main ? 'status-btn active' : 'status-btn';
    addCommandLog(`-> OSNAP: ${osnapState.main?'ON':'OFF'}`);
    render();
};
window.toggleOsnapPanel = function(e) {
    const p = document.getElementById('osnap-panel');
    if(!p) return;
    if(p.style.display === 'block') {
        p.style.display = 'none';
    } else {
        p.style.display = 'block';
        if(e && e.target) {
            const rect = e.target.getBoundingClientRect();
            p.style.top = (rect.bottom + 5) + 'px';
            let leftPos = rect.left - 60; // ボタンより少し左側を基準
            if(leftPos < 5) leftPos = 5;  // 画面左端にはみ出さないよう調整
            p.style.left = leftPos + 'px';
        } else {
            p.style.top = '60px';
            p.style.left = '10px';
        }
    }
};
// パネルのチェックボックスイベント
['end','mid','cen','int','near','perp'].forEach(type => {
    const cb = document.getElementById('osnap-'+type);
    if(cb) cb.addEventListener('change', (e) => { osnapState[type] = e.target.checked; render(); });
});
// F3, F8 キーバインド
document.addEventListener('keydown', (e) => {
    if(e.key==='F3') { e.preventDefault(); toggleOsnapMain(); }
    if(e.key==='F8') { e.preventDefault(); toggleOrtho(); }
});

// ===== 全画面UI コールバック用関数（アクションバー） =====
window.dimConfirmPoint = function() {
    if(cmdState.mode.startsWith('WAITING_DIM')) {
        const pt = getInputPoint(); // スナップがあればスナップ座標、なければWCS座標
        // 寸法が確定した際にも振動フィードバック
        if(navigator.vibrate) navigator.vibrate(20);
        handlePointInput(pt, false);
    } else if(cmdState.mode === 'WAITING_UCS_2P_ORIGIN_PREVIEW') {
        const pt = getInputPoint();
        if(navigator.vibrate) navigator.vibrate(20);
        cmdState.startWcs = {x: pt.x, y: pt.y};
        cmdState.mode = 'WAITING_UCS_2P_XDIR';
        setPrompt('X軸方向の点:');
        const u = wcsToUcs(pt.x, pt.y);
        addCommandLog(`-> 原点: (${dimFormat(u.x)},${dimFormat(u.y)})`);
        const ab = document.getElementById('fs-dim-actionbar');
        if(ab) ab.style.display = 'none';
        render();
    } else if(cmdState.mode === 'WAITING_UCS_2P_XDIR_PREVIEW') {
        const pt = getInputPoint();
        if(navigator.vibrate) navigator.vibrate(20);
        const ox = cmdState.startWcs.x, oy = cmdState.startWcs.y;
        const angle = Math.atan2(pt.y - oy, pt.x - ox);
        setUCS(ox, oy, angle);
        const ab = document.getElementById('fs-dim-actionbar');
        if(ab) ab.style.display = 'none';
    }
};

window.dimToggleMode = function() {
    if(typeof toggleDimContMode === 'function') {
        if(navigator.vibrate) navigator.vibrate(10);
        toggleDimContMode();
    }
};

window.dimToggleDir = function() {
    if(typeof toggleDimContDir === 'function') {
        if(navigator.vibrate) navigator.vibrate(10);
        toggleDimContDir();
    }
};

window.changeLayerColorGlobal = function(layerId, color) {
    if(layers[layerId]) {
        saveUndo();
        layers[layerId].color = color;
        addCommandLog(`-> 画層「${layers[layerId].name}」の色を ${color} に変更しました`);
        render();
        updatePropertiesPanel();
        if(typeof populateLayerPanel === 'function') populateLayerPanel();
    }
};
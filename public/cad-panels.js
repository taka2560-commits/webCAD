// ===== Web CAD パネル・一覧表示 =====
// cad-panels.js - ブロック（グループ）管理、画層の一括管理・表示切替、
//                 プロパティパネル、選択アクションバー、スナップ/直交の切り替え
// （cad-core.js から分割。ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

// ===== ブロック/グループ管理（スマホ向け） =====
// グループ選択のON/OFF
window.setGroupSelectEnabled = function(enabled) {
    window.groupSelectEnabled = !!enabled;
    try { localStorage.setItem('cad_group_select', enabled ? '1' : '0'); } catch(e) {}
    addCommandLog(`-> タップでブロック全体を選択: ${enabled ? 'ON' : 'OFF'}`);
    if(typeof window.updateBlockManagerContent === 'function') window.updateBlockManagerContent();
};

// ブロック名ごとの集計（インスタンス数・部品数・非表示数）
function getBlockSummary() {
    const map = new Map();
    entities.forEach(e => {
        if(!e.gid) return;
        const name = e.blockName || 'グループ';
        let s = map.get(name);
        if(!s) { s = { name, gids: new Set(), count: 0, hidden: 0 }; map.set(name, s); }
        s.gids.add(e.gid); s.count++; if(e.hidden) s.hidden++;
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}
let _blockNameCache = [];

// 指定 index 群にズーム
function zoomToEntities(indices) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    indices.forEach(i => {
        const e = entities[i]; if(!e) return;
        const b = (e.type === 'HATCH' && e.target) ? calcBBox(e.target) : (e.bbox || (e.bbox = calcBBox(e)));
        if(!b) return;
        if(b.minX < minX) minX = b.minX; if(b.minY < minY) minY = b.minY;
        if(b.maxX > maxX) maxX = b.maxX; if(b.maxY > maxY) maxY = b.maxY;
    });
    if(!isFinite(minX)) return;
    const pad = 60, w = maxX - minX || 1, h = maxY - minY || 1;
    view.scale = Math.min((canvas.width - pad * 2) / w, (canvas.height - pad * 2) / h, 50);
    _reanchorView(canvas.width / 2, canvas.height / 2, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    render();
}

window.showBlockManagerPanel = function() {
    showPropertyPanel('ブロック管理', '<div id="block-manager-container"></div>');
    window.updateBlockManagerContent();
};
window.toggleBlockManagerPanel = function() {
    const panel = document.getElementById('property-panel');
    const title = document.getElementById('property-panel-title');
    if(panel && panel.style.display === 'flex' && title && title.textContent === 'ブロック管理') hidePropertyPanel();
    else window.showBlockManagerPanel();
};

window.updateBlockManagerContent = function() {
    const c = document.getElementById('block-manager-container');
    if(!c) return;
    const summary = getBlockSummary();
    _blockNameCache = summary.map(s => s.name);
    const sel = cmdState.selectedIndices || [];
    const selIdx = sel.length ? sel : (cmdState.highlightIdx >= 0 ? [cmdState.highlightIdx] : []);
    const selGids = new Set(); selIdx.forEach(i => { const e = entities[i]; if(e && e.gid) selGids.add(e.gid); });
    const btn = (label, onclick, color, extra) => `<button class="status-btn" style="font-size:11px; padding:2px 8px; height:26px; border-radius:8px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:${color || '#ddd'}; cursor:pointer; ${extra || ''}" onclick="${onclick}">${label}</button>`;

    let html = `
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.1);">
        <label style="display:flex; align-items:center; gap:8px; padding:4px 8px; background:rgba(255,255,255,0.05); border-radius:6px; cursor:pointer; font-size:12px; color:#ddd; font-weight:bold;">
            <input type="checkbox" ${window.groupSelectEnabled ? 'checked' : ''} onchange="setGroupSelectEnabled(this.checked)" style="width:16px; height:16px; cursor:pointer;">
            タップでブロック全体を選択
        </label>`;
    // 選択中のグループに対する操作
    if(selIdx.length > 0) {
        const first = entities[selIdx[0]];
        const isGroup = selGids.size >= 1;
        const label = isGroup ? `🧩 ${escapeHtml(first && first.blockName || 'グループ')}${selGids.size > 1 ? ` 他${selGids.size - 1}` : ''} (${selIdx.length}個)` : `${selIdx.length}個を選択中`;
        html += `<div style="font-size:12px; color:#00ff88; font-weight:bold;">${label}</div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
            ${isGroup ? btn('分解（グループ解除）', 'explodeSelection()', '#ffcc00') : ''}
            ${(!isGroup && selIdx.length > 1) ? btn('🧩 グループ化', 'groupSelection()', '#00ff88') : ''}
            ${btn('🔍 ズーム', 'zoomToSelection()', '#61afef')}
            ${btn('🚫 隠す', 'hideSelectedEntities()', '#ff6b6b')}
            ${btn('✕ 選択解除', 'clearSelection(); render();', '#aaa')}
        </div>`;
    } else {
        html += `<div style="font-size:11px; color:#888;">図形をタップするとブロック（同じ挿入のまとまり）を選択できます。複数選択して「グループ化」もできます。</div>`;
    }
    html += `</div>`;

    // ブロック一覧
    if(summary.length === 0) {
        html += `<div style="color:#666; font-size:11px; font-style:italic; padding:6px 8px;">ブロック・グループはありません（DXF/DWGのブロックは取り込み時に自動でグループになります）</div>`;
    } else {
        html += `<div style="font-size:11px; color:#888; margin-bottom:4px;">ブロック一覧 (${summary.length}種類)</div>`;
        html += `<div style="max-height:260px; overflow-y:auto; display:flex; flex-direction:column; gap:6px; padding-right:4px;">`;
        summary.forEach((s, i) => {
            const allHidden = s.hidden === s.count;
            const eye = allHidden ? '➖' : '👁️';
            const nameStyle = allHidden ? 'color:#888;' : 'color:#ddd;';
            html += `
            <div class="prop-row" style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.02); padding:4px 6px; border-radius:4px; margin:0;">
                <button class="status-btn" style="padding:2px 5px; font-size:12px; width:28px; text-align:center; background:${allHidden ? 'rgba(255,255,255,0.05)' : 'rgba(0,255,136,0.1)'}; border:1px solid ${allHidden ? 'rgba(255,255,255,0.15)' : 'rgba(0,255,136,0.3)'}; color:${allHidden ? '#888' : '#00ff88'}; border-radius:3px; cursor:pointer;" onclick="toggleBlockVisibility(${i})" title="${allHidden ? '表示する' : '非表示にする'}">${eye}</button>
                <div style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; ${nameStyle}" title="${escapeHtml(s.name)}">${escapeHtml(s.name)} <span style="color:#888; font-size:10px;">×${s.gids.size} (${s.count}個)</span></div>
                <button class="status-btn" style="padding:2px 6px; font-size:12px; background:rgba(97,175,239,0.12); border:1px solid rgba(97,175,239,0.3); color:#61afef; border-radius:3px; cursor:pointer;" onclick="zoomToBlock(${i})" title="この種類のブロックへズーム">🔍</button>
                <button class="status-btn" style="padding:2px 6px; font-size:12px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:#ddd; border-radius:3px; cursor:pointer;" onclick="selectBlockByName(${i})" title="この種類のブロックをすべて選択">☑</button>
            </div>`;
        });
        html += `</div>`;
    }
    c.innerHTML = html;
};

window.toggleBlockVisibility = function(i) {
    const name = _blockNameCache[i]; if(name === undefined) return;
    const idxs = []; entities.forEach((e, k) => { if(e.gid && (e.blockName || 'グループ') === name) idxs.push(k); });
    if(idxs.length === 0) return;
    const allHidden = idxs.every(k => entities[k].hidden);
    saveUndo();
    idxs.forEach(k => { entities[k].hidden = !allHidden; });
    if(!allHidden) { cmdState.selectedIndices = (cmdState.selectedIndices || []).filter(k => !idxs.includes(k)); if(idxs.includes(cmdState.highlightIdx)) cmdState.highlightIdx = -1; }
    addCommandLog(`-> ブロック「${name}」を${allHidden ? '表示' : '非表示'}にしました (${idxs.length}個)`);
    updatePropertiesPanel();
    window.updateBlockManagerContent();
    if(typeof window.updateLayerManagerContent === 'function') window.updateLayerManagerContent();
    render();
};
window.zoomToBlock = function(i) {
    const name = _blockNameCache[i]; if(name === undefined) return;
    const idxs = []; entities.forEach((e, k) => { if(e.gid && (e.blockName || 'グループ') === name) idxs.push(k); });
    zoomToEntities(idxs);
};
window.selectBlockByName = function(i) {
    const name = _blockNameCache[i]; if(name === undefined) return;
    const idxs = []; entities.forEach((e, k) => { if(e.gid && (e.blockName || 'グループ') === name && !e.hidden) idxs.push(k); });
    if(idxs.length === 0) { addCommandLog(`-> ブロック「${name}」に表示中の図形がありません`); return; }
    cmdState.selectedIndices = idxs; cmdState.highlightIdx = idxs[0];
    addCommandLog(`-> ブロック「${name}」を ${idxs.length}個 選択しました`);
    updatePropertiesPanel();
    window.updateBlockManagerContent();
    render();
};
window.zoomToSelection = function() {
    const sel = (cmdState.selectedIndices && cmdState.selectedIndices.length) ? cmdState.selectedIndices : (cmdState.highlightIdx >= 0 ? [cmdState.highlightIdx] : []);
    if(sel.length) zoomToEntities(sel);
};
// 選択図形をグループ化（既にブロック名があるものはその名前を保持）
window.groupSelection = function() {
    const sel = (cmdState.selectedIndices && cmdState.selectedIndices.length) ? cmdState.selectedIndices.slice() : (cmdState.highlightIdx >= 0 ? [cmdState.highlightIdx] : []);
    if(sel.length < 2) { addCommandLog('-> グループ化するには2個以上の図形を選択してください（範囲選択やブロック一覧の☑で複数選択できます）'); showToast('2個以上選択してからグループ化してください'); return; }
    saveUndo();
    const gid = newGroupId('u');
    sel.forEach(i => { const e = entities[i]; if(e) { e.gid = gid; if(!e.blockName) e.blockName = 'グループ'; } });
    addCommandLog(`-> ${sel.length}個の図形をグループ化しました`);
    showToast(`${sel.length}個をグループ化しました`);
    updatePropertiesPanel();
    if(typeof window.updateBlockManagerContent === 'function') window.updateBlockManagerContent();
    render();
};
// 選択中のグループを分解（gid/blockName を外す）。ブロックの部品を個別に編集したいときに使う
window.explodeSelection = function() {
    const sel = (cmdState.selectedIndices && cmdState.selectedIndices.length) ? cmdState.selectedIndices : (cmdState.highlightIdx >= 0 ? [cmdState.highlightIdx] : []);
    const gids = new Set(); sel.forEach(i => { const e = entities[i]; if(e && e.gid) gids.add(e.gid); });
    if(gids.size === 0) { addCommandLog('-> 分解できるグループが選択されていません'); return; }
    saveUndo();
    let n = 0;
    entities.forEach(e => { if(e.gid && gids.has(e.gid)) { delete e.gid; delete e.blockName; n++; } });
    addCommandLog(`-> ${gids.size}個のグループを分解しました（${n}個の図形を個別化）`);
    showToast(`グループを分解しました（${n}個）`);
    cmdState.selectedIndices = [];
    updatePropertiesPanel();
    if(typeof window.updateBlockManagerContent === 'function') window.updateBlockManagerContent();
    render();
};
// 選択図形を非表示（再表示は画層管理の「隠れ図形を再表示」）
window.hideSelectedEntities = function() {
    const sel = (cmdState.selectedIndices && cmdState.selectedIndices.length) ? cmdState.selectedIndices.slice() : (cmdState.highlightIdx >= 0 ? [cmdState.highlightIdx] : []);
    if(sel.length === 0) return;
    saveUndo();
    sel.forEach(i => { if(entities[i]) entities[i].hidden = true; });
    addCommandLog(`-> ${sel.length}個の図形を非表示にしました（再表示: 画層管理の「隠れ図形を再表示」）`);
    showToast(`${sel.length}個を非表示にしました`);
    clearSelection();
    if(typeof window.updateBlockManagerContent === 'function') window.updateBlockManagerContent();
    if(typeof window.updateLayerManagerContent === 'function') window.updateLayerManagerContent();
    render();
};
// ハイライト中の図形が属するグループ全体を選択
window.selectGroupOfHighlighted = function() {
    const e = entities[cmdState.highlightIdx];
    if(!e || !e.gid) return;
    cmdState.selectedIndices = getGroupMembers(e.gid);
    updatePropertiesPanel();
    render();
};
// 選択アクションバー（IDLEで図形を選択中に表示。移動/複写/回転/削除/隠す/グループ化）
function updateSelectionBar() {
    const bar = document.getElementById('sel-actionbar');
    if(!bar) return;
    const sel = cmdState.selectedIndices || [];
    const n = sel.length > 0 ? sel.length : (cmdState.highlightIdx >= 0 ? 1 : 0);
    if(cmdState.mode !== 'IDLE' || n === 0) { bar.style.display = 'none'; return; }
    const idxs = sel.length ? sel : [cmdState.highlightIdx];
    const gids = new Set(); idxs.forEach(i => { const e = entities[i]; if(e && e.gid) gids.add(e.gid); });
    const first = entities[idxs[0]];
    const label = document.getElementById('sel-label');
    if(label) {
        if(gids.size >= 1 && first && first.gid) label.textContent = `🧩 ${first.blockName || 'グループ'}${gids.size > 1 ? ` 他${gids.size - 1}` : ''} (${n}個)`;
        else label.textContent = `${n}個選択`;
    }
    const gbtn = document.getElementById('sel-group-btn');
    if(gbtn) {
        if(gids.size > 0) { gbtn.style.display = ''; gbtn.textContent = '分解'; gbtn.dataset.action = 'explode'; }
        else if(n > 1) { gbtn.style.display = ''; gbtn.textContent = '🧩 グループ化'; gbtn.dataset.action = 'group'; }
        else gbtn.style.display = 'none';
    }
    bar.style.display = 'flex';
}
window.toggleGroupOfSelection = function() {
    const gbtn = document.getElementById('sel-group-btn');
    if(gbtn && gbtn.dataset.action === 'explode') window.explodeSelection(); else window.groupSelection();
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
                <div style="width:12px;height:12px;background-color:${safeColor(l.color)};border:1px solid rgba(255,255,255,0.2);border-radius:2px;margin-right:8px;box-shadow:0 0 3px rgba(0,0,0,0.5);"></div>
                <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; font-size:12px; ${textStyle}" onclick="changeCurrentLayer('${l.index}')" title="クリックで作図画層に設定: ${escapeHtml(l.name)}">
                    ${currentMark}${escapeHtml(l.name)}
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
                <div style="width:12px;height:12px;background-color:${safeColor(l.color)};border:1px solid rgba(255,255,255,0.1);border-radius:2px;margin-right:8px;opacity:0.5;"></div>
                <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; font-size:12px; ${textStyle}" onclick="changeCurrentLayer('${l.index}')" title="クリックで作図画層に設定: ${escapeHtml(l.name)}">
                    ${currentMark}${escapeHtml(l.name)}
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
            <div style="width:12px;height:12px;background-color:${safeColor(l.color)};border:1px solid #777;border-radius:2px;margin-right:5px;"></div>
            <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(l.name)}">${escapeHtml(l.name)}</div>
        </div>`;
    });
    list.innerHTML = html;
};
window.toggleLayerVisibility = function(idx) {
    if(layers[idx]) {
        saveUndo();
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
    saveUndo();
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

// プロパティ欄の数（座標・長さ）。オプションで単位を選んでいればその単位（m は小数3桁、mm は小数1桁）、
// 「図面どおり」なら以前と同じ桁（autoDigits が null ならそのままの値）
function _propNum(v, kind, autoDigits) {
    const u = displayUnitChosen(kind);
    if(!u) return autoDigits === null ? String(v) : v.toFixed(autoDigits);
    return toDisplayUnit(v, kind).toFixed(u === 'm' ? 3 : 1);
}
// プロパティ欄で座標・長さとして入れる項目（入れた数は表示の単位なので、図面の単位に直す）
const PROP_COORD_KEYS = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy'];
const PROP_LENGTH_KEYS = ['radius', 'rx', 'ry', 'height'];

function updatePropertiesPanel() {
    const p = document.getElementById('props-content');
    if(!p) return;
    if(cmdState.mode === 'IDLE' && cmdState.highlightIdx >= 0 && entities[cmdState.highlightIdx]) {
        const e = entities[cmdState.highlightIdx];
        const eid = _idOf(e); // 入力欄の onchange には配列番号ではなくIDを埋め込む（画面を開いたまま配列が変わっても別の図形を編集しない）
        const layerColor = layers[e.layer] ? layers[e.layer].color : '#ffffff';
        let html = `<div style="font-weight:bold;margin-bottom:10px;color:var(--highlight-color);">${e.type}</div>`;
        // 単位を選んでいるときは、欄の数の単位を示す（オプションの表示・操作）
        if(displayUnitChosen('coord') || displayUnitChosen('len')) {
            html += `<div class="prop-unit-note" style="font-size:10px;color:#888;margin:-6px 0 8px;">単位: 座標 ${displayUnit('coord')}・長さ ${displayUnit('len')}</div>`;
        }
        if(e.gid) {
            const gcount = getGroupMembers(e.gid).length;
            html += `<div class="prop-row"><div class="prop-label">ブロック</div><div style="flex:1;display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                <span style="color:var(--green);font-weight:600;">🧩 ${escapeHtml(e.blockName || 'グループ')}</span><span style="color:#888;font-size:10px;">(${gcount}個)</span>
                <button class="status-btn" style="font-size:10px;padding:2px 6px;border:1px solid #666;border-radius:3px;" onclick="selectGroupOfHighlighted()">全選択</button>
                <button class="status-btn" style="font-size:10px;padding:2px 6px;border:1px solid #666;border-radius:3px;" onclick="showBlockManagerPanel()">🧩管理</button>
            </div></div>`;
        }
        html += `<div class="prop-row"><div class="prop-label">画層</div>
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                <input class="prop-val" style="width:60px;" type="text" value="${escapeHtml(layers[e.layer]?layers[e.layer].name:e.layer)}" readonly title="画層名">
                <input class="prop-val" type="color" value="${safeColor(layerColor)}" onchange="changeLayerColorGlobal('${e.layer}', this.value)" title="この画層の色を変更">
                <button class="status-btn" style="font-size:10px;padding:2px 6px;border:1px solid #666;border-radius:3px;" onclick="hideLayerOfSelected()" title="この画層のオブジェクトをすべて非表示">🚫画層非表示</button>
            </div>
        </div>`;
        html += `<div class="prop-row"><div class="prop-label">色</div><div style="display:flex;align-items:center;gap:5px;">
            <input class="prop-val" type="color" value="${getEntityColor(e)}" onchange="changeEntityPropById(${eid}, 'color', this.value)">
            ${e.color ? `<button class="prop-btn" style="font-size:10px;padding:2px 4px;" onclick="changeEntityPropById(${eid}, 'color', null)">ByLayer</button>` : `<span style="font-size:10px;color:#888;">ByLayer</span>`}
        </div></div>`;
        html += `<div class="prop-row"><div class="prop-label">表示</div><input class="prop-val" type="checkbox" ${e.hidden?'':'checked'} onchange="changeEntityPropById(${eid}, 'hidden', !this.checked)"></div>`;
        if(e.type === 'POINT' || e.size !== undefined) {
            html += `<div class="prop-row"><div class="prop-label">サイズ</div><input class="prop-val" type="number" step="0.1" value="${e.size||10}" onchange="changeEntityPropById(${eid}, 'size', this.value)"></div>`;
        }
        if(e.type === 'POINT') {
            // 測点の情報（SIMA・座標CSV・座標一覧で使う）。座標は画面表示と同じ X＝北・Y＝東
            const pu = wcsToUcs(e.x, e.y);
            html += `<div class="prop-row"><div class="prop-label">点名</div><input class="prop-val" type="text" value="${escapeHtml(e.name || '')}" onchange="changeEntityPropById(${eid}, 'name', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">点番号</div><input class="prop-val" type="text" value="${escapeHtml(e.num || '')}" onchange="changeEntityPropById(${eid}, 'num', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">X</div><input class="prop-val" type="number" step="0.001" value="${_propNum(pu.y, 'coord', 3)}" onchange="changeEntityPropById(${eid}, 'y', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">Y</div><input class="prop-val" type="number" step="0.001" value="${_propNum(pu.x, 'coord', 3)}" onchange="changeEntityPropById(${eid}, 'x', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">標高</div><input class="prop-val" type="number" step="0.001" value="${typeof e.z === 'number' ? e.z : ''}" placeholder="なし" onchange="changeEntityPropById(${eid}, 'z', this.value)"></div>`;
        }
        if(e.type === 'PLINE' && e.closed && e.points && e.points.length >= 3 && typeof polygonArea === 'function') {
            // 閉じたポリライン（区画など）の面積。図面の単位（オプションの測量座標の単位）を m に直して ㎡ で表示
            const uf = (typeof surveyUnitFactor === 'function') ? surveyUnitFactor() : 1;
            const area = polygonArea(e.points) / (uf * uf);
            if(e.lotName) html += `<div class="prop-row"><div class="prop-label">区画名</div><div style="flex:1;color:#e0e0e0;">${escapeHtml(e.lotName)}</div></div>`;
            html += `<div class="prop-row"><div class="prop-label">面積</div><div style="flex:1;color:var(--green);font-family:Consolas,monospace;">${area.toFixed(3)} ㎡</div></div>`;
        }
        
        // escapeHtml はグローバル版（cad-core.js 先頭付近で定義）を使う
        
        if(e.type === 'LINE') {
            const p1 = wcsToUcs(e.x1, e.y1); const p2 = wcsToUcs(e.x2, e.y2);
            html += `<div class="prop-row"><div class="prop-label">始点 X</div><input class="prop-val" type="number" step="1" value="${_propNum(p1.y, 'coord', 1)}" onchange="changeEntityPropById(${eid}, 'y1', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">始点 Y</div><input class="prop-val" type="number" step="1" value="${_propNum(p1.x, 'coord', 1)}" onchange="changeEntityPropById(${eid}, 'x1', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">終点 X</div><input class="prop-val" type="number" step="1" value="${_propNum(p2.y, 'coord', 1)}" onchange="changeEntityPropById(${eid}, 'y2', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">終点 Y</div><input class="prop-val" type="number" step="1" value="${_propNum(p2.x, 'coord', 1)}" onchange="changeEntityPropById(${eid}, 'x2', this.value)"></div>`;
        } else if(e.type === 'CIRCLE' || e.type === 'ARC') {
            const c = wcsToUcs(e.cx, e.cy);
            html += `<div class="prop-row"><div class="prop-label">中心 X</div><input class="prop-val" type="number" step="1" value="${_propNum(c.y, 'coord', 1)}" onchange="changeEntityPropById(${eid}, 'cy', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">中心 Y</div><input class="prop-val" type="number" step="1" value="${_propNum(c.x, 'coord', 1)}" onchange="changeEntityPropById(${eid}, 'cx', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">半径</div><input class="prop-val" type="number" step="1" value="${_propNum(e.radius, 'len', 1)}" onchange="changeEntityPropById(${eid}, 'radius', this.value)"></div>`;
        } else if(e.type === 'RECTANG') {
            const p1 = wcsToUcs(e.x1, e.y1); const p2 = wcsToUcs(e.x2, e.y2);
            html += `<div class="prop-row"><div class="prop-label">角1 X</div><input class="prop-val" type="number" step="1" value="${_propNum(p1.y, 'coord', 1)}" onchange="changeEntityPropById(${eid}, 'y1', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">角1 Y</div><input class="prop-val" type="number" step="1" value="${_propNum(p1.x, 'coord', 1)}" onchange="changeEntityPropById(${eid}, 'x1', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">角2 X</div><input class="prop-val" type="number" step="1" value="${_propNum(p2.y, 'coord', 1)}" onchange="changeEntityPropById(${eid}, 'y2', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">角2 Y</div><input class="prop-val" type="number" step="1" value="${_propNum(p2.x, 'coord', 1)}" onchange="changeEntityPropById(${eid}, 'x2', this.value)"></div>`;
        } else if(e.type === 'ELLIPSE') {
            const c = wcsToUcs(e.cx, e.cy);
            html += `<div class="prop-row"><div class="prop-label">中心 X</div><input class="prop-val" type="number" step="1" value="${_propNum(c.y, 'coord', 1)}" onchange="changeEntityPropById(${eid}, 'cy', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">中心 Y</div><input class="prop-val" type="number" step="1" value="${_propNum(c.x, 'coord', 1)}" onchange="changeEntityPropById(${eid}, 'cx', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">X半径</div><input class="prop-val" type="number" step="1" value="${_propNum(e.rx, 'len', 1)}" onchange="changeEntityPropById(${eid}, 'rx', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">Y半径</div><input class="prop-val" type="number" step="1" value="${_propNum(e.ry, 'len', 1)}" onchange="changeEntityPropById(${eid}, 'ry', this.value)"></div>`;
        } else if(e.type === 'TEXT') {
            const p = wcsToUcs(e.x, e.y);
            html += `<div class="prop-row"><div class="prop-label">始点 X</div><input class="prop-val" type="number" step="1" value="${_propNum(p.y, 'coord', 1)}" onchange="changeEntityPropById(${eid}, 'y', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">始点 Y</div><input class="prop-val" type="number" step="1" value="${_propNum(p.x, 'coord', 1)}" onchange="changeEntityPropById(${eid}, 'x', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">テキスト</div><input class="prop-val" type="text" value="${escapeHtml(e.text)}" onchange="changeEntityPropById(${eid}, 'text', this.value)"></div>`;
            html += `<div class="prop-row"><div class="prop-label">高さ</div><input class="prop-val" type="number" step="1" value="${_propNum(e.height, 'len', null)}" onchange="changeEntityPropById(${eid}, 'height', this.value)"></div>`;
        } else if(e.type === 'HATCH') {
            html += `<div class="prop-row"><div class="prop-label">対象図形</div><input class="prop-val" type="text" value="${e.target.type}" readonly></div>`;
            html += `<div class="prop-row"><div class="prop-label">透過度</div><input class="prop-val" type="number" step="0.1" min="0" max="1" value="${e.alpha!==undefined?e.alpha:0.5}" onchange="changeEntityPropById(${eid}, 'alpha', this.value)"></div>`;
        } else if(e.type === 'DIMENSION') {
            html += `<div class="prop-row"><div class="prop-label">種類</div><input class="prop-val" type="text" value="${e.subType}" readonly></div>`;
            html += `<div class="prop-row"><div class="prop-label">文字上書き</div><input class="prop-val" type="text" value="${escapeHtml(e.textOverride||'')}" placeholder="自動" onchange="changeEntityPropById(${eid}, 'textOverride', this.value)"></div>`;
        }
        p.innerHTML = html;
    } else {
        p.innerHTML = '<div style="color:#888; text-align:center; padding:20px 0;">図形が選択されていません</div>';
    }
    if(typeof updateSelectionBar === 'function') updateSelectionBar();
}

window.changeEntityPropById = function(id, prop, val) {
    const idx = entityIndexById(id);
    if(idx < 0) { if(typeof showToast === 'function') showToast('対象の図形が見つかりません（削除された可能性があります）'); updatePropertiesPanel(); return; }
    return window.changeEntityProp(idx, prop, val);
};
window.changeEntityProp = function(idx, prop, val) {
    if(!entities[idx]) return;
    saveUndo();
    if(prop==='color') {
        entities[idx].color = (val === '' || val === 'null' || val === null) ? null : val;
    }
    else if(prop==='text') entities[idx].text = val;
    else if(prop==='name' || prop==='num') {
        const e0 = entities[idx];
        e0[prop] = String(val === null || val === undefined ? '' : val).trim();
        if(prop === 'name' && e0.gid) {
            const lbl = entities.find(t => t && t.gid === e0.gid && t.ptLabel);
            if(lbl) { lbl.text = e0.name; delete lbl.bbox; }
        }
    }
    else if(prop==='z') {
        const zv = parseFloat(val);
        entities[idx].z = (val === '' || val === null || !isFinite(zv)) ? null : zv;
    }
    else if(prop==='textOverride') entities[idx].textOverride = val===''?null:val;
    else if(prop==='hidden') entities[idx].hidden = (val === 'true' || val === true);
    else {
        let num = parseFloat(val);
        // 座標・長さの欄は表示の単位（オプションの座標・長さの単位）で入るので、図面の単位に直す
        if(PROP_COORD_KEYS.includes(prop)) num = fromDisplayUnit(num, 'coord');
        else if(PROP_LENGTH_KEYS.includes(prop)) num = fromDisplayUnit(num, 'len');
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
    _bumpGeomEpoch();
    render();
};

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
            // ボタンの上側に展開するよう、bottom基準で位置を設定
            const bottomPos = window.innerHeight - rect.top + 5;
            p.style.bottom = bottomPos + 'px';
            p.style.top = 'auto';
            p.style.maxHeight = Math.max(160, rect.top - 15) + 'px'; // ボタンより上に収まる高さ（中身はスクロール）
            let leftPos = rect.left - 60; // ボタンより少し左側を基準
            // 画面の左右どちらにもはみ出さないよう調整（パネルの幅は中身で決まる）
            leftPos = Math.min(leftPos, window.innerWidth - p.offsetWidth - 5);
            if(leftPos < 5) leftPos = 5;
            p.style.left = leftPos + 'px';
            p.style.right = 'auto';
        } else {
            p.style.bottom = '60px';
            p.style.top = 'auto';
            p.style.left = '10px';
            p.style.right = 'auto';
        }
    }
};

window.changeLayerColorGlobal = function(layerId, color) {
    if(layers[layerId]) {
        saveUndo();
        layers[layerId].color = color;
        addCommandLog(`-> 画層「${layers[layerId].name}」の色を ${color} に変更しました`);
        render();
        updatePropertiesPanel();
    }
};

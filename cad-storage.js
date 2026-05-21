// ===== Web CAD ストレージモジュール =====
// cad-storage.js - IndexedDB を使った図面データの保存・復元

// ===== IndexedDB ヘルパー =====
const CAD_DB_NAME = 'WebCAD';
const CAD_DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_AUTOSAVE = 'autosave';
const AUTOSAVE_KEY = '__autosave__';
const AUTOSAVE_INTERVAL = 300000; // 5分

let _cadDb = null;
let _autoSaveTimer = null;
let _lastAutoSaveTime = 0;
let _currentProjectName = null; // 現在開いているプロジェクト名

// DB接続を取得（シングルトン）
function _openCadDb() {
    if (_cadDb) return Promise.resolve(_cadDb);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(CAD_DB_NAME, CAD_DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
                db.createObjectStore(STORE_PROJECTS, { keyPath: 'name' });
            }
            if (!db.objectStoreNames.contains(STORE_AUTOSAVE)) {
                db.createObjectStore(STORE_AUTOSAVE);
            }
        };
        req.onsuccess = (e) => { _cadDb = e.target.result; resolve(_cadDb); };
        req.onerror = (e) => { console.error('IndexedDB エラー:', e); reject(e); };
    });
}

// 汎用の読み書きヘルパー
function _dbPut(storeName, key, value) {
    return _openCadDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = key !== undefined ? store.put(value, key) : store.put(value);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e);
    }));
}

function _dbGet(storeName, key) {
    return _openCadDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e);
    }));
}

function _dbGetAll(storeName) {
    return _openCadDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e);
    }));
}

function _dbDelete(storeName, key) {
    return _openCadDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e);
    }));
}

// ===== 保存データの組み立て =====
function _buildSaveData(name) {
    // bboxは復元時に再計算するため除外し、保存サイズを削減
    const cleanEntities = entities.map(e => {
        const copy = Object.assign({}, e);
        delete copy.bbox;
        return copy;
    });
    return {
        name: name || '無題',
        entities: cleanEntities,
        layers: JSON.parse(JSON.stringify(layers)),
        currentLayerIndex: currentLayerIndex,
        view: { x: view.x, y: view.y, scale: view.scale, rotation: view.rotation },
        ucs: { originX: ucs.originX, originY: ucs.originY, angle: ucs.angle },
        savedUCSList: JSON.parse(JSON.stringify(savedUCSList)),
        entityCount: entities.length,
        savedAt: new Date().toISOString()
    };
}

// ===== 復元データの適用 =====
function applyProjectData(data) {
    if (!data) return false;
    // エンティティ
    if (data.entities) entities = data.entities;
    else entities = [];
    // 画層
    if (data.layers && data.layers.length > 0) layers = data.layers;
    // アクティブ画層
    if (data.currentLayerIndex !== undefined) currentLayerIndex = data.currentLayerIndex;
    // ビュー
    if (data.view) {
        view.x = data.view.x || 0;
        view.y = data.view.y || 0;
        view.scale = data.view.scale || 1;
        view.rotation = data.view.rotation || 0;
    }
    // UCS
    if (data.ucs) {
        ucs.originX = data.ucs.originX || 0;
        ucs.originY = data.ucs.originY || 0;
        ucs.angle = data.ucs.angle || 0;
    }
    // 保存済みUCSリスト
    if (data.savedUCSList) savedUCSList = data.savedUCSList;
    else savedUCSList = [];

    // Undo/Redo はリセット
    undoStack = [];
    redoStack = [];

    // 描画更新
    if (typeof render === 'function') render();
    if (typeof populateLayerPanel === 'function') populateLayerPanel();
    if (typeof updateUcsSelectBoxes === 'function') updateUcsSelectBoxes();
    // BBox再計算
    entities.forEach(e => {
        if (typeof computeBBox === 'function') e.bbox = computeBBox(e);
    });

    return true;
}

// ===== 自動保存 =====
let _autoSavePending = false;

function scheduleAutoSave() {
    // まだ予約がなければタイマーをセット（即時実行はしない）
    if (!_autoSaveTimer && !_autoSavePending) {
        const now = Date.now();
        const elapsed = now - _lastAutoSaveTime;
        const wait = Math.max(AUTOSAVE_INTERVAL - elapsed, 10000); // 最低10秒は待つ
        _autoSaveTimer = setTimeout(() => {
            _autoSaveTimer = null;
            _doAutoSave();
        }, wait);
    }
}

function _doAutoSave() {
    if (_autoSavePending) return; // 二重実行防止
    _autoSavePending = true;
    _lastAutoSaveTime = Date.now();
    // UIをブロックしないようsetTimeoutで切り離す
    setTimeout(() => {
        try {
            const data = _buildSaveData('__autosave__');
            _dbPut(STORE_AUTOSAVE, AUTOSAVE_KEY, data).then(() => {
                _updateAutoSaveStatus('保存済み');
            }).catch(err => {
                console.error('自動保存エラー:', err);
                _updateAutoSaveStatus('エラー');
            }).finally(() => {
                _autoSavePending = false;
            });
        } catch (err) {
            console.error('自動保存エラー:', err);
            _autoSavePending = false;
        }
    }, 0);
}

function _updateAutoSaveStatus(status) {
    const el = document.getElementById('autosave-status');
    if (!el) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    el.textContent = `💾 ${status} ${hh}:${mm}:${ss}`;
    el.style.color = status === 'エラー' ? '#ff6b6b' : '#00ff88';
    // 5秒後に薄くする
    setTimeout(() => { if (el) el.style.color = '#666'; }, 5000);
}

// ===== 手動保存（名前付きプロジェクト） =====
window.saveProject = async function(nameOverride) {
    let name = nameOverride || _currentProjectName;
    if (!name) {
        name = prompt('プロジェクト名を入力してください:', `図面_${new Date().toLocaleDateString('ja-JP')}`);
        if (!name) return; // キャンセル
    }
    try {
        const data = _buildSaveData(name);
        await _dbPut(STORE_PROJECTS, undefined, data);
        _currentProjectName = name;
        addCommandLog(`-> プロジェクト「${name}」を保存しました (${entities.length}図形)`);
        _updateAutoSaveStatus('手動保存');
        // タイトル更新
        document.title = `${name} - WebCAD`;
    } catch (err) {
        console.error('プロジェクト保存エラー:', err);
        addCommandLog('エラー: プロジェクトの保存に失敗しました');
    }
};

window.saveProjectAs = async function() {
    const name = prompt('新しいプロジェクト名を入力してください:', _currentProjectName || `図面_${new Date().toLocaleDateString('ja-JP')}`);
    if (!name) return;
    _currentProjectName = null; // リセットして新しい名前で保存
    await window.saveProject(name);
};

// ===== プロジェクト一覧 =====
window.showProjectList = async function() {
    const panel = document.getElementById('project-list-panel');
    if (!panel) return;
    
    try {
        const projects = await _dbGetAll(STORE_PROJECTS);
        const listEl = document.getElementById('project-list-items');
        if (!listEl) return;
        
        if (projects.length === 0) {
            listEl.innerHTML = '<div style="color:#888; text-align:center; padding:20px;">保存されたプロジェクトはありません</div>';
        } else {
            // 更新日時で降順ソート（新しい順）
            projects.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
            let html = '';
            projects.forEach(p => {
                const dt = new Date(p.savedAt);
                const dateStr = `${dt.getMonth()+1}/${dt.getDate()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
                const isCurrent = (_currentProjectName === p.name);
                html += `<div class="project-item${isCurrent ? ' current' : ''}" onclick="loadProjectFromList('${p.name.replace(/'/g, "\\'")}')">
                    <div class="project-name">${p.name}${isCurrent ? ' (現在)' : ''}</div>
                    <div class="project-meta">${dateStr} | ${p.entityCount || 0}図形</div>
                    <button class="project-delete-btn" onclick="event.stopPropagation();deleteProjectFromList('${p.name.replace(/'/g, "\\'")}')" title="削除">🗑</button>
                </div>`;
            });
            listEl.innerHTML = html;
        }
        panel.style.display = 'flex';
    } catch (err) {
        console.error('プロジェクト一覧取得エラー:', err);
        addCommandLog('エラー: プロジェクト一覧の取得に失敗しました');
    }
};

window.hideProjectList = function() {
    const panel = document.getElementById('project-list-panel');
    if (panel) panel.style.display = 'none';
};

window.loadProjectFromList = async function(name) {
    if (!confirm(`プロジェクト「${name}」を読み込みますか？\n（現在の作業は自動保存されます）`)) return;
    
    // 現在の作業を自動保存
    _doAutoSave();
    
    try {
        const data = await _dbGet(STORE_PROJECTS, name);
        if (data && applyProjectData(data)) {
            _currentProjectName = name;
            document.title = `${name} - WebCAD`;
            addCommandLog(`-> プロジェクト「${name}」を復元しました (${entities.length}図形)`);
            window.hideProjectList();
        } else {
            addCommandLog('エラー: プロジェクトデータが見つかりません');
        }
    } catch (err) {
        console.error('プロジェクト読込エラー:', err);
        addCommandLog('エラー: プロジェクトの読み込みに失敗しました');
    }
};

window.deleteProjectFromList = async function(name) {
    if (!confirm(`プロジェクト「${name}」を削除しますか？\nこの操作は元に戻せません。`)) return;
    try {
        await _dbDelete(STORE_PROJECTS, name);
        addCommandLog(`-> プロジェクト「${name}」を削除しました`);
        if (_currentProjectName === name) {
            _currentProjectName = null;
            document.title = 'WebCAD';
        }
        // リスト更新
        window.showProjectList();
    } catch (err) {
        console.error('プロジェクト削除エラー:', err);
    }
};

// ===== 起動時の自動復元チェック =====
async function checkAutoRestore() {
    try {
        const data = await _dbGet(STORE_AUTOSAVE, AUTOSAVE_KEY);
        if (data && data.entities && data.entities.length > 0) {
            const dt = new Date(data.savedAt);
            const dateStr = `${dt.getMonth()+1}/${dt.getDate()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
            if (confirm(`前回の作業データがあります（${dateStr}、${data.entityCount || data.entities.length}図形）。\n\n復元しますか？`)) {
                applyProjectData(data);
                addCommandLog(`-> 自動保存データを復元しました (${entities.length}図形)`);
            }
        }
    } catch (err) {
        console.error('自動復元チェックエラー:', err);
    }
}

// ===== ページ離脱時の保存 =====
window.addEventListener('beforeunload', () => {
    if (entities.length > 0) {
        try {
            // 同期的に書き込み（best effort）
            const data = _buildSaveData('__autosave__');
            const req = indexedDB.open(CAD_DB_NAME, CAD_DB_VERSION);
            req.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction(STORE_AUTOSAVE, 'readwrite');
                tx.objectStore(STORE_AUTOSAVE).put(data, AUTOSAVE_KEY);
            };
        } catch (e) { /* best effort */ }
    }
});

// ===== コマンド処理 =====
function processStorageCommand(cmd) {
    if (cmd === 'SAVE') { window.saveProject(); return true; }
    if (cmd === 'SAVEAS') { window.saveProjectAs(); return true; }
    if (cmd === 'RESTORE' || cmd === 'PROJECTS') { window.showProjectList(); return true; }
    return false;
}

// ===== DB初期化 =====
_openCadDb().catch(err => console.error('IndexedDB初期化失敗:', err));

// ===== Web CAD ストレージモジュール =====
// cad-storage.js - IndexedDB を使った図面データの保存・復元

// ===== IndexedDB ヘルパー =====
const CAD_DB_NAME = 'WebCAD';
const CAD_DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_AUTOSAVE = 'autosave';
const AUTOSAVE_KEY = '__autosave__';
// 変更が止まってから15秒後に保存。編集し続けていても最初の変更から60秒以内には必ず保存する。
// （以前は5分間隔で、スマホでは離脱時の保存も効かず最大5分の作業が消えることがあった）
const AUTOSAVE_DEBOUNCE_MS = 15000;
const AUTOSAVE_MAX_WAIT_MS = 60000;

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
        // put 自体が成功しても、容量不足(QuotaExceededError)等はトランザクションの abort で届く。
        // 本当に書き込まれたことを保証するため complete を待って成功とする。
        const fail = () => reject(tx.error || req.error || new Error('IndexedDB への書き込みに失敗しました'));
        tx.oncomplete = () => resolve();
        tx.onerror = fail;
        tx.onabort = fail;
        if (typeof tx.commit === 'function') { try { tx.commit(); } catch (e) { /* 古いブラウザ */ } }
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
        delete copy._hits; // 寸法の画面上の当たり判定（描画時に作り直す）
        return copy;
    });
    return {
        name: name || '無題',
        projectName: name === AUTOSAVE_KEY ? _currentProjectName : (name || null),
        drawingName: window._drawingName || null,
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

    // 固有IDを確認（古い保存データにはIDが無いので付ける。以後の選択はIDで保持される）
    if (typeof ensureEntityIds === 'function') ensureEntityIds();
    if (typeof _bumpGeomEpoch === 'function') _bumpGeomEpoch();
    if (typeof _undoStrCache !== 'undefined') _undoStrCache = null;

    // Undo/Redo はリセット
    undoStack = [];
    redoStack = [];

    // BBox再計算（HATCHは対象外: render側の遅延計算と同じ条件）
    entities.forEach(e => {
        delete e.bbox;
        if (typeof calcBBox === 'function' && e.type !== 'HATCH') e.bbox = calcBBox(e);
    });

    // UI更新（画層ドロップダウン・画層パネル・UCSリスト・UCSラベル）
    if (typeof initLayers === 'function') initLayers();
    if (typeof updateLayerPanel === 'function') updateLayerPanel();
    if (typeof updateUCSDropdowns === 'function') updateUCSDropdowns();
    _syncUcsLabels();

    // 描画更新
    if (typeof render === 'function') render();

    return true;
}

// 復元したUCS状態をステータスバーのラベル表示に反映する
function _syncUcsLabels() {
    const isWcs = ucs.originX === 0 && ucs.originY === 0 && ucs.angle === 0;
    const text = isWcs ? 'WCS' : 'UCS';
    const color = isWcs ? 'var(--highlight-color)' : 'var(--ucs-color)';
    const disp = document.getElementById('ucs-status-display');
    if (disp) { disp.textContent = text; disp.style.color = color; }
    const label = document.getElementById('ucs-label');
    if (label) { label.textContent = text; label.style.color = color; }
}

// ===== 自動保存 =====
// ・変更（saveUndo / undo / redo）のたびに scheduleAutoSave() が呼ばれ、少し待ってまとめて保存する
// ・アプリを裏に回した/閉じたとき（visibilitychange / pagehide）は即保存する
//   （スマホでは beforeunload がほぼ発火しないため、これが無いと直前の作業が消える）
let _autoSavePending = null;  // 実行中の保存 Promise
let _changeSeq = 0;           // 変更の通番
let _savedSeq = 0;            // 自動保存済みの通番
let _projectSavedSeq = 0;     // 名前付き保存（または読込）時点の通番
let _firstUnsavedAt = 0;      // 未保存の変更が最初に発生した時刻
let _autoSaveErrorNotified = false;

function scheduleAutoSave() {
    _changeSeq++;
    const now = Date.now();
    if (!_firstUnsavedAt) _firstUnsavedAt = now;
    clearTimeout(_autoSaveTimer);
    const wait = Math.max(0, Math.min(AUTOSAVE_DEBOUNCE_MS, _firstUnsavedAt + AUTOSAVE_MAX_WAIT_MS - now));
    _autoSaveTimer = setTimeout(() => { _autoSaveTimer = null; _doAutoSave(); }, wait);
}

function _hasUnsavedChanges() { return _changeSeq !== _savedSeq; }
// 名前付きプロジェクトとして保存していない変更があるか
function _hasUnsavedProjectChanges() { return entities.length > 0 && (!_currentProjectName || _changeSeq !== _projectSavedSeq); }

function _doAutoSave() {
    // 保存中なら、終わってから（まだ未保存の変更があれば）もう一度保存する
    if (_autoSavePending) {
        return _autoSavePending.then(() => (_hasUnsavedChanges() ? _doAutoSave() : true));
    }
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
    const seq = _changeSeq;
    let data;
    try {
        // その場でスナップショットを取る（直後に別の図面へ切り替わっても今の内容が保存される）
        data = _buildSaveData(AUTOSAVE_KEY);
    } catch (err) {
        console.error('自動保存エラー:', err);
        _updateAutoSaveStatus('エラー');
        return Promise.resolve(false);
    }
    _autoSavePending = _dbPut(STORE_AUTOSAVE, AUTOSAVE_KEY, data).then(() => {
        _savedSeq = seq;
        if (!_hasUnsavedChanges()) _firstUnsavedAt = 0;
        _lastAutoSaveTime = Date.now();
        _autoSaveErrorNotified = false;
        _updateAutoSaveStatus('保存済み');
        _requestPersistentStorage();
        return true;
    }).catch(err => {
        console.error('自動保存エラー:', err);
        _updateAutoSaveStatus('エラー');
        // 容量不足などは作業が失われる恐れがあるため、一度だけ画面に知らせる
        if (!_autoSaveErrorNotified) {
            _autoSaveErrorNotified = true;
            const msg = (err && (err.name === 'QuotaExceededError')) ? '端末の保存容量が不足しています' : ((err && err.message) || String(err));
            if (window.cadErrors) window.cadErrors.record('storage', '自動保存に失敗しました: ' + msg, err && err.stack);
        }
        return false;
    }).finally(() => {
        _autoSavePending = null;
    });
    return _autoSavePending;
}

// 未保存の変更があれば今すぐ自動保存する（再読み込み前・アプリ離脱時用）
window.flushAutoSave = function() {
    if (_autoSavePending || _hasUnsavedChanges()) return _doAutoSave();
    return Promise.resolve(true);
};

function _onPageHidden() {
    if (_hasUnsavedChanges()) _doAutoSave();
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') _onPageHidden();
});
window.addEventListener('pagehide', _onPageHidden);

// ブラウザの容量逼迫時に保存データが自動削除されないよう「永続ストレージ」を要求する（初回保存時に1回）
let _persistRequested = false;
function _requestPersistentStorage() {
    if (_persistRequested) return;
    _persistRequested = true;
    try {
        if (navigator.storage && navigator.storage.persist) {
            navigator.storage.persisted()
                .then(p => (p ? true : navigator.storage.persist()))
                .catch(() => {});
        }
    } catch { /* 非対応 */ }
}

// オプション画面用: 保存領域の状態
window.getStorageStatus = async function() {
    const st = { persisted: null, usage: null, quota: null, lastAutoSave: _lastAutoSaveTime, unsaved: _hasUnsavedChanges() };
    try {
        if (navigator.storage && navigator.storage.persisted) st.persisted = await navigator.storage.persisted();
        if (navigator.storage && navigator.storage.estimate) {
            const est = await navigator.storage.estimate();
            st.usage = est.usage; st.quota = est.quota;
        }
    } catch { /* 非対応 */ }
    return st;
};

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
        _projectSavedSeq = _changeSeq;
        _requestPersistentStorage();
        addCommandLog(`-> プロジェクト「${name}」を保存しました (${entities.length}図形)`);
        if (typeof showToast === 'function') showToast(`「${name}」を保存しました`, 2500);
        _updateAutoSaveStatus('手動保存');
        // タイトル更新
        document.title = `${name} - WebCAD`;
        if(navigator.vibrate) navigator.vibrate([30, 50, 30]);
    } catch (err) {
        console.error('プロジェクト保存エラー:', err);
        addCommandLog('エラー: プロジェクトの保存に失敗しました');
        const msg = (err && err.name === 'QuotaExceededError') ? '端末の保存容量が不足しています' : ((err && err.message) || String(err));
        if (window.cadErrors) window.cadErrors.record('storage', 'プロジェクトの保存に失敗しました: ' + msg, err && err.stack);
    }
};

// 現在のプロジェクト名を外部から設定/解除（DXF読み込みで置き換えたときに前の名前で上書き保存しないため）
window.setCurrentProjectName = function(name) {
    _currentProjectName = name || null;
    _projectSavedSeq = _changeSeq;
    document.title = name ? `${name} - WebCAD` : 'Web CAD';
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
        
        listEl.innerHTML = '';
        if (projects.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color:#888; text-align:center; padding:20px;';
            empty.textContent = '保存されたプロジェクトはありません';
            listEl.appendChild(empty);
        } else {
            // 更新日時で降順ソート（新しい順）
            projects.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
            projects.forEach(p => {
                const dt = new Date(p.savedAt);
                const dateStr = `${dt.getMonth()+1}/${dt.getDate()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
                const isCurrent = (_currentProjectName === p.name);

                // プロジェクト名はユーザー入力のため、innerHTML連結ではなく
                // textContent/DOM APIで組み立てる（HTML・引用符の混入対策）
                const item = document.createElement('div');
                item.className = 'project-item' + (isCurrent ? ' current' : '');
                item.addEventListener('click', () => window.loadProjectFromList(p.name));

                const nameEl = document.createElement('div');
                nameEl.className = 'project-name';
                nameEl.textContent = p.name + (isCurrent ? ' (現在)' : '');

                const metaEl = document.createElement('div');
                metaEl.className = 'project-meta';
                metaEl.textContent = `${dateStr} | ${p.entityCount || 0}図形`;

                const delBtn = document.createElement('button');
                delBtn.className = 'project-delete-btn';
                delBtn.title = '削除';
                delBtn.textContent = '🗑';
                delBtn.addEventListener('click', (ev) => { ev.stopPropagation(); window.deleteProjectFromList(p.name); });

                item.appendChild(nameEl);
                item.appendChild(metaEl);
                item.appendChild(delBtn);
                listEl.appendChild(item);
            });
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
    const warn = _hasUnsavedProjectChanges()
        ? '\n\n⚠ 現在の図面には名前を付けて保存していない変更があります。読み込むと失われます（必要なら先に「保存」してください）。'
        : '';
    if (!confirm(`プロジェクト「${name}」を読み込みますか？${warn}`)) return;

    try {
        const data = await _dbGet(STORE_PROJECTS, name);
        if (data && applyProjectData(data)) {
            _currentProjectName = name;
            _projectSavedSeq = _changeSeq;
            if (typeof setDrawingName === 'function' && data.drawingName) setDrawingName(data.drawingName);
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
    // アプリ更新の「再読み込み」から起動した場合は確認なしで復元する
    let silent = false;
    try { silent = sessionStorage.getItem('cad_auto_restore') === '1'; sessionStorage.removeItem('cad_auto_restore'); } catch { /* 非対応 */ }
    try {
        const data = await _dbGet(STORE_AUTOSAVE, AUTOSAVE_KEY);
        // 既に図面を開いている場合（起動直後にファイルを開いた等）は上書きしない
        if (data && data.entities && data.entities.length > 0 && entities.length === 0) {
            const dt = new Date(data.savedAt);
            const dateStr = `${dt.getMonth()+1}/${dt.getDate()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
            const label = data.projectName ? `「${data.projectName}」` : (data.drawingName ? `「${data.drawingName}」` : '');
            if (silent || confirm(`前回の作業データ${label}があります（${dateStr}、${data.entityCount || data.entities.length}図形）。\n\n復元しますか？\n（復元しない場合、次に編集した時点で上書きされます）`)) {
                applyProjectData(data);
                if (data.projectName) window.setCurrentProjectName(data.projectName);
                if (typeof setDrawingName === 'function' && data.drawingName) setDrawingName(data.drawingName);
                addCommandLog(`-> 自動保存データを復元しました (${entities.length}図形)`);
                if (silent && typeof showToast === 'function') showToast('更新前の図面を復元しました', 3000);
            }
        }
    } catch (err) {
        console.error('自動復元チェックエラー:', err);
    }
}

// ===== ページ離脱時の保存 =====
// PC ブラウザでタブを閉じる場合の保険（既に開いている DB 接続で即座に書き込みを開始する）。
// スマホでは上の visibilitychange / pagehide が主に働く。
window.addEventListener('beforeunload', _onPageHidden);

// ===== コマンド処理 =====
function processStorageCommand(cmd) {
    if (cmd === 'SAVE') { window.saveProject(); return true; }
    if (cmd === 'SAVEAS') { window.saveProjectAs(); return true; }
    if (cmd === 'RESTORE' || cmd === 'PROJECTS') { window.showProjectList(); return true; }
    return false;
}

// ===== DB初期化 =====
_openCadDb().catch(err => console.error('IndexedDB初期化失敗:', err));

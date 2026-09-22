// ===== Web CAD 入力イベント =====
// cad-input.js - マウス・タッチ・キーボードのイベント登録と、
//                画面の拡大縮小・移動（パン/ピンチ）・範囲選択の処理
// （cad-core.js から分割。ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

// ===== イベントリスナー =====
let lastTouchTime = 0;
function updateMousePos(e) {
    const rect=canvas.getBoundingClientRect(); mouse.screenX=e.clientX-rect.left; mouse.screenY=e.clientY-rect.top;
    const wcs=screenToWcs(mouse.screenX,mouse.screenY); mouse.wcsX=wcs.x; mouse.wcsY=wcs.y;
    const uc=wcsToUcs(wcs.x,wcs.y); mouse.ucsX=uc.x; mouse.ucsY=uc.y;
}
function setupEventListeners() {
    // ボタンのハプティクスは index.html 側の click リスナーで一元管理（二重振動を防ぐため、ここでは登録しない）

    canvas.addEventListener('mousemove', (e) => {
        updateMousePos(e);
        if(mouse.isPanning) {
            view.x += e.movementX; view.y += e.movementY; // 中ボタンドラッグは画面パン（UCS原点は動かさない）
            render(); return;
        }
        if(mouse.isTrimming) {
            if(cmdState.trimPath) cmdState.trimPath.push({x: mouse.wcsX, y: mouse.wcsY});
            renderOverlay(); return; // なぞった線は重ね表示
        }
        const hlBefore = cmdState.highlightIdx;
        // コマンドモード中のみスナップ計算（IDLE時は軽量化のためスキップ。座標読取モードでは座標を読むため常に計算）
        const isSelectMode = ['WAITING_ERASE_SELECT','WAITING_MOVE_SELECT','WAITING_COPY_SELECT','WAITING_OFFSET_SELECT','WAITING_OFFSET_SIDE'].includes(cmdState.mode);
        const isFullscreenMouse = document.body.classList.contains('fullscreen-mode');
        if((cmdState.mode !== 'IDLE' || isFullscreenMouse) && !isSelectMode && !mouse.isSelecting) {
            snapResult = findSnap(mouse.screenX, mouse.screenY, mouse.wcsX, mouse.wcsY);
        } else { snapResult = null; }
        if(snapResult){ const su=wcsToUcs(snapResult.wcsX,snapResult.wcsY); setCoordsDisplay(su.x, su.y); if(window.updateFsCoordTooltip) window.updateFsCoordTooltip(e.clientX, e.clientY, su.x, su.y, snapResult.type); }
        else { setCoordsDisplay(mouse.ucsX, mouse.ucsY); if(window.updateFsCoordTooltip) window.updateFsCoordTooltip(e.clientX, e.clientY, mouse.ucsX, mouse.ucsY, null); }
        if(cmdState.mode==='WAITING_ERASE_SELECT'||cmdState.mode==='WAITING_MOVE_SELECT'||cmdState.mode==='WAITING_COPY_SELECT'||cmdState.mode==='WAITING_OFFSET_SELECT') {
            if(!mouse.isSelecting) cmdState.highlightIdx=hitTestEntity(mouse.screenX,mouse.screenY);
        }
        // 図形の強調表示が変わったときだけ図形ごと描き直す（それ以外はカーソル・スナップ記号などの重ね表示だけ）
        if(cmdState.highlightIdx !== hlBefore) render(); else renderOverlay();
    });
    canvas.addEventListener('mousedown', (e) => {
        if(Date.now() - lastTouchTime < 500) return; // タッチイベントに起因する疑似マウスイベントを無視
        if(e.button===1){mouse.isPanning=true;e.preventDefault();return;} // Middle click for panning
        if(e.button===0) {
            if (cmdState.mode === 'WAITING_TRIM' || cmdState.mode === 'WAITING_EXTEND') {
                mouse.isTrimming = true;
                cmdState.trimPath = [{x: mouse.wcsX, y: mouse.wcsY}];
                render();
                return;
            }

            const selectModes = ['IDLE', 'WAITING_ERASE_SELECT', 'WAITING_MOVE_SELECT', 'WAITING_COPY_SELECT', 'WAITING_ROTATE_SELECT'];
            const isSelectMode = selectModes.includes(cmdState.mode);

            if (cmdState.mode!=='IDLE' && !isSelectMode) { // Left click for point input when not in IDLE and not select mode
                const pt=getInputPoint(); handlePointInput(pt, true);
            } else {
                const idx = hitTestEntity(mouse.screenX, mouse.screenY);
                if(idx >= 0) {
                    if (cmdState.mode === 'IDLE') {
                        selectEntityAt(mouse.screenX, mouse.screenY);
                    } else {
                        const pt=getInputPoint(); handlePointInput(pt, true);
                    }
                } else {
                    if (cmdState.mode === 'IDLE') { cmdState.highlightIdx = -1; cmdState.selectedIndices = []; }
                    if (window.areaSelectEnabled) {
                        mouse.isSelecting = true;
                        mouse.selStartX = mouse.screenX;
                        mouse.selStartY = mouse.screenY;
                    }
                }
                updatePropertiesPanel();
                render();
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
            else if(cmdState.mode==='WAITING_TRIM'){resetCommand(); addCommandLog('-> トリム終了');}
            else if(cmdState.mode!=='IDLE'){resetCommand();addCommandLog('-> コマンド終了');}
        }
    });
    window.addEventListener('mouseup',(e)=>{
        if(e.button===1){ mouse.isPanning=false; render(); }
        if(e.button===0 && mouse.isTrimming) {
            if(cmdState.mode === 'WAITING_EXTEND') executeExtend(cmdState.trimPath);
            else executeTrim(cmdState.trimPath);
            mouse.isTrimming = false;
            cmdState.trimPath = [];
            render();
        }
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
        noteViewGesture();
        render();
    },{passive:false});

    // ===== タッチイベント（スマホ対応 - AutoCADライクUX） =====
    canvas.style.touchAction = 'none';

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
        else if(e.type === 'TEXT') {
            const p = wcsToScreen(e.x, e.y); const b = textLocalBox(e); const k = view.scale;
            const th = -(view.rotation + (e.rotation || 0)), c = Math.cos(th), s = Math.sin(th);
            pts = [[b.xMin, b.yMin], [b.xMax, b.yMin], [b.xMax, b.yMax], [b.xMin, b.yMax]].map(([lx, ly]) => ({ x: p.x + (lx * c - ly * s) * k, y: p.y + (lx * s + ly * c) * k }));
        }
        else if(e.type === 'POINT') { const p = wcsToScreen(e.x, e.y); return {minX:p.x-5, minY:p.y-5, maxX:p.x+5, maxY:p.y+5}; }

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

            // 指を置いた位置でスナップを取り直す（動かさずにタップしたときに前の点が残らないように）
            const isFullscreenStart = document.body.classList.contains('fullscreen-mode');
            const isSelectModeStart = cmdState.mode==='WAITING_ERASE_SELECT'||cmdState.mode==='WAITING_MOVE_SELECT'||cmdState.mode==='WAITING_COPY_SELECT'||cmdState.mode==='WAITING_OFFSET_SELECT'||cmdState.mode==='WAITING_OFFSET_SIDE';
            if(isFullscreenStart || (cmdState.mode !== 'IDLE' && !isSelectModeStart)) snapResult = findSnap(tx, ty, mouse.wcsX, mouse.wcsY);
            else snapResult = null;

            // スワイプモード優先
            if(cmdState.mode === 'WAITING_TRIM' || cmdState.mode === 'WAITING_EXTEND') {
                touchState.isTrimming = true;
                cmdState.trimPath = [{x: mouse.wcsX, y: mouse.wcsY}];
            } else if(cmdState.mode==='WAITING_ERASE_SELECT'||cmdState.mode==='WAITING_MOVE_SELECT'||cmdState.mode==='WAITING_COPY_SELECT'||cmdState.mode==='WAITING_OFFSET_SELECT') {
                cmdState.highlightIdx = hitTestEntity(tx, ty);
            }

            // 長押しタイマーの設定 (0.6秒)
            touchState.pressTimer = setTimeout(() => {
                if(!touchState.hasMoved && !touchState.isPinch) {
                    const idx = hitTestEntity(touchState.startX, touchState.startY);
                    if(idx >= 0) {
                        const hitEnt = entities[idx];
                        if(hitEnt.type === 'DIMENSION' || hitEnt.type === 'TEXT') {
                            saveUndo();
                            entities.splice(idx, 1);
                            const name = hitEnt.type === 'TEXT' ? `文字 "${hitEnt.text}"` : `寸法 (${hitEnt.subType || '不明'})`;
                            addCommandLog(`-> 長押しにより ${name} を削除しました`);
                            if(typeof guideNotify === 'function') guideNotify('longPressDelete');
                            cmdState.highlightIdx = -1;
                            if(window.hideFsCoordTooltip) window.hideFsCoordTooltip();
                            render();
                            if(navigator.vibrate) navigator.vibrate([50, 50, 50]); // 長押し成功時の振動
                            touchState.hasMoved = true;
                        }
                    }
                }
            }, 600);

            // 全画面座標ツールチップ更新
            if(snapActive()) {
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

            // 座標更新
            mouse.screenX = tx; mouse.screenY = ty;
            const wcs = screenToWcs(tx, ty);
            mouse.wcsX = wcs.x; mouse.wcsY = wcs.y;
            const uc = wcsToUcs(wcs.x, wcs.y);
            mouse.ucsX = uc.x; mouse.ucsY = uc.y;

            // ドラッグ判定
            if(!touchState.hasMoved && moved > DRAG_THRESHOLD) {
                touchState.hasMoved = true;
                touchState.isDragging = true;
                // 全画面モード中は範囲選択しない（座標読取専用）
                const isFullscreen = document.body.classList.contains('fullscreen-mode');
                if(!isFullscreen) {
                    if (cmdState.mode === 'WAITING_TRIM' || cmdState.mode === 'WAITING_EXTEND') {
                        touchState.isTrimming = true;
                        if(!cmdState.trimPath || cmdState.trimPath.length === 0) {
                            cmdState.trimPath = [{x: mouse.wcsX, y: mouse.wcsY}];
                        }
                    } else {
                        // IDLEモードまたは編集コマンドのオブジェクト選択待ちの場合は範囲選択開始
                        const selectModes = ['IDLE', 'WAITING_ERASE_SELECT', 'WAITING_MOVE_SELECT', 'WAITING_COPY_SELECT', 'WAITING_ROTATE_SELECT'];
                        if(selectModes.includes(cmdState.mode) && window.areaSelectEnabled) {
                            touchState.isSelecting = true;
                            touchState.selStartX = touchState.startX;
                            touchState.selStartY = touchState.startY;
                        }
                    }
                }
            }

            if(touchState.isTrimming) {
                if(cmdState.trimPath) cmdState.trimPath.push({x: mouse.wcsX, y: mouse.wcsY});
                renderOverlay(); return; // なぞった線は重ね表示
            }

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
            if(snapActive()) {
                const su = wcsToUcs(snapResult.wcsX, snapResult.wcsY);
                setCoordsDisplay(su.x, su.y);
                if(window.updateFsCoordTooltip) window.updateFsCoordTooltip(touch.clientX, touch.clientY, su.x, su.y, snapResult.type);
            } else {
                setCoordsDisplay(mouse.ucsX, mouse.ucsY);
                if(window.updateFsCoordTooltip) window.updateFsCoordTooltip(touch.clientX, touch.clientY, mouse.ucsX, mouse.ucsY, null);
            }

            // ルーペ・スナップ記号・範囲選択枠などの重ね表示だけが変わる（図形・表示位置は変わらない）
            renderOverlay();
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

            if(touchState.isTrimming) {
                if(cmdState.mode === 'WAITING_EXTEND') executeExtend(cmdState.trimPath);
                else executeTrim(cmdState.trimPath);
                touchState.isTrimming = false;
                cmdState.trimPath = [];
            } else if(touchState.isSelecting) {
                // 範囲選択完了
                performSelection(touchState.selStartX, touchState.selStartY, mouse.screenX, mouse.screenY);
                touchState.isSelecting = false;
            } else if(cmdState.mode !== 'IDLE') {
                // コマンドモード中: 指を離した位置でポイント確定
                const isDimMode = cmdState.mode.startsWith('WAITING_DIM');
                
                if(isDimMode) {
                    if(typeof guideNotify === 'function') guideNotify('dimTouchEnd');
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
                // 短いタップでIDLEモード: エンティティ選択/選択解除（グループ選択ONならブロック全体）
                selectEntityAt(mouse.screenX, mouse.screenY);
            } else if(!document.body.classList.contains('fullscreen-mode') && typeof guideNotify === 'function') {
                guideNotify('idleDrag'); // 1本指でなぞった（画面を動かしたかったのかもしれない）
            }

            touchState.isDragging = false;
            touchState.hasMoved = false;
            render();
        }

        if(e.touches.length < 2) {
            const wasPinch = touchState.isPinch;
            touchState.isPinch = false;
            touchState.lastDist = 0;
            touchState.lastMid = null;
            if(wasPinch) render(); // 操作中はキャッシュを見せていたので正確に描き直す
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

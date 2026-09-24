// ===== Web CAD コマンド処理 =====
// cad-command.js - 点入力の補正（直交・スナップ）、各コマンドの点入力処理、
//                  オフセット・回転・トリム・延長、コマンド文字列の解釈、
//                  画面下アクションバーのボタン処理
// （cad-core.js から分割。ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

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
    if(snapActive()) return {x:snapResult.wcsX, y:snapResult.wcsY};
    return applyOrtho({x:mouse.wcsX, y:mouse.wcsY});
}

// 点の入力（クリック・タップの確定・座標入力）。2点の中点の途中ならその点として受け取り、
// 入力のあとは「次の1点だけ」のスナップ指定を解除する
function handlePointInput(wcs, fromMouse = false) {
    if(snapInputIntercept(wcs)) return;
    _handlePointInputCore(wcs, fromMouse);
    afterSnapPointInput(wcs);
    if(typeof guideNotify === 'function') guideNotify('point'); // 操作ガイド: 手順カードを今の段階に合わせる
}
function _handlePointInputCore(wcs, fromMouse) {
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
        const isAuto = lastParams.circleMode === 'auto';
        cmdState.startWcs = {x: wcs.x, y: wcs.y};
        cmdState.lastInputWcs = {x: wcs.x, y: wcs.y};
        const u = wcsToUcs(wcs.x, wcs.y);
        
        if (isAuto) {
            const rVal = parseFloat(lastParams.radius) || 50;
            cmdState.previewRadius = rVal;
            setPrompt(`円 (半径${rVal}): 位置OKなら「確定」をタップ`);
            addCommandLog(`-> 中心: (${u.x.toFixed(2)},${u.y.toFixed(2)}) → 「確定」で配置`);
        } else {
            cmdState.mode = 'WAITING_CIRCLE_RADIUS';
            cmdState.previewRadius = 50;
            setPrompt('半径を指定し「確定」をタップ:');
            addCommandLog(`-> 中心: (${u.x.toFixed(2)},${u.y.toFixed(2)}) → 半径を決めて確定`);
        }
        hidePropertyPanel();
        showActionbarControls({ showMode: true });
        updateCircleActionBar();
        render();
        return;
    }
    if(m==='WAITING_CIRCLE_RADIUS') { 
        const r=dist(cmdState.startWcs.x,cmdState.startWcs.y,wcs.x,wcs.y); 
        cmdState.previewRadius = r;
        cmdState.lastInputWcs = {x: wcs.x, y: wcs.y};
        addCommandLog(`-> 半径: ${r.toFixed(2)} (「確定」で配置)`);
        showActionbarControls({ showMode: true });
        updateCircleActionBar();
        render(); 
        return; 
    }
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
        cmdState.previewWcs = {x: wcs.x, y: wcs.y};
        const u = wcsToUcs(wcs.x, wcs.y);
        addCommandLog(`-> 配置位置: (${u.x.toFixed(2)},${u.y.toFixed(2)}) → 「確定」で配置`);
        showActionbarControls({ showMode: false });
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
        if(idx>=0){
            const targets = expandGroupTargets(idx);
            saveUndo(); targets.sort((a,b)=>b-a).forEach(i => entities.splice(i,1));
            addCommandLog(targets.length > 1 ? `-> グループ ${targets.length}個を削除` : '-> エンティティ削除');
            cmdState.highlightIdx=-1; cmdState.selectedIndices=[]; render();
        }
        else addCommandLog('エンティティが見つかりません');
        return;
    }
    if(m==='WAITING_ROTATE_SELECT') {
        const idx=hitTestEntity(mouse.screenX,mouse.screenY);
        if(idx>=0) {
            cmdState.highlightIdx = idx;
            const grp = expandGroupTargets(idx); cmdState.selectedIndices = grp.length > 1 ? grp : [];
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
            const rt = _getRotateTargets();
            saveUndo();
            rt.forEach(i => { if(entities[i]) rotateEntity(entities[i], wcs.x, wcs.y, cmdState.presetAngleDeg * Math.PI/180); });
            addCommandLog(`-> 回転完了 (角度: ${cmdState.presetAngleDeg}度${rt.length > 1 ? ', ' + rt.length + '個' : ''})`);
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
        const rt = _getRotateTargets();
        saveUndo();
        rt.forEach(i => { if(entities[i]) rotateEntity(entities[i], cmdState.rotateBase.x, cmdState.rotateBase.y, deltaAngle); });
        addCommandLog(`-> 回転完了 (角度: ${(deltaAngle * 180 / Math.PI).toFixed(2)}度${rt.length > 1 ? ', ' + rt.length + '個' : ''})`);
        cmdState.highlightIdx = -1;
        resetCommand();
        return;
    }

    // 測量計算の点の指定・区画のタップは cad-cogo-ui.js へ
    if(typeof handleCogoPointInput === 'function' && handleCogoPointInput(m, wcs)) return;
    // 寸法コマンドの入力処理は cad-dimension.js へ委譲
    if(typeof handleDimPointInput==='function') handleDimPointInput(m, wcs);
}

// ===== オフセット処理 =====
function isOffsetable(e) { return e.type==='LINE'||e.type==='CIRCLE'||e.type==='ARC'||e.type==='RECTANG'||(e.type==='PLINE'&&!!e.points&&e.points.length>=2); }

// ポリラインを距離 d だけずらした頂点の列（d > 0 で進む向きの左側）。
// 各区間を平行にずらし、となり合う区間は延長して交わる点で結ぶ（尖りすぎる角は2点で面取り）
function offsetPolylinePoints(points, closed, d) {
    const P = [];
    points.forEach(p => { const q = P[P.length - 1]; if(!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-12) P.push({ x: p.x, y: p.y }); });
    if(closed && P.length > 2 && Math.hypot(P[0].x - P[P.length - 1].x, P[0].y - P[P.length - 1].y) <= 1e-12) P.pop();
    const m = P.length;
    if(m < 2 || (closed && m < 3)) return null;
    const n = closed ? m : m - 1;
    const segs = [];
    for(let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % m], len = Math.hypot(b.x - a.x, b.y - a.y);
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, ox = -uy * d, oy = ux * d;
        segs.push({ ax: a.x + ox, ay: a.y + oy, bx: b.x + ox, by: b.y + oy, ux, uy });
    }
    const join = (s1, s2) => {
        const cr = s1.ux * s2.uy - s1.uy * s2.ux;
        if(Math.abs(cr) < 1e-9) return [{ x: s2.ax, y: s2.ay }]; // まっすぐ続く
        const t = ((s2.ax - s1.ax) * s2.uy - (s2.ay - s1.ay) * s2.ux) / cr;
        const ix = s1.ax + s1.ux * t, iy = s1.ay + s1.uy * t;
        if(Math.hypot(ix - s1.bx, iy - s1.by) > 4 * Math.abs(d)) return [{ x: s1.bx, y: s1.by }, { x: s2.ax, y: s2.ay }];
        return [{ x: ix, y: iy }];
    };
    const out = [];
    if(closed) { for(let i = 0; i < n; i++) out.push(...join(segs[(i - 1 + n) % n], segs[i])); }
    else {
        out.push({ x: segs[0].ax, y: segs[0].ay });
        for(let i = 1; i < n; i++) out.push(...join(segs[i - 1], segs[i]));
        out.push({ x: segs[n - 1].bx, y: segs[n - 1].by });
    }
    return out;
}
function createOffsetEntity(e, d, wx, wy) {
    const copy = JSON.parse(JSON.stringify(e));
    delete copy.bbox; // 元図形のbboxを引き継ぐとスナップ/描画カリングが誤判定する
    // オフセットで作った図形は独立した新しい図形（元のブロックのグループには入れない）
    delete copy.id; delete copy.gid; delete copy.blockName;
    if(e.type==='CIRCLE'||e.type==='ARC') {
        const dc = dist(e.cx, e.cy, wx, wy);
        if(dc > e.radius) copy.radius += d; else { copy.radius -= d; if(copy.radius<=0) return null; }
        return copy;
    } else if(e.type==='LINE') {
        const dx = e.x2 - e.x1, dy = e.y2 - e.y1, len = Math.sqrt(dx*dx+dy*dy);
        if(len === 0) return null; // 長さ0の線は方向が決まらない（NaN の図形を作らない）
        const nx = -dy/len, ny = dx/len; // 左側法線
        // クリック点が線分のどちら側か
        const vx = wx - e.x1, vy = wy - e.y1;
        const cross = dx*vy - dy*vx; // Z成分：正なら左側
        const sign = cross > 0 ? 1 : -1;
        copy.x1 += nx*d*sign; copy.y1 += ny*d*sign; copy.x2 += nx*d*sign; copy.y2 += ny*d*sign;
        return copy;
    } else if(e.type==='PLINE') {
        // 押した点に一番近い区間の、どちら側か（左なら +、右なら −）
        const P = e.points, n = e.closed ? P.length : P.length - 1;
        let best = Infinity, side = 1;
        for(let i = 0; i < n; i++) {
            const a = P[i], b = P[(i + 1) % P.length];
            const dd = distPointToSeg(wx, wy, a.x, a.y, b.x, b.y);
            if(dd < best) { best = dd; side = ((b.x - a.x) * (wy - a.y) - (b.y - a.y) * (wx - a.x)) >= 0 ? 1 : -1; }
        }
        const pts = offsetPolylinePoints(P, !!e.closed, d * side);
        if(!pts || pts.length < 2) return null;
        copy.points = pts;
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
    _bumpGeomEpoch();
    const rx = (x, y) => (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle) + cx;
    const ry = (x, y) => (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle) + cy;
    if(e.ins) { const ix = rx(e.ins.x, e.ins.y), iy = ry(e.ins.x, e.ins.y); e.ins.x = ix; e.ins.y = iy; } // ブロックの挿入点（測点の座標）
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
        e.points.forEach(p => { const nx = rx(p.x, p.y), ny = ry(p.x, p.y); p.x = nx; p.y = ny; });
    } else if(e.type === 'POINT' || e.type === 'TEXT') {
        const nx = rx(e.x, e.y), ny = ry(e.x, e.y);
        e.x = nx; e.y = ny;
        if(e.type === 'TEXT') e.rotation = (e.rotation || 0) + angle;
    } else if(e.type === 'DIMENSION') {
        // 測った点・引出線などの位置を回す（同じ点を2回回さないよう、回した点を覚えておく）
        const done = new Set();
        [e.p1, e.p2, e.center, e.vertex, e.arm1, e.arm2, e.point, e.leader, e.leaderX, e.leaderY, e.leaderCoord].forEach(p => {
            if(!p || done.has(p)) return;
            done.add(p);
            const nx = rx(p.x, p.y), ny = ry(p.x, p.y); p.x = nx; p.y = ny;
        });
        if(e.subType === 'LINEAR') e.dimRot = (e.dimRot || 0) + angle;          // 測る向き（横・縦）も一緒に回す
        if(e.subType === 'RADIUS' || e.subType === 'DIAMETER') e.angle = (e.angle || 0) + angle;
    } else if(e.type === 'HATCH') {
        if(e.target) rotateEntity(e.target, cx, cy, angle); // 塗りつぶしの範囲
    }
}

function finishPline(close) {
    if(cmdState.points.length>=2) { saveUndo(); entities.push({type:'PLINE',layer:currentLayerIndex,color:null,points:cmdState.points.slice(),closed:!!close}); addCommandLog(close?'-> ポリライン閉合':'-> ポリライン確定'); }
    else addCommandLog('-> キャンセル（点が不足）');
    resetCommand();
}

// 指定されたパス(線分群)と交差する図形をトリム(カット/単体削除)する
function executeTrim(trimPath) {
    if(!trimPath || trimPath.length === 0) return;
    
    // 点が1つしかない場合（タップだけの場合）も考慮して疑似パスを作成
    if(trimPath.length === 1) {
        trimPath = [trimPath[0], {x: trimPath[0].x + 0.001, y: trimPath[0].y + 0.001}];
    }

    saveUndo();
    let trimmedCount = 0;
    const swipeSegs = [];
    for(let i = 0; i < trimPath.length - 1; i++) {
        swipeSegs.push({x1: trimPath[i].x, y1: trimPath[i].y, x2: trimPath[i+1].x, y2: trimPath[i+1].y});
    }
    const isVisible = (e) => (e.layer === undefined || !layers[e.layer] || layers[e.layer].visible) && !e.hidden;
    
    let newEntities = [];
    let entitiesToRemove = [];

    // 画面スケールに合わせた判定許容距離 (WCS単位)
    const tolWcs = 15 / (view.scale || 1.0);

    entities.forEach((e, i) => {
        if(!isVisible(e)) return;
        let hitPt = null;

        // 各スワイプセグメントとのヒット判定
        for(const seg of swipeSegs) {
            if(e.type === 'LINE') {
                const pt = intersectLineLine(seg.x1, seg.y1, seg.x2, seg.y2, e.x1, e.y1, e.x2, e.y2);
                if(pt && isPointOnSegment(pt.x, pt.y, seg.x1, seg.y1, seg.x2, seg.y2) && isPointOnSegment(pt.x, pt.y, e.x1, e.y1, e.x2, e.y2)) {
                    hitPt = pt; break;
                }
                // 厳密な交差がない場合も、スワイプ点が線の近くを通ったかチェック
                const d1 = distPointToSeg(seg.x1, seg.y1, e.x1, e.y1, e.x2, e.y2);
                const d2 = distPointToSeg(seg.x2, seg.y2, e.x1, e.y1, e.x2, e.y2);
                if(d1 <= tolWcs || d2 <= tolWcs) {
                    hitPt = {x: (seg.x1 + seg.x2)/2, y: (seg.y1 + seg.y2)/2}; break;
                }
            } else if(e.type === 'CIRCLE' || e.type === 'ARC') {
                const pts = intersectSegCircle(seg.x1, seg.y1, seg.x2, seg.y2, e.cx, e.cy, e.radius);
                if(pts.length > 0) { hitPt = pts[0]; break; }
                const d1 = Math.abs(dist(seg.x1, seg.y1, e.cx, e.cy) - e.radius);
                if(d1 <= tolWcs) { hitPt = {x: seg.x1, y: seg.y1}; break; }
            } else if(e.type === 'PLINE' || e.type === 'RECTANG') {
                // ポリライン・長方形
                const pts = (e.type === 'RECTANG') ? [
                    {x:e.x1, y:e.y1}, {x:e.x2, y:e.y1}, {x:e.x2, y:e.y2}, {x:e.x1, y:e.y2}
                ] : e.points;
                if(pts && pts.length > 1) {
                    for(let k = 0; k < pts.length; k++) {
                        const pNext = pts[(k + 1) % pts.length];
                        if(!e.closed && k === pts.length - 1) break;
                        const pt = intersectLineLine(seg.x1, seg.y1, seg.x2, seg.y2, pts[k].x, pts[k].y, pNext.x, pNext.y);
                        if(pt && isPointOnSegment(pt.x, pt.y, seg.x1, seg.y1, seg.x2, seg.y2) && isPointOnSegment(pt.x, pt.y, pts[k].x, pts[k].y, pNext.x, pNext.y)) {
                            hitPt = pt; break;
                        }
                    }
                }
            }
        }

        if(!hitPt) return;

        // LINEのトリム処理
        if(e.type === 'LINE') {
            // 境界: 線・長方形・ポリライン・円・円弧（円弧は描かれている範囲のみ）
            // （以前は線と円だけが境界で、長方形やポリラインと交わる線はトリムすると線ごと消えていた）
            let allIntersections = [];
            entities.forEach(other => {
                if(e === other || !isVisible(other)) return;
                intersectSegWithEntity(e.x1, e.y1, e.x2, e.y2, other).forEach(pt => allIntersections.push(pt));
            });

            const dx = e.x2 - e.x1, dy = e.y2 - e.y1, len2 = dx*dx + dy*dy;
            const getT = (p) => len2 > 0 ? ((p.x - e.x1)*dx + (p.y - e.y1)*dy) / len2 : 0;

            allIntersections.push({x: e.x1, y: e.y1}, {x: e.x2, y: e.y2});
            allIntersections.sort((a, b) => getT(a) - getT(b));

            const uniqueInts = [];
            for(const pt of allIntersections) {
                if(uniqueInts.length === 0 || dist(uniqueInts[uniqueInts.length-1].x, uniqueInts[uniqueInts.length-1].y, pt.x, pt.y) > 0.0001) uniqueInts.push(pt);
            }

            // 他の線との交点が端点以外にない場合 -> 単体削除（消しゴム動作）
            if(uniqueInts.length <= 2) {
                entitiesToRemove.push(i);
                trimmedCount++;
            } else {
                const hitT = getT(hitPt);
                let t1Idx = -1, t2Idx = -1;
                for(let j = 0; j < uniqueInts.length - 1; j++) {
                    if(getT(uniqueInts[j]) - 0.001 <= hitT && hitT <= getT(uniqueInts[j+1]) + 0.001) {
                        t1Idx = j; t2Idx = j + 1; break;
                    }
                }
                if(t1Idx !== -1) {
                    entitiesToRemove.push(i);
                    // 残った部分は元の線の属性（画層・色・ブロックのグループ等）を引き継ぐ
                    const piece = (a, b) => {
                        const n = Object.assign({}, e, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
                        delete n.bbox; delete n.id;
                        return n;
                    };
                    if(t1Idx > 0) newEntities.push(piece(uniqueInts[0], uniqueInts[t1Idx]));
                    if(t2Idx < uniqueInts.length - 1) newEntities.push(piece(uniqueInts[t2Idx], uniqueInts[uniqueInts.length-1]));
                    trimmedCount++;
                } else {
                    // 万が一ヒット位置が特定できなければ単体削除
                    entitiesToRemove.push(i);
                    trimmedCount++;
                }
            }
        } else {
            // LINE以外（円やポリラインなど）でスワイプヒットした場合はそのまま削除
            entitiesToRemove.push(i);
            trimmedCount++;
        }
    });

    if(trimmedCount > 0) {
        entitiesToRemove.sort((a, b) => b - a).forEach(idx => entities.splice(idx, 1));
        newEntities.forEach(e => entities.push(e));
        addCommandLog(`-> ${trimmedCount} 個のオブジェクト/セグメントをトリム(消去)しました`);
        render();
    }
}

// なぞって延長する (EXTEND)
function executeExtend(extendPath) {
    if(!extendPath || extendPath.length === 0) return;
    if(extendPath.length === 1) {
        extendPath = [extendPath[0], {x: extendPath[0].x + 0.001, y: extendPath[0].y + 0.001}];
    }

    saveUndo();
    let extendedCount = 0;
    const swipeSegs = [];
    for(let i = 0; i < extendPath.length - 1; i++) {
        swipeSegs.push({x1: extendPath[i].x, y1: extendPath[i].y, x2: extendPath[i+1].x, y2: extendPath[i+1].y});
    }
    const isVisible = (e) => (e.layer === undefined || !layers[e.layer] || layers[e.layer].visible) && !e.hidden;
    const tolWcs = 20 / (view.scale || 1.0);

    entities.forEach((e) => {
        if(!isVisible(e) || e.type !== 'LINE') return; // LINE延長対応
        let hitPt = null;
        for(const seg of swipeSegs) {
            const pt = intersectLineLine(seg.x1, seg.y1, seg.x2, seg.y2, e.x1, e.y1, e.x2, e.y2);
            if(pt && isPointOnSegment(pt.x, pt.y, seg.x1, seg.y1, seg.x2, seg.y2) && isPointOnSegment(pt.x, pt.y, e.x1, e.y1, e.x2, e.y2)) {
                hitPt = pt; break;
            }
            const d1 = distPointToSeg(seg.x1, seg.y1, e.x1, e.y1, e.x2, e.y2);
            if(d1 <= tolWcs) { hitPt = {x: seg.x1, y: seg.y1}; break; }
        }
        if(!hitPt) return;

        // hitPt が始点(p1)と終点(p2)のどちらに近いかで延長方向を決定
        const dist1 = dist(hitPt.x, hitPt.y, e.x1, e.y1);
        const dist2 = dist(hitPt.x, hitPt.y, e.x2, e.y2);
        const isP1 = dist1 < dist2;
        const targetPt = isP1 ? {x: e.x1, y: e.y1} : {x: e.x2, y: e.y2};
        const len = dist(e.x1, e.y1, e.x2, e.y2);
        if(len === 0) return;
        const dir = isP1 ? -1 : 1; // 延長方向の係数
        const ux = (e.x2 - e.x1) / len * dir, uy = (e.y2 - e.y1) / len * dir; // 延長方向の単位ベクトル
        // 端点から延長方向へ十分長い線分（半直線の代わり）。公共座標（数十万m）でも届く長さにする
        const RAY = 1e8;
        const rx2 = targetPt.x + ux * RAY, ry2 = targetPt.y + uy * RAY;
        const minGap = len * 1e-9;

        let closestPt = null;
        let minT = Infinity;

        // 境界: 線・長方形・ポリライン・円・円弧（円弧は描かれている範囲のみ）
        entities.forEach(other => {
            if(e === other || !isVisible(other)) return;
            intersectSegWithEntity(targetPt.x, targetPt.y, rx2, ry2, other).forEach(pt => {
                const t = (pt.x - targetPt.x) * ux + (pt.y - targetPt.y) * uy; // 端点からの距離
                if(t > minGap && t < minT) { minT = t; closestPt = pt; }
            });
        });

        if(closestPt) {
            if(isP1) { e.x1 = closestPt.x; e.y1 = closestPt.y; }
            else { e.x2 = closestPt.x; e.y2 = closestPt.y; }
            delete e.bbox;
            _bumpGeomEpoch();
            extendedCount++;
        }
    });

    if(extendedCount > 0) {
        addCommandLog(`-> ${extendedCount} 本の線を延長しました`);
        render();
    }
}
window.executeTrim = executeTrim;
window.executeExtend = executeExtend;

function isPointOnSegment(px, py, x1, y1, x2, y2, tol = 0.001) { return distPointToSeg(px, py, x1, y1, x2, y2) <= tol; }

function processCommand(cmdText) {
    const cmd = cmdText.toUpperCase().trim();
    const coordMatch = cmd.match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
    // 「X,Y」の順（画面の座標表示と同じ。X＝北、Y＝東）。以前は「東,北」の順で、表示と逆になっていた
    if(coordMatch) { const X=parseFloat(coordMatch[1]), Y=parseFloat(coordMatch[3]); const w=ucsToWcs(Y, X); handlePointInput(w, true); return; }
    // 相対座標「@X,Y」: 直前に入力した点から、北へ X・東へ Y（並びは絶対座標と同じ）
    const relMatch = cmd.match(/^@\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
    if(relMatch) {
        const w = relativeCommandPoint(parseFloat(relMatch[3]), parseFloat(relMatch[1]));
        if(w && cmdState.mode !== 'IDLE') handlePointInput(w, true); else addCommandLog('-> 相対座標の基準になる点がありません（先に1点を入力してください）');
        return;
    }
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
            if (typeof _hideMeasureButtons === 'function') _hideMeasureButtons();
            
            const cancelBtn = document.getElementById('dim-cancel-btn');
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
    if(cmd==='TRIM' || cmd==='TR') {
        cmdState.mode = 'WAITING_TRIM';
        setPrompt('トリム: 消したい線をなぞってください');
        setActiveTool('TRIM');
        addCommandLog('-> トリム: 線をスワイプ（ドラッグ）して交点間でカットします');
    }
    else if(cmd==='EXTEND' || cmd==='EX') {
        cmdState.mode = 'WAITING_EXTEND';
        setPrompt('延長: 延長したい線をなぞってください');
        setActiveTool('EXTEND');
        addCommandLog('-> 延長: 線をスワイプ（ドラッグ）して一番近い交点まで延長します');
    }
    else if(cmd==='L'||cmd==='LINE') { cmdState.mode='WAITING_LINE_P1'; setPrompt('1点目:'); setActiveTool('LINE'); addCommandLog('-> 1点目を指定'); }
    else if(cmd==='C'||cmd==='CIRCLE') {
        materializeSizeDefault('radius', 40); // 一度も変えていなければ、画面に合った半径にする
        const isAuto = lastParams.circleMode === 'auto';
        const rVal = parseFloat(lastParams.radius) || 50;
        if (isAuto) {
            cmdState.presetRadius = rVal;
            cmdState.mode = 'WAITING_CIRCLE_CENTER';
            setPrompt(`円 (自動・半径${rVal}): 中心を指定 → 「確定」`);
            addCommandLog(`-> 円作図: 【固定半径 (自動: 半径${rVal})】 中心を指定して「確定」`);
        } else {
            cmdState.presetRadius = 0;
            cmdState.mode = 'WAITING_CIRCLE_CENTER';
            setPrompt('円 (手動): 中心を指定:');
            addCommandLog('-> 円作図: 【手動 (2点指定)】 中心を指定');
        }
        setActiveTool('CIRCLE');
        showActionbarControls({ showMode: true });
        updateCircleActionBar();
        showCirclePanel();
    }
    else if(cmd==='REC'||cmd==='RECTANG') {
        cmdState.mode='WAITING_RECT_P1'; setPrompt('1点目:'); setActiveTool('RECT'); addCommandLog('-> 1つ目の角を指定（または寸法を入力）');
        showPropertyPanel('長方形 設定', `
            <div class="prop-row"><label>幅:</label><input type="number" id="prop-rect-w" value="${lastParams.rectW || '100'}" placeholder="クリックで指定"></div>
            <div class="prop-row"><label>高さ:</label><input type="number" id="prop-rect-h" value="${lastParams.rectH || '50'}" placeholder="クリックで指定"></div>
            <button class="prop-btn" onclick="applyRectPreset()">この寸法で配置</button>
            <div style="color:#888;font-size:10px;margin-top:4px;">空欄なら2点クリックで作図</div>
        `);
    }
    else if(cmd==='A'||cmd==='ARC') { cmdState.mode='WAITING_ARC_P1'; cmdState.points=[]; setPrompt('始点:'); setActiveTool('ARC'); addCommandLog('-> 始点を指定'); }
    else if(cmd==='PL'||cmd==='PLINE') {
        cmdState.mode='WAITING_PLINE_NEXT'; cmdState.points=[]; setPrompt('始点:'); setActiveTool('PLINE'); addCommandLog('-> 始点を指定');
        // スマホでも完了できるよう、画面下に「☑確定（完了）」「⭘閉じる」「❌終了」を出す
        showActionbarControls({});
        const pc = document.getElementById('pline-close-btn'); if(pc) pc.style.display = '';
    }
    else if(cmd==='EL'||cmd==='ELLIPSE') { cmdState.mode='WAITING_ELLIPSE_CENTER'; setPrompt('中心:'); setActiveTool('ELLIPSE'); addCommandLog('-> 楕円の中心を指定'); }
    else if(cmd==='T'||cmd==='TEXT') { 
        cmdState.mode='WAITING_TEXT_INPUT'; 
        setPrompt('文字設定を入力'); 
        setActiveTool('TEXT'); 
        addCommandLog('-> 文字の内容と高さを設定');
        
        materializeSizeDefault('textHeight', 18); // 一度も変えていなければ、画面で読める大きさにする
        const lastH = lastParams.textHeight || 20;
        const lastStr = lastParams.textStr || 'テキスト';
        const lastCont = lastParams.textCont !== false;
        
        const html = `
            <div class="prop-row">
                <label>文字内容:</label>
                <input type="text" id="prop-text-val" value="${escapeHtml(lastStr)}" placeholder="入力...">
            </div>
            <div class="prop-row">
                <label>高さ:</label>
                <input type="number" id="prop-text-h" value="${lastH}" min="0.001" step="any">
            </div>
            <div class="prop-row">
                <label>連続配置:</label>
                <input type="checkbox" id="prop-text-cont" ${lastCont ? 'checked' : ''}>
            </div>
            <button class="prop-btn" onclick="startTextPlacement()">配置開始</button>
        `;
        showPropertyPanel('文字 設定', html);
    }
    else if(cmd==='H'||cmd==='HATCH') { cmdState.mode='WAITING_HATCH_SELECT'; setPrompt('閉じた図形を選択:'); setActiveTool('HATCH'); addCommandLog('-> 塗りつぶす閉じた図形を選択'); }
    else if(cmd==='E'||cmd==='ERASE') {
        // IDLE時の選択を引き継ぎ（タップで選んだ1図形も対象）
        _adoptIdleHighlight();
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
    else if(cmd==='GROUP'||cmd==='G') { window.groupSelection(); }
    else if(cmd==='UNGROUP'||cmd==='EXPLODE'||cmd==='X') { window.explodeSelection(); }
    else if(cmd==='BLOCKS'||cmd==='BLOCK') { window.showBlockManagerPanel(); }
    else if(cmd==='U'||cmd==='UNDO') { undo(); }
    else if(cmd==='REDO') { redo(); }
    else if(cmd==='ZE'||cmd==='ZOOM') { zoomExtents(); }
    else if(cmd==='CANCEL') {
        const wasCogo = typeof cogoIsPicking === 'function' && cogoIsPicking(); // 測量計算の点の指定中なら、やめたあとパネルに戻る
        // ポリラインは描いた部分を残して終わる（2点以上あるとき）
        if(cmdState.mode === 'WAITING_PLINE_NEXT' && cmdState.points.length >= 2) finishPline(false); else resetCommand();
        if(wasCogo) cogoPickCancelled();
    }
    else if(cmd==='ERRORS'||cmd==='ERRLOG') { if(window.cadErrors) window.cadErrors.show(); }
    else if(typeof processSurveyCommand === 'function' && processSurveyCommand(cmd)) { /* 測量コマンド（座標一覧・SIMA/CSV出力・GNSS）処理済み */ }
    else if(typeof processCogoCommand === 'function' && processCogoCommand(cmd)) { /* 測量計算（求積・逆計算・点の追加・交点）処理済み */ }
    else if(typeof processTsCommand === 'function' && processTsCommand(cmd)) { /* トータルステーション連携（TS・SDROUT）処理済み */ }
    else if(typeof processStorageCommand === 'function' && processStorageCommand(cmd)) { /* ストレージコマンド処理済み */ }
    else { addCommandLog(`不明なコマンドです "${cmdText}"`); resetCommand(); }
}


// ===== 全画面UI コールバック用関数（アクションバー） =====
// ポリラインの「⭘閉じる」
window.plineCloseFromBar = function() {
    if(cmdState.mode !== 'WAITING_PLINE_NEXT') return;
    if(cmdState.points.length >= 3) finishPline(true);
    else if(typeof showToast === 'function') showToast('閉じるには3点以上が必要です');
};
window.dimConfirmPoint = function() {
    if(cmdState.mode === 'WAITING_PLINE_NEXT') { finishPline(false); return; } // ポリラインの完了
    if(cmdState.mode.startsWith('WAITING_DIM')) {
        const pt = getInputPoint(); // スナップがあればスナップ座標、なければWCS座標
        // 寸法が確定した際にも振動フィードバック
        if(navigator.vibrate) navigator.vibrate(20);
        handlePointInput(pt, false);
    } else if(cmdState.mode === 'WAITING_CIRCLE_CENTER') {
        const pt = cmdState.startWcs || getInputPoint();
        const r = parseFloat(lastParams.radius) || 50;
        saveUndo();
        entities.push({type:'CIRCLE', layer:currentLayerIndex, color:null, cx:pt.x, cy:pt.y, radius:r});
        addCommandLog(`-> 円作成 半径: ${r.toFixed(2)} (続けて次の円の中心を指定可能)`);
        if(navigator.vibrate) navigator.vibrate(20);
        cmdState.mode = 'WAITING_CIRCLE_CENTER';
        cmdState.startWcs = null;
        cmdState.lastInputWcs = null;
        setPrompt(`次の円の中心を指定 (半径:${r}) [終了は❌]:`);
        showActionbarControls({ showMode: true });
        updateCircleActionBar();
        render();
    } else if(cmdState.mode === 'WAITING_CIRCLE_RADIUS') {
        const pt = cmdState.lastInputWcs || getInputPoint();
        const r = Math.max(0.1, dist(cmdState.startWcs.x, cmdState.startWcs.y, pt.x, pt.y));
        lastParams.radius = String(r.toFixed(2));
        saveLastParams();
        saveUndo();
        entities.push({type:'CIRCLE', layer:currentLayerIndex, color:null, cx:cmdState.startWcs.x, cy:cmdState.startWcs.y, radius:r});
        addCommandLog(`-> 円作成 半径: ${r.toFixed(2)} (続けて次の円を配置可能)`);
        if(navigator.vibrate) navigator.vibrate(20);
        cmdState.mode = 'WAITING_CIRCLE_CENTER'; // ★連続配置
        cmdState.startWcs = null;
        cmdState.lastInputWcs = null;
        setPrompt('次の円の中心を指定 (終了は❌):');
        showActionbarControls({ showMode: true });
        updateCircleActionBar();
        render();
    } else if(cmdState.mode === 'WAITING_TEXT_PLACE') {
        const pt = cmdState.previewWcs || getInputPoint();
        saveUndo();
        entities.push({type:'TEXT', layer:currentLayerIndex, color:null, x:pt.x, y:pt.y, text:cmdState.textStr, height:cmdState.textHeight});
        addCommandLog(`-> テキスト配置: "${cmdState.textStr}" (続けてタップで配置可能)`);
        if(navigator.vibrate) navigator.vibrate(20);
        setPrompt('次の配置点をタップ → 「確定」 (終了は❌):');
        showActionbarControls({ showMode: false });
        render();
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

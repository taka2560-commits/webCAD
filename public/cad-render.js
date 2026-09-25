// ===== Web CAD 画面描画 =====
// cad-render.js - 描画の呼び出し管理（rAF）、画面操作中の描画キャッシュ、ルーペ、
//                 図形・軸・ラバーバンド・スナップ記号・十字カーソルの描画
// （cad-core.js から分割。ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

// ===== 描画 =====
let _renderPending = false;
let _renderFull = false; // 次のフレームで図形も描き直す必要があるか
function _requestFrame() {
    if(_renderPending) return;
    _renderPending = true;
    requestAnimationFrame(() => {
        _renderPending = false;
        const full = _renderFull;
        _renderFull = false;
        _drawFrame(!full);
    });
}
// 画面全体（図形を含む）を描き直す
function render() {
    _renderFull = true;
    _requestFrame();
}
// カーソル・スナップ記号・ルーペ・範囲選択枠など「上に重ねる表示」だけが変わったときの描画要求。
// 図形の描画に時間がかかる図面では、前回描いた図形の画面をそのまま使い、重ね表示だけ描き直す。
// （マウスや指を動かすたびに全図形を描き直していたのを避ける。図形・表示位置・選択が変わったら render() を使う）
function renderOverlay() {
    _requestFrame();
}
// ===== 画面操作中の描画キャッシュ =====
// 大きな図面では全図形の描画に時間がかかり、ピンチやホイールで画面を動かすとカクつく。
// そこで、描画に GESTURE_CACHE_MIN_MS 以上かかる図面に限り、図形を描き終えた時点の画面を保存しておき、
// 画面操作中はそれを拡大縮小・移動して見せる（地図アプリと同じ方式）。操作が終わったら正確に描き直す。
// 軽い図面では従来どおり毎回すべて描く。
const GESTURE_CACHE_MIN_MS = 12;
let _frameCache = null;   // { canvas, x, y, scale, rot, w, h, epoch, bg }
let _lastBaseMs = 0;      // 直近のフル描画で図形の描画にかかった時間
let _viewGestureUntil = 0;
let _viewGestureTimer = null;
// 画面操作（ホイール・ズームスライダー等）の途中であることを知らせる。最後の操作から holdMs 後に正確に描き直す
function noteViewGesture(holdMs) {
    const hold = holdMs || 160;
    _viewGestureUntil = performance.now() + hold;
    clearTimeout(_viewGestureTimer);
    _viewGestureTimer = setTimeout(() => { _viewGestureTimer = null; render(); }, hold + 20);
}
window.noteViewGesture = noteViewGesture;
function _isViewGestureActive() {
    return !!(touchState.isPinch || mouse.isPanning || performance.now() < _viewGestureUntil);
}
// 図形の見た目に影響する状態（選択・ハイライト・画層の表示/色・薄表示・UCS）の要約
function _baseSignature() {
    let s = cmdState.highlightIdx + '|' + (cmdState.selectedIndices || []).join(',') + '|' + (window.ghostLayerMode ? 1 : 0) +
        '|' + ucs.originX + ',' + ucs.originY + ',' + ucs.angle + '|';
    for(let i = 0; i < layers.length; i++) s += (layers[i].visible ? '1' : '0') + layers[i].color + ';';
    return s;
}
function _canUseFrameCache() {
    const fc = _frameCache;
    return !!(fc && _lastBaseMs >= GESTURE_CACHE_MIN_MS && fc.rot === view.rotation && fc.w === canvas.width && fc.h === canvas.height &&
        fc.epoch === _geomEpoch && fc.bg === canvasBg && fc.scale > 0 && fc.sig === _baseSignature());
}
// 表示位置も含めて前回と同じ画面か（重ね表示だけの描き直しに使えるか）
function _canReuseStaticFrame() {
    const fc = _frameCache;
    return _canUseFrameCache() && fc.x === view.x && fc.y === view.y && fc.scale === view.scale;
}
function _saveFrameCache() {
    let fc = _frameCache;
    if(!fc) {
        const c = document.createElement('canvas');
        fc = _frameCache = { canvas: c, cctx: c.getContext('2d') };
    }
    if(fc.canvas.width !== canvas.width || fc.canvas.height !== canvas.height) { fc.canvas.width = canvas.width; fc.canvas.height = canvas.height; }
    if(!fc.cctx) return;
    fc.cctx.clearRect(0, 0, canvas.width, canvas.height);
    fc.cctx.drawImage(canvas, 0, 0);
    fc.x = view.x; fc.y = view.y; fc.scale = view.scale; fc.rot = view.rotation;
    fc.w = canvas.width; fc.h = canvas.height; fc.epoch = _geomEpoch; fc.bg = canvasBg; fc.sig = _baseSignature();
}

// 1フレーム分の描画（同期）。render() が requestAnimationFrame から呼ぶ。計測・テストからも直接呼べる
// overlayOnly: 重ね表示だけが変わった描画要求（renderOverlay）。前回と同じ画面なら図形を描き直さない
function _drawFrame(overlayOnly) {
        // 描画の状態を毎回初期に戻す（どこかで ctx.save() と restore() の数がずれても、点線・移動・透明度が
        // 次のコマの図形に残らないように。以前、座標寸法のプレビューの点線が残り、図面の線がすべて点線になった）
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.setLineDash([]); ctx.globalAlpha = 1;
        if(overlayOnly && _canReuseStaticFrame()) {
            // 図形・表示位置が前回と同じ: 保存した画面を貼るだけ（背景・軸・図形・寸法を含む）
            ctx.drawImage(_frameCache.canvas, 0, 0);
        } else if(_isViewGestureActive() && _canUseFrameCache()) {
            // 画面操作中: 保存した画面を今の拡大率・位置に合わせて貼る（見えていなかった部分は操作後に描かれる）
            const fc = _frameCache, k = view.scale / fc.scale;
            ctx.fillStyle=canvasBg; ctx.fillRect(0,0,canvas.width,canvas.height);
            ctx.drawImage(fc.canvas, view.x - fc.x * k, view.y - fc.y * k, canvas.width * k, canvas.height * k);
            drawAxes();
        } else {
        ctx.fillStyle=canvasBg; ctx.fillRect(0,0,canvas.width,canvas.height);
        const _t0 = performance.now();
        if(typeof drawUnderlays === 'function') drawUnderlays(); // 背景の地図・下絵（図形の下）
        drawAxes(); drawEntities(); drawDimensions();
        _lastBaseMs = performance.now() - _t0;
        if(_lastBaseMs >= GESTURE_CACHE_MIN_MS) _saveFrameCache();
        else if(_frameCache) _frameCache = null; // 軽い図面ではキャッシュ用のメモリを持たない
        }
        drawRubberBand(); drawSnapMarker(); drawCrosshair();
        if(typeof drawSurveyOverlays === 'function') drawSurveyOverlays(); // 現在地（GNSS）・一覧で選んだ点の目印
        if(typeof drawMeasureOverlay === 'function') drawMeasureOverlay(); // 基点測定（基点からのX・Y・直線距離）
        if(typeof drawCogoOverlay === 'function') drawCogoOverlay(); // 測量計算（指定した点・補助線・計算した点）
        if(typeof drawHelmOverlay === 'function') drawHelmOverlay(); // ヘルマート変換（張り合わせ点・変換後の点）
        if(typeof drawTsOverlay === 'function') drawTsOverlay(); // TS から受信した、取り込み前の点
        if(typeof drawStakeOverlay === 'function') drawStakeOverlay(); // 杭打ち（順番の杭・済み・いまの杭・案内の線）
        if(typeof drawPrintOverlay === 'function') drawPrintOverlay(); // 印刷の枠（用紙・表題欄・方位記号の場所）
        if(typeof drawUnderlayOverlay === 'function') drawUnderlayOverlay(); // 下絵を2点で合わせる途中の印
        if(typeof drawPhotoPins === 'function') drawPhotoPins(); // 現場写真・メモのピン
        if(typeof drawEditOverlay === 'function') drawEditOverlay(); // 鏡像・尺度変更・配列などの途中の形
        if(typeof drawGripOverlay === 'function') drawGripOverlay(); // 選んだ図形のグリップ（点を動かす）
        
        // 範囲選択矩形描画
        drawSelectionRect();

        // トリム・延長パス描画
        if((cmdState.mode === 'WAITING_TRIM' || cmdState.mode === 'WAITING_EXTEND') && cmdState.trimPath && cmdState.trimPath.length > 0) {
            ctx.strokeStyle = cmdState.mode === 'WAITING_EXTEND' ? '#33ff99' : '#ff6b6b';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            const first = wcsToScreen(cmdState.trimPath[0].x, cmdState.trimPath[0].y);
            ctx.moveTo(first.x, first.y);
            for(let i=1; i<cmdState.trimPath.length; i++) {
                const pt = wcsToScreen(cmdState.trimPath[i].x, cmdState.trimPath[i].y);
                ctx.lineTo(pt.x, pt.y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // ルーペ（拡大鏡）描画
        drawLoupe();
        if(typeof drawPrefPreview === 'function') drawPrefPreview(); // 設定を変えた直後の見本（ルーペ・吸着範囲）

        // ズームスライダーの位置同期
        if(window.updateZoomSlider) window.updateZoomSlider();
}
function renderImmediate() {
    render();
}

// ルーペ（拡大鏡）描画。大きさ・倍率はオプションの「表示・操作」で変えられる
function drawLoupe() {
    if(touchState.showLoupe) _drawLoupeAt(touchState.loupeX, touchState.loupeY, null);
}
// (lx, ly) の周りを拡大して描く。box（ルーペの中心）を省略すると指の上に出す
function _drawLoupeAt(lx, ly, box) {
    const loupeR = displayPref('loupeSize') || 70; // ルーペの半径（既定 70px）
    const zoom = displayPref('loupeZoom') || 3;    // 拡大倍率（既定 3倍）
    const loupeX = box ? box.x : Math.max(loupeR + 5, Math.min(canvas.width - loupeR - 5, lx));
    const finalY = box ? box.y : Math.max(loupeR + 5, ly - loupeR * 2); // 指で隠れないよう、半径の2倍だけ上に表示

    ctx.save();
    ctx.beginPath();
    ctx.rect(loupeX - loupeR, finalY - loupeR, loupeR * 2, loupeR * 2);
    ctx.clip();

    ctx.fillStyle = '#111';
    ctx.fillRect(loupeX - loupeR, finalY - loupeR, loupeR * 2, loupeR * 2);

    ctx.translate(loupeX, finalY);
    ctx.scale(zoom, zoom);
    ctx.translate(-lx, -ly);

    const ws = wcsToScreen(0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, ws.y); ctx.lineTo(canvas.width, ws.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ws.x, 0); ctx.lineTo(ws.x, canvas.height); ctx.stroke();

    ctx.lineWidth = 0.5;
    const isVisible = (e) => (e.layer === undefined || !layers[e.layer] || layers[e.layer].visible) && !e.hidden;
    const hl = cmdState.highlightIdx;
    // ルーペに映るのは指の周り（画面上で半径 loupeR/zoom）だけなので、その範囲の図形に絞る
    const half = loupeR / zoom + 4;
    const corners = [screenToWcs(lx - half, ly - half), screenToWcs(lx + half, ly - half), screenToWcs(lx - half, ly + half), screenToWcs(lx + half, ly + half)];
    const qMinX = Math.min(...corners.map(p => p.x)), qMaxX = Math.max(...corners.map(p => p.x));
    const qMinY = Math.min(...corners.map(p => p.y)), qMaxY = Math.max(...corners.map(p => p.y));
    _forEachCandidate(qMinX, qMinY, qMaxX, qMaxY, (e, i) => {
        if(!isVisible(e) || e.type === 'DIMENSION') return;
        const b = e.bbox;
        if(b && (b.maxX < qMinX || b.minX > qMaxX || b.maxY < qMinY || b.minY > qMaxY)) return;
        drawOneEntity(e, i === hl ? '#ff6b6b' : null);
    });

    if(snapActive()) {
        const s = wcsToScreen(snapResult.wcsX, snapResult.wcsY);
        drawSnapGuides({ currentOnly: true, px: 1 / zoom }); // 延長を使っているときの補助線（ルーペの中）
        ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 1.5;
        drawSnapShape(snapResult.type, s.x, s.y, 6);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.strokeStyle = 'rgba(255,255,0,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(loupeX - loupeR, finalY); ctx.lineTo(loupeX + loupeR, finalY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(loupeX, finalY - loupeR); ctx.lineTo(loupeX, finalY + loupeR); ctx.stroke();

    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.strokeRect(loupeX - loupeR, finalY - loupeR, loupeR * 2, loupeR * 2);

    // ルーペの下の座標。スナップしているときは、確定で入力される点（スナップ点）の座標を出す
    const snapping = !box && snapActive();
    const p = snapping ? { x: snapResult.wcsX, y: snapResult.wcsY } : screenToWcs(lx, ly);
    const ucsCoord = wcsToUcs(p.x, p.y);
    const fs = Math.max(8, Math.round(11 * (displayPref('coordFont') || 1))); // 座標の文字（既定 11px）
    const lineH = fs + 5;
    const text = `X:${formatCoordValue(ucsCoord.y, 'loupe')}  Y:${formatCoordValue(ucsCoord.x, 'loupe')}`;
    ctx.font = fs + 'px monospace';
    const tw = Math.max(loupeR * 2, ctx.measureText(text).width + 12); // 桁が多いときは帯を広げる
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(loupeX - tw / 2, finalY + loupeR + 2, tw, snapping ? lineH * 2 + 4 : lineH + 4);
    ctx.fillStyle = '#00ff88'; ctx.textAlign = 'center';
    ctx.fillText(text, loupeX, finalY + loupeR + lineH);
    if(snapping) {
        ctx.fillStyle = '#ffff00'; ctx.font = 'bold ' + fs + 'px monospace';
        const cyc = snapResult.count > 1 ? ` (${snapResult.index + 1}/${snapResult.count})` : ''; // 重なった候補の数
        ctx.fillText(`SNAP: ${snapResult.type}${cyc}`, loupeX, finalY + loupeR + lineH * 2);
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
    const isWindow = ex >= sx;

    ctx.save();
    if(isWindow) {
        ctx.strokeStyle = '#3399ff'; ctx.fillStyle = 'rgba(51,153,255,0.15)';
        ctx.setLineDash([]);
    } else {
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
    ctx.strokeStyle = outdoorColor(adjustColorForBg(color || getEntityColor(e))); ctx.lineWidth = lineWidthPx(1); // 屋外モードでは太く・明るさの差を広げる
    if(e.type==='LINE') { const a=wcsToScreen(e.x1,e.y1),b=wcsToScreen(e.x2,e.y2); ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke(); }
    else if(e.type==='CIRCLE') { const c=wcsToScreen(e.cx,e.cy); ctx.beginPath();ctx.arc(c.x,c.y,e.radius*view.scale,0,Math.PI*2);ctx.stroke(); }
    // 画面上の角度 = -(図面の角度 + 画面の回転)（以前は回転を逆向きに足していて、PLAN で円弧がずれていた）
    // 図面の反時計回り＝キャンバスの anticlockwise（y が逆向きのため）。以前は逆で、円弧の残りの側が描かれていた
    else if(e.type==='ARC') { const c=wcsToScreen(e.cx,e.cy); ctx.beginPath();ctx.arc(c.x,c.y,e.radius*view.scale,-e.startAngle - view.rotation,-e.endAngle - view.rotation,e.counterclockwise !== false);ctx.stroke(); }
    else if(e.type==='RECTANG') { 
        const p1=wcsToScreen(e.x1,e.y1), p2=wcsToScreen(e.x2,e.y1);
        const p3=wcsToScreen(e.x2,e.y2), p4=wcsToScreen(e.x1,e.y2);
        ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y); ctx.lineTo(p4.x,p4.y); ctx.closePath(); ctx.stroke();
    }
    else if(e.type==='PLINE'&&e.points.length>1) { ctx.beginPath(); const f=wcsToScreen(e.points[0].x,e.points[0].y); ctx.moveTo(f.x,f.y); for(let i=1;i<e.points.length;i++){const p=wcsToScreen(e.points[i].x,e.points[i].y);ctx.lineTo(p.x,p.y);} if(e.closed)ctx.closePath(); ctx.stroke(); }
    else if(e.type==='POINT') { const r=4; const p=wcsToScreen(e.x,e.y); ctx.beginPath();ctx.arc(p.x,p.y,r*0.4,0,Math.PI*2);ctx.stroke(); ctx.beginPath();ctx.moveTo(p.x-r,p.y);ctx.lineTo(p.x+r,p.y);ctx.moveTo(p.x,p.y-r);ctx.lineTo(p.x,p.y+r);ctx.stroke(); }
    else if(e.type==='ELLIPSE') {
        const c=wcsToScreen(e.cx,e.cy);
        ctx.beginPath(); ctx.ellipse(c.x, c.y, e.rx*view.scale, e.ry*view.scale, -(e.rotation || 0) - view.rotation, 0, Math.PI*2); ctx.stroke();
    }
    else if(e.type==='TEXT') {
        const p=wcsToScreen(e.x,e.y);
        const px=(e.height||10)*view.scale;
        ctx.font = `${outdoorFontWeight()}${px}px sans-serif`;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.save();
        ctx.translate(p.x, p.y);
        if(view.rotation !== 0) ctx.rotate(-view.rotation);
        if(e.rotation) ctx.rotate(-e.rotation); // 文字自体の回転（DXFの回転角・ROTATEコマンド）
        // DXF/DWGインポート時の文字整列を反映（未指定なら従来通り左・ベースライン基準）
        ctx.textAlign = (e.halign === 'center' || e.halign === 'right') ? e.halign : 'left';
        ctx.textBaseline = (e.valign === 'top') ? 'top' : (e.valign === 'middle') ? 'middle' : 'alphabetic';
        // MTEXT由来の改行(\n)を複数行として描画
        String(e.text).split('\n').forEach((line, i) => { outdoorTextHalo(ctx, line, 0, i * px * 1.4, px); ctx.fillText(line, 0, i * px * 1.4); });
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


// ===== 図形の描画（大きな図面向けに軽量化） =====
// ・同じ色・同じ透明度で続く線系の図形は1本のパスにまとめて stroke する（stroke 回数が図形数→色の切替回数に減る）
// ・画面上で1ピクセルに満たない図形は点として描く（全体表示で細かい図形を1つずつ描かない）
// ・ポリラインは画面上で0.5ピクセル未満しか動かない頂点を省く
// ・文字は小さすぎて読めない大きさでは点・線で簡略表示する（fillText は重い）
// ・背景に合わせた色の補正結果は色ごとに覚えておく
const _strokeColorCache = new Map();
let _strokeColorCacheBg = null;
function _strokeColorFor(col) {
    const key = canvasBg + (isOutdoor() ? '|outdoor' : ''); // 屋外モードでは背景との明るさの差を広げた色
    if(_strokeColorCacheBg !== key) { _strokeColorCache.clear(); _strokeColorCacheBg = key; }
    let c = _strokeColorCache.get(col);
    if(c === undefined) { c = outdoorColor(adjustColorForBg(col)); _strokeColorCache.set(col, c); }
    return c;
}
const TEXT_DOT_PX = 1;    // これ未満の文字は点
const TEXT_GREEK_PX = 3;  // これ未満の文字は文字列の長さの線（読めない大きさ）
function _approxTextWidth(text, px) {
    let w = 0;
    for(let k = 0; k < text.length; k++) w += text.charCodeAt(k) > 0xff ? 1.0 : 0.6;
    return w * px;
}
function drawEntities() {
    ctx.save();
    ctx.lineWidth = lineWidthPx(1); // 屋外モードでは2倍
    const fontWeight = outdoorFontWeight(); // 屋外モードでは文字を太字にして縁取る
    const selSet = new Set(cmdState.selectedIndices || []);
    const hlIdx = cmdState.highlightIdx;
    const ghost = !!window.ghostLayerMode;
    const baseTransform = ctx.getTransform();

    // カリング用の画面の表示範囲 (WCS座標)。100ピクセルずつ余裕をもたせる
    const tl = screenToWcs(-100, -100);
    const tr = screenToWcs(canvas.width + 100, -100);
    const bl = screenToWcs(-100, canvas.height + 100);
    const br = screenToWcs(canvas.width + 100, canvas.height + 100);
    const viewMinX = Math.min(tl.x, tr.x, bl.x, br.x);
    const viewMaxX = Math.max(tl.x, tr.x, bl.x, br.x);
    const viewMinY = Math.min(tl.y, tr.y, bl.y, br.y);
    const viewMaxY = Math.max(tl.y, tr.y, bl.y, br.y);

    // WCS→画面の変換（wcsToScreen と同じ式。頂点の多いポリライン用にオブジェクトを作らず計算する）
    const sc = view.scale, vx = view.x, vy = view.y;
    const rot = view.rotation, rc = Math.cos(rot), rs = Math.sin(rot), rotated = rot !== 0;
    const TX = rotated ? (x, y) => (x * rc - y * rs) * sc + vx : (x) => x * sc + vx;
    const TY = rotated ? (x, y) => -(x * rs + y * rc) * sc + vy : (x, y) => -y * sc + vy;

    let batchOpen = false, batchColor = null, batchAlpha = 1;
    const flush = () => { if(batchOpen) { ctx.stroke(); batchOpen = false; } };
    const begin = (color, alpha) => {
        if(batchOpen && color === batchColor && alpha === batchAlpha) return;
        flush();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        batchColor = color; batchAlpha = alpha;
        ctx.beginPath();
        batchOpen = true;
    };
    let lastFont = null, lastAlign = null, lastBaseline = null;

    const n = entities.length;
    for(let i = 0; i < n; i++) {
        const e = entities[i];
        if(!e || e.hidden) continue;
        const lyrVisible = e.layer === undefined || !layers[e.layer] || layers[e.layer].visible;
        if(!lyrVisible && !ghost) continue; // ghostLayerModeがOFFで画層非表示なら描画をスキップ
        if(e.type === 'DIMENSION') continue;

        // BBoxカリング（事前計算＆画面外をスキップ）
        if(e.bbox === undefined && e.type !== 'HATCH') e.bbox = calcBBox(e);
        const bb = e.bbox;
        if(bb && (bb.maxX < viewMinX || bb.minX > viewMaxX || bb.maxY < viewMinY || bb.minY > viewMaxY)) continue;

        const alpha = lyrVisible ? 1 : 0.15; // 非表示レイヤーはうっすら（15%不透明度）表示
        let raw = null;
        if(lyrVisible) {
            if(i === hlIdx) raw = '#ff6b6b';
            else if(selSet.has(i)) raw = '#ffaa33'; // 複数選択時はオレンジ
        }
        const color = _strokeColorFor(raw || getEntityColor(e));
        const t = e.type;

        // 画面上で1ピクセルに満たない図形（全体表示時の細かい記号など）は点として描く（POINT は画面上で一定の大きさの記号なので対象外）
        if(bb && t !== 'TEXT' && t !== 'HATCH' && t !== 'POINT' && (bb.maxX - bb.minX) * sc < 1 && (bb.maxY - bb.minY) * sc < 1) {
            const mx = (bb.minX + bb.maxX) / 2, my = (bb.minY + bb.maxY) / 2;
            const px = TX(mx, my), py = TY(mx, my);
            begin(color, alpha); ctx.moveTo(px, py); ctx.lineTo(px + 1, py);
            continue;
        }

        if(t === 'LINE') {
            begin(color, alpha);
            ctx.moveTo(TX(e.x1, e.y1), TY(e.x1, e.y1)); ctx.lineTo(TX(e.x2, e.y2), TY(e.x2, e.y2));
        } else if(t === 'CIRCLE') {
            begin(color, alpha);
            const cx = TX(e.cx, e.cy), cy = TY(e.cx, e.cy), r = e.radius * sc;
            ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        } else if(t === 'ARC') {
            begin(color, alpha);
            const cx = TX(e.cx, e.cy), cy = TY(e.cx, e.cy), r = e.radius * sc;
            const a0 = -e.startAngle - rot, a1 = -e.endAngle - rot;
            ctx.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
            ctx.arc(cx, cy, r, a0, a1, e.counterclockwise !== false);
        } else if(t === 'RECTANG') {
            begin(color, alpha);
            ctx.moveTo(TX(e.x1, e.y1), TY(e.x1, e.y1)); ctx.lineTo(TX(e.x2, e.y1), TY(e.x2, e.y1));
            ctx.lineTo(TX(e.x2, e.y2), TY(e.x2, e.y2)); ctx.lineTo(TX(e.x1, e.y2), TY(e.x1, e.y2)); ctx.closePath();
        } else if(t === 'PLINE') {
            const pts = e.points;
            if(!pts || pts.length < 2) continue;
            begin(color, alpha);
            let lx = TX(pts[0].x, pts[0].y), ly = TY(pts[0].x, pts[0].y);
            ctx.moveTo(lx, ly);
            const last = pts.length - 1;
            for(let k = 1; k <= last; k++) {
                const p = pts[k];
                const x = TX(p.x, p.y), y = TY(p.x, p.y);
                const dx = x - lx, dy = y - ly;
                if(k < last && dx * dx + dy * dy < 0.25) continue; // 0.5px 未満の移動は省く（最後の頂点は必ず描く）
                ctx.lineTo(x, y); lx = x; ly = y;
            }
            if(e.closed) ctx.closePath();
        } else if(t === 'ELLIPSE') {
            begin(color, alpha);
            const cx = TX(e.cx, e.cy), cy = TY(e.cx, e.cy), th = -(e.rotation || 0) - rot;
            ctx.moveTo(cx + e.rx * sc * Math.cos(th), cy + e.rx * sc * Math.sin(th));
            ctx.ellipse(cx, cy, e.rx * sc, e.ry * sc, th, 0, Math.PI * 2);
        } else if(t === 'POINT') {
            begin(color, alpha);
            const r = 4, px = TX(e.x, e.y), py = TY(e.x, e.y);
            ctx.moveTo(px + r * 0.4, py); ctx.arc(px, py, r * 0.4, 0, Math.PI * 2);
            ctx.moveTo(px - r, py); ctx.lineTo(px + r, py); ctx.moveTo(px, py - r); ctx.lineTo(px, py + r);
        } else if(t === 'TEXT') {
            const px = (e.height || 10) * sc;
            const ax = TX(e.x, e.y), ay = TY(e.x, e.y);
            if(px < TEXT_DOT_PX) { begin(color, alpha); ctx.moveTo(ax, ay); ctx.lineTo(ax + 1, ay); continue; }
            const text = String(e.text);
            const ang = -(rot + (e.rotation || 0)); // 画面上の文字の向き（drawOneEntity と同じ回転）
            if(px < TEXT_GREEK_PX) {
                // 読めない大きさの文字は、文字列の長さの線で表す（CADの簡易文字表示と同じ考え方）
                const firstLine = text.split('\n')[0];
                const w = _approxTextWidth(firstLine, px);
                const off = e.halign === 'center' ? -w / 2 : e.halign === 'right' ? -w : 0;
                const ux = Math.cos(ang), uy = Math.sin(ang);
                begin(color, alpha);
                ctx.moveTo(ax + ux * off, ay + uy * off); ctx.lineTo(ax + ux * (off + w), ay + uy * (off + w));
                continue;
            }
            flush();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;
            const font = fontWeight + px + 'px sans-serif';
            if(font !== lastFont) { ctx.font = font; lastFont = font; }
            // DXF/DWGインポート時の文字整列を反映（未指定なら従来通り左・ベースライン基準）
            const align = (e.halign === 'center' || e.halign === 'right') ? e.halign : 'left';
            const baseline = (e.valign === 'top') ? 'top' : (e.valign === 'middle') ? 'middle' : 'alphabetic';
            if(align !== lastAlign) { ctx.textAlign = align; lastAlign = align; }
            if(baseline !== lastBaseline) { ctx.textBaseline = baseline; lastBaseline = baseline; }
            ctx.translate(ax, ay);
            if(ang !== 0) ctx.rotate(ang);
            if(text.indexOf('\n') < 0) { outdoorTextHalo(ctx, text, 0, 0, px); ctx.fillText(text, 0, 0); }
            else text.split('\n').forEach((line, li) => { outdoorTextHalo(ctx, line, 0, li * px * 1.4, px); ctx.fillText(line, 0, li * px * 1.4); }); // MTEXT由来の改行
            ctx.setTransform(baseTransform);
        } else {
            // 塗り（HATCH）など: 個別に描く
            flush();
            ctx.save();
            ctx.globalAlpha = alpha;
            drawOneEntity(e, raw);
            ctx.restore();
            lastFont = lastAlign = lastBaseline = null;
        }
    }
    flush();
    ctx.restore();
}
// 寸法描画は cad-dimension.js の drawDimensions() へ委譲
function drawDimensions() { if(typeof drawAllDimensions==='function') drawAllDimensions(); }

function drawRubberBand() {
    ctx.save(); ctx.strokeStyle=isLightCanvasBg()?'rgba(0,0,0,0.5)':'rgba(255,255,255,0.5)'; ctx.setLineDash([6,4]); ctx.lineWidth=lineWidthPx(1, 1.5);
    const m=cmdState.mode, sw=cmdState.startWcs, mp={x:mouse.wcsX,y:mouse.wcsY};
    if(m==='WAITING_LINE_P2'&&sw) { const a=wcsToScreen(sw.x,sw.y),b=wcsToScreen(mp.x,mp.y); ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke(); }
    else if(m==='WAITING_CIRCLE_RADIUS'&&sw) { 
        const pt = cmdState.lastInputWcs || mp;
        const c=wcsToScreen(sw.x,sw.y), r=dist(sw.x,sw.y,pt.x,pt.y)*view.scale; 
        ctx.beginPath();ctx.arc(c.x,c.y,r,0,Math.PI*2);ctx.stroke(); 
    }
    else if(m==='WAITING_CIRCLE_CENTER' && lastParams.circleMode === 'auto') {
        const center = sw || mp;
        const c = wcsToScreen(center.x, center.y);
        const r = (parseFloat(lastParams.radius) || 50) * view.scale;
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI*2); ctx.stroke();
        if(sw) {
            ctx.fillStyle = '#00ff88';
            ctx.fillRect(c.x - 3, c.y - 3, 6, 6);
        }
    }
    else if(m==='WAITING_RECT_P2'&&sw) { const a=wcsToScreen(sw.x,sw.y),b=wcsToScreen(mp.x,mp.y); ctx.beginPath();ctx.rect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y));ctx.stroke(); }
    else if(m==='WAITING_ARC_P3'&&cmdState.points.length===2) {
        const p1=cmdState.points[0],p2=cmdState.points[1],p3=mp;
        const cc=circumcenter(p1.x,p1.y,p2.x,p2.y,p3.x,p3.y);
        if(cc){ const r=dist(cc.x,cc.y,p1.x,p1.y),sa=Math.atan2(p1.y-cc.y,p1.x-cc.x),ea=Math.atan2(p3.y-cc.y,p3.x-cc.x),ma=Math.atan2(p2.y-cc.y,p2.x-cc.x); const ccw=isAngleBetweenCCW(ma,sa,ea); const sc=wcsToScreen(cc.x,cc.y); ctx.beginPath();ctx.arc(sc.x,sc.y,r*view.scale,-sa-view.rotation,-ea-view.rotation,ccw);ctx.stroke(); }
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
        ctx.beginPath(); ctx.ellipse(c.x, c.y, rx*view.scale, ry*view.scale, -rot - view.rotation, 0, Math.PI*2); ctx.stroke();
    }
    else if(m==='WAITING_TEXT_PLACE' && cmdState.textStr) {
        const targetPt = cmdState.previewWcs || mp;
        const p = wcsToScreen(targetPt.x, targetPt.y);
        ctx.save();
        ctx.font = `${cmdState.textHeight * view.scale}px sans-serif`;
        ctx.fillStyle = 'rgba(0, 255, 136, 0.8)';
        
        // UCSに合わせて回転してプレビュー
        ctx.translate(p.x, p.y);
        ctx.rotate(-view.rotation);
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'left';
        ctx.fillText(cmdState.textStr, 0, 0);
        
        // プレビュー基準点マーカー
        ctx.strokeStyle = '#00ff88';
        ctx.strokeRect(-3, -3, 6, 6);
        
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
        
        const rotTargets = _getRotateTargets();
        if(rotTargets.length > 0) {
            ctx.save();
            const bscr = wcsToScreen(cmdState.rotateBase.x, cmdState.rotateBase.y);
            ctx.translate(bscr.x, bscr.y);
            ctx.rotate(-deltaAngle); // Canvas Y is down, WCS Y is up
            ctx.translate(-bscr.x, -bscr.y);
            ctx.setLineDash([2,2]);
            rotTargets.forEach(i => { if(entities[i]) drawOneEntity(entities[i], '#ffff00'); });
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

// スナップ記号（形は cad-snap.js の drawSnapShape）と、延長の補助線・2点の中点の途中表示
function drawSnapMarker() {
    updateSnapCycleButton();
    drawSnapGuides();
    if(!snapActive()) { snapIndicator.textContent=''; return; }
    snapIndicator.textContent=snapResult.type;
    const s=wcsToScreen(snapResult.wcsX,snapResult.wcsY);
    ctx.save(); ctx.strokeStyle='#00ff00'; ctx.lineWidth=lineWidthPx(2, 1.5); // 屋外モードでは1.5倍
    drawSnapShape(snapResult.type, s.x, s.y, 6);
    ctx.restore();
}

function drawCrosshair() {
    ctx.save(); ctx.strokeStyle=isLightCanvasBg()?'#555':'#e2c288'; ctx.lineWidth=lineWidthPx(1, 1.5);
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

// ===== Web CAD 図形の計算（交点・タップ判定・空間索引） =====
// cad-geom.js - 数学ユーティリティ、交点計算、オブジェクトスナップ、ヒットテスト、
//               外形（bbox）と空間索引（候補を素早く絞る格子）
// （cad-core.js から分割。ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

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

// ===== 交点計算（スナップ・トリム・延長で使う） =====
// ※ スナップ点の収集と選択は cad-snap.js
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

// 点(px,py)が円弧 e の描かれている範囲にあるか（円なら常に true）
function isPointOnArc(e, px, py) {
    if(e.type !== 'ARC') return true;
    const a = Math.atan2(py - e.cy, px - e.cx);
    const ccw = e.counterclockwise !== false;
    return isAngleBetweenCCW(ccw ? a : -a, ccw ? e.startAngle : -e.startAngle, ccw ? e.endAngle : -e.endAngle);
}
// トリム・延長の境界として使える図形の線分（線・長方形・ポリライン）
function boundarySegmentsOf(e) {
    if(e.type === 'LINE') return [{ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 }];
    if(e.type === 'RECTANG') return [
        { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y1 }, { x1: e.x2, y1: e.y1, x2: e.x2, y2: e.y2 },
        { x1: e.x2, y1: e.y2, x2: e.x1, y2: e.y2 }, { x1: e.x1, y1: e.y2, x2: e.x1, y2: e.y1 }
    ];
    if(e.type === 'PLINE' && e.points && e.points.length > 1) {
        const segs = [];
        for(let i = 1; i < e.points.length; i++) segs.push({ x1: e.points[i-1].x, y1: e.points[i-1].y, x2: e.points[i].x, y2: e.points[i].y });
        if(e.closed && e.points.length > 2) {
            const a = e.points[e.points.length - 1], b = e.points[0];
            segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        }
        return segs;
    }
    return [];
}
// 線分(x1,y1)-(x2,y2) と図形 other の交点（線分の範囲内・円弧は描かれている範囲のみ）
function intersectSegWithEntity(x1, y1, x2, y2, other) {
    const out = [];
    if(other.type === 'CIRCLE' || other.type === 'ARC') {
        intersectSegCircle(x1, y1, x2, y2, other.cx, other.cy, other.radius).forEach(p => {
            if(isPointOnArc(other, p.x, p.y)) out.push(p);
        });
        return out;
    }
    boundarySegmentsOf(other).forEach(s => {
        const p = intersectLineLine(x1, y1, x2, y2, s.x1, s.y1, s.x2, s.y2);
        if(p) out.push(p);
    });
    return out;
}

// ===== ヒットテスト =====
// 点 (x,y) が塗りつぶしの範囲（長方形・円・閉じたポリライン）の内側か
function _pointInHatch(t, x, y) {
    if(!t) return false;
    if(t.type === 'CIRCLE') return Math.hypot(x - t.cx, y - t.cy) < t.radius;
    let P = null;
    if(t.type === 'RECTANG') P = [{ x: t.x1, y: t.y1 }, { x: t.x2, y: t.y1 }, { x: t.x2, y: t.y2 }, { x: t.x1, y: t.y2 }];
    else if(t.type === 'PLINE' && t.points && t.points.length >= 3) P = t.points;
    if(!P) return false;
    let inside = false;
    for(let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const a = P[i], b = P[j];
        if(((a.y > y) !== (b.y > y)) && (x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x)) inside = !inside;
    }
    return inside;
}
function distPointToSeg(px,py,x1,y1,x2,y2) {
    const dx=x2-x1,dy=y2-y1,len2=dx*dx+dy*dy;
    if(len2===0) return dist(px,py,x1,y1);
    let t=((px-x1)*dx+(py-y1)*dy)/len2; t=Math.max(0,Math.min(1,t));
    return dist(px,py,x1+t*dx,y1+t*dy);
}
function hitTestEntity(sx,sy) {
    // #10 指で押すときは範囲を広げる（以前は線から5px未満でないと選べなかった）
    const hitR = (typeof hitRadiusPx === 'function') ? hitRadiusPx() : ERASE_R;
    let bestIdx=-1, bestD=hitR;
    const isVisible = (e) => (e.layer === undefined || !layers[e.layer] || layers[e.layer].visible) && !e.hidden;
    const wcs = screenToWcs(sx, sy);
    const tolWcs = hitR / view.scale;

    _forEachCandidate(wcs.x - tolWcs, wcs.y - tolWcs, wcs.x + tolWcs, wcs.y + tolWcs, (e,i) => {
        if(!isVisible(e)) return;

        // BBoxカリング
        if(e.bbox && e.type !== 'HATCH') {
            if(e.bbox.maxX < wcs.x - tolWcs || e.bbox.minX > wcs.x + tolWcs ||
               e.bbox.maxY < wcs.y - tolWcs || e.bbox.minY > wcs.y + tolWcs) return;
        }

        let d = Infinity;
        if(e.type==='LINE') { const p1=wcsToScreen(e.x1,e.y1),p2=wcsToScreen(e.x2,e.y2); d=distPointToSeg(sx,sy,p1.x,p1.y,p2.x,p2.y); }
        else if(e.type==='CIRCLE') { const c=wcsToScreen(e.cx,e.cy); d=Math.abs(dist(sx,sy,c.x,c.y)-e.radius*view.scale); }
        else if(e.type==='ARC') { const c=wcsToScreen(e.cx,e.cy); const ad=dist(sx,sy,c.x,c.y); const rd=e.radius*view.scale; d=Math.abs(ad-rd); const a=Math.atan2(wcs.y-e.cy,wcs.x-e.cx); const ccw=e.counterclockwise !== false; if(!isAngleBetweenCCW(ccw?a:-a,ccw?e.startAngle:-e.startAngle,ccw?e.endAngle:-e.endAngle))d=Infinity; }
        else if(e.type==='RECTANG') { const p1=wcsToScreen(e.x1,e.y1),p2=wcsToScreen(e.x2,e.y1),p3=wcsToScreen(e.x2,e.y2),p4=wcsToScreen(e.x1,e.y2); d=Math.min(distPointToSeg(sx,sy,p1.x,p1.y,p2.x,p2.y),distPointToSeg(sx,sy,p2.x,p2.y,p3.x,p3.y),distPointToSeg(sx,sy,p3.x,p3.y,p4.x,p4.y),distPointToSeg(sx,sy,p4.x,p4.y,p1.x,p1.y)); }
        else if(e.type==='PLINE') { for(let j=1;j<e.points.length;j++){const a=wcsToScreen(e.points[j-1].x,e.points[j-1].y),b=wcsToScreen(e.points[j].x,e.points[j].y);d=Math.min(d,distPointToSeg(sx,sy,a.x,a.y,b.x,b.y));} if(e.closed&&e.points.length>2){const a=wcsToScreen(e.points[e.points.length-1].x,e.points[e.points.length-1].y),b=wcsToScreen(e.points[0].x,e.points[0].y);d=Math.min(d,distPointToSeg(sx,sy,a.x,a.y,b.x,b.y));} }
        else if(e.type==='ELLIPSE') { const q = _ellNearest(e, wcs.x, wcs.y), s = wcsToScreen(q.x, q.y); d = dist(sx, sy, s.x, s.y); }
        else if(e.type==='TEXT') { d = textHitDistance(e, sx, sy); }
        else if(e.type==='POINT') { const p=wcsToScreen(e.x,e.y); d=dist(sx,sy,p.x,p.y); }
        else if(e.type==='HATCH') {
            const tgt = e.target;
            if(tgt.type==='RECTANG') { const p1=wcsToScreen(tgt.x1,tgt.y1),p2=wcsToScreen(tgt.x2,tgt.y1),p3=wcsToScreen(tgt.x2,tgt.y2),p4=wcsToScreen(tgt.x1,tgt.y2); d=Math.min(distPointToSeg(sx,sy,p1.x,p1.y,p2.x,p2.y),distPointToSeg(sx,sy,p2.x,p2.y,p3.x,p3.y),distPointToSeg(sx,sy,p3.x,p3.y,p4.x,p4.y),distPointToSeg(sx,sy,p4.x,p4.y,p1.x,p1.y)); }
            else if(tgt.type==='CIRCLE') { const c=wcsToScreen(tgt.cx,tgt.cy); d=Math.abs(dist(sx,sy,c.x,c.y)-tgt.radius*view.scale); }
            else if(tgt.type==='PLINE' && tgt.closed) {
                for(let j=1;j<tgt.points.length;j++){const a=wcsToScreen(tgt.points[j-1].x,tgt.points[j-1].y),b=wcsToScreen(tgt.points[j].x,tgt.points[j].y);d=Math.min(d,distPointToSeg(sx,sy,a.x,a.y,b.x,b.y));}
                if(tgt.points.length>2){const a=wcsToScreen(tgt.points[tgt.points.length-1].x,tgt.points[tgt.points.length-1].y),b=wcsToScreen(tgt.points[0].x,tgt.points[0].y);d=Math.min(d,distPointToSeg(sx,sy,a.x,a.y,b.x,b.y));}
            }
            if(d >= hitR && _pointInHatch(tgt, wcs.x, wcs.y)) d = hitR - 0.01;
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
    const hitR = Math.max(ERASE_R * 2, (typeof hitRadiusPx === 'function') ? hitRadiusPx() : 0);
    let bestIdx=-1, bestD=hitR;
    const isVisible = (e) => (e.layer === undefined || !layers[e.layer] || layers[e.layer].visible) && !e.hidden;
    const wcs = screenToWcs(sx, sy);
    const tolWcs = hitR / view.scale;

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


// ===== 空間索引（タップ判定・スナップ・ルーペの候補を素早く絞る） =====
// 図面全体を格子に区切り、各図形を外形（bbox）が重なる格子に登録しておく。
// 以前は1回のタップ判定・スナップ探索のたびに全図形を調べており、3万図形でタップ判定1.2ms・
// スナップ2.1ms（スマホでは約4〜5倍）かかっていた。
// 索引は「図形データの変更世代」「外形の再計算回数」「配列の入れ替え・件数」が変わったら次の問い合わせ時に作り直す。
let _bboxGen = 0;         // calcBBox が呼ばれた回数（編集で外形が消され、描画時に再計算されると増える）
let _spIndex = null;
let _spQueryStamp = null; // 候補の重複除去用
let _spQueryCounter = 0;
const SP_MAX_CELLS_PER_ENTITY = 64; // これより広い図形は「常に調べる」一覧へ

function _spatialIndexIsValid(ix) {
    return ix && ix.epoch === _geomEpoch && ix.bboxGen === _bboxGen && ix.arr === entities && ix.n === entities.length;
}
function _buildSpatialIndex() {
    const n = entities.length;
    const boxes = new Array(n);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for(let i = 0; i < n; i++) {
        const e = entities[i];
        if(!e || e.type === 'DIMENSION' || e.type === 'HATCH') continue; // 画面上の当たり判定・塗りの対象図形で判定するもの
        const b = e.bbox || (e.bbox = calcBBox(e));
        if(!b || !isFinite(b.minX) || !isFinite(b.maxX) || !isFinite(b.minY) || !isFinite(b.maxY)) continue;
        boxes[i] = b;
        if(b.minX < minX) minX = b.minX; if(b.minY < minY) minY = b.minY;
        if(b.maxX > maxX) maxX = b.maxX; if(b.maxY > maxY) maxY = b.maxY;
    }
    const ix = { epoch: _geomEpoch, arr: entities, n, cells: new Map(), always: [], cell: 1, minX: 0, minY: 0, cols: 1, rows: 1 };
    if(minX === Infinity) {
        for(let i = 0; i < n; i++) if(entities[i]) ix.always.push(i);
    } else {
        const w = Math.max(maxX - minX, 1e-9), h = Math.max(maxY - minY, 1e-9);
        // 1マスあたり平均2〜3図形になる大きさ（マス数の上限あり）
        const target = Math.max(1, Math.min(n / 2, 250000));
        const cell = Math.max(Math.sqrt((w * h) / target), Math.max(w, h) / 4096, 1e-9);
        ix.cell = cell; ix.minX = minX; ix.minY = minY;
        ix.cols = Math.max(1, Math.ceil(w / cell) + 1); ix.rows = Math.max(1, Math.ceil(h / cell) + 1);
        for(let i = 0; i < n; i++) {
            const e = entities[i];
            if(!e) continue;
            const b = boxes[i];
            if(!b) { ix.always.push(i); continue; }
            const c0 = Math.floor((b.minX - minX) / cell), c1 = Math.floor((b.maxX - minX) / cell);
            const r0 = Math.floor((b.minY - minY) / cell), r1 = Math.floor((b.maxY - minY) / cell);
            if((c1 - c0 + 1) * (r1 - r0 + 1) > SP_MAX_CELLS_PER_ENTITY) { ix.always.push(i); continue; }
            for(let r = r0; r <= r1; r++) for(let c = c0; c <= c1; c++) {
                const key = r * ix.cols + c;
                const list = ix.cells.get(key);
                if(list) list.push(i); else ix.cells.set(key, [i]);
            }
        }
    }
    ix.bboxGen = _bboxGen; // 構築中の calcBBox 呼び出し分は含めて記録する
    return ix;
}
function _getSpatialIndex() {
    if(!_spatialIndexIsValid(_spIndex)) _spIndex = _buildSpatialIndex();
    return _spIndex;
}
// WCS の矩形に外形が重なりうる図形の番号を、配列順（小さい順）で返す。広すぎる範囲なら null（＝全図形を調べる）
function _spatialCandidates(qMinX, qMinY, qMaxX, qMaxY) {
    if(window.__disableSpatialIndex) return null; // テストで索引なしの結果と比較するためのスイッチ
    const ix = _getSpatialIndex();
    const n = ix.n;
    if(n < 500) return null; // 小さい図面は全件を調べた方が速い
    const c0 = Math.max(0, Math.floor((qMinX - ix.minX) / ix.cell)), c1 = Math.min(ix.cols - 1, Math.floor((qMaxX - ix.minX) / ix.cell));
    const r0 = Math.max(0, Math.floor((qMinY - ix.minY) / ix.cell)), r1 = Math.min(ix.rows - 1, Math.floor((qMaxY - ix.minY) / ix.cell));
    const span = (c1 >= c0 && r1 >= r0) ? (c1 - c0 + 1) * (r1 - r0 + 1) : 0;
    if(span > Math.max(64, ix.cells.size / 3)) return null;
    if(!_spQueryStamp || _spQueryStamp.length < n) _spQueryStamp = new Uint32Array(Math.max(n, 1024));
    _spQueryCounter++;
    if(_spQueryCounter >= 0xFFFFFFFF) { _spQueryStamp.fill(0); _spQueryCounter = 1; }
    const stamp = _spQueryStamp, q = _spQueryCounter;
    const out = [];
    for(const i of ix.always) if(stamp[i] !== q) { stamp[i] = q; out.push(i); }
    for(let r = r0; r <= r1; r++) for(let c = c0; c <= c1; c++) {
        const list = ix.cells.get(r * ix.cols + c);
        if(!list) continue;
        for(let k = 0; k < list.length; k++) { const i = list[k]; if(stamp[i] !== q) { stamp[i] = q; out.push(i); } }
    }
    out.sort((a, b) => a - b); // 同じ距離のときは配列の前の図形を優先する従来の動作を保つ
    return out;
}
// 候補（または全図形）について fn(e, i) を配列順に呼ぶ
function _forEachCandidate(qMinX, qMinY, qMaxX, qMaxY, fn) {
    const cand = (qMinX === undefined) ? null : _spatialCandidates(qMinX, qMinY, qMaxX, qMaxY);
    if(!cand) { entities.forEach(fn); return; }
    for(let k = 0; k < cand.length; k++) { const i = cand[k]; const e = entities[i]; if(e) fn(e, i); }
}

// 図形の外形（バウンディングボックス）を計算する（初回のみ実行され、e.bbox に覚えさせる）
function calcBBox(e) {
    _bboxGen++;
    let minX, minY, maxX, maxY;
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
    } else if(e.type==='POINT') {
        minX = e.x; maxX = e.x; minY = e.y; maxY = e.y;
    } else if(e.type==='TEXT') {
        // 文字の広がり（回転に依らない保守的な範囲）。アンカー点だけだと画面端で文字が消える
        const b = textLocalBox(e);
        const r = Math.hypot(Math.max(Math.abs(b.xMin), Math.abs(b.xMax)), Math.max(Math.abs(b.yMin), Math.abs(b.yMax)));
        minX = e.x - r; maxX = e.x + r; minY = e.y - r; maxY = e.y + r;
    } else if(e.type==='ELLIPSE') {
        const r = Math.max(e.rx||0, e.ry||0) || e.radius || 0;
        minX = e.cx - r; maxX = e.cx + r; minY = e.cy - r; maxY = e.cy + r;
    } else {
        return null; // カリングなし
    }
    return { minX, minY, maxX, maxY };
}

// ===== Web CAD 図形の計算（スナップ・タップ判定・空間索引） =====
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

// 点(px,py)が円弧 e の描かれている範囲にあるか（円なら常に true）
function isPointOnArc(e, px, py) {
    if(e.type !== 'ARC') return true;
    const a = Math.atan2(py - e.cy, px - e.cx);
    const ccw = e.counterclockwise;
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

    _forEachCandidate(wxMin, wyMin, wxMax, wyMax, e => {
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
        _forEachCandidate(wxMin, wyMin, wxMax, wyMax, e => {
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
        const onArc = isPointOnArc;
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

    // タッチ操作は指の位置精度が低いため吸着半径を少し広げる
    const radius = (typeof isMobile === 'function' && isMobile()) ? SNAP_R * 1.4 : SNAP_R;

    // スナップ優先順位（AutoCAD準拠の2段階）:
    //   1) 幾何スナップ（端点・中点・中心・交点・垂線）: 範囲内で最もカーソルに近いもの
    //   2) 近接点: 幾何スナップが範囲内に1つも無いときだけ採用
    // ※ 近接点はカーソル直下（距離≒0）に必ず存在するため、単純な最近傍比較だと
    //    後から評価される交点などが永久に選ばれなくなる
    const pick = (cands) => {
        let best=null, bestD=radius;
        cands.forEach(p=>{
            const sp=wcsToScreen(p.x,p.y);
            const d=dist(sx,sy,sp.x,sp.y);
            if(d<bestD){ bestD=d; best={wcsX:p.x, wcsY:p.y, type:p.t}; }
        });
        return best;
    };
    return pick(pts.filter(p => p.t !== '近接点')) || pick(pts.filter(p => p.t === '近接点'));
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
        else if(e.type==='ARC') { const c=wcsToScreen(e.cx,e.cy); const ad=dist(sx,sy,c.x,c.y); const rd=e.radius*view.scale; d=Math.abs(ad-rd); const a=Math.atan2(-(sy-c.y),sx-c.x); const ccw=e.counterclockwise; if(!isAngleBetweenCCW(ccw?a:-a,ccw?e.startAngle:-e.startAngle,ccw?e.endAngle:-e.endAngle))d=Infinity; }
        else if(e.type==='RECTANG') { const p1=wcsToScreen(e.x1,e.y1),p2=wcsToScreen(e.x2,e.y1),p3=wcsToScreen(e.x2,e.y2),p4=wcsToScreen(e.x1,e.y2); d=Math.min(distPointToSeg(sx,sy,p1.x,p1.y,p2.x,p2.y),distPointToSeg(sx,sy,p2.x,p2.y,p3.x,p3.y),distPointToSeg(sx,sy,p3.x,p3.y,p4.x,p4.y),distPointToSeg(sx,sy,p4.x,p4.y,p1.x,p1.y)); }
        else if(e.type==='PLINE') { for(let j=1;j<e.points.length;j++){const a=wcsToScreen(e.points[j-1].x,e.points[j-1].y),b=wcsToScreen(e.points[j].x,e.points[j].y);d=Math.min(d,distPointToSeg(sx,sy,a.x,a.y,b.x,b.y));} if(e.closed&&e.points.length>2){const a=wcsToScreen(e.points[e.points.length-1].x,e.points[e.points.length-1].y),b=wcsToScreen(e.points[0].x,e.points[0].y);d=Math.min(d,distPointToSeg(sx,sy,a.x,a.y,b.x,b.y));} }
        else if(e.type==='ELLIPSE') { const c=wcsToScreen(e.cx,e.cy); d=Math.abs(dist(sx,sy,c.x,c.y)-(e.rx+e.ry)/2*view.scale); }
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

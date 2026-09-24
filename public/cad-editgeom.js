// ===== Web CAD 編集の計算 =====
// cad-editgeom.js - 鏡像・尺度変更・配列（相似変換）、分割・等分、結合、フィレット・面取りの形の計算
//                   （画面・入力に関係しない計算だけ。コマンドの流れは cad-edit.js、頂点のドラッグは cad-grip.js）
// （ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

// ===== 相似変換 =====
// 点 p は  p' = t + M·(p − o)  に写る（M = [[a, c], [b, d]]。回転・拡大縮小・鏡像）。
// o を基準に差を取るので、公共座標（数十万 m）でも基準の近くの点の桁が落ちない。
// k: 倍率。flip: 鏡像（形の向きが裏返る）。phi: 向き α の写り先は、flip なら phi − α、そうでなければ α + phi
function editXform(a, b, c, d, o, t) {
    const det = a * d - b * c;
    return { a, b, c, d, ox: o.x, oy: o.y, tx: t.x, ty: t.y, k: Math.sqrt(Math.abs(det)), flip: det < 0, phi: Math.atan2(b, a) };
}
// 0・±1 にごく近い値はそのものにする（縦・横の鏡や 90° の回転で、長方形が長方形のまま・座標がそのままになるように）
function _editClean(v) {
    if(Math.abs(v) < 1e-14) return 0;
    if(Math.abs(Math.abs(v) - 1) < 1e-14) return Math.sign(v);
    return v;
}
// 2点 p1・p2 を通る直線を鏡にした鏡像
function editMirrorXform(p1, p2) {
    const th = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const c2 = _editClean(Math.cos(2 * th)), s2 = _editClean(Math.sin(2 * th));
    return editXform(c2, s2, s2, -c2, p1, p1);
}
// 基点 o を中心に k 倍
function editScaleXform(o, k) { return editXform(k, 0, 0, k, o, o); }
// 点 o を中心に ang（ラジアン。左回りが正）回す
function editRotateXform(o, ang) {
    const c = _editClean(Math.cos(ang)), s = _editClean(Math.sin(ang));
    return editXform(c, s, -s, c, o, o);
}
// 平行移動
function editMoveXform(dx, dy) { return editXform(1, 0, 0, 1, { x: 0, y: 0 }, { x: dx, y: dy }); }
function editXformPoint(T, x, y) {
    const dx = x - T.ox, dy = y - T.oy;
    return { x: T.tx + T.a * dx + T.c * dy, y: T.ty + T.b * dx + T.d * dy };
}
function editXformAngle(T, ang) { return T.flip ? T.phi - ang : ang + T.phi; }
// 角度を -π より大きく π 以下にそろえる
function _editWrap(a) {
    a %= Math.PI * 2;
    if(a > Math.PI) a -= Math.PI * 2; else if(a <= -Math.PI) a += Math.PI * 2;
    return a;
}
function _editSetRot(e, key, r) { r = _editWrap(r); if(Math.abs(r) > 1e-12) e[key] = r; else delete e[key]; }

// 図形 e（そのものを書き換える）を T で写す。長方形は、軸に沿わない向きになるときは閉じたポリラインにする
function editTransformEntity(e, T) {
    if(typeof _bumpGeomEpoch === 'function') _bumpGeomEpoch();
    return _editXformShape(e, T);
}
// 形だけを写す（途中の表示で使う複写にも使うので、図形データの変更世代は進めない）
function _editXformShape(e, T) {
    if(!e) return e;
    delete e.bbox; delete e._hits;
    const mp =(p) => { const q = editXformPoint(T, p.x, p.y); p.x = q.x; p.y = q.y; };
    const k = T.k, t = e.type;
    if(e.ins) mp(e.ins); // ブロックの挿入点（測点の座標）
    if(t === 'LINE') {
        const a = editXformPoint(T, e.x1, e.y1), b = editXformPoint(T, e.x2, e.y2);
        e.x1 = a.x; e.y1 = a.y; e.x2 = b.x; e.y2 = b.y;
    } else if(t === 'RECTANG') {
        const q = [[e.x1, e.y1], [e.x2, e.y1], [e.x2, e.y2], [e.x1, e.y2]].map(([x, y]) => editXformPoint(T, x, y));
        if(Math.abs(T.a * T.b) <= 1e-12 * (T.a * T.a + T.b * T.b)) { e.x1 = q[0].x; e.y1 = q[0].y; e.x2 = q[2].x; e.y2 = q[2].y; }
        else { e.type = 'PLINE'; e.points = q; e.closed = true; delete e.x1; delete e.y1; delete e.x2; delete e.y2; }
    } else if(t === 'CIRCLE' || t === 'ARC') {
        const c = editXformPoint(T, e.cx, e.cy); e.cx = c.x; e.cy = c.y;
        e.radius *= k;
        if(t === 'ARC') {
            // 鏡像では回る向きが逆になるので、始点と終点を入れ替えて、同じ向き（左回り／右回り）のまま表す
            const s = e.startAngle, en = e.endAngle;
            e.startAngle = normalizeAngle(editXformAngle(T, T.flip ? en : s));
            e.endAngle = normalizeAngle(editXformAngle(T, T.flip ? s : en));
        }
    } else if(t === 'ELLIPSE') {
        const c = editXformPoint(T, e.cx, e.cy); e.cx = c.x; e.cy = c.y;
        e.rx *= k; e.ry *= k;
        _editSetRot(e, 'rotation', editXformAngle(T, e.rotation || 0));
    } else if(t === 'PLINE') {
        (e.points || []).forEach(mp);
    } else if(t === 'POINT') {
        mp(e);
    } else if(t === 'TEXT') {
        mp(e);
        if(Math.abs(k - 1) > 1e-12) e.height = (e.height || 10) * k;
        if(T.flip) _editMirrorText(e, T); else _editSetRot(e, 'rotation', (e.rotation || 0) + T.phi);
    } else if(t === 'DIMENSION') {
        _editTransformDim(e, T);
    } else if(t === 'HATCH') {
        if(e.target) _editXformShape(e.target, T); // 塗りつぶしの範囲
    }
    return e;
}
// 鏡像の文字: 裏返しの文字にはせず、読める向きのまま、鏡に映した位置・範囲に置く
function _editMirrorText(e, T) {
    const rA = editXformAngle(T, e.rotation || 0), c = Math.cos(rA);
    if(c > 1e-9 || (c >= -1e-9 && Math.sin(rA) > 0)) {
        // 読む向きはそのまま。上下が入れ替わるので、縦の揃えを入れ替える
        _editSetRot(e, 'rotation', rA);
        if(e.valign === 'top') delete e.valign; else if(e.valign !== 'middle') e.valign = 'top';
    } else {
        // 逆さまにならないよう半回転し、横の揃えを入れ替える
        _editSetRot(e, 'rotation', rA + Math.PI);
        if(e.halign === 'right') delete e.halign; else if(e.halign !== 'center') e.halign = 'right';
    }
}
// 寸法: 測った点・引出線などを写し、寸法線の位置（offset）・向き（dimRot・angle）を直す
function _editTransformDim(e, T) {
    const k = T.k, st = e.subType;
    // 向きが自動の平行寸法は、いまの向き（横・縦）に決めてから写す（写したあとに縦横が入れ替わらないように）
    if(st === 'LINEAR' && !e.dimDir && e.p1 && e.p2) e.dimDir = Math.abs(e.p2.x - e.p1.x) >= Math.abs(e.p2.y - e.p1.y) ? 'H' : 'V';
    const done = new Set();
    [e.p1, e.p2, e.center, e.vertex, e.arm1, e.arm2, e.point, e.leader, e.leaderX, e.leaderY, e.leaderCoord].forEach(p => {
        if(!p || done.has(p)) return;
        done.add(p);
        const q = editXformPoint(T, p.x, p.y); p.x = q.x; p.y = q.y;
    });
    if(st === 'LINEAR' || st === 'ALIGNED') {
        let off = (e.offset ?? 30) * k;
        // 鏡像では、寸法線をずらす向き（整列: 右側、平行の横: 上、縦: 右）の裏表が変わる
        if(T.flip && (st === 'ALIGNED' || e.dimDir === 'H')) off = -off;
        e.offset = off;
        if(st === 'LINEAR') _editSetRot(e, 'dimRot', editXformAngle(T, e.dimRot || 0));
    } else if(st === 'RADIUS' || st === 'DIAMETER') {
        if(typeof e.radius === 'number') e.radius *= k;
        e.angle = _editWrap(editXformAngle(T, e.angle || 0));
    } else if(st === 'ANGULAR') {
        e.arcRadius = (e.arcRadius || 40) * k;
    }
}
// 複写用の図形（新しい図形: 固有IDは付け直す。ブロック・グループは、複写どうしの新しいまとまりにする）
function editCloneEntity(e, gidMap) {
    const c = JSON.parse(JSON.stringify(e));
    delete c.id; delete c.bbox; delete c._hits;
    if(c.gid && gidMap) {
        if(!gidMap[c.gid]) gidMap[c.gid] = (typeof newGroupId === 'function') ? newGroupId('c') : c.gid + '_c';
        c.gid = gidMap[c.gid];
    }
    return c;
}
// 元の図形の属性（画層・色・グループなど）を引き継いだ、形だけ違う図形
function _editPiece(e, over) {
    const n = Object.assign(JSON.parse(JSON.stringify(e)), over);
    delete n.id; delete n.bbox; delete n._hits;
    return n;
}
function _editRectPoints(e) { return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y1 }, { x: e.x2, y: e.y2 }, { x: e.x1, y: e.y2 }]; }
// 図形たちの外形（WCS）
function editBoundsOf(list) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    list.forEach(e => {
        const b = (e.type === 'HATCH') ? (e.target ? calcBBox(e.target) : null) : calcBBox(e);
        if(!b || !isFinite(b.minX)) return;
        minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY); maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    });
    return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

// ===== 分割（1点で分ける・等分する） =====
// 折れ線 P（開いた経路）の上で点 (px,py) に一番近い位置。s: 始点からの長さ、q: その点、d: 点からの距離
function editPathProject(P, px, py) {
    let best = null, acc = 0;
    for(let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
        let t = L2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        const q = { x: a.x + dx * t, y: a.y + dy * t }, d = Math.hypot(px - q.x, py - q.y);
        if(!best || d < best.d - 1e-12) best = { s: acc + L * t, q, d, i: i - 1, t };
        acc += L;
    }
    if(best) best.total = acc;
    return best;
}
function editPathLength(P) { let L = 0; for(let i = 1; i < P.length; i++) L += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y); return L; }
// 折れ線 P（開いた経路）を、始点からの長さ cuts（小さい順）で切った部分の列（頂点ちょうどで切るときは頂点で分ける）
function editCutPath(P, cuts) {
    const eps = 1e-9 * Math.max(1, editPathLength(P));
    const out = [];
    let cur = [{ x: P[0].x, y: P[0].y }], acc = 0, ci = 0;
    for(let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], L = Math.hypot(b.x - a.x, b.y - a.y);
        while(ci < cuts.length && cuts[ci] <= acc + eps) ci++; // 区間の始め（＝前の頂点）で切る分は済んでいる
        while(ci < cuts.length && cuts[ci] < acc + L - eps) {
            const t = (cuts[ci] - acc) / L, q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            cur.push(q); out.push(cur); cur = [{ x: q.x, y: q.y }]; ci++;
        }
        cur.push({ x: b.x, y: b.y });
        acc += L;
        if(i < P.length - 1 && ci < cuts.length && Math.abs(cuts[ci] - acc) <= eps) { out.push(cur); cur = [{ x: b.x, y: b.y }]; ci++; }
    }
    out.push(cur);
    return out;
}
// 図形の上の点（線に下ろした足）。指定した点がほぼ図形の上なら、その点そのもの（交点などの座標を変えない）
function _editOnPath(proj, px, py) {
    return proj.d <= 1e-9 * Math.max(1, proj.total) ? { x: px, y: py } : proj.q;
}
// 図形 e を点 (px,py) で分ける。返り値: 置き換える図形の配列（閉じた形は、その点で開いた1本）、分けられないときは { error }
function editSplitAt(e, px, py) {
    if(e.type === 'LINE') {
        const P = [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }], pr = editPathProject(P, px, py);
        if(!pr || !(pr.total > 0)) return { error: '長さの無い線です' };
        const eps = 1e-9 * pr.total;
        if(pr.s <= eps || pr.s >= pr.total - eps) return { error: '線の端では分けられません' };
        const q = _editOnPath(pr, px, py);
        return [_editPiece(e, { x2: q.x, y2: q.y }), _editPiece(e, { x1: q.x, y1: q.y })];
    }
    if(e.type === 'ARC') {
        const a = Math.atan2(py - e.cy, px - e.cx);
        const ccw = e.counterclockwise !== false;
        const span = ccw ? normalizeAngle(e.endAngle - e.startAngle) : normalizeAngle(e.startAngle - e.endAngle);
        const u = ccw ? normalizeAngle(a - e.startAngle) : normalizeAngle(e.startAngle - a);
        if(!(u > 1e-9 && u < span - 1e-9)) return { error: '円弧の端・円弧の外では分けられません' };
        return [_editPiece(e, { endAngle: a }), _editPiece(e, { startAngle: a })];
    }
    if(e.type === 'PLINE' || e.type === 'RECTANG') {
        const closed = e.type === 'RECTANG' || !!e.closed;
        const V = e.type === 'RECTANG' ? _editRectPoints(e) : (e.points || []).map(p => ({ x: p.x, y: p.y }));
        if(V.length < 2) return { error: '点の足りないポリラインです' };
        const P = closed ? V.concat([{ x: V[0].x, y: V[0].y }]) : V;
        const pr = editPathProject(P, px, py);
        if(!pr || !(pr.total > 0)) return { error: '長さの無いポリラインです' };
        const eps = 1e-9 * pr.total;
        const q = _editOnPath(pr, px, py);
        const fix = (pieces) => { // 分けた点を、指定した点そのものにそろえる（頂点で分けたときは頂点のまま）
            const onVertex = V.some(v => Math.hypot(v.x - q.x, v.y - q.y) <= eps);
            if(onVertex) return pieces;
            for(let i = 0; i < pieces.length - 1; i++) { pieces[i][pieces[i].length - 1] = { x: q.x, y: q.y }; pieces[i + 1][0] = { x: q.x, y: q.y }; }
            return pieces;
        };
        const base = { type: 'PLINE', closed: false };
        const strip = (n) => { delete n.x1; delete n.y1; delete n.x2; delete n.y2; return n; };
        if(!closed) {
            if(pr.s <= eps || pr.s >= pr.total - eps) return { error: 'ポリラインの端では分けられません' };
            const pieces = fix(editCutPath(P, [pr.s]));
            if(pieces.length !== 2) return { error: 'ここでは分けられません' };
            return pieces.map(pts => _editPiece(e, Object.assign({}, base, { points: pts })));
        }
        // 閉じた形: その点から一周して、その点に戻る1本にする
        let pieces;
        if(pr.s <= eps || pr.s >= pr.total - eps) pieces = [P.map(p => ({ x: p.x, y: p.y }))];
        else pieces = fix(editCutPath(P, [pr.s]));
        const pts = pieces.length === 2 ? pieces[1].concat(pieces[0].slice(1)) : pieces[0];
        return [strip(_editPiece(e, Object.assign({}, base, { points: pts })))];
    }
    if(e.type === 'CIRCLE') return { error: '円は1点では分けられません（「等分する」か、トリムを使います）' };
    return { error: 'この図形は分けられません（線・円弧・ポリライン・長方形）' };
}
// 図形 e を n 等分した図形の配列（閉じた形・円は、始点（円は右の点）から等分する）
function editDivide(e, n) {
    n = Math.floor(n);
    if(!(n >= 2 && n <= 1000)) return { error: '分ける数は 2〜1000 です' };
    if(e.type === 'LINE') {
        const out = [];
        for(let i = 0; i < n; i++) {
            const t0 = i / n, t1 = (i + 1) / n;
            out.push(_editPiece(e, { x1: e.x1 + (e.x2 - e.x1) * t0, y1: e.y1 + (e.y2 - e.y1) * t0,
                x2: i === n - 1 ? e.x2 : e.x1 + (e.x2 - e.x1) * t1, y2: i === n - 1 ? e.y2 : e.y1 + (e.y2 - e.y1) * t1 }));
        }
        return out;
    }
    if(e.type === 'ARC' || e.type === 'CIRCLE') {
        const ccw = e.type === 'CIRCLE' || e.counterclockwise !== false;
        const s = e.type === 'CIRCLE' ? 0 : e.startAngle;
        const span = e.type === 'CIRCLE' ? Math.PI * 2 : (ccw ? normalizeAngle(e.endAngle - s) : normalizeAngle(s - e.endAngle));
        if(!(span > 0)) return { error: '長さの無い円弧です' };
        const dir = ccw ? 1 : -1, out = [];
        for(let i = 0; i < n; i++) {
            const a0 = s + dir * span * i / n, a1 = (i === n - 1 && e.type === 'ARC') ? e.endAngle : s + dir * span * (i + 1) / n;
            out.push(_editPiece(e, { type: 'ARC', startAngle: normalizeAngle(a0), endAngle: normalizeAngle(a1), counterclockwise: ccw }));
        }
        return out;
    }
    if(e.type === 'PLINE' || e.type === 'RECTANG') {
        const closed = e.type === 'RECTANG' || !!e.closed;
        const V = e.type === 'RECTANG' ? _editRectPoints(e) : (e.points || []).map(p => ({ x: p.x, y: p.y }));
        if(V.length < 2) return { error: '点の足りないポリラインです' };
        const P = closed ? V.concat([{ x: V[0].x, y: V[0].y }]) : V;
        const L = editPathLength(P);
        if(!(L > 0)) return { error: '長さの無いポリラインです' };
        const cuts = []; for(let i = 1; i < n; i++) cuts.push(L * i / n);
        return editCutPath(P, cuts).map(pts => {
            const piece = _editPiece(e, { type: 'PLINE', closed: false, points: pts });
            delete piece.x1; delete piece.y1; delete piece.x2; delete piece.y2;
            return piece;
        });
    }
    return { error: 'この図形は等分できません（線・円弧・円・ポリライン・長方形）' };
}

// ===== 結合 =====
// 端点が同じとみなす距離（図面の単位で 0.5mm。点の座標は 1mm 単位で違えば別の点）
function editJoinTol() { return 0.0005 * ((typeof surveyUnitFactor === 'function') ? surveyUnitFactor() : 1); }
// 結合できる形（線・開いたポリライン）の経路。ほかは null
function editJoinPath(e) {
    if(!e) return null;
    if(e.type === 'LINE') return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
    if(e.type === 'PLINE' && !e.closed && e.points && e.points.length >= 2) return e.points.map(p => ({ x: p.x, y: p.y }));
    return null;
}
// 端点の索引（tol の格子。境目の取りこぼしが無いよう、周りの9マスを調べる）
function _editEndIndex(tol) {
    const cells = new Map(), key = (cx, cy) => cx + ',' + cy;
    return {
        add(p, item) { const k = key(Math.round(p.x / tol), Math.round(p.y / tol)); const l = cells.get(k); if(l) l.push(item); else cells.set(k, [item]); },
        near(p) {
            const cx = Math.round(p.x / tol), cy = Math.round(p.y / tol), out = [];
            for(let i = -1; i <= 1; i++) for(let j = -1; j <= 1; j++) {
                const l = cells.get(key(cx + i, cy + j));
                if(l) l.forEach(it => { if(Math.hypot(it.p.x - p.x, it.p.y - p.y) <= tol) out.push(it); });
            }
            return out;
        },
    };
}
// 選んだ図形の番号 idxs のうち、端がつながる線・ポリラインを順につなぐ。
// 返り値: [{ items: [番号...], points, closed }]（1本だけの鎖も含む）
function editJoinChains(idxs, tol) {
    const items = [];
    idxs.forEach(i => { const P = editJoinPath(entities[i]); if(P) items.push({ i, P, used: false }); });
    const ix = _editEndIndex(tol);
    items.forEach(it => { ix.add(it.P[0], { it, p: it.P[0] }); ix.add(it.P[it.P.length - 1], { it, p: it.P[it.P.length - 1] }); });
    const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
    const chains = [];
    for(const seed of items) {
        if(seed.used) continue;
        seed.used = true;
        let pts = seed.P.slice();
        const members = [seed.i];
        const extend = (atTail) => {
            if(pts.length > 2 && near(pts[0], pts[pts.length - 1])) return false; // 一周した
            const end = atTail ? pts[pts.length - 1] : pts[0];
            const cand = ix.near(end).find(c => !c.it.used);
            if(!cand) return false;
            const it = cand.it, fromStart = cand.p === it.P[0];
            const P = fromStart ? it.P : it.P.slice().reverse(); // P[0] が end の側
            if(atTail) pts = pts.concat(P.slice(1)); else pts = P.slice(1).reverse().concat(pts);
            it.used = true; members.push(it.i);
            return true;
        };
        while(extend(true)) { /* 後ろへ */ }
        while(extend(false)) { /* 前へ */ }
        let closed = false;
        if(members.length > 1 && pts.length > 3 && near(pts[0], pts[pts.length - 1])) { closed = true; pts.pop(); }
        // 続けて同じ点（許容の中）は1つに
        const clean = [];
        pts.forEach(p => { if(!clean.length || !near(clean[clean.length - 1], p)) clean.push(p); });
        chains.push({ items: members, points: clean, closed });
    }
    return chains;
}
// 点がすべて p0→pN の直線の上に、順に並んでいるか（一直線の線どうしの結合は1本の線にする）
function _editStraight(P, tol) {
    const a = P[0], b = P[P.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y);
    if(!(L > tol)) return false;
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    let last = -tol;
    for(const p of P) {
        const s = (p.x - a.x) * ux + (p.y - a.y) * uy, h = Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux);
        if(h > tol || s < last - tol) return false;
        last = s;
    }
    return true;
}
// 同じ円の上で続く円弧を1つにする。返り値: [{ items, entity }]（一周すれば円）
function editJoinArcs(idxs, tol) {
    const arcs = idxs.filter(i => entities[i] && entities[i].type === 'ARC').map(i => {
        const e = entities[i], ccw = e.counterclockwise !== false;
        const s = ccw ? e.startAngle : e.endAngle, span = ccw ? normalizeAngle(e.endAngle - e.startAngle) : normalizeAngle(e.startAngle - e.endAngle);
        return { i, e, s: normalizeAngle(s), span, used: false };
    });
    const out = [];
    for(const seed of arcs) {
        if(seed.used) continue;
        const same = arcs.filter(a => !a.used && Math.hypot(a.e.cx - seed.e.cx, a.e.cy - seed.e.cy) <= tol && Math.abs(a.e.radius - seed.e.radius) <= tol);
        const angTol = tol / Math.max(seed.e.radius, 1e-12);
        // 始まりの角度の順に並べ、つながる（重なる）ものをまとめる
        same.sort((p, q) => p.s - q.s);
        const groups = [];
        same.forEach(a => {
            const g = groups[groups.length - 1];
            if(g && normalizeAngle(a.s - g.s) <= g.span + angTol) { g.span = Math.max(g.span, normalizeAngle(a.s - g.s) + a.span); g.members.push(a); }
            else groups.push({ s: a.s, span: a.span, members: [a] });
        });
        // 最後のまとまりが最初のまとまりへ（0° をまたいで）つながる
        if(groups.length > 1) {
            const f = groups[0], l = groups[groups.length - 1];
            if(normalizeAngle(f.s - l.s) <= l.span + angTol) { l.span = Math.max(l.span, normalizeAngle(f.s - l.s) + f.span); l.members.push(...f.members); groups.shift(); }
        }
        same.forEach(a => { a.used = true; });
        groups.forEach(g => {
            if(g.members.length < 2) return;
            const base = g.members[0].e;
            const entity = g.span >= Math.PI * 2 - angTol
                ? (() => { const c = _editPiece(base, { type: 'CIRCLE' }); delete c.startAngle; delete c.endAngle; delete c.counterclockwise; return c; })()
                : _editPiece(base, { startAngle: normalizeAngle(g.s), endAngle: normalizeAngle(g.s + g.span), counterclockwise: true });
            out.push({ items: g.members.map(a => a.i), entity });
        });
    }
    return out;
}
// 番号 idxs の図形を結合した結果（まだ図面は変えない）。返り値: { made: [{ items, entity }], skipped }
function editJoinPlan(idxs, tol) {
    const made = [];
    editJoinChains(idxs, tol).forEach(ch => {
        if(ch.items.length < 2) return;
        const first = entities[ch.items[0]];
        const allLines = ch.items.every(i => entities[i].type === 'LINE');
        let entity;
        if(!ch.closed && allLines && _editStraight(ch.points, tol)) {
            const a = ch.points[0], b = ch.points[ch.points.length - 1];
            entity = _editPiece(first, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        } else {
            const firstPl = ch.items.map(i => entities[i]).find(e => e.type === 'PLINE') || first;
            entity = _editPiece(firstPl, { type: 'PLINE', points: ch.points, closed: ch.closed });
            delete entity.x1; delete entity.y1; delete entity.x2; delete entity.y2;
            if(firstPl.type !== 'PLINE') { entity.layer = first.layer; entity.color = first.color; }
        }
        made.push({ items: ch.items, entity });
    });
    editJoinArcs(idxs, tol).forEach(m => made.push(m));
    const used = new Set(); made.forEach(m => m.items.forEach(i => used.add(i)));
    return { made, skipped: idxs.filter(i => !used.has(i)).length };
}
// 図形 idx から、ほかの線と「2本だけで」つながる点をたどった、ひと続きの線・ポリラインの番号
// （分かれ道・行き止まり・円弧の所で止まる。一周すれば一周分）
function editJoinChainFrom(idx, tol) {
    if(!editJoinPath(entities[idx])) return [idx];
    const vis = (e) => e && (e.layer === undefined || !layers[e.layer] || layers[e.layer].visible) && !e.hidden;
    const ix = _editEndIndex(tol);
    entities.forEach((e, i) => {
        if(!vis(e)) return;
        let ends = null;
        const P = editJoinPath(e);
        if(P) ends = [P[0], P[P.length - 1]];
        else if(e.type === 'ARC') ends = [0, 1].map(k => { const a = k ? e.endAngle : e.startAngle; return { x: e.cx + e.radius * Math.cos(a), y: e.cy + e.radius * Math.sin(a) }; });
        if(ends) ends.forEach((p, k) => ix.add(p, { i, k, p, ok: !!P }));
    });
    const out = [idx], inSet = new Set([idx]);
    const P0 = editJoinPath(entities[idx]);
    [P0[0], P0[P0.length - 1]].forEach((start) => {
        let cur = idx, p = start;
        for(let guard = 0; guard < 100000; guard++) {
            const others = ix.near(p).filter(c => c.i !== cur);
            if(others.length !== 1 || !others[0].ok) break; // 分かれ道・行き止まり・円弧
            const o = others[0];
            if(inSet.has(o.i)) break; // 一周した
            inSet.add(o.i); out.push(o.i);
            const Q = editJoinPath(entities[o.i]);
            cur = o.i; p = o.k === 0 ? Q[Q.length - 1] : Q[0];
        }
    });
    return out;
}

// ===== フィレット・面取り =====
function _editUnit(dx, dy) { const L = Math.hypot(dx, dy); return L > 0 ? { x: dx / L, y: dy / L } : null; }
// 線 e の上で、角 P から選んだ点 tap の側へ向かう向き d と、その側の一番遠い端 far（s: P からの長さ）
function _editKeepSide(e, P, tap) {
    const u = _editUnit(e.x2 - e.x1, e.y2 - e.y1);
    if(!u) return null;
    const along = (x, y) => (x - P.x) * u.x + (y - P.y) * u.y;
    const s1 = along(e.x1, e.y1), s2 = along(e.x2, e.y2);
    let sg = Math.sign(along(tap.x, tap.y));
    if(Math.abs(along(tap.x, tap.y)) <= 1e-9 * (Math.abs(s1) + Math.abs(s2) + 1) || !sg) sg = Math.abs(s1) >= Math.abs(s2) ? Math.sign(s1) : Math.sign(s2);
    const d = { x: u.x * sg, y: u.y * sg };
    const far = sg * s1 >= sg * s2 ? { x: e.x1, y: e.y1, s: sg * s1, end: 1 } : { x: e.x2, y: e.y2, s: sg * s2, end: 2 };
    return { d, far };
}
// 2本の線（を延ばした直線）の交点。平行なら null
function editLineCross(e1, e2) {
    const dx1 = e1.x2 - e1.x1, dy1 = e1.y2 - e1.y1, dx2 = e2.x2 - e2.x1, dy2 = e2.y2 - e2.y1;
    const den = dx1 * dy2 - dy1 * dx2, L = Math.hypot(dx1, dy1) * Math.hypot(dx2, dy2);
    if(!(L > 0) || Math.abs(den) <= 1e-12 * L) return null;
    const t = ((e2.x1 - e1.x1) * dy2 - (e2.y1 - e1.y1) * dx2) / den;
    return { x: e1.x1 + dx1 * t, y: e1.y1 + dy1 * t };
}
// 2本の線の角を処理した形（まだ図面は変えない）。t1・t2 は線を選んだ点（角のどちら側を残すか）。
// opt: { mode: 'fillet', radius } … r > 0 は円弧でつなぎ、r = 0 は延ばす・切って角を出す
//      { mode: 'chamfer', dist, by: 'leg'|'base' } … 角から両方の線に沿って dist（base なら切る線の長さが dist）の所を結ぶ
// 返り値: { l1: {x1,y1,x2,y2}, l2: {...}, arc?: {cx,cy,radius,startAngle,endAngle}, seg?: {x1,y1,x2,y2} } または { error }
function editFilletLines(e1, t1, e2, t2, opt) {
    const P = editLineCross(e1, e2);
    if(!P) return { error: '平行な線（一直線の線）は処理できません' };
    const A = _editKeepSide(e1, P, t1), B = _editKeepSide(e2, P, t2);
    if(!A || !B) return { error: '長さの無い線です' };
    const cosT = Math.max(-1, Math.min(1, A.d.x * B.d.x + A.d.y * B.d.y)), th = Math.acos(cosT);
    if(!(th > 1e-9 && th < Math.PI - 1e-9)) return { error: '一直線の線は処理できません' };
    const tol = 1e-9 * (A.far.s + B.far.s + 1);
    // 線の、残す端 far から新しい端 q まで（元の線の向きを保つ）
    const keep = (e, side, q) => side.far.end === 1 ? { x1: e.x1, y1: e.y1, x2: q.x, y2: q.y } : { x1: q.x, y1: q.y, x2: e.x2, y2: e.y2 };
    const at = (side, s) => ({ x: P.x + side.d.x * s, y: P.y + side.d.y * s });
    if(opt.mode === 'chamfer') {
        let d = +opt.dist;
        if(!(d > 0)) return { error: '面取りの長さを入れてください' };
        if(opt.by === 'base') d = d / (2 * Math.sin(th / 2)); // 二等辺三角形の底辺 → 角からの長さ
        if(d > A.far.s + tol || d > B.far.s + tol) return { error: '面取りの長さが線より長いです' };
        const a = at(A, d), b = at(B, d);
        return { l1: keep(e1, A, a), l2: keep(e2, B, b), seg: { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, corner: P, legs: d };
    }
    const r = +opt.radius || 0;
    if(r < 0) return { error: '半径は 0 以上です' };
    if(r === 0) return { l1: keep(e1, A, P), l2: keep(e2, B, P), corner: P };
    const td = r / Math.tan(th / 2);
    if(td > A.far.s + tol || td > B.far.s + tol) return { error: '半径が大きすぎます（線が短い）' };
    const T1 = at(A, td), T2 = at(B, td);
    const bis = _editUnit(A.d.x + B.d.x, A.d.y + B.d.y), h = r / Math.sin(th / 2);
    const C = { x: P.x + bis.x * h, y: P.y + bis.y * h };
    const a1 = Math.atan2(T1.y - C.y, T1.x - C.x), a2 = Math.atan2(T2.y - C.y, T2.x - C.x);
    // 短い方の円弧（左回り）
    const arc = normalizeAngle(a2 - a1) <= Math.PI
        ? { cx: C.x, cy: C.y, radius: r, startAngle: normalizeAngle(a1), endAngle: normalizeAngle(a2), counterclockwise: true }
        : { cx: C.x, cy: C.y, radius: r, startAngle: normalizeAngle(a2), endAngle: normalizeAngle(a1), counterclockwise: true };
    return { l1: keep(e1, A, T1), l2: keep(e2, B, T2), arc, corner: P };
}
// 点の列 pts（closed なら閉じた形）の頂点 v を面取りした点の列。opt は editFilletLines と同じ（面取りだけ）
function editChamferVertex(pts, closed, v, opt) {
    const n = pts.length;
    if(n < 3 || (!closed && (v <= 0 || v >= n - 1))) return { error: '端の点は面取りできません' };
    const cur = pts[v], prev = pts[(v - 1 + n) % n], next = pts[(v + 1) % n];
    const u1 = _editUnit(prev.x - cur.x, prev.y - cur.y), u2 = _editUnit(next.x - cur.x, next.y - cur.y);
    if(!u1 || !u2) return { error: '重なった点です' };
    const th = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
    if(!(th > 1e-9 && th < Math.PI - 1e-9)) return { error: 'この点は角ではありません（まっすぐ）' };
    let d = +opt.dist;
    if(!(d > 0)) return { error: '面取りの長さを入れてください' };
    if(opt.by === 'base') d = d / (2 * Math.sin(th / 2));
    const L1 = Math.hypot(prev.x - cur.x, prev.y - cur.y), L2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const tol = 1e-9 * (L1 + L2 + 1);
    if(d > L1 + tol || d > L2 + tol) return { error: '面取りの長さが辺より長いです' };
    const a = { x: cur.x + u1.x * d, y: cur.y + u1.y * d }, b = { x: cur.x + u2.x * d, y: cur.y + u2.y * d };
    const out = pts.slice(0, v).concat([a, b], pts.slice(v + 1)).map(p => ({ x: p.x, y: p.y }));
    // 辺の長さちょうどの面取りでできた、隣と同じ点は1つに
    const clean = [];
    out.forEach(p => { if(!clean.length || Math.hypot(clean[clean.length - 1].x - p.x, clean[clean.length - 1].y - p.y) > tol) clean.push(p); });
    if(closed && clean.length > 1 && Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].y - clean[clean.length - 1].y) <= tol) clean.pop();
    return { points: clean, seg: { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, legs: d };
}
// 点 (px,py) に一番近い、ポリライン（長方形）の角の頂点の番号（開いた形の端は除く）
function editNearestCorner(pts, closed, px, py) {
    let best = -1, bd = Infinity;
    pts.forEach((p, i) => {
        if(!closed && (i === 0 || i === pts.length - 1)) return;
        const d = Math.hypot(p.x - px, p.y - py);
        if(d < bd) { bd = d; best = i; }
    });
    return best;
}

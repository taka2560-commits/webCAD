'use strict';
// 計算ゲート（tests/calc-gate.test.cjs）の「答え」を出す道具。
//
// 考え方: アプリの関数は呼ばず、式も写さずに、定義から組み立て直した計算で答えを出す。
//   ・方向角は半角の公式（2·atan）で出す（アプリは atan2）
//   ・直交座標の差は「最初の点からの差」で計算し、公共座標（数十万 m）でも桁が落ちないようにする
//   ・ヘルマート変換は正規方程式をガウスの消去法で解く（アプリは重心を引いた閉じた式）。1/1 はガウス・ニュートン法
//   ・平面直角座標は Karney（2011）の級数（n の6次まで）と、子午線弧長を数値積分（シンプソン則）で出す。逆は順変換のニュートン法
//   ・地積の端数は、数の2進の正確な値から BigInt で小数6桁に丸め、整数で切り捨てる
// 座標の約束: 測量の X ＝ 北・Y ＝ 東（m）、図面の x ＝ 東・y ＝ 北。方向角は北から右回り（度）。

// ===== 乱数（種を決めると毎回同じ並び） =====
function mulberry32(seed) {
    let a = seed >>> 0;
    return function() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// 乱数の道具: 区間 [lo, hi) の一様な数・整数
function rng(seed) {
    const r = mulberry32(seed);
    const u = (lo, hi) => lo + (hi - lo) * r();
    return { r, u, int: (lo, hi) => Math.floor(u(lo, hi + 1)), pick: (arr) => arr[Math.floor(r() * arr.length)] };
}

const D2R = Math.PI / 180;
// 0 以上 360 未満の度
function normDeg(d) { let x = d % 360; if(x < 0) x += 360; if(x >= 360) x -= 360; return x; }
// 2つの角度（度）の差（円周上で一番近い差。0〜180）
function angDiff(a, b) { const d = Math.abs(normDeg(a) - normDeg(b)); return Math.min(d, 360 - d); }
// 2つのラジアンの差（円周上。0〜π）
function radDiff(a, b) { let d = (a - b) % (2 * Math.PI); if(d < 0) d += 2 * Math.PI; return Math.min(d, 2 * Math.PI - d); }

// 度の cos・sin（90° の倍数は正確に 0・±1 になるよう、象限を分けてから計算する）
function cosSinDeg(deg) {
    const k = Math.round(deg / 90), r = (deg - 90 * k) * D2R, c = Math.cos(r), s = Math.sin(r);
    switch(((k % 4) + 4) % 4) {
        case 0: return { c, s };
        case 1: return { c: -s, s: c };
        case 2: return { c: -c, s: -s };
        default: return { c: s, s: -c };
    }
}
// ベクトル（北 dX・東 dY）の方向角（度）。半角の公式: θ = 2·atan(dY / (r + dX))（dX ≥ 0）、θ = 2·atan((r − dX) / dY)（dX < 0）
function azOf(dX, dY) {
    const r = Math.sqrt(dX * dX + dY * dY);
    if(r === 0) return 0;
    let th;
    if(dX >= 0) th = 2 * Math.atan(dY / (r + dX));
    else if(dY !== 0) th = 2 * Math.atan((r - dX) / dY);
    else th = Math.PI;
    return normDeg(th / D2R);
}

// ===== 2点の計算（測量座標） =====
function inverse(a, b) {
    const dX = b.X - a.X, dY = b.Y - a.Y;
    return { dX, dY, dist: Math.sqrt(dX * dX + dY * dY), az: azOf(dX, dY) };
}
function polar(a, az, d) { const cs = cosSinDeg(az); return { X: a.X + d * cs.c, Y: a.Y + d * cs.s }; }
function azFromBacksight(st, bs, ang) { return normDeg(azOf(bs.X - st.X, bs.Y - st.Y) + ang); }

// ===== 交点（測量座標） =====
// 直線 p + t·u と q + s·v の交点（延長線上でもよい）。向きの sin が minSin より小さいと平行として null
function lineMeet(p, u, q, v, minSin) {
    const cr = u.X * v.Y - u.Y * v.X, lu = Math.hypot(u.X, u.Y), lv = Math.hypot(v.X, v.Y);
    if(!(lu > 0 && lv > 0) || Math.abs(cr) < (minSin || 0) * lu * lv || cr === 0) return null;
    const wX = q.X - p.X, wY = q.Y - p.Y, t = (wX * v.Y - wY * v.X) / cr;
    return { X: p.X + t * u.X, Y: p.Y + t * u.Y, t, sin: Math.abs(cr) / (lu * lv) };
}
function intersectLines(p1, p2, p3, p4) {
    return lineMeet(p1, { X: p2.X - p1.X, Y: p2.Y - p1.Y }, p3, { X: p4.X - p3.X, Y: p4.Y - p3.Y }, 1e-12);
}
function intersectAzimuths(a, azA, b, azB) {
    const ca = cosSinDeg(azA), cb = cosSinDeg(azB);
    return lineMeet(a, { X: ca.c, Y: ca.s }, b, { X: cb.c, Y: cb.s }, 1e-12);
}
// 距離の交会。a→b を見て右（方向角 +90°）と左
function intersectDistances(a, da, b, db) {
    const ab = inverse(a, b), d = ab.dist;
    if(!(d > 0) || !(da > 0) || !(db > 0)) return null;
    if(da + db < d || Math.abs(da - db) > d) return null;
    const along = (d * d + da * da - db * db) / (2 * d), h2 = da * da - along * along, h = h2 > 0 ? Math.sqrt(h2) : 0;
    const f = cosSinDeg(ab.az), rt = cosSinDeg(ab.az + 90);
    const m = { X: a.X + along * f.c, Y: a.Y + along * f.s };
    return { right: { X: m.X + h * rt.c, Y: m.Y + h * rt.s }, left: { X: m.X - h * rt.c, Y: m.Y - h * rt.s } };
}

// ===== 面積（座標法） =====
// 最初の点からの差で倍面積（符号つき）を出す。周長も
function shoelace(pts) {
    const n = pts.length, o = pts[0];
    let tw = 0, per = 0;
    for(let i = 0; i < n; i++) {
        const p = pts[i], q = pts[(i + 1) % n];
        const px = p.X - o.X, py = p.Y - o.Y, qx = q.X - o.X, qy = q.Y - o.Y;
        tw += px * qy - qx * py;
        per += Math.hypot(q.X - p.X, q.Y - p.Y);
    }
    // 測量の向き（X 北・Y 東）では Σ Xn(Yn+1 − Yn−1) ＝ 上の和（X を横軸に見たときの外積の和）
    return { twiceSigned: tw, area: Math.abs(tw) / 2, perimeter: per };
}
// 図面の点 { x, y } の多角形の面積（最初の点からの差）
function polyAreaXY(pts) { return shoelace(pts.map((p) => ({ X: p.x, Y: p.y }))).area; }

// 数（double）の正確な値を小数6桁に丸めた整数（×10⁶）。ちょうど半分なら大きい方（Number.prototype.toFixed と同じ決まり）
function microOf(v) {
    if(!isFinite(v)) throw new Error('有限の数ではありません');
    const x = Math.abs(v);
    if(x === 0) return 0n;
    // x ＝ m·2^e（m は整数）に分ける
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, x);
    const hi = buf.getUint32(0), lo = buf.getUint32(4);
    const expBits = (hi >>> 20) & 0x7ff;
    let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo), e;
    if(expBits === 0) e = -1074; else { m |= 1n << 52n; e = expBits - 1075; }
    const M = 10n ** 6n;
    if(e >= 0) return (m << BigInt(e)) * M;
    const den = 1n << BigInt(-e), num = m * M, q = num / den, r = num - q * den;
    return 2n * r >= den ? q + 1n : q;
}
// 地積（登記）の端数。'cm': 1㎡の1/100 未満を切り捨て（小数2桁の文字）、'm': 10㎡を超えるなら 1㎡ 未満を切り捨て（整数の文字）
function landArea(area, mode) {
    const u = microOf(area);
    if(mode === 'm' && u > 10n * 10n ** 6n) return String(u / 10n ** 6n);
    const c = u / 10n ** 4n; // 0.01㎡ の数（切り捨て）
    return String(c / 100n) + '.' + String(c % 100n).padStart(2, '0');
}

// 多角形の辺が真に交差するか（隣り合わない辺の組を総当たり。端で触れるだけは数えない）
function polySelfIntersects(pts) {
    const n = pts.length;
    if(n < 4) return false;
    const orient = (o, a, b) => Math.sign((a.X - o.X) * (b.Y - o.Y) - (a.Y - o.Y) * (b.X - o.X));
    for(let i = 0; i < n; i++) for(let j = 0; j < n; j++) {
        if(j === i || (i + 1) % n === j || (j + 1) % n === i) continue;
        const a = pts[i], b = pts[(i + 1) % n], c = pts[j], d = pts[(j + 1) % n];
        const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
        if(o1 * o2 < 0 && o3 * o4 < 0) return true;
    }
    return false;
}

// ===== 連立一次方程式（ガウスの消去法・部分ピボット） =====
function solveLinear(A, b) {
    const n = A.length, M = A.map((row, i) => row.concat([b[i]]));
    for(let c = 0; c < n; c++) {
        let p = c;
        for(let r = c + 1; r < n; r++) if(Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
        if(M[p][c] === 0) return null;
        [M[c], M[p]] = [M[p], M[c]];
        for(let r = c + 1; r < n; r++) {
            const f = M[r][c] / M[c][c];
            for(let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
        }
    }
    const x = new Array(n).fill(0);
    for(let r = n - 1; r >= 0; r--) {
        let s = M[r][n];
        for(let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
        x[r] = s / M[r][r];
    }
    return x;
}
function invert(A) {
    const n = A.length, cols = [];
    for(let j = 0; j < n; j++) cols.push(solveLinear(A, A.map((_, i) => (i === j ? 1 : 0))));
    return A.map((_, i) => cols.map((c) => c[i]));
}
const quad = (Q, g) => g.reduce((s, gi, i) => s + gi * g.reduce((t, gj, j) => t + Q[i][j] * gj, 0), 0);

// ===== 2次元の相似変換・1/1（回転・移動）の最小二乗 =====
// pairs: [{ src: { X, Y }, dst: { X, Y } }]、mode: 'sim' | 'rigid'
// 戻り値: { apply(X, Y), scale, rot（右回りが正のラジアン）, sigma0, dof, Qinv（未知数の余因子行列）, residuals, pointSigma(X, Y), sRot, sScale, sShift }
function helmertLsq(pairs, mode) {
    const n = pairs.length, s0 = pairs[0].src, d0 = pairs[0].dst;
    const loc = pairs.map((p) => ({ x: p.src.X - s0.X, y: p.src.Y - s0.Y, u: p.dst.X - d0.X, v: p.dst.Y - d0.Y }));
    let fwd, J, Q, rot, scale, params;
    if(mode === 'sim') {
        // u = a·x − b·y + tx、v = b·x + a·y + ty
        const N = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], rhs = [0, 0, 0, 0];
        const add = (row, l) => { for(let i = 0; i < 4; i++) { rhs[i] += row[i] * l; for(let j = 0; j < 4; j++) N[i][j] += row[i] * row[j]; } };
        loc.forEach((q) => { add([q.x, -q.y, 1, 0], q.u); add([q.y, q.x, 0, 1], q.v); });
        params = solveLinear(N, rhs);
        if(!params) return null;
        const [a, b, tx, ty] = params;
        fwd = (x, y) => ({ u: a * x - b * y + tx, v: b * x + a * y + ty });
        J = (x, y) => [[x, -y, 1, 0], [y, x, 0, 1]];
        Q = invert(N);
        scale = Math.hypot(a, b); rot = Math.atan2(b, a);
    } else {
        // u = cosθ·x − sinθ·y + tx、v = sinθ·x + cosθ·y + ty（ガウス・ニュートン法）
        const L = loc[n - 1];
        let th = Math.atan2(L.v, L.u) - Math.atan2(L.y, L.x), tx = 0, ty = 0, N;
        if(!isFinite(th)) th = 0;
        for(let it = 0; it < 100; it++) {
            const c = Math.cos(th), s = Math.sin(th);
            N = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
            const rhs = [0, 0, 0];
            const add = (row, l) => { for(let i = 0; i < 3; i++) { rhs[i] += row[i] * l; for(let j = 0; j < 3; j++) N[i][j] += row[i] * row[j]; } };
            loc.forEach((q) => {
                add([-s * q.x - c * q.y, 1, 0], q.u - (c * q.x - s * q.y + tx));
                add([c * q.x - s * q.y, 0, 1], q.v - (s * q.x + c * q.y + ty));
            });
            const dx = solveLinear(N, rhs);
            if(!dx) return null;
            th += dx[0]; tx += dx[1]; ty += dx[2];
            if(Math.abs(dx[0]) < 1e-16 && Math.abs(dx[1]) < 1e-13 && Math.abs(dx[2]) < 1e-13 && it > 2) break;
        }
        const c = Math.cos(th), s = Math.sin(th);
        params = [th, tx, ty];
        fwd = (x, y) => ({ u: c * x - s * y + tx, v: s * x + c * y + ty });
        J = (x, y) => [[-s * x - c * y, 1, 0], [c * x - s * y, 0, 1]];
        Q = invert(N);
        scale = 1; rot = Math.atan2(s, c);
    }
    const apply = (X, Y) => { const r = fwd(X - s0.X, Y - s0.Y); return { X: d0.X + r.u, Y: d0.Y + r.v }; };
    let ss = 0;
    const residuals = pairs.map((p) => { const q = apply(p.src.X, p.src.Y), dX = q.X - p.dst.X, dY = q.Y - p.dst.Y; ss += dX * dX + dY * dY; return { dX, dY, d: Math.hypot(dX, dY) }; });
    const dof = 2 * n - (mode === 'sim' ? 4 : 3), sigma0 = dof > 0 ? Math.sqrt(ss / dof) : null;
    // 変換した点の X・Y それぞれの標準偏差（誤差の伝播）
    const pointSigma = (X, Y) => { if(sigma0 === null) return null; const j = J(X - s0.X, Y - s0.Y); return { sX: sigma0 * Math.sqrt(quad(Q, j[0])), sY: sigma0 * Math.sqrt(quad(Q, j[1])) }; };
    let sRot = null, sScale = null, sShift = null;
    if(sigma0 !== null) {
        if(mode === 'sim') {
            const [a, b] = params, s2 = a * a + b * b, Qab = [[Q[0][0], Q[0][1]], [Q[1][0], Q[1][1]]];
            sRot = sigma0 * Math.sqrt(quad(Qab, [-b / s2, a / s2]));
            sScale = sigma0 * Math.sqrt(quad(Qab, [a / Math.sqrt(s2), b / Math.sqrt(s2)]));
        } else { sRot = sigma0 * Math.sqrt(Q[0][0]); sScale = 0; }
        let cx = 0, cy = 0;
        pairs.forEach((p) => { cx += p.src.X; cy += p.src.Y; });
        sShift = pointSigma(cx / n, cy / n).sX;
    }
    return { apply, scale, rot, sigma0, dof, residuals, pointSigma, sRot, sScale, sShift, params };
}

// ===== 円 =====
// 3点を通る円（重心からの差で、垂直二等分線の連立方程式を解く）
function circleThrough3(a, b, c) {
    const gx = (a.x + b.x + c.x) / 3, gy = (a.y + b.y + c.y) / 3;
    const A = { x: a.x - gx, y: a.y - gy }, B = { x: b.x - gx, y: b.y - gy }, C = { x: c.x - gx, y: c.y - gy };
    // |P − A|² = |P − B|²  →  2(B − A)·P = |B|² − |A|²
    const M = [[2 * (B.x - A.x), 2 * (B.y - A.y)], [2 * (C.x - A.x), 2 * (C.y - A.y)]];
    const r = [B.x * B.x + B.y * B.y - A.x * A.x - A.y * A.y, C.x * C.x + C.y * C.y - A.x * A.x - A.y * A.y];
    const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
    if(det === 0) return null;
    const px = (r[0] * M[1][1] - M[0][1] * r[1]) / det, py = (M[0][0] * r[1] - r[0] * M[1][0]) / det;
    return { cx: gx + px, cy: gy + py, r: Math.hypot(px - A.x, py - A.y) };
}
function circleDiameter(a, b) { const r = Math.hypot(b.x - a.x, b.y - a.y) / 2; return r > 0 ? { cx: a.x + (b.x - a.x) / 2, cy: a.y + (b.y - a.y) / 2, r } : null; }

// 直線（a→b）から点 p までの距離
function distToLine(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y; return Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / Math.hypot(dx, dy); }
// 線分までの最短距離（端点で止める）
function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    if(L === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// 2つの「中心が通る所」（直線 { k:'line', p, u } か円 { k:'circle', c, r }）の交点
function lociMeet(A, B) {
    if(A.k === 'circle' && B.k === 'line') return lociMeet(B, A);
    if(A.k === 'line' && B.k === 'line') {
        const m = lineMeet({ X: A.p.x, Y: A.p.y }, { X: A.u.x, Y: A.u.y }, { X: B.p.x, Y: B.p.y }, { X: B.u.x, Y: B.u.y }, 1e-12);
        return m ? [{ x: m.X, y: m.Y }] : [];
    }
    if(A.k === 'line') {
        // |p + t·u − c|² = r²（u は単位ベクトル）
        const L = Math.hypot(A.u.x, A.u.y), ux = A.u.x / L, uy = A.u.y / L;
        const wx = A.p.x - B.c.x, wy = A.p.y - B.c.y, t0 = -(wx * ux + wy * uy);
        const fx = wx + t0 * ux, fy = wy + t0 * uy, h2 = B.r * B.r - (fx * fx + fy * fy);
        if(h2 < -1e-9 * B.r * B.r) return [];
        const h = Math.sqrt(Math.max(0, h2));
        return [t0 - h, t0 + h].map((t) => ({ x: A.p.x + t * ux, y: A.p.y + t * uy }));
    }
    return circlesMeet(A.c, A.r, B.c, B.r);
}
// 2つの円（中心 c・半径 r）の交点
function circlesMeet(c1, r1, c2, r2) {
    const dx = c2.x - c1.x, dy = c2.y - c1.y, d = Math.hypot(dx, dy);
    if(!(d > 0) || d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
    const a = (d * d + r1 * r1 - r2 * r2) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
    const ex = dx / d, ey = dy / d, mx = c1.x + a * ex, my = c1.y + a * ey;
    if(h === 0) return [{ x: mx, y: my }];
    return [{ x: mx - h * ey, y: my + h * ex }, { x: mx + h * ey, y: my - h * ex }];
}
// 半径 r の円が形 s（{ k:'line', a, b } か { k:'circle', c, r }）に接するときの中心が通る所
function tanLoci(s, r) {
    if(s.k === 'line') {
        const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
        return [{ k: 'line', p: { x: s.a.x + nx * r, y: s.a.y + ny * r }, u: { x: dx, y: dy } }, { k: 'line', p: { x: s.a.x - nx * r, y: s.a.y - ny * r }, u: { x: dx, y: dy } }];
    }
    const out = [{ k: 'circle', c: s.c, r: s.r + r }];
    if(Math.abs(s.r - r) > 0) out.push({ k: 'circle', c: s.c, r: Math.abs(s.r - r) });
    return out;
}
// 中心 c・半径 r の円が形 s に接する点
function tanPoint(s, c, r) {
    if(s.k === 'line') {
        const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, t = ((c.x - s.a.x) * dx + (c.y - s.a.y) * dy) / (dx * dx + dy * dy);
        return { x: s.a.x + t * dx, y: s.a.y + t * dy };
    }
    const d = Math.hypot(c.x - s.c.x, c.y - s.c.y), ux = (c.x - s.c.x) / d, uy = (c.y - s.c.y) / d;
    // 外接なら中心の向き、内接（r > R で相手を包む）なら逆向きの点も候補。円 c までの距離が r に近い方
    const p = { x: s.c.x + s.r * ux, y: s.c.y + s.r * uy }, q = { x: s.c.x - s.r * ux, y: s.c.y - s.r * uy };
    return Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r) <= Math.abs(Math.hypot(q.x - c.x, q.y - c.y) - r) ? p : q;
}
// 2つの形に接する半径 r の円の候補を全部（接する点がタップした所に近い順）
function tanTanRadiusAll(s1, p1, s2, p2, r) {
    const out = [];
    tanLoci(s1, r).forEach((A) => tanLoci(s2, r).forEach((B) => lociMeet(A, B).forEach((c) => {
        const t1 = tanPoint(s1, c, r), t2 = tanPoint(s2, c, r);
        out.push({ cx: c.x, cy: c.y, r, t1, t2, score: Math.hypot(t1.x - p1.x, t1.y - p1.y) + Math.hypot(t2.x - p2.x, t2.y - p2.y) });
    })));
    return out.sort((a, b) => a.score - b.score);
}

// ===== 線分・円の交点（図面の座標） =====
function segCircle(a, b, c, r) {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    if(L === 0) return [];
    const ux = dx / L, uy = dy / L, wx = c.x - a.x, wy = c.y - a.y, s0 = wx * ux + wy * uy;
    const fx = wx - s0 * ux, fy = wy - s0 * uy, h2 = r * r - (fx * fx + fy * fy);
    if(h2 < 0) return [];
    const h = Math.sqrt(h2);
    return [s0 - h, s0 + h].filter((s) => s >= 0 && s <= L).map((s) => ({ x: a.x + s * ux, y: a.y + s * uy, t: s / L }));
}
function segSeg(a, b, c, d) {
    const m = lineMeet({ X: a.x, Y: a.y }, { X: b.x - a.x, Y: b.y - a.y }, { X: c.x, Y: c.y }, { X: d.x - c.x, Y: d.y - c.y }, 0);
    if(!m) return null;
    // 2本目の線の上の位置
    const dx = d.x - c.x, dy = d.y - c.y, s = ((m.X - c.x) * dx + (m.Y - c.y) * dy) / (dx * dx + dy * dy);
    return { x: m.X, y: m.Y, t: m.t, s };
}

// ===== 平面直角座標系（GRS80・m0 = 0.9999） =====
const GRS80 = { a: 6378137, f: 1 / 298.257222101 };
const K0 = 0.9999;
// 19 の系の原点（緯度・経度。度・分）
const ZONES = [null,
    [33, 0, 129, 30], [33, 0, 131, 0], [36, 0, 132, 10], [33, 0, 133, 30], [36, 0, 134, 20], [36, 0, 136, 0], [36, 0, 137, 10],
    [36, 0, 138, 30], [36, 0, 139, 50], [40, 0, 140, 50], [44, 0, 140, 15], [44, 0, 142, 15], [44, 0, 144, 15], [26, 0, 142, 0],
    [26, 0, 127, 30], [26, 0, 124, 0], [26, 0, 131, 0], [20, 0, 136, 0], [26, 0, 154, 0]].map((z) => (z ? { lat: z[0] + z[1] / 60, lon: z[2] + z[3] / 60 } : null));
const E2 = GRS80.f * (2 - GRS80.f), ECC = Math.sqrt(E2), NN = GRS80.f / (2 - GRS80.f);
// 子午線弧長（赤道から緯度 φ ラジアンまで）。M(φ) = ∫ a(1−e²)/(1−e² sin²t)^1.5 dt をシンプソン則で
function meridianArc(phi) {
    const N = 4096, h = phi / N, f = (t) => { const s = Math.sin(t); return GRS80.a * (1 - E2) / Math.pow(1 - E2 * s * s, 1.5); };
    let sum = f(0) + f(phi), comp = 0;
    for(let i = 1; i < N; i++) {
        const y = (i % 2 ? 4 : 2) * f(i * h) - comp, t = sum + y; // カハンの加算
        comp = (t - sum) - y; sum = t;
    }
    return sum * h / 3;
}
const RECT_A = meridianArc(Math.PI / 2) / (Math.PI / 2); // 等距離の半径（子午線の4分の1の長さ ÷ π/2）
// Karney（2011）の α（n の6次まで）
const ALPHA = (() => {
    const n = NN, n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
    return [0,
        n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
        13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
        61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
        49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
        34729 * n5 / 80640 - 3418889 * n6 / 1995840,
        212378941 * n6 / 319334400];
})();
const _m0cache = new Map();
function _zoneM0(zone) { if(!_m0cache.has(zone)) _m0cache.set(zone, meridianArc(ZONES[zone].lat * D2R)); return _m0cache.get(zone); }
// 緯度・経度（度）→ 平面直角座標 { X（北）, Y（東） }（m）
function gkForward(lat, lon, zone) {
    const z = ZONES[zone], phi = lat * D2R, lam = (lon - z.lon) * D2R;
    const tau = Math.tan(phi), sig = Math.sinh(ECC * Math.atanh(ECC * tau / Math.sqrt(1 + tau * tau)));
    const taup = tau * Math.sqrt(1 + sig * sig) - sig * Math.sqrt(1 + tau * tau); // 等角緯度の tan
    const xip = Math.atan2(taup, Math.cos(lam)), etap = Math.asinh(Math.sin(lam) / Math.sqrt(taup * taup + Math.cos(lam) ** 2));
    let xi = xip, eta = etap;
    for(let j = 1; j <= 6; j++) {
        xi += ALPHA[j] * Math.sin(2 * j * xip) * Math.cosh(2 * j * etap);
        eta += ALPHA[j] * Math.cos(2 * j * xip) * Math.sinh(2 * j * etap);
    }
    return { X: K0 * RECT_A * xi - K0 * _zoneM0(zone), Y: K0 * RECT_A * eta };
}
// 平面直角座標 → 緯度・経度（度）。順変換をニュートン法で解く
function gkInverse(X, Y, zone) {
    const z = ZONES[zone];
    let lat = z.lat + X / 111000, lon = z.lon + Y / (111000 * Math.cos(lat * D2R));
    const h = 1e-6;
    for(let it = 0; it < 30; it++) {
        const f = gkForward(lat, lon, zone), fx = gkForward(lat + h, lon, zone), fy = gkForward(lat, lon + h, zone);
        const a = (fx.X - f.X) / h, b = (fy.X - f.X) / h, c = (fx.Y - f.Y) / h, d = (fy.Y - f.Y) / h, det = a * d - b * c;
        const rX = X - f.X, rY = Y - f.Y, dLat = (d * rX - b * rY) / det, dLon = (-c * rX + a * rY) / det;
        lat += dLat; lon += dLon;
        if(Math.abs(dLat) < 1e-14 && Math.abs(dLon) < 1e-14) break;
    }
    return { lat, lon };
}

// ===== UCS・図面の変換（図面の座標 x 東・y 北。角度は左回りが正のラジアン） =====
const rot2 = (x, y, th) => ({ x: x * Math.cos(th) - y * Math.sin(th), y: x * Math.sin(th) + y * Math.cos(th) });
function ucsToWcs(u, ux, uy) { const r = rot2(ux, uy, u.angle); return { x: u.originX + r.x, y: u.originY + r.y }; }
function wcsToUcs(u, wx, wy) { return rot2(wx - u.originX, wy - u.originY, -u.angle); }
// 一般の変換 p' = t + M (p − o)（M = [[a, c], [b, d]]）
function affine(M, o, t, p) { const dx = p.x - o.x, dy = p.y - o.y; return { x: t.x + M.a * dx + M.c * dy, y: t.y + M.b * dx + M.d * dy }; }
function rotateAbout(o, ang, p) { const r = rot2(p.x - o.x, p.y - o.y, ang); return { x: o.x + r.x, y: o.y + r.y }; }
function scaleAbout(o, k, p) { return { x: o.x + k * (p.x - o.x), y: o.y + k * (p.y - o.y) }; }
// 2点 a・b を通る直線を鏡にした点（足を求めて、反対側へ同じだけ）
function mirrorAcross(a, b, p) {
    const dx = b.x - a.x, dy = b.y - a.y, t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
    const fx = a.x + t * dx, fy = a.y + t * dy;
    return { x: 2 * fx - p.x, y: 2 * fy - p.y };
}
// 測量座標（m）⇔ 図面の座標（f: 図面の1単位が何分の1 m か。m なら 1、mm なら 1000）
function surveyToWcs(f, X, Y) { return { x: Y * f, y: X * f }; }
function wcsToSurvey(f, x, y) { return { X: y / f, Y: x / f }; }

// ===== トータルステーションの観測 → 座標 =====
// st: 器械点 { X, Y, Z, ih }、bsAz: 後視の方向角（度）、bsH: 後視を視準したときの水平角（度）、
// obs: { sd: 斜距離, z: 天頂角（度）, h: 水平角（度） }、th: 目標高、sf: 縮尺係数
function tsReduce(st, bsAz, bsH, obs, th, sf) {
    const zc = cosSinDeg(obs.z); // 天頂角の cos・sin
    const hd = obs.sd * zc.s * sf, vd = obs.sd * zc.c;
    const az = normDeg(bsAz + (obs.h - bsH));
    const p = polar(st, az, hd);
    return { X: p.X, Y: p.Y, Z: st.Z === null ? null : st.Z + st.ih + vd - th, hd, vd, az };
}

// ===== 度分秒の文字（秒は整数に丸める） =====
function dmsText(deg) {
    let s = Math.round(normDeg(deg) * 3600);
    if(s >= 360 * 3600) s -= 360 * 3600;
    const D = Math.floor(s / 3600), M = Math.floor((s % 3600) / 60), S = s % 60;
    return `${D}°${String(M).padStart(2, '0')}′${String(S).padStart(2, '0')}″`;
}

module.exports = {
    mulberry32, rng, D2R, normDeg, angDiff, radDiff, cosSinDeg, azOf,
    inverse, polar, azFromBacksight, lineMeet, intersectLines, intersectAzimuths, intersectDistances,
    shoelace, polyAreaXY, microOf, landArea, polySelfIntersects,
    solveLinear, invert, helmertLsq,
    circleThrough3, circleDiameter, distToLine, distToSeg, lociMeet, circlesMeet, tanLoci, tanPoint, tanTanRadiusAll,
    segCircle, segSeg,
    GRS80, K0, ZONES, meridianArc, gkForward, gkInverse,
    ucsToWcs, wcsToUcs, affine, rotateAbout, scaleAbout, mirrorAcross, surveyToWcs, wcsToSurvey,
    tsReduce, dmsText,
};

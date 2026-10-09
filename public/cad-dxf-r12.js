// ===== Web CAD DXF の書き出し（Jw_cad・古い CAD 向け: R12・Shift-JIS・mm） =====
// cad-dxf-r12.js - ☰「DXF 出力（Jw_cad 向け）」（コマンド DXFJW）。AutoCAD 向け（cad-io.js の exportDxf。AutoCAD 2007 形式・UTF-8）とは別に、
//   Jw_cad が読みやすい形で書く:
//   ・AutoCAD R12 形式（AC1009）。R12 に無い図形は置き換える: 長方形・ポリライン・楕円 → POLYLINE、複数行の文字 → 1行ずつの TEXT、
//     塗りつぶし → SOLID（横の帯の台形に分ける）、斜線などの模様 → 範囲で切った LINE、寸法 → 線・円弧・矢印（SOLID）・文字
//   ・文字は Shift-JIS（$DWGCODEPAGE ANSI_932）。Shift-JIS に無い記号は置き換える（⌀ → φ、m² → ㎡、㎥ → m3、㉑ → (21)、↔ → ⇔。ほかは「?」）。
//     画層・線種の名前は、Shift-JIS に無い文字を「_」にする（「?」は名前に使えないため）
//   ・長さは mm（Jw_cad は mm で読むので、図面の1単位が m なら 1000 倍）
//   ・測点は点（POINT。高さ Z つき）と点名の文字（属性は Jw_cad が読まないため）
//   ・線種は線種表と画層・図形の線種の名前、色は画層と図形の色番号。線の太さ・図形ごとの線種の尺度は R12 に無いので書かない

function _r12Num(v) {
    if(!Number.isFinite(v)) return '0';
    const s = v.toFixed(8).replace(/\.?0+$/, '');
    return s === '-0' ? '0' : s;
}
// 文字: 改行は空白に、Shift-JIS に無い記号は近い文字に（丸数字は ⑳ まで Shift-JIS にある）
function _r12Circled(ch) {
    const c = ch.codePointAt(0), n = (c >= 0x3251 && c <= 0x325F) ? c - 0x3251 + 21 : (c >= 0x32B1 && c <= 0x32BF) ? c - 0x32B1 + 36 : 0;
    return n ? `(${n})` : ch;
}
function _r12Text(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[\r\n]+/g, ' ')
        .replace(/⌀/g, 'φ').replace(/m²/g, '㎡').replace(/²/g, '2').replace(/㎥/g, 'm3').replace(/³/g, '3').replace(/↔/g, '⇔')
        .replace(/[㉑-㉟㊱-㊿]/g, _r12Circled);
}
// Shift-JIS で表せる文字か（表せない文字は、書き出すと「?」になる）
const _r12SjisOk = new Map();
function _r12CanSjis(ch) {
    if(ch.codePointAt(0) < 0x80) return true;
    let ok = _r12SjisOk.get(ch);
    if(ok === undefined) { const b = encodeShiftJis(ch); ok = !(b.length === 1 && b[0] === 0x3F); _r12SjisOk.set(ch, ok); }
    return ok;
}
// 画層・線種の名前: DXF の名前に使えない文字と、Shift-JIS に無い文字（そのままだと「?」になる）は「_」
function _r12Name(s) {
    const t = Array.from(_r12Text(s).replace(/[<>/\\":;?*|=,`]/g, '_')).map(ch => _r12CanSjis(ch) ? ch : '_').join('').trim();
    return t || '0';
}

// 塗りつぶし: 輪（偶奇の規則。穴・離れた輪も）を、横の帯の台形（SOLID の4隅: 左下・右下・左上・右上）に分ける
function r12FillTrapezoids(rings) {
    const edges = [];
    rings.forEach(r => { for(let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; if(a.y !== b.y) edges.push(a.y < b.y ? [a, b] : [b, a]); } });
    const ys = [...new Set(rings.flat().map(p => p.y))].sort((p, q) => p - q);
    const out = [];
    const xAt = (e, y) => e[0].x + (e[1].x - e[0].x) * (y - e[0].y) / (e[1].y - e[0].y);
    for(let i = 0; i + 1 < ys.length; i++) {
        const y0 = ys[i], y1 = ys[i + 1], ym = (y0 + y1) / 2;
        const cut = edges.filter(e => e[0].y <= ym && e[1].y > ym).sort((a, b) => xAt(a, ym) - xAt(b, ym));
        for(let k = 0; k + 1 < cut.length; k += 2) {
            const a = cut[k], b = cut[k + 1];
            out.push([{ x: xAt(a, y0), y: y0 }, { x: xAt(b, y0), y: y0 }, { x: xAt(a, y1), y: y1 }, { x: xAt(b, y1), y: y1 }]);
        }
    }
    return out;
}
// 線分 a-b のうち、輪の内側（偶奇の規則）にある部分
function r12ClipSegment(a, b, rings) {
    const ts = [0, 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    rings.forEach(r => { for(let i = 0; i < r.length; i++) {
        const p = r[i], q = r[(i + 1) % r.length], ex = q.x - p.x, ey = q.y - p.y;
        const den = dx * ey - dy * ex;
        if(Math.abs(den) < 1e-15) continue;
        const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den, u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
        if(t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    } });
    ts.sort((p, q) => p - q);
    const inside = (x, y) => {
        let c = false;
        rings.forEach(r => { for(let i = 0, j = r.length - 1; i < r.length; j = i++) { const p = r[i], q = r[j]; if((p.y > y) !== (q.y > y) && x < (q.x - p.x) * (y - p.y) / (q.y - p.y) + p.x) c = !c; } });
        return c;
    };
    const out = [];
    for(let i = 0; i + 1 < ts.length; i++) {
        const tm = (ts[i] + ts[i + 1]) / 2;
        if(ts[i + 1] - ts[i] > 1e-12 && inside(a.x + dx * tm, a.y + dy * tm)) out.push([{ x: a.x + dx * ts[i], y: a.y + dy * ts[i] }, { x: a.x + dx * ts[i + 1], y: a.y + dy * ts[i + 1] }]);
    }
    return out;
}
// 塗りつぶしの範囲の輪（形の分からないものは null）
function _r12HatchRings(tg) {
    if(tg.type === 'PLINE' && tg.points && tg.points.length >= 3) return [tg.points].concat((tg.holes || []).filter(r => r && r.length >= 3));
    if(tg.type === 'RECTANG') return [[{ x: tg.x1, y: tg.y1 }, { x: tg.x2, y: tg.y1 }, { x: tg.x2, y: tg.y2 }, { x: tg.x1, y: tg.y2 }]];
    if(tg.type === 'CIRCLE') { const r0 = []; for(let k = 0; k < 72; k++) { const a = k / 72 * Math.PI * 2; r0.push({ x: tg.cx + tg.radius * Math.cos(a), y: tg.cy + tg.radius * Math.sin(a) }); } return [r0]; }
    return null;
}

// R12 の DXF の文字を作る。戻り値 { text, count（書いた図形）, skipped（書けなかった図形） }
function buildDxfR12() {
    const uf = (typeof surveyUnitFactor === 'function') ? surveyUnitFactor() : 1; // 図面の1単位が m なら 1、mm なら 1000
    const f = 1000 / uf; // mm にする倍率
    const L = [];
    const g = (c, v) => { L.push(String(c).padStart(3, ' ')); L.push(String(v)); };
    const n = (c, v) => g(c, _r12Num(v));
    const P = (c, x, y, z) => { n(c, x * f); n(c + 10, y * f); n(c + 20, (z || 0) * f); };
    const names = new Map(); // 名前の置き換えは、同じ名前ごとに1回
    const nm = (s) => { let v = names.get(s); if(v === undefined) { v = _r12Name(s); names.set(s, v); } return v; };
    const layerOf = (e) => nm((layers[e.layer] && layers[e.layer].name) || '0');
    const ltOf = (s) => nm(String(s).trim().toUpperCase());
    const head = (type, e, layer) => {
        g(0, type); g(8, layer !== undefined ? layer : layerOf(e));
        if(e && e.lt) g(6, ltOf(e.lt));
        if(e && e.color) g(62, hexToAci(e.color));
    };
    let count = 0, skipped = 0;
    const ents = [];
    const E = (fn) => ents.push(fn);
    const line = (e, x1, y1, x2, y2, layer) => E(() => { head('LINE', e, layer); P(10, x1, y1); P(11, x2, y2); });
    const poly = (e, pts, closed) => E(() => {
        const ly = layerOf(e);
        head('POLYLINE', e); g(66, 1); P(10, 0, 0); g(70, closed ? 1 : 0);
        pts.forEach(p => { g(0, 'VERTEX'); g(8, ly); P(10, p.x, p.y); });
        g(0, 'SEQEND'); g(8, ly);
    });
    const solid = (e, q, layer) => E(() => { head('SOLID', e, layer); P(10, q[0].x, q[0].y); P(11, q[1].x, q[1].y); P(12, q[2].x, q[2].y); P(13, q[3].x, q[3].y); });
    // 文字（H: 0 左・1 中央・2 右、V: 0 基準線・1 下・2 中央・3 上。左・基準線以外は 11 が位置）
    const text = (e, x, y, h, rot, s, H, V, layer) => E(() => {
        head('TEXT', e, layer); P(10, x, y); n(40, (h || 2.5) * f); g(1, _r12Text(s)); n(50, (rot || 0) * 180 / Math.PI);
        if(H || V) { g(72, H); P(11, x, y); if(V) g(73, V); }
    });
    const HA = { left: 0, center: 1, right: 2 }, VA = { bottom: 0, middle: 2, top: 3 }; // アプリの「下」は基準線
    const dimK = (typeof dimExportTextHeight === 'function' ? dimExportTextHeight() : 2.5) / DIM_TEXT_SIZE;
    entities.forEach(e => {
        if(!e) return;
        const t = e.type;
        if(t === 'LINE') line(e, e.x1, e.y1, e.x2, e.y2);
        else if(t === 'CIRCLE') E(() => { head('CIRCLE', e); P(10, e.cx, e.cy); n(40, e.radius * f); });
        else if(t === 'ARC') E(() => {
            let sa = e.startAngle * 180 / Math.PI, ea = e.endAngle * 180 / Math.PI;
            if(e.counterclockwise === false) { const s0 = sa; sa = ea; ea = s0; } // DXF の円弧は左回り
            head('ARC', e); P(10, e.cx, e.cy); n(40, e.radius * f); n(50, sa); n(51, ea);
        });
        else if(t === 'RECTANG') poly(e, [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y1 }, { x: e.x2, y: e.y2 }, { x: e.x1, y: e.y2 }], true);
        else if(t === 'PLINE' && e.points && e.points.length >= 2) poly(e, e.points, !!e.closed);
        else if(t === 'ELLIPSE') {
            // R12 に楕円は無いので、72 角形のポリライン
            const pts = [], r = e.rotation || 0, c = Math.cos(r), s = Math.sin(r);
            for(let k = 0; k < 72; k++) { const a = k / 72 * Math.PI * 2, u = e.rx * Math.cos(a), v = e.ry * Math.sin(a); pts.push({ x: e.cx + u * c - v * s, y: e.cy + u * s + v * c }); }
            poly(e, pts, true);
        }
        else if(t === 'POINT') E(() => { head('POINT', e); P(10, e.x, e.y, (typeof e.z === 'number' && isFinite(e.z)) ? e.z * uf : 0); }); // 標高（m）→ 図面の単位
        else if(t === 'TEXT') {
            // 複数行は1行ずつ（アプリは文字の 1.4 倍ずつ下へずらして描く）
            const r = e.rotation || 0, h = e.height || 2.5;
            String(e.text || '').split('\n').forEach((s, i) => text(e, e.x + Math.sin(r) * i * 1.4 * h, e.y - Math.cos(r) * i * 1.4 * h, h, r, s, HA[e.halign] || 0, VA[e.valign] || 0));
        }
        else if(t === 'DIMENSION') {
            // 寸法は、線・円弧・矢印（SOLID）・文字にする（画層「寸法」。AutoCAD 向けの以前の書き方と同じ形）
            const D = dimExportPrims(e, dimK, true);
            D.lines.forEach(l => line(null, l.x1, l.y1, l.x2, l.y2, '寸法'));
            D.arcs.forEach(a => E(() => { head('ARC', null, '寸法'); P(10, a.cx, a.cy); n(40, a.r * f); n(50, a.sa * 180 / Math.PI); n(51, a.ea * 180 / Math.PI); }));
            D.arrows.forEach(a => {
                const c = Math.cos(a.a), s = Math.sin(a.a), bx = a.x - a.size * c, by = a.y - a.size * s, w = a.size / 3;
                const b1 = { x: bx - w * s, y: by + w * c }, b2 = { x: bx + w * s, y: by - w * c };
                solid(null, [{ x: a.x, y: a.y }, b1, b2, b2], '寸法');
            });
            D.texts.forEach(tx => text(null, tx.x, tx.y, tx.h, tx.ang, tx.s, HA[tx.ha] || 0, tx.va === 'bottom' ? 1 : (VA[tx.va] || 0), '寸法'));
        }
        else if(t === 'HATCH') {
            const rings = e.target ? _r12HatchRings(e.target) : null;
            if(!rings) { skipped++; return; }
            if(e.pat) {
                // 斜線などの模様は、範囲で切った線（線・間の長さは省いて実線）。細かすぎる・形の分からない模様は書かない
                // （ソリッドにすると、模様の所が黒く塗りつぶされてしまうため）
                const segs = [];
                if(!printHatchLines(e, f, (a, b) => segs.push([a, b]), () => {}, () => {})) { skipped++; return; }
                segs.forEach(([a, b]) => r12ClipSegment(a, b, rings).forEach(([p, q]) => line(e, p.x, p.y, q.x, q.y)));
            } else r12FillTrapezoids(rings).forEach(q => solid(e, q)); // 塗り（単色）は SOLID
        }
        else if(t === 'PIN') return; // 現場写真・メモのピンはアプリだけのもの
        else { skipped++; return; }
        count++;
    });

    // 図面の範囲（Jw_cad は読み込むときの縮尺・位置に使う）
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    entities.forEach(e => {
        if(!e || e.type === 'DIMENSION' || e.type === 'PIN') return;
        let b;
        try { b = e.type === 'HATCH' ? (e.target ? calcBBox(e.target) : null) : (e.bbox || calcBBox(e)); } catch { b = null; }
        if(b && isFinite(b.minX) && isFinite(b.maxX)) { minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY); maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY); }
    });
    if(!isFinite(minX)) { minX = minY = 0; maxX = maxY = 1; }

    // ---- ヘッダー ----
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1009');
    g(9, '$DWGCODEPAGE'); g(3, 'ANSI_932');
    g(9, '$INSBASE'); P(10, 0, 0);
    g(9, '$INSUNITS'); g(70, 4); // mm（R12 には無い変数だが、読めるソフトは単位に使い、読めないソフトは飛ばす）
    g(9, '$EXTMIN'); P(10, minX, minY);
    g(9, '$EXTMAX'); P(10, maxX, maxY);
    g(9, '$LTSCALE'); n(40, (typeof getDrawingLtscale === 'function' ? getDrawingLtscale() : 1) * f);
    g(0, 'ENDSEC');
    // ---- 表: 線種・画層・文字のスタイル ----
    g(0, 'SECTION'); g(2, 'TABLES');
    const lts = new Map([['CONTINUOUS', null]]);
    const addLt = (s) => { const k = ltOf(s); if(!/^(BYLAYER|BYBLOCK)$/.test(k) && !lts.has(k)) lts.set(k, s); };
    layers.forEach(l => { if(l && l.lt) addLt(l.lt); });
    entities.forEach(e => { if(e && e.lt) addLt(e.lt); });
    g(0, 'TABLE'); g(2, 'LTYPE'); g(70, lts.size);
    lts.forEach((orig, k) => {
        const pat = (orig && typeof ltypePattern === 'function' && ltypePattern(orig)) || [];
        g(0, 'LTYPE'); g(2, k); g(70, 0); g(3, orig ? _r12Text(typeof ltypeLabel === 'function' ? ltypeLabel(orig) : orig) : 'Solid line'); g(72, 65); g(73, pat.length);
        n(40, pat.reduce((a, v) => a + Math.abs(v), 0)); pat.forEach(v => n(49, v));
    });
    g(0, 'ENDTAB');
    const lay = new Map();
    layers.forEach(l => { if(!l) return; const k = nm(l.name || '0'); if(!lay.has(k)) lay.set(k, l); });
    if(!lay.has('0')) lay.set('0', { color: '#ffffff' });
    if(!lay.has('寸法')) lay.set('寸法', { color: '#00ffff' });
    g(0, 'TABLE'); g(2, 'LAYER'); g(70, lay.size);
    lay.forEach((l, k) => { const aci = hexToAci(l.color || '#ffffff') || 7; g(0, 'LAYER'); g(2, k); g(70, 0); g(62, l.visible === false ? -aci : aci); g(6, l.lt ? ltOf(l.lt) : 'CONTINUOUS'); });
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1);
    // 日本語は big font（extfont2.shx。AutoCAD・互換ソフトにある）で表示する（無いと「?」になる。Jw_cad は自分の書体で表示する）
    g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'txt'); g(4, 'extfont2.shx');
    g(0, 'ENDTAB');
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'BLOCKS'); g(0, 'ENDSEC');
    // ---- 図形 ----
    g(0, 'SECTION'); g(2, 'ENTITIES');
    ents.forEach(fn => fn());
    g(0, 'ENDSEC');
    g(0, 'EOF');
    return { text: L.join('\r\n') + '\r\n', count, skipped };
}

// ☰「DXF 出力（Jw_cad 向け）」
function exportDxfJw() {
    try {
        const r = buildDxfR12();
        const name = exportFileName('dxf').replace(/\.dxf$/i, '_jw.dxf');
        const saving = Promise.resolve(downloadBlob(new Blob([encodeShiftJis(r.text)], { type: 'application/dxf' }), name));
        if(r.skipped > 0) addCommandLog(`  注意: 書き出しに未対応の図形 ${r.skipped}個 を省略しました`);
        saving.then((n) => {
            if(n === null) return; // 名前の欄で「やめる」
            notify(`-> DXF（Jw_cad 向け: R12・Shift-JIS・mm）を書き出しました${n ? `: ${n}` : ''}`, { kind: 'success', ms: 2500 });
        });
    } catch(err) {
        notify(`エラー: DXF（Jw_cad 向け）を書き出せませんでした - ${err.message}`, { kind: 'error', ms: 5000 });
        console.error('DXF（Jw_cad 向け）の書き出しエラー:', err);
    }
}

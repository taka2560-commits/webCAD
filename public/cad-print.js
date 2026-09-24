// ===== Web CAD 縮尺印刷・PDF =====
// cad-print.js - 用紙（A4〜A1・横縦）と縮尺（1/S）を決めて、図面を正しい縮尺の PDF（ベクター）にする。
//   印刷する範囲は画面の中央（パネルを開いている間は、図面に用紙の枠を重ねて見せる）。画面の回転（PLAN）もそのまま。
//   図枠・表題欄（図面名・縮尺・用紙・日付・作成者）・方位記号・縮尺バーを入れる。
//   PDF はこのファイルで書く（外部ライブラリなし）。日本語の文字は PDF 閲覧ソフトの標準の日本語フォント
//   （平成角ゴシック・埋め込まない。UniJIS-UCS2-HW-H で半角 500・全角 1000 の幅）で表す。
//   印刷は「実際のサイズ（100%）」で行う（用紙に合わせると縮尺が変わる）。PDF にも拡大縮小しない指定（PrintScaling None）を入れる。

const PRINT_TITLE = '🖨 印刷・PDF';
const PRINT_PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594] }; // 横向きの幅×高さ（mm）
const PRINT_SCALES = [100, 200, 250, 300, 500, 600, 1000, 2500, 5000];
const PRINT_MARGIN = 10;           // 用紙の余白（mm）
const PRINT_TB = { w: 96, row: 7 }; // 表題欄（mm）: 幅と1行の高さ（4行）
const PRINT_OPTS_KEY = 'cad_print_opts';
const PT_PER_MM = 72 / 25.4;

function printOpts() {
    const def = { paper: 'A3', orient: 'land', scale: 500, color: 'mono', author: '' };
    try { return Object.assign(def, JSON.parse(localStorage.getItem(PRINT_OPTS_KEY) || '{}')); } catch { return def; }
}
function _printSaveOpts(o) { try { localStorage.setItem(PRINT_OPTS_KEY, JSON.stringify(o)); } catch { /* 保存できなくても続行 */ } }
// 用紙の大きさ（mm）と、図枠の内側（図を描く範囲）
function printPaperMm(o) {
    const p = PRINT_PAPERS[o.paper] || PRINT_PAPERS.A3;
    const [W, H] = o.orient === 'port' ? [p[1], p[0]] : [p[0], p[1]];
    return { W, H, inner: { x: PRINT_MARGIN, y: PRINT_MARGIN, w: W - PRINT_MARGIN * 2, h: H - PRINT_MARGIN * 2 } };
}
// 図面の1単位が用紙で何 mm か（1/S、図面の単位 m・mm）
function printMmPerUnit(scale) { return 1000 / (scale * surveyUnitFactor()); }

// ===== PDF を書く小さな道具 =====
// 数値（小数3桁まで・末尾の0を省く）
function pdfNum(v) {
    if(!isFinite(v)) return '0';
    let s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
    if(s === '-0' || s === '') s = '0';
    return s;
}
// 文字 → UTF-16BE の16進（BMP 外の文字は ? にする）
function pdfHexText(str) {
    let h = '';
    for(const ch of String(str)) {
        const c = ch.codePointAt(0);
        h += (c > 0xffff ? 0x3f : c).toString(16).toUpperCase().padStart(4, '0');
    }
    return h;
}
// 文字の幅（全角 1.0・半角 0.5 × 文字の大きさ）。UniJIS-UCS2-HW-H の半角（ASCII・半角カナ）は幅 500
function pdfTextWidth(str, size) {
    let w = 0;
    for(const ch of String(str)) { const c = ch.codePointAt(0); w += (c <= 0x7e || (c >= 0xff61 && c <= 0xff9f)) ? 0.5 : 1; }
    return w * size;
}
// 16進の色 → PDF の 0〜1 の RGB。mono は黒。カラーは白い紙で読めるよう明るい色を濃くする（白・灰色は黒）
function printColor(hex, mode) {
    if(mode === 'mono') return [0, 0, 0];
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || ''));
    if(!m) return [0, 0, 0];
    let s = m[1];
    if(s.length === 3) s = s.split('').map((c) => c + c).join('');
    let r = parseInt(s.slice(0, 2), 16) / 255, g = parseInt(s.slice(2, 4), 16) / 255, b = parseInt(s.slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if(mx - mn < 0.15) return [0, 0, 0]; // 白・灰色・黒は黒
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if(lum > 0.5) { const k = 0.5 / lum; r *= k; g *= k; b *= k; }
    return [r, g, b];
}
/**
 * PDF を作る。doc: 1ページなら { W, H（pt）, content（描画命令の文字列）, images }、複数ページなら { pages: [同じ形, …] }。
 *   images: [{ name（描画命令で /名前 Do と使う）, jpeg（Uint8Array）, w, h（画素） }]（JPEG をそのまま入れる）
 * info: { title }。compress: CompressionStream があれば描画命令を Flate で縮める。戻り値は Uint8Array
 * 1ページ目の番号の並び（1〜10）は、以前の1ページだけの PDF と同じ。2ページ目以降・画像はその後ろに足す。
 */
async function pdfBuild(doc, info, compress) {
    const enc = new window.TextEncoder();
    const pages = doc.pages || [doc];
    const deflate = async (u8) => {
        if(!compress || typeof window.CompressionStream !== 'function') return null;
        try {
            const cs = new window.CompressionStream('deflate');
            return new Uint8Array(await new window.Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer());
        } catch { return null; } // 縮められなければそのまま
    };
    const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    const date = `D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const font = 'HeiseiKakuGo-W5';
    // 番号: 1 目録, 2 ページの束, 3・4 1ページ目と描画命令, 5〜7 フォント, 8・9 透明度, 10 情報, 11〜 2ページ目以降（ページ・描画命令）と画像
    const pageNo = [3], contNo = [4];
    let next = 11;
    for(let i = 1; i < pages.length; i++) { pageNo.push(next++); contNo.push(next++); }
    const imgNo = pages.map((pg) => (pg.images || []).map(() => next++));
    const objs = new Array(next - 1).fill(null); // objs[番号 - 1] = 文字列、またはストリーム { dict, data }
    objs[0] = '<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >> >>';
    objs[1] = `<< /Type /Pages /Kids [${pageNo.map((n) => n + ' 0 R').join(' ')}] /Count ${pages.length} >>`;
    objs[4] = `<< /Type /Font /Subtype /Type0 /BaseFont /${font} /Encoding /UniJIS-UCS2-HW-H /DescendantFonts [6 0 R] >>`;
    objs[5] = `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /${font} /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 7 0 R /DW 1000 /W [231 389 500] >>`;
    objs[6] = `<< /Type /FontDescriptor /FontName /${font} /Flags 4 /FontBBox [-92 -250 1010 922] /ItalicAngle 0 /Ascent 752 /Descent -271 /CapHeight 737 /StemV 114 >>`;
    objs[7] = '<< /Type /ExtGState /ca 1 /CA 1 >>';
    objs[8] = '<< /Type /ExtGState /ca 0.3 >>';
    objs[9] = `<< /Title <FEFF${pdfHexText(info.title || '')}> /Creator (Web CAD) /Producer (Web CAD) /CreationDate (${date}) >>`;
    for(let i = 0; i < pages.length; i++) {
        const pg = pages[i], imgs = pg.images || [];
        const xo = imgs.length ? ` /XObject << ${imgs.map((im, j) => `/${im.name} ${imgNo[i][j]} 0 R`).join(' ')} >>` : '';
        objs[pageNo[i] - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNum(pg.W)} ${pdfNum(pg.H)}] /Resources << /Font << /F1 5 0 R >> /ExtGState << /GS0 8 0 R /GS1 9 0 R >>${xo} >> /Contents ${contNo[i]} 0 R >>`;
        const raw = enc.encode(pg.content), z = await deflate(raw);
        objs[contNo[i] - 1] = { dict: z ? ' /Filter /FlateDecode' : '', data: z || raw };
        imgs.forEach((im, j) => {
            objs[imgNo[i][j] - 1] = { dict: ` /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, data: im.jpeg };
        });
    }
    const chunks = [], offsets = [];
    let len = 0;
    const push = (u8) => { chunks.push(u8); len += u8.length; };
    const pushS = (s) => push(enc.encode(s));
    pushS('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // バイナリを含むことの印（%âãÏÓ）
    objs.forEach((o, i) => {
        offsets.push(len);
        if(o && typeof o === 'object') {
            pushS(`${i + 1} 0 obj\n<< /Length ${o.data.length}${o.dict} >>\nstream\n`);
            push(o.data);
            pushS('\nendstream\nendobj\n');
        } else pushS(`${i + 1} 0 obj\n${o}\nendobj\n`);
    });
    const xref = len;
    pushS(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
    pushS(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 10 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len);
    let pos = 0;
    chunks.forEach((c) => { out.set(c, pos); pos += c.length; });
    return out;
}

// ===== 図面 → 用紙の描画命令 =====
/**
 * 印刷の中身（描画命令）を作る。o: 印刷の設定、center: 印刷の中心（図面の座標）、rot: 画面の回転
 * 戻り値: { W, H（pt）, content, count（描いた図形の数） }
 */
function printCompose(o, center, rot, meta) {
    const P = printPaperMm(o), mmU = printMmPerUnit(o.scale), k = PT_PER_MM;
    const cxP = P.inner.x + P.inner.w / 2, cyP = P.inner.y + P.inner.h / 2;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    // 図面の座標 → 用紙の pt（y 上向き。画面と同じ向きに回す）
    const T = (x, y) => { const dx = (x - center.x) * mmU, dy = (y - center.y) * mmU; return [(cxP + dx * cs - dy * sn) * k, (cyP + dx * sn + dy * cs) * k]; };
    const out = [];
    let stroke = '', fill = '', lw = '';
    const setStroke = (c) => { const s = c.map(pdfNum).join(' ') + ' RG'; if(s !== stroke) { out.push(s); stroke = s; } };
    const setFill = (c) => { const s = c.map(pdfNum).join(' ') + ' rg'; if(s !== fill) { out.push(s); fill = s; } };
    const setW = (mm) => { const s = pdfNum(mm * k) + ' w'; if(s !== lw) { out.push(s); lw = s; } };
    const M = (p) => pdfNum(p[0]) + ' ' + pdfNum(p[1]);
    // 円弧（図面の角度 a0 から開き da。反時計回りが正）を 90° 以下の3次ベジェに分けて足す
    const arcPath = (cx, cy, r, a0, da, move) => {
        const n = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 2)));
        const d = da / n, kk = 4 / 3 * Math.tan(d / 4);
        let a = a0;
        const pt = (t) => T(cx + r * Math.cos(t), cy + r * Math.sin(t));
        if(move) out.push(M(pt(a)) + ' m');
        for(let i = 0; i < n; i++) {
            const b = a + d;
            const p1 = T(cx + r * (Math.cos(a) - kk * Math.sin(a)), cy + r * (Math.sin(a) + kk * Math.cos(a)));
            const p2 = T(cx + r * (Math.cos(b) + kk * Math.sin(b)), cy + r * (Math.sin(b) - kk * Math.cos(b)));
            out.push(M(p1) + ' ' + M(p2) + ' ' + M(pt(b)) + ' c');
            a = b;
        }
    };
    const poly = (pts, closed, op) => {
        if(pts.length < 2) return;
        out.push(M(T(pts[0].x, pts[0].y)) + ' m');
        for(let i = 1; i < pts.length; i++) out.push(M(T(pts[i].x, pts[i].y)) + ' l');
        out.push((closed ? 'h ' : '') + op);
    };
    // 文字（図面の位置・向き（ラジアン）・大きさ（図面の単位））。複数行は下へ 1.4 倍の間隔
    const text = (s, x, y, hWorld, ang, ha, va, color) => {
        const size = hWorld * mmU * k;
        if(!(size > 0.3) || !String(s).length) return;
        setFill(color);
        const a = (ang || 0) + rot, ca = Math.cos(a), sa = Math.sin(a);
        const base = T(x, y);
        String(s).split('\n').forEach((line, i) => {
            if(!line) return;
            const w = pdfTextWidth(line, size);
            const ox = ha === 'center' ? -w / 2 : ha === 'right' ? -w : 0;
            const oy = (va === 'middle' ? -size * 0.35 : va === 'top' ? -size * 0.8 : 0) - i * size * 1.4;
            const px = base[0] + ox * ca - oy * sa, py = base[1] + ox * sa + oy * ca;
            out.push(`BT /F1 ${pdfNum(size)} Tf ${pdfNum(ca)} ${pdfNum(sa)} ${pdfNum(-sa)} ${pdfNum(ca)} ${pdfNum(px)} ${pdfNum(py)} Tm <${pdfHexText(line)}> Tj ET`);
        });
    };
    // 印刷する範囲（図面の座標の外接矩形）: 範囲の外の図形は描かない
    const inv = (px, py) => { const dx = (px - cxP) / mmU, dy = (py - cyP) / mmU; return { x: center.x + dx * cs + dy * sn, y: center.y - dx * sn + dy * cs }; };
    const corners = [inv(P.inner.x, P.inner.y), inv(P.inner.x + P.inner.w, P.inner.y), inv(P.inner.x, P.inner.y + P.inner.h), inv(P.inner.x + P.inner.w, P.inner.y + P.inner.h)];
    const win = { minX: Math.min(...corners.map((c) => c.x)), maxX: Math.max(...corners.map((c) => c.x)), minY: Math.min(...corners.map((c) => c.y)), maxY: Math.max(...corners.map((c) => c.y)) };
    const outside = (e) => {
        const b = (e.type === 'DIMENSION' || e.type === 'HATCH') ? null : (e.bbox || calcBBox(e));
        return b && isFinite(b.minX) && (b.maxX < win.minX || b.minX > win.maxX || b.maxY < win.minY || b.minY > win.maxY);
    };

    // 図を描く範囲で切り抜く
    out.push('q', `${pdfNum(P.inner.x * k)} ${pdfNum(P.inner.y * k)} ${pdfNum(P.inner.w * k)} ${pdfNum(P.inner.h * k)} re W n`, '1 J 1 j');
    let count = 0;
    const dimK = 2.5 / mmU / dimSizePx(DIM_TEXT_SIZE); // 寸法の文字を用紙で 2.5mm にする
    const drawShape = (e, c) => {
        const t = e.type;
        if(t === 'LINE') { out.push(M(T(e.x1, e.y1)) + ' m ' + M(T(e.x2, e.y2)) + ' l S'); return; }
        if(t === 'PLINE' && e.points) { poly(e.points, e.closed, 'S'); return; }
        if(t === 'RECTANG') { poly([{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y1 }, { x: e.x2, y: e.y2 }, { x: e.x1, y: e.y2 }], true, 'S'); return; }
        if(t === 'CIRCLE') { arcPath(e.cx, e.cy, e.radius, 0, Math.PI * 2, true); out.push('h S'); return; }
        if(t === 'ARC') {
            const ccw = e.counterclockwise !== false;
            let da = ccw ? e.endAngle - e.startAngle : e.startAngle - e.endAngle;
            da = ((da % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) || Math.PI * 2;
            arcPath(e.cx, e.cy, e.radius, e.startAngle, ccw ? da : -da, true); out.push('S'); return;
        }
        if(t === 'ELLIPSE') {
            // 単位円の4つのベジェを、楕円の向き・半径で写す
            const r0 = e.rotation || 0, c0 = Math.cos(r0), s0 = Math.sin(r0), kk = 0.5522847498;
            const E = (u, v) => T(e.cx + e.rx * u * c0 - e.ry * v * s0, e.cy + e.rx * u * s0 + e.ry * v * c0);
            const q = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 0]];
            out.push(M(E(1, 0)) + ' m');
            for(let i = 0; i < 4; i++) {
                const [u0, v0] = q[i], [u1, v1] = q[i + 1];
                out.push(M(E(u0 - kk * v0, v0 + kk * u0)) + ' ' + M(E(u1 + kk * v1, v1 - kk * u1)) + ' ' + M(E(u1, v1)) + ' c');
            }
            out.push('h S'); return;
        }
        if(t === 'POINT') {
            const s = T(e.x, e.y), r = 0.8 * k;
            out.push(`${pdfNum(s[0] - r)} ${pdfNum(s[1])} m ${pdfNum(s[0] + r)} ${pdfNum(s[1])} l ${pdfNum(s[0])} ${pdfNum(s[1] - r)} m ${pdfNum(s[0])} ${pdfNum(s[1] + r)} l S`);
            return;
        }
        if(t === 'TEXT') { text(e.text, e.x, e.y, e.height || 10, e.rotation || 0, e.halign, e.valign, c); return; }
        if(t === 'DIMENSION') {
            const D = dimExportPrims(e, dimK);
            setW(0.13);
            D.lines.forEach((l) => out.push(M(T(l.x1, l.y1)) + ' m ' + M(T(l.x2, l.y2)) + ' l S'));
            D.arcs.forEach((a) => { let da = a.ea - a.sa; da = ((da % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); arcPath(a.cx, a.cy, a.r, a.sa, da, true); out.push('S'); });
            setFill(c);
            D.arrows.forEach((a) => {
                const bx = a.x - a.size * Math.cos(a.a), by = a.y - a.size * Math.sin(a.a), wv = a.size * 0.18;
                const nx = -Math.sin(a.a) * wv, ny = Math.cos(a.a) * wv;
                out.push(M(T(a.x, a.y)) + ' m ' + M(T(bx + nx, by + ny)) + ' l ' + M(T(bx - nx, by - ny)) + ' l h f');
            });
            D.texts.forEach((tx) => text(tx.s, tx.x, tx.y, tx.h, tx.ang, tx.ha, tx.va, c));
            setW(0.2);
            return;
        }
        if(t === 'HATCH' && e.target) {
            const g = e.target;
            out.push('/GS1 gs');
            setFill(c);
            if(g.type === 'CIRCLE') { arcPath(g.cx, g.cy, g.radius, 0, Math.PI * 2, true); out.push('h f'); }
            else if(g.type === 'RECTANG') poly([{ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y1 }, { x: g.x2, y: g.y2 }, { x: g.x1, y: g.y2 }], true, 'f');
            else if(g.type === 'PLINE' && g.points) poly(g.points, true, 'f');
            out.push('/GS0 gs');
        }
    };
    // 現場写真・メモのピンは、写真台帳と同じ番号の丸で描く
    const pinNo = new Map();
    entities.forEach((e) => { if(e && e.type === 'PIN') pinNo.set(e, pinNo.size + 1); });
    const drawPin = (e) => {
        const s = T(e.x, e.y), r = 1.8 * k, cy = s[1] + r + 1.2 * k;
        out.push('1 1 1 rg');
        fill = '';
        out.push(`${M(s)} m ${M([s[0], cy - r])} l S`);
        arcPathPt(s[0], cy, r);
        out.push('b');
        setFill([0, 0, 0]);
        const lab = String(pinNo.get(e));
        out.push(`BT /F1 ${pdfNum(2.2 * k)} Tf 1 0 0 1 ${pdfNum(s[0] - pdfTextWidth(lab, 2.2 * k) / 2)} ${pdfNum(cy - 0.8 * k)} Tm <${pdfHexText(lab)}> Tj ET`);
    };
    // 用紙の pt で円を描く（ピン用）
    const arcPathPt = (cx, cy, r) => {
        const kk = 0.5522847498;
        out.push(`${pdfNum(cx + r)} ${pdfNum(cy)} m`);
        [[0, 1], [-1, 0], [0, -1], [1, 0]].reduce((prev, cur) => {
            out.push(`${pdfNum(cx + r * (prev[0] - kk * prev[1]))} ${pdfNum(cy + r * (prev[1] + kk * prev[0]))} ${pdfNum(cx + r * (cur[0] + kk * cur[1]))} ${pdfNum(cy + r * (cur[1] - kk * cur[0]))} ${pdfNum(cx + r * cur[0])} ${pdfNum(cy + r * cur[1])} c`);
            return cur;
        }, [1, 0]);
    };
    setW(0.2);
    entities.forEach((e) => {
        if(!e || e.hidden) return;
        if(e.layer !== undefined && layers[e.layer] && layers[e.layer].visible === false) return;
        if(outside(e)) return;
        const c = printColor(getEntityColor(e), o.color);
        setStroke(c);
        if(e.type === 'PIN') drawPin(e); else drawShape(e, c);
        count++;
    });
    out.push('Q');
    // 方位記号（右上）: 北は図面の +y を画面と同じだけ回した向き
    {
        const r = 6, ox = P.inner.x + P.inner.w - r - 5, oy = P.inner.y + P.inner.h - r - 5, na = Math.PI / 2 + rot;
        const ptm = (ang, rr) => [(ox + rr * Math.cos(ang)) * k, (oy + rr * Math.sin(ang)) * k];
        setStroke([0, 0, 0]); setFill([0, 0, 0]); setW(0.25);
        out.push(`1 1 1 rg ${pdfNum((ox - r - 1) * k)} ${pdfNum((oy - r - 1) * k)} ${pdfNum((2 * r + 2) * k)} ${pdfNum((2 * r + 2 + 4) * k)} re f`); fill = '';
        setFill([0, 0, 0]);
        out.push(M(ptm(na, r)) + ' m ' + M(ptm(na + 2.6, r * 0.75)) + ' l ' + M(ptm(0, 0)) + ' l ' + M(ptm(na - 2.6, r * 0.75)) + ' l h B');
        const np = ptm(na, r + 2.8);
        out.push(`BT /F1 ${pdfNum(3 * k)} Tf 1 0 0 1 ${pdfNum(np[0] - pdfTextWidth('N', 3 * k) / 2)} ${pdfNum(np[1] - 1 * k)} Tm <${pdfHexText('N')}> Tj ET`);
    }
    // 縮尺バー（左下）: 用紙で 30〜60mm になる切りのよい長さ
    {
        const mPerMm = o.scale / 1000, raw = 40 * mPerMm, p10 = Math.pow(10, Math.floor(Math.log10(raw)));
        const Lm = [1, 2, 5, 10].map((m) => m * p10).reduce((best, v) => Math.abs(Math.log(v / raw)) < Math.abs(Math.log(best / raw)) ? v : best, p10);
        const Lmm = Lm / mPerMm, x0 = P.inner.x + 5, y0 = P.inner.y + 6, hh = 1.5;
        out.push(`1 1 1 rg ${pdfNum((x0 - 2) * k)} ${pdfNum((y0 - 2) * k)} ${pdfNum((Lmm + 22) * k)} ${pdfNum((hh + 8) * k)} re f`); fill = '';
        setStroke([0, 0, 0]); setW(0.2);
        for(let i = 0; i < 4; i++) {
            const xs = x0 + Lmm * i / 4;
            out.push(`${i % 2 ? '1 1 1' : '0 0 0'} rg ${pdfNum(xs * k)} ${pdfNum(y0 * k)} ${pdfNum(Lmm / 4 * k)} ${pdfNum(hh * k)} re B`);
        }
        fill = '';
        setFill([0, 0, 0]);
        const lab = (s, x) => out.push(`BT /F1 ${pdfNum(2.5 * k)} Tf 1 0 0 1 ${pdfNum(x * k - pdfTextWidth(s, 2.5 * k) / 2)} ${pdfNum((y0 + hh + 1) * k)} Tm <${pdfHexText(s)}> Tj ET`);
        lab('0', x0); lab(String(+Lm.toPrecision(6)) + 'm', x0 + Lmm);
    }
    // 図枠と表題欄（右下）
    {
        setStroke([0, 0, 0]); setW(0.5);
        out.push(`${pdfNum(P.inner.x * k)} ${pdfNum(P.inner.y * k)} ${pdfNum(P.inner.w * k)} ${pdfNum(P.inner.h * k)} re S`);
        const tw = PRINT_TB.w, rh = PRINT_TB.row, x0 = P.inner.x + P.inner.w - tw, y0 = P.inner.y, lw0 = 20;
        const rows = [['図面名', meta.title || ''], ['縮尺', '1/' + o.scale + '　' + o.paper + (o.orient === 'port' ? ' 縦' : ' 横')], ['日付', meta.date || ''], ['作成者', meta.author || '']];
        out.push(`1 1 1 rg ${pdfNum(x0 * k)} ${pdfNum(y0 * k)} ${pdfNum(tw * k)} ${pdfNum(rh * rows.length * k)} re f`); fill = '';
        setW(0.35);
        out.push(`${pdfNum(x0 * k)} ${pdfNum(y0 * k)} ${pdfNum(tw * k)} ${pdfNum(rh * rows.length * k)} re S`);
        setW(0.2);
        for(let i = 1; i < rows.length; i++) out.push(`${pdfNum(x0 * k)} ${pdfNum((y0 + rh * i) * k)} m ${pdfNum((x0 + tw) * k)} ${pdfNum((y0 + rh * i) * k)} l S`);
        out.push(`${pdfNum((x0 + lw0) * k)} ${pdfNum(y0 * k)} m ${pdfNum((x0 + lw0) * k)} ${pdfNum((y0 + rh * rows.length) * k)} l S`);
        setFill([0, 0, 0]);
        rows.forEach(([lab, val], i) => {
            const yb = (y0 + rh * (rows.length - 1 - i) + rh * 0.3) * k;
            out.push(`BT /F1 ${pdfNum(2.6 * k)} Tf 1 0 0 1 ${pdfNum((x0 + lw0 / 2) * k - pdfTextWidth(lab, 2.6 * k) / 2)} ${pdfNum(yb)} Tm <${pdfHexText(lab)}> Tj ET`);
            // 長い値は欄に入るよう文字を小さくする
            let fs = 3.4;
            const maxW = (tw - lw0 - 3) * k;
            while(fs > 1.8 && pdfTextWidth(val, fs * k) > maxW) fs -= 0.2;
            out.push(`BT /F1 ${pdfNum(fs * k)} Tf 1 0 0 1 ${pdfNum((x0 + lw0 + 1.5) * k)} ${pdfNum(yb)} Tm <${pdfHexText(val)}> Tj ET`);
        });
    }
    return { W: P.W * k, H: P.H * k, content: out.join('\n') + '\n', count };
}

// ===== パネル =====
window.showPrintPanel = function() { _printRender(); render(); };
function _printRender() {
    const o = printOpts();
    const seg = (cur, list, fn) => `<div class="cogo-seg">${list.map(([v, t]) => `<button class="prop-btn opt-bg-btn ${String(cur) === String(v) ? 'active' : ''}" onclick="${fn}('${v}')">${t}</button>`).join('')}</div>`;
    const row = (label, inner) => `<div class="prop-row cogo-row"><div class="prop-label cogo-label">${label}</div>${inner}</div>`;
    const scaleSel = `<select class="prop-val" onchange="printSet('scale', this.value)" style="min-width:0;">` +
        (PRINT_SCALES.includes(+o.scale) ? '' : `<option value="${o.scale}" selected>1/${o.scale}</option>`) +
        PRINT_SCALES.map((s) => `<option value="${s}" ${+o.scale === s ? 'selected' : ''}>1/${s}</option>`).join('') + '</select>';
    const h = row('用紙', seg(o.paper, Object.keys(PRINT_PAPERS).map((p) => [p, p]), 'printSetPaper')) +
        row('向き', seg(o.orient, [['land', '横'], ['port', '縦']], 'printSetOrient')) +
        row('縮尺', scaleSel + '<button class="prop-btn btn-sub cogo-pick" onclick="printFitScale()" title="いまの画面が入る縮尺にする">画面に合わせる</button>') +
        row('色', seg(o.color, [['mono', '白黒'], ['color', 'カラー']], 'printSetColor')) +
        row('図面名', `<input id="print-title" class="prop-val" type="text" autocomplete="off" value="${escapeHtml(_printTitle())}" style="min-width:0;">`) +
        row('作成者', `<input id="print-author" class="prop-val" type="text" autocomplete="off" value="${escapeHtml(o.author || '')}" oninput="printSet('author', this.value, true)" style="min-width:0;">`) +
        '<div class="cogo-btns"><button class="prop-btn" onclick="printMakePdf(false)">📄 PDF を保存</button><button class="prop-btn btn-sub" onclick="printMakePdf(true)">🖨 開いて印刷</button></div>' +
        _cogoNote('図面に重ねた枠（点線）の中が印刷されます。画面を動かす・拡大して位置を合わせます（画面の中央が用紙の中央）。右下の四角は表題欄、右上は方位記号です。<br>印刷するときは「実際のサイズ（100%）」を選びます（用紙に合わせると縮尺が変わります）。');
    showPropertyPanel(PRINT_TITLE, h);
}
function _printTitle() {
    const el = document.getElementById('print-title');
    if(el && el.value.trim()) return el.value.trim();
    return (window._drawingName || '').replace(/\.[^.]+$/, '') || '図面';
}
window.printSet = function(key, v, quiet) {
    const o = printOpts();
    o[key] = key === 'scale' ? Math.max(1, Math.round(+v) || 500) : v;
    _printSaveOpts(o);
    if(!quiet) _printRender();
    renderOverlay();
};
window.printSetPaper = function(v) { printSet('paper', v); };
window.printSetOrient = function(v) { printSet('orient', v); };
window.printSetColor = function(v) { printSet('color', v); };
// いまの画面が図枠の中に入る縮尺（標準の縮尺のうち、入る一番大きいもの）
window.printFitScale = function() {
    const o = printOpts(), P = printPaperMm(o), f = surveyUnitFactor();
    const vw = canvas.width / view.scale, vh = canvas.height / view.scale; // 図面の単位
    const need = Math.max(vw / f * 1000 / P.inner.w, vh / f * 1000 / P.inner.h);
    const s = PRINT_SCALES.find((x) => x >= need) || Math.ceil(need / 1000) * 1000;
    printSet('scale', s);
    showToast(`縮尺 1/${s} にしました`, 2000);
};
window.printMakePdf = async function(openIt) {
    const o = printOpts();
    const title = _printTitle();
    // 開いて印刷: 押した操作のうちに窓を開いておく（あとから開くと止められることがある）
    const win = openIt ? window.open('', '_blank') : null;
    const center = screenToWcs(canvas.width / 2, canvas.height / 2);
    const d = new Date();
    const page = printCompose(o, center, view.rotation || 0, { title, author: o.author || '', date: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` });
    const bytes = await pdfBuild(page, { title }, true);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const name = `${_baseName()}_1-${o.scale}_${o.paper}.pdf`;
    if(win) { win.location.href = URL.createObjectURL(blob); }
    else downloadBlob(blob, name);
    addCommandLog(`-> PDF を作りました: 1/${o.scale} ${o.paper}${o.orient === 'port' ? '縦' : '横'}（図形 ${page.count}）`);
    showToast(openIt ? 'PDF を開きました。印刷は「実際のサイズ（100%）」で' : `PDF を保存しました（1/${o.scale} ${o.paper}）`, 3500);
    return bytes;
};

// ===== 重ね表示（用紙の枠・表題欄・方位記号の場所） =====
function _printPanelOpen() {
    const p = document.getElementById('property-panel'), t = document.getElementById('property-panel-title');
    return !!(p && p.style.display === 'flex' && t && t.textContent === PRINT_TITLE);
}
function drawPrintOverlay() {
    if(!_printPanelOpen()) return;
    const o = printOpts(), P = printPaperMm(o);
    const px = view.scale / printMmPerUnit(o.scale); // 用紙 1mm が画面で何 px か
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const w = P.inner.w * px, h = P.inner.h * px, x = cx - w / 2, y = cy - h / 2;
    ctx.save();
    // 枠の外を暗くする
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.rect(0, 0, canvas.width, canvas.height); ctx.rect(x, y, w, h); ctx.fill('evenodd');
    ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 1.5; ctx.setLineDash([8, 5]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,204,0,0.8)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + w - PRINT_TB.w * px, y + h - PRINT_TB.row * 4 * px, PRINT_TB.w * px, PRINT_TB.row * 4 * px); // 表題欄
    ctx.beginPath(); ctx.arc(x + w - 11 * px, y + 11 * px, 6 * px, 0, Math.PI * 2); ctx.stroke();       // 方位記号
    ctx.fillStyle = '#ffcc00'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`1/${o.scale}  ${o.paper}${o.orient === 'port' ? '縦' : '横'}`, x + 4, y - 4);
    ctx.restore();
}

// ===== コマンド =====
function processPrintCommand(cmd) {
    if(cmd === 'PRINT' || cmd === 'PLOT' || cmd === 'PDF') { window.showPrintPanel(); return true; }
    return false;
}

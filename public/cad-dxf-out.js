// ===== Web CAD DXF の書き出し（ブロックの中身・測点・複数行の文字・寸法） =====
// cad-dxf-out.js - cad-io.js の exportDxf から使う。DXF の書き出しライブラリ（dxf-writer）が書けないものを書く:
//   ・ブロックの中身（dxf-writer のブロックは外枠だけ）
//   ・測点: ブロック「測点」（点＋属性 点番号・点名・標高）の参照（INSERT）と属性（ATTRIB）。高さ（Z）は挿入点の Z（図面の単位）。
//          点名は見える属性（今の点名の文字の位置・大きさ）、点番号・標高は見えない属性。読み直すと座標一覧の点に戻る
//   ・複数行の文字: MTEXT（\P で改行）
//   ・寸法: DIMENSION（種類ごとの定義点・測定値）と、その形のブロック *D（画面と同じ線・矢印・文字）。AutoCAD で作り直したときも
//          同じ見た目になるよう、文字の高さ・矢印・桁を寸法ごとの上書き（拡張データ ACAD の DSTYLE）に書く。
//          アプリに読み直したときに元の寸法に戻すため、寸法の中身を拡張データ WEBCAD に入れる。
// ハンドルは dxf-writer と同じ通し番号から取る（$HANDSEED がずれないように）。所有の書き方（330）も dxf-writer に合わせる。

const DXF_OUT_APP = 'WEBCAD';

function dxfOutNewState(d) {
    const LayerCtor = Object.getPrototypeOf(d.layers['0']).constructor;
    const st = { d, handle: () => new LayerCtor('_h', 7).handle, blocks: {}, dimN: 0 };
    // 拡張データの名前（APPID）と、寸法スタイル STANDARD（dxf-writer の寸法スタイル表は空のため）
    const app = d.tables && d.tables.APPID;
    if(app && app.elements.length) app.add(new (Object.getPrototypeOf(app.elements[0]).constructor)(DXF_OUT_APP));
    const ds = d.tables && d.tables.DIMSTYLE;
    if(ds) {
        const h = st.handle();
        ds.add({ handle: h, ownerObjectHandle: '0', tags(m) {
            m.push(0, 'DIMSTYLE'); m.push(105, this.handle); m.push(330, this.ownerObjectHandle);
            m.push(100, 'AcDbSymbolTableRecord'); m.push(100, 'AcDbDimStyleTableRecord'); m.push(2, 'STANDARD'); m.push(70, 0);
        } });
    }
    return st;
}

// タグを記録する（ハンドルは記録するとき＝組み立てるときに取る。書き出すときに取ると $HANDSEED より後の番号になり、AutoCAD が新しく作る図形と重なる）
function _dxoRec() { const pairs = []; return { pairs, push: (c, v) => pairs.push([c, v]), replay: (m) => pairs.forEach((p) => m.push(p[0], p[1])) }; }

// ブロック（名前・種類 70・中身を書く関数 body(m, 持ち主のハンドル)）。同じ名前は1回だけ。中身はここで記録する
function dxfOutBlock(st, name, flags, body) {
    if(st.blocks[name]) return st.blocks[name];
    const blk = st.d.addBlock(name);
    const rec = _dxoRec();
    body(rec, blk.handle);
    blk.tags = function(m) {
        m.push(0, 'BLOCK'); m.push(5, this.handle); m.push(330, this.ownerObjectHandle);
        m.push(100, 'AcDbEntity'); m.push(8, '0'); m.push(100, 'AcDbBlockBegin');
        m.push(2, name); m.push(70, flags); m.push(10, 0); m.push(20, 0); m.push(30, 0); m.push(3, name); m.push(1, '');
        rec.replay(m);
        m.push(0, 'ENDBLK'); this.end.tags(m);
    };
    st.blocks[name] = blk;
    return blk;
}

// ===== 図形の書き方（ブロックの中身・寸法・測点の属性で使う） =====
function _dxoEnt(m, st, type, owner, layer) { m.push(0, type); m.push(5, st.handle()); m.push(330, owner); m.push(100, 'AcDbEntity'); m.push(8, layer); }
function _dxoLine(m, st, owner, layer, x1, y1, x2, y2) {
    _dxoEnt(m, st, 'LINE', owner, layer); m.push(100, 'AcDbLine');
    m.push(10, x1); m.push(20, y1); m.push(30, 0); m.push(11, x2); m.push(21, y2); m.push(31, 0);
}
function _dxoArc(m, st, owner, layer, cx, cy, r, saDeg, eaDeg) {
    _dxoEnt(m, st, 'ARC', owner, layer); m.push(100, 'AcDbCircle'); m.push(10, cx); m.push(20, cy); m.push(30, 0); m.push(40, r);
    m.push(100, 'AcDbArc'); m.push(50, saDeg); m.push(51, eaDeg);
}
function _dxoSolid(m, st, owner, layer, a, b, c) {
    _dxoEnt(m, st, 'SOLID', owner, layer); m.push(100, 'AcDbTrace');
    [[10, a], [11, b], [12, c], [13, c]].forEach(([k, p]) => { m.push(k, p.x); m.push(k + 10, p.y); m.push(k + 20, 0); });
}
const _DXO_HA = { left: 0, center: 1, right: 2 }, _DXO_VA = { baseline: 0, bottom: 1, middle: 2, top: 3 };
// 1行の文字。ha: left/center/right、va: baseline/bottom/middle/top（アプリの bottom は DXF の baseline と同じ置き方）
function _dxoText(m, st, owner, layer, x, y, h, angDeg, s, ha, va) {
    const H = _DXO_HA[ha] || 0, V = _DXO_VA[va === 'bottom' ? 'baseline' : va] || 0;
    _dxoEnt(m, st, 'TEXT', owner, layer); m.push(100, 'AcDbText');
    m.push(10, x); m.push(20, y); m.push(30, 0); m.push(40, h); m.push(1, String(s)); m.push(50, angDeg || 0); m.push(7, 'standard');
    if(H || V) { m.push(72, H); m.push(11, x); m.push(21, y); m.push(31, 0); }
    m.push(100, 'AcDbText'); if(V) m.push(73, V);
}
// 寸法の線・円弧・矢印・文字（dimExportPrims の形）
function _dxoPrims(m, st, owner, layer, P) {
    P.lines.forEach(l => _dxoLine(m, st, owner, layer, l.x1, l.y1, l.x2, l.y2));
    P.arcs.forEach(a => _dxoArc(m, st, owner, layer, a.cx, a.cy, a.r, a.sa * 180 / Math.PI, a.ea * 180 / Math.PI));
    P.arrows.forEach(a => {
        const c = Math.cos(a.a), s = Math.sin(a.a), bx = a.x - a.size * c, by = a.y - a.size * s, w = a.size / 3;
        _dxoSolid(m, st, owner, layer, { x: a.x, y: a.y }, { x: bx - w * s, y: by + w * c }, { x: bx + w * s, y: by - w * c });
    });
    P.texts.forEach(t => _dxoText(m, st, owner, layer, t.x, t.y, t.h, t.ang * 180 / Math.PI, t.s, t.ha, t.va));
}
// MTEXT の文字（書式の記号 \ { } を打ち消し、改行は \P）。長い文字は 250 字ずつ（最後が 1、その前は 3）
function _dxoMtextPush(m, s) {
    const t = String(s).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, '\\P');
    for(let i = 0; i + 250 < t.length; i += 250) m.push(3, t.slice(i, i + 250));
    m.push(1, t.slice(Math.floor(Math.max(0, t.length - 1) / 250) * 250));
}

// ===== 複数行の文字（MTEXT） =====
// addRaw・withType は exportDxf の道具（dxf-writer の図形の番号・所属を使って、中身を差し替えて書く）
function dxfOutMText(st, addRaw, withType, e) {
    const VA = { top: 1, middle: 4, bottom: 7 }, HA = { left: 0, center: 1, right: 2 };
    const att = (VA[e.valign] || 7) + (HA[e.halign] || 0); // 1 左上 … 9 右下（アプリの基準線は下と同じ）
    const r = e.rotation || 0;
    withType(addRaw((m, layer) => {
        m.push(100, 'AcDbEntity'); m.push(8, layer); m.push(100, 'AcDbMText');
        m.push(10, e.x); m.push(20, e.y); m.push(30, 0); m.push(40, e.height || 2.5); m.push(41, 0); m.push(71, att); m.push(72, 1);
        _dxoMtextPush(m, e.text);
        m.push(7, 'standard'); m.push(11, Math.cos(r)); m.push(21, Math.sin(r)); m.push(31, 0);
        m.push(44, 0.84); // 行の間隔: アプリは文字の 1.4 倍（MTEXT の 1.0 は約 1.67 倍）
    }), 'MTEXT');
}

// ===== 測点（ブロック「測点」と属性） =====
// e: 点（POINT。点名・点番号・標高）、label: 点名の文字（無ければ null）、labelLayer: その画層名
function dxfOutSurveyPoint(st, addRaw, withType, e, label, labelLayer) {
    dxfOutBlock(st, '測点', 2, (m, owner) => { // 70: 2 ＝ 属性を持つブロック
        _dxoEnt(m, st, 'POINT', owner, '0'); m.push(100, 'AcDbPoint'); m.push(10, 0); m.push(20, 0); m.push(30, 0);
        [['点番号', 1], ['点名', 0], ['標高', 1]].forEach(([tag, flags]) => {
            _dxoEnt(m, st, 'ATTDEF', owner, '0'); m.push(100, 'AcDbText'); m.push(10, 0); m.push(20, 0); m.push(30, 0); m.push(40, 1); m.push(1, '');
            m.push(100, 'AcDbAttributeDefinition'); m.push(3, tag); m.push(2, tag); m.push(70, flags);
        });
    });
    const f = (typeof surveyUnitFactor === 'function') ? surveyUnitFactor() : 1;
    const hasZ = typeof e.z === 'number' && isFinite(e.z);
    const zW = hasZ ? e.z * f : 0;
    const h = label ? (label.height || 1) : 1 * f;
    const rec = _dxoRec();
    const shape = addRaw((m) => rec.replay(m));
    const layer = shape.layer ? shape.layer.name : (st.d.activeLayer ? st.d.activeLayer.name : '0');
    {
        const m = rec;
        m.push(100, 'AcDbEntity'); m.push(8, layer); m.push(100, 'AcDbBlockReference'); m.push(66, 1); m.push(2, '測点');
        m.push(10, e.x); m.push(20, e.y); m.push(30, zW);
        const att = (tag, val, x, y, hh, invisible, lay) => {
            _dxoEnt(m, st, 'ATTRIB', shape.handle, lay); m.push(100, 'AcDbText');
            m.push(10, x); m.push(20, y); m.push(30, zW); m.push(40, hh); m.push(1, String(val)); m.push(7, 'standard');
            m.push(100, 'AcDbAttribute'); m.push(2, tag); m.push(70, invisible ? 1 : 0);
        };
        att('点番号', e.num || '', e.x, e.y, h, true, layer);
        if(label) att('点名', e.name || '', label.x, label.y, h, false, labelLayer || layer);
        else att('点名', e.name || '', e.x, e.y, h, true, layer);
        att('標高', hasZ ? formatSurveyNumber(e.z) : '', e.x, e.y, h, true, layer);
        _dxoEnt(m, st, 'SEQEND', shape.handle, layer);
    }
    withType(shape, 'INSERT');
}

// ===== 寸法（DIMENSION と、その形のブロック） =====
// k: 寸法の大きさの倍率（exportDxf の dimK）、P: dimExportPrims の結果
function dxfOutDimension(st, addRaw, withType, e, P, k) {
    const def = _dxoDimDef(e, P, k);
    if(!def) return false;
    const name = '*D' + (++st.dimN);
    dxfOutBlock(st, name, 1, (m, owner) => _dxoPrims(m, st, owner, '寸法', P)); // 70: 1 ＝ 名前の無いブロック
    const th = dimSizePx(DIM_TEXT_SIZE) * k, as = dimSizePx(DIM_ARROW_SIZE) * k;
    const mm = (typeof getSurveyUnit === 'function') && getSurveyUnit() === 'mm';
    withType(addRaw((m, layer) => {
        m.push(100, 'AcDbEntity'); m.push(8, layer); m.push(100, 'AcDbDimension'); m.push(2, name);
        m.push(10, def.p10.x); m.push(20, def.p10.y); m.push(30, 0);
        m.push(11, def.text.x); m.push(21, def.text.y); m.push(31, 0);
        m.push(70, def.type | 32 | 128); m.push(71, 5); m.push(42, def.meas); m.push(1, def.override || ''); m.push(3, 'STANDARD');
        def.sub(m);
        // 寸法ごとの上書き: 文字の高さ・矢印・桁（m は 1mm まで・末尾の 0 を省く、mm は整数）・文字は寸法線の上・角度は 0.1 度
        m.push(1001, 'ACAD'); m.push(1000, 'DSTYLE'); m.push(1002, '{');
        [[140, 1040, th], [41, 1040, as], [147, 1040, th * 0.25], [271, 1070, mm ? 0 : 3], [78, 1070, 8], [77, 1070, 1], [179, 1070, 1]].forEach(([c, k2, v]) => { m.push(1070, c); m.push(k2, v); });
        m.push(1002, '}');
        // アプリに読み直すための寸法の中身
        m.push(1001, DXF_OUT_APP);
        dxfOutXdataChunks(e).forEach(s => m.push(1000, s));
    }), 'DIMENSION');
    return true;
}
// 寸法の種類ごとの定義点（DXF の決まり）。type: 0 回転（水平・垂直）・1 平行・3 直径・4 半径・5 角度（3点）・6 座標
function _dxoDimDef(e, P, k) {
    const st = e.subType;
    if(st === 'LINEAR' || st === 'ALIGNED') {
        const L = dimLinePrims(st, e.p1, e.p2, e.offset ?? 30, e.dimDir, e.dimRot, k);
        const dl = L.dim, ang = Math.atan2(dl.y2 - dl.y1, dl.x2 - dl.x1);
        return { type: st === 'LINEAR' ? 0 : 1, p10: { x: dl.x2, y: dl.y2 }, text: L.textAt, meas: L.value, override: e.textOverride || '',
            sub: (m) => {
                m.push(100, 'AcDbAlignedDimension'); m.push(13, e.p1.x); m.push(23, e.p1.y); m.push(33, 0); m.push(14, e.p2.x); m.push(24, e.p2.y); m.push(34, 0);
                if(st === 'LINEAR') { m.push(50, ang * 180 / Math.PI); m.push(100, 'AcDbRotatedDimension'); }
            } };
    }
    if(st === 'RADIUS' || st === 'DIAMETER') {
        const c = e.center, r = e.radius, a0 = e.angle || 0, ep = { x: c.x + r * Math.cos(a0), y: c.y + r * Math.sin(a0) };
        const t = P.texts[0] || { x: c.x, y: c.y };
        if(st === 'RADIUS') return { type: 4, p10: c, text: t, meas: r, override: e.textOverride || '',
            sub: (m) => { m.push(100, 'AcDbRadialDimension'); m.push(15, ep.x); m.push(25, ep.y); m.push(35, 0); m.push(40, 0); } };
        const ep2 = { x: c.x - r * Math.cos(a0), y: c.y - r * Math.sin(a0) };
        return { type: 3, p10: ep2, text: t, meas: r * 2, override: e.textOverride || '',
            sub: (m) => { m.push(100, 'AcDbDiametricDimension'); m.push(15, ep.x); m.push(25, ep.y); m.push(35, 0); m.push(40, 0); } };
    }
    if(st === 'ANGULAR') {
        const v = e.vertex, R = e.arcRadius || 40, g = dimAngularGeom(e), am = g.a1 + g.d / 2;
        const t = P.texts[0] || { x: v.x, y: v.y };
        return { type: 5, p10: { x: v.x + R * Math.cos(am), y: v.y + R * Math.sin(am) }, text: t, meas: Math.abs(g.d), override: e.textOverride || '',
            sub: (m) => {
                m.push(100, 'AcDb3PointAngularDimension');
                m.push(13, e.arm1.x); m.push(23, e.arm1.y); m.push(33, 0); m.push(14, e.arm2.x); m.push(24, e.arm2.y); m.push(34, 0); m.push(15, v.x); m.push(25, v.y); m.push(35, 0);
            } };
    }
    if(st === 'ORDINATE') {
        const p = e.point, L = e.leaderCoord || e.leaderX || e.leader;
        if(!p || !L) return null;
        // アプリの座標寸法は X（北）・Y（東）を2段で出すので、その文字のまま（P の文字）を上書きの文字にする
        const s = e.textOverride || P.texts.map(t => t.s).join('\\P');
        const t = P.texts[P.texts.length - 1] || L;
        return { type: 6, p10: { x: 0, y: 0 }, text: t, meas: p.y, override: s,
            sub: (m) => { m.push(100, 'AcDbOrdinateDimension'); m.push(13, p.x); m.push(23, p.y); m.push(33, 0); m.push(14, L.x); m.push(24, L.y); m.push(34, 0); } };
    }
    return null;
}
// 拡張データ WEBCAD の文字（寸法の中身の JSON。日本語は \\uXXXX にして、250 字ずつ。最初に「WEBCAD:」）
function dxfOutXdataChunks(e) {
    const keep = Object.assign({}, e);
    ['id', 'bbox', '_hits', 'gid', 'blockName', 'layer'].forEach(k => delete keep[k]);
    const json = JSON.stringify(keep).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    const out = [];
    const s = DXF_OUT_APP + ':' + json;
    for(let i = 0; i < s.length; i += 250) out.push(s.slice(i, i + 250));
    return out;
}

// ===== 読み直し: 拡張データ WEBCAD の寸法・ブロック「測点」を、アプリの図形に戻す =====
// strings: 拡張データの文字（DXF は dxf-parser の extendedData.customStrings、DWG は xdata の WEBCAD の 1000）
function webcadEntityFromXdata(strings) {
    if(!Array.isArray(strings)) return null;
    const i = strings.findIndex(s => typeof s === 'string' && s.startsWith(DXF_OUT_APP + ':'));
    if(i < 0) return null;
    try {
        const o = JSON.parse(strings.slice(i).join('').slice(DXF_OUT_APP.length + 1));
        return (o && o.type === 'DIMENSION') ? o : null;
    } catch { return null; }
}
function webcadXdataStringsDwg(ent) {
    const x = (ent && ent.xdata || []).find(a => a && a.appName === DXF_OUT_APP);
    return x ? (x.value || []).filter(v => v && v.code === 1000).map(v => String(v.value)) : null;
}
// 書き出した測点（ブロック「測点」と属性 点番号・点名・標高）を、座標一覧の点（POINT＋点名の文字）に戻す。
// pos: 挿入点（図面の座標。z があれば図面の単位の高さ）、attrs: [{ tag, text, x, y, h, layer, invisible }]
function surveyPointFromInsert(pos, layerPt, attrs) {
    const get = (tag) => attrs.find(a => String(a.tag || '').trim() === tag);
    const nameA = get('点名'), numA = get('点番号'), zA = get('標高');
    const f = (typeof surveyUnitFactor === 'function') ? surveyUnitFactor() : 1;
    let z = (zA && String(zA.text || '').trim() !== '') ? parseFloat(zA.text) : ((typeof pos.z === 'number' && pos.z) ? pos.z / f : null);
    if(!(typeof z === 'number' && isFinite(z))) z = null;
    const gid = newGroupId('p');
    const pt = { type: 'POINT', layer: layerPt, color: null, x: pos.x, y: pos.y, name: nameA ? String(nameA.text || '') : '', num: numA ? String(numA.text || '') : '', z, gid, blockName: '測点' };
    const out = [pt];
    if(nameA && nameA.text && !nameA.invisible) out.push({ type: 'TEXT', layer: nameA.layer, color: null, x: nameA.x, y: nameA.y, text: String(nameA.text), height: nameA.h || 1, halign: 'left', valign: 'bottom', gid, blockName: '測点', ptLabel: true });
    return out;
}

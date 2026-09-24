// ===== Web CAD ファイル入出力モジュール =====
// cad-io.js - DXF/DWGの読み込みとエクスポート

// テキスト処理は cad-text-parse.js に集約（読込失敗時は素通しにフォールバック）
function _decodeCadText(s) { return (typeof decodeDxfText === 'function') ? decodeDxfText(s) : s; }
function _cleanCadMtext(s) { return (typeof parseCadText === 'function') ? parseCadText(s) : s; }

// ===== DXF読み込み =====
function loadDxfFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const buffer = e.target.result;
        const bytes = new Uint8Array(buffer);

        // ファイルシグネチャによる判定
        if (bytes.length >= 6) {
            const head = String.fromCharCode(...bytes.slice(0, 6));
            if (head.startsWith('AC10')) {
                const msg = '※ 拡張子は.dxfですが、中身はAutoCAD DWGファイルです。\nWebブラウザでのDWG直接読み込みは簡易的なため、図形が崩れる可能性があります。\n\n正確に開くには、AutoCAD等のソフトで「ASCII形式のDXF」として保存し直してください。';
                alert(msg);
                addCommandLog(`※ DWGファイルとしてロードを試みます。`);
                loadDwgFile(file);
                return;
            }
            if (head.startsWith('AutoCA')) { // 'AutoCAD Binary DXF'
                alert('エラー: バイナリ形式のDXFファイルです。\nASCII形式のDXFで保存し直してください。');
                addCommandLog(`エラー: バイナリ形式のDXFファイルは未対応です。`);
                return;
            }
        }

        try {
            // 文字コード自動判定: UTF-8(AC1021以降のDXF)を厳格モードで試し、
            // 失敗したら日本語環境のAutoCAD出力に多いShift-JIS (ANSI_932)へフォールバック
            const decoded = (typeof decodeDxfBuffer === 'function')
                ? decodeDxfBuffer(buffer)
                : { text: new TextDecoder('shift-jis').decode(buffer), encoding: 'Shift-JIS' };
            const text = decoded.text;
            addCommandLog(`  文字コード: ${decoded.encoding} として読み込み`);

            if(typeof window.DxfParser !== 'function') {
                throw new Error('DXF読込ライブラリが読み込まれていません。ページを再読み込みしてください');
            }
            const parser = new window.DxfParser();
            registerExtraDxfHandlers(parser);
            const dxf = parser.parseSync(text);
            importDxfData(dxf, { skipUndo: true });
            // 開いた直後にアプリが落ちても復元できるよう、読み込んだ図面を自動保存の対象にする
            if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
            setDrawingName(file.name);
            addCommandLog(`-> DXFファイル読み込み完了: ${file.name}`);
        } catch(err) {
            addCommandLog(`エラー: DXFファイルの読み込みに失敗 - ${err.message}`);
            reportImportFailure('DXF', file.name, err);
            console.error('DXFパースエラー:', err);
        }
    };
    reader.readAsArrayBuffer(file);
}

// ===== 取り込みオプション =====
function shouldHideImportedArcs() {
    try { const v = localStorage.getItem('cad_import_hide_arcs'); return v === null ? true : v === '1'; } catch(_) { return true; }
}

// dxf-parser が扱わない ATTRIB（ブロック属性の実値: 測点名・番号など）用の独自ハンドラを登録する
// dxf-parser のハンドラ規約: parseEntity(scanner, curr) で code 0 に達するまで読み進めて返す
function registerExtraDxfHandlers(parser) {
    if(!parser || typeof parser.registerEntityHandler !== 'function') return;
    class AttribHandler {
        constructor() { this.ForEntityName = 'ATTRIB'; }
        parseEntity(scanner, curr) {
            const ent = { type: 'ATTRIB' };
            const readPoint = (g) => {
                const p = { x: g.value };
                let n = scanner.next();
                if(n.code === g.code + 10) {
                    p.y = n.value;
                    n = scanner.next();
                    if(n.code === g.code + 20) p.z = n.value; else scanner.rewind();
                } else { scanner.rewind(); }
                return p;
            };
            curr = scanner.next();
            while(!scanner.isEOF() && curr.code !== 0) {
                switch(curr.code) {
                    case 1: ent.text = curr.value; break;
                    case 2: ent.tag = curr.value; break;
                    case 8: ent.layer = curr.value; break;
                    case 10: ent.startPoint = readPoint(curr); break;
                    case 11: ent.endPoint = readPoint(curr); break;
                    case 40: ent.textHeight = curr.value; break;
                    case 41: ent.xScale = curr.value; break;
                    case 50: ent.rotation = curr.value; break;
                    case 60: ent.visible = (curr.value === 0); break;
                    case 62: ent.colorIndex = curr.value; break;
                    case 67: ent.inPaperSpace = (curr.value !== 0); break;
                    case 70: ent.invisible = !!(curr.value & 1); ent.constant = !!(curr.value & 2); break;
                    case 72: ent.halign = curr.value; break;
                    case 74: ent.valign = curr.value; break;
                    case 420: ent.color = curr.value; break;
                    default: break;
                }
                curr = scanner.next();
            }
            return ent;
        }
    }
    parser.registerEntityHandler(AttribHandler);
}

// ===== 取り込み先の準備（置き換え / 追加） =====
// 図面が空でなければ確認し、置き換えの場合は図形・画層を初期化する。Undoは1回分にまとめる
function _prepareImportTarget() {
    if(typeof guideBeforeFileOpen === 'function') guideBeforeFileOpen();
    saveUndo();
    if(entities.length === 0) return 'fresh';
    const replace = confirm('現在の図面を置き換えて開きますか？\n\n[OK] 置き換える\n[キャンセル] 現在の図面に追加する');
    if(!replace) return 'append';
    entities.length = 0;
    layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
    currentLayerIndex = 0;
    cmdState.highlightIdx = -1; cmdState.selectedIndices = [];
    if(typeof window.setCurrentProjectName === 'function') window.setCurrentProjectName(null);
    initLayers();
    return 'replace';
}

// ===== 画層・色ヘルパー =====
function rgbIntToHex(n) {
    n = Number(n) || 0;
    return '#' + ((n >>> 16) & 255).toString(16).padStart(2, '0') + ((n >>> 8) & 255).toString(16).padStart(2, '0') + (n & 255).toString(16).padStart(2, '0');
}
// dxf-parser の画層: colorIndex=ACI番号, color=RGB整数（ACIから変換済み）。以前は color をACIとして扱っていたため全画層が白になっていた
function dxfLayerColorHex(dl) {
    if(!dl) return '#FFFFFF';
    if(typeof dl.colorIndex === 'number' && dl.colorIndex > 0 && dl.colorIndex < 256) return aciToHex(Math.abs(dl.colorIndex));
    if(typeof dl.color === 'number') return dl.color <= 255 ? aciToHex(dl.color) : rgbIntToHex(dl.color);
    return '#FFFFFF';
}
// エンティティ色: 256=ByLayer, 0=ByBlock → null（画層色で描画）。トゥルーカラー(420)はRGB整数
function dxfEntityColorHex(e) {
    if(e.colorIndex !== undefined && e.colorIndex !== 256 && e.colorIndex !== 0) return aciToHex(e.colorIndex);
    if(e.colorIndex === undefined && typeof e.color === 'number' && e.color > 255) return rgbIntToHex(e.color);
    return null;
}
let _dxfLayersAdded = false;
// 画層テーブルに無い画層名を参照する図形があれば、その場で画層を作る（従来は画層0に寄せていた）
function dxfLayerIndex(name) {
    const nm = (name === undefined || name === null || name === '') ? '0' : String(name);
    let idx = layers.findIndex(l => l.name === nm);
    if(idx < 0) { layers.push({ name: nm, color: '#FFFFFF', visible: true }); idx = layers.length - 1; _dxfLayersAdded = true; }
    return idx;
}

// DXF の単位（$INSUNITS）とオプションの「図面の1単位」が違うときの案内（同じ・不明なら空文字）
function _dxfUnitNote(dxf) {
    const u = dxf && dxf.header && dxf.header.$INSUNITS;
    const fileUnit = u === 4 ? 'mm' : u === 6 ? 'm' : null;
    if(!fileUnit || typeof getSurveyUnit !== 'function' || getSurveyUnit() === fileUnit) return '';
    return `このDXFの単位は ${fileUnit} です（オプションの「図面の1単位」は 1${getSurveyUnit()}）。測定・SIMA の値を合わせるには、オプションで 1${fileUnit} にしてください`;
}
function importDxfData(dxf, opts) {
    opts = opts || {};
    if(!opts.skipUndo) saveUndo();
    _dxfLayersAdded = false;
    const hideArcs = shouldHideImportedArcs();
    let importCount = 0;
    const skipStats = {};
    const noteSkip = (t) => { skipStats[t] = (skipStats[t] || 0) + 1; };

    // 画層の読み込み（色はACI番号、非表示/フリーズ状態も引き継ぐ）
    if(dxf.tables && dxf.tables.layer && dxf.tables.layer.layers) {
        const dxfLayers = dxf.tables.layer.layers;
        Object.keys(dxfLayers).forEach(name => {
            const dl = dxfLayers[name];
            if(!layers.find(l => l.name === name)) {
                layers.push({ name: name, color: dxfLayerColorHex(dl), visible: !(dl.visible === false || dl.frozen === true) });
            }
        });
        initLayers();
    }

    const blocks = dxf.blocks || {};
    const addEntity = (ent) => {
        if(!ent) return;
        if(hideArcs && ent.type === 'ARC') ent.hidden = true;
        entities.push(ent); importCount++;
    };
    const addResults = (results) => {
        if(!results) return false;
        if(Array.isArray(results)) { results.forEach(addEntity); return results.length > 0; }
        addEntity(results); return true;
    };

    // エンティティは元の順序で処理する（ATTRIB は直前の INSERT に属する属性文字のため）
    let lastInsertGid = null, lastInsertBlock = null, lastInsertPos = null;
    (dxf.entities || []).forEach(e => {
        if(e.inPaperSpace || e.paperSpace) { noteSkip('ペーパー空間'); lastInsertGid = null; lastInsertPos = null; return; }
        try {
            if(e.type === 'INSERT') {
                const gid = newGroupId('b');
                const expanded = expandInsert(e, blocks, 0, gid, e.name);
                if(expanded.length === 0) noteSkip('INSERT:' + (e.name || '?'));
                // 挿入点を各図形に記録（移動・回転で一緒に動く。図形ごとに別オブジェクトにする）
                const ip = e.position ? { x: e.position.x || 0, y: e.position.y || 0 } : null;
                if(ip) expanded.forEach(m => { m.ins = { x: ip.x, y: ip.y }; });
                expanded.forEach(addEntity);
                lastInsertGid = gid; lastInsertBlock = e.name; lastInsertPos = ip;
                return;
            }
            if(e.type === 'ATTRIB') {
                if(e.invisible) return; // 不可視属性は描画しない
                const t = convertDxfEntity(e);
                if(t) {
                    if(lastInsertGid) { t.gid = lastInsertGid; t.blockName = lastInsertBlock; if(lastInsertPos) t.ins = { x: lastInsertPos.x, y: lastInsertPos.y }; }
                    if(e.tag) t.attTag = String(e.tag);
                    addEntity(t);
                }
                else noteSkip('ATTRIB');
                return; // 属性の並びは INSERT の続きなので lastInsertGid を維持
            }
            lastInsertGid = null; lastInsertBlock = null; lastInsertPos = null;
            if(e.type === 'DIMENSION') {
                const dimEnts = expandDimension(e, blocks);
                if(dimEnts.length === 0) noteSkip('DIMENSION');
                dimEnts.forEach(addEntity);
                return;
            }
            if(!addResults(convertDxfEntity(e))) noteSkip(e.type || '?');
        } catch(err) { noteSkip(e.type || '?'); console.warn('エンティティ変換エラー:', e.type, err); }
    });

    if(_dxfLayersAdded) initLayers();

    const skipTotal = Object.values(skipStats).reduce((a, b) => a + b, 0);
    addCommandLog(`  読み込み: ${importCount}個 / スキップ: ${skipTotal}個`);
    if(skipTotal > 0) {
        const detail = Object.entries(skipStats).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}×${c}`).join(', ');
        addCommandLog(`  未対応・除外: ${detail}`);
    }

    // === 重い画層の自動非表示 ===
    // 全エンティティ数が非常に多い場合のみ、極端に多い画層を自動非表示にする（bboxカリングがあるため閾値は高め）
    const AUTO_HIDE_TOTAL_THRESHOLD = 4000;
    const AUTO_HIDE_LAYER_THRESHOLD = 2000;
    const autoHidden = [];
    if(entities.length > AUTO_HIDE_TOTAL_THRESHOLD) {
        const layerCounts = {};
        entities.forEach(e => { const li = e.layer !== undefined ? e.layer : 0; layerCounts[li] = (layerCounts[li] || 0) + 1; });
        Object.entries(layerCounts).sort((a, b) => b[1] - a[1]).forEach(([layerIdx, count]) => {
            const idx = parseInt(layerIdx);
            if(count >= AUTO_HIDE_LAYER_THRESHOLD && layers[idx]) { layers[idx].visible = false; autoHidden.push(`${layers[idx].name}(${count}個)`); }
        });
        if(autoHidden.length > 0) {
            addCommandLog(`⚡ 軽量化: 重い画層を自動非表示にしました: ${autoHidden.join(', ')}`);
            addCommandLog(`  ※ 画層パネル(👁)から再表示できます`);
        }
    }

    if(typeof ensureEntityIds === 'function') ensureEntityIds();
    if(typeof _bumpGeomEpoch === 'function') _bumpGeomEpoch();
    if(typeof updateLayerPanel === 'function') updateLayerPanel();
    zoomExtents();
    render();
    if(typeof showToast === 'function') {
        let msg = `読み込み完了: ${importCount}個の図形`;
        if(skipTotal > 0) msg += `（未対応 ${skipTotal}個）`;
        if(autoHidden.length > 0) msg += `\n重い画層を自動非表示: ${autoHidden.length}件`;
        const unitNote = _dxfUnitNote(dxf);
        if(unitNote) { msg += '\n' + unitNote; addCommandLog('-> ' + unitNote); }
        showToast(msg, unitNote ? 7000 : 4000);
    }
    return { importCount, skipStats };
}

// ===== 寸法(DIMENSION)の展開 =====
// DXFの寸法は実描画形状が匿名ブロック(*Dnn)に入っている。ブロックがあればそれを展開し、
// 無ければ寸法値テキストだけを配置する。展開した部品は1グループ(ブロック名「寸法」)にまとめる
function expandDimension(e, blocks) {
    const gid = newGroupId('d');
    let ents = [];
    if(e.block && blocks[e.block]) {
        ents = expandInsert({ name: e.block, position: { x: 0, y: 0 }, xScale: 1, yScale: 1, rotation: 0 }, blocks, 0, gid, '寸法');
    }
    if(ents.length === 0) {
        const pt = e.middleOfText || e.anchorPoint;
        if(pt) {
            let txt = (e.text !== undefined && e.text !== null) ? String(e.text) : '';
            const measured = (e.actualMeasurement !== undefined) ? String(Math.round(e.actualMeasurement * 100) / 100) : '';
            if(txt === '' || txt === '<>') txt = measured;
            else if(txt.includes('<>')) txt = txt.replace('<>', measured);
            txt = _decodeCadText(txt);
            if(txt) ents.push({ type: 'TEXT', layer: dxfLayerIndex(e.layer), color: dxfEntityColorHex(e), x: pt.x, y: pt.y, text: txt, height: 2.5, halign: 'center', valign: 'middle', gid, blockName: '寸法' });
        }
    }
    return ents;
}

// ===== ブロック参照(INSERT)の再帰展開 =====
// ・ブロック基点(BLOCK 10/20)を差し引いてから縮尺・回転・挿入点を適用する
// ・ネストしたINSERTは親の回転・縮尺を継承する
// ・展開した図形には gid（挿入1つ＝1グループ）と blockName を付与し、まとめて選択・移動・非表示できるようにする
function expandInsert(insertEnt, blocks, depth, gid, blockName) {
    if(depth > 10) return []; // 無限再帰防止
    const block = blocks[insertEnt.name];
    if(!block || !block.entities) return [];
    gid = gid || newGroupId('b');
    blockName = blockName || insertEnt.name;

    const ix = insertEnt.position ? (insertEnt.position.x || 0) : 0;
    const iy = insertEnt.position ? (insertEnt.position.y || 0) : 0;
    const sx = (insertEnt.xScale === undefined || insertEnt.xScale === 0) ? 1 : insertEnt.xScale;
    const sy = (insertEnt.yScale === undefined || insertEnt.yScale === 0) ? 1 : insertEnt.yScale;
    const rotDeg = insertEnt.rotation || 0;
    const rot = rotDeg * Math.PI / 180;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const bpx = block.position ? (block.position.x || 0) : 0;
    const bpy = block.position ? (block.position.y || 0) : 0;
    const cols = Math.max(1, insertEnt.columnCount || 1), rows = Math.max(1, insertEnt.rowCount || 1);
    const colSpacing = insertEnt.columnSpacing || 0, rowSpacing = insertEnt.rowSpacing || 0;
    // 基点補正: world = R·S·(p − 基点) + 挿入点 = R·S·p + (挿入点 − R·S·基点)
    const baseOffX = -(sx * bpx * cosR - sy * bpy * sinR);
    const baseOffY = -(sx * bpx * sinR + sy * bpy * cosR);

    const result = [];
    const tag = (ent) => { if(ent) { ent.gid = gid; ent.blockName = blockName; result.push(ent); } };
    const tagAll = (r) => { if(!r) return; if(Array.isArray(r)) r.forEach(tag); else tag(r); };

    for(let col = 0; col < cols; col++) {
        for(let row = 0; row < rows; row++) {
            // 配列複写の間隔はブロック座標系（縮尺・回転後）で並ぶ
            const dcol = col * colSpacing, drow = row * rowSpacing;
            const ox = ix + baseOffX + (sx * dcol * cosR - sy * drow * sinR);
            const oy = iy + baseOffY + (sx * dcol * sinR + sy * drow * cosR);

            block.entities.forEach(be => {
                try {
                    if(be.type === 'INSERT') {
                        const px = be.position ? (be.position.x || 0) : 0, py = be.position ? (be.position.y || 0) : 0;
                        const nested = Object.assign({}, be, {
                            position: { x: ox + (sx * px * cosR - sy * py * sinR), y: oy + (sx * px * sinR + sy * py * cosR) },
                            rotation: (be.rotation || 0) + rotDeg,
                            xScale: ((be.xScale === undefined || be.xScale === 0) ? 1 : be.xScale) * sx,
                            yScale: ((be.yScale === undefined || be.yScale === 0) ? 1 : be.yScale) * sy
                        });
                        expandInsert(nested, blocks, depth + 1, gid, blockName).forEach(n => result.push(n));
                    } else if(be.type === 'ATTDEF') {
                        // 定数属性だけはブロック定義の値をそのまま表示する。可変属性の値は INSERT 側の ATTRIB が持つ
                        if(be.constant && !be.invisible) tagAll(convertDxfEntity(Object.assign({}, be, { type: 'TEXT', halign: be.horizontalJustification, valign: be.verticalJustification }), ox, oy, sx, sy, rot));
                    } else if(be.type === 'ATTRIB') {
                        if(!be.invisible) tagAll(convertDxfEntity(be, ox, oy, sx, sy, rot));
                    } else {
                        tagAll(convertDxfEntity(be, ox, oy, sx, sy, rot));
                    }
                } catch(err) { console.warn('ブロック内エンティティ変換エラー:', be.type, err); }
            });
        }
    }
    return result;
}

// ===== 幾何ヘルパー =====
// ポリラインの bulge（円弧セグメント）を折れ線で近似展開する。bulge = tan(挟角/4)、正=反時計回り
function expandBulgeVertices(vertices, closed, segsPer90) {
    const out = [];
    const n = vertices.length;
    segsPer90 = segsPer90 || 8;
    for(let i = 0; i < n; i++) {
        const v = vertices[i];
        out.push({ x: v.x, y: v.y });
        const bulge = v.bulge || 0;
        if(!bulge) continue;
        if(i === n - 1 && !closed) continue; // 開いたポリラインの末尾 bulge は無視
        const nx = vertices[(i + 1) % n];
        if(!nx) continue;
        const theta = 4 * Math.atan(bulge);            // 符号付き挟角
        const dx = nx.x - v.x, dy = nx.y - v.y, d = Math.hypot(dx, dy);
        if(d < 1e-12 || Math.abs(theta) < 1e-9) continue;
        const r = d / (2 * Math.sin(Math.abs(theta) / 2));
        const mx = (v.x + nx.x) / 2, my = (v.y + nx.y) / 2;
        const lnx = -dy / d, lny = dx / d;              // 弦の左法線
        const h = r * Math.cos(Math.abs(theta) / 2);   // 中点→中心の距離（挟角>180°なら負）
        const sgn = bulge > 0 ? 1 : -1;
        const cx = mx + sgn * lnx * h, cy = my + sgn * lny * h;
        const a1 = Math.atan2(v.y - cy, v.x - cx);
        const steps = Math.max(1, Math.ceil(Math.abs(theta) / (Math.PI / 2) * segsPer90));
        for(let k = 1; k < steps; k++) {
            const a = a1 + theta * k / steps;
            out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        }
    }
    return out;
}

// B-スプライン（非有理）の de Boor 評価。knots が無ければ clamped uniform を生成
function evalBSplinePoints(ctrl, degree, knots, samples) {
    const n = ctrl.length;
    if(n < 2) return ctrl.map(p => ({ x: p.x, y: p.y }));
    let p = degree || 3; if(p >= n) p = n - 1;
    let k = (knots && knots.length === n + p + 1) ? knots.slice() : null;
    if(!k) {
        k = [];
        for(let i = 0; i <= p; i++) k.push(0);
        const inner = n - p - 1;
        for(let i = 1; i <= inner; i++) k.push(i / (inner + 1));
        for(let i = 0; i <= p; i++) k.push(1);
    }
    const u0 = k[p], u1 = k[n];
    if(!(u1 > u0)) return ctrl.map(pt => ({ x: pt.x, y: pt.y }));
    const pts = [];
    for(let s = 0; s <= samples; s++) {
        let u = u0 + (u1 - u0) * s / samples;
        if(s === samples) u = u1;
        let span = p;
        if(u >= u1) span = n - 1; else { while(span < n - 1 && u >= k[span + 1]) span++; }
        const d = [];
        for(let j = 0; j <= p; j++) { const c = ctrl[span - p + j]; d.push({ x: c.x, y: c.y }); }
        for(let r = 1; r <= p; r++) {
            for(let j = p; j >= r; j--) {
                const i = span - p + j;
                const den = k[i + p - r + 1] - k[i];
                const a = den === 0 ? 0 : (u - k[i]) / den;
                d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y };
            }
        }
        pts.push(d[p]);
    }
    return pts;
}

// ===== DXFエンティティ変換 =====
// (offX, offY, scaleX, scaleY, rotation) はブロック展開時の変換。回転はラジアン
function convertDxfEntity(e, offX, offY, scaleX, scaleY, rotation) {
    offX = offX || 0; offY = offY || 0;
    scaleX = (scaleX === undefined || scaleX === 0) ? 1 : scaleX;
    scaleY = (scaleY === undefined || scaleY === 0) ? 1 : scaleY;
    rotation = rotation || 0;
    const D2R = Math.PI / 180;
    const cosR = Math.cos(rotation), sinR = Math.sin(rotation);
    const tx = (x, y) => scaleX * x * cosR - scaleY * y * sinR + offX;
    const ty = (x, y) => scaleX * x * sinR + scaleY * y * cosR + offY;
    const tvec = (x, y) => ({ x: scaleX * x * cosR - scaleY * y * sinR, y: scaleX * x * sinR + scaleY * y * cosR });
    const mirrored = (scaleX * scaleY) < 0;
    const sAbs = Math.abs(scaleX);
    const layer = dxfLayerIndex(e.layer);
    const color = dxfEntityColorHex(e);
    const base = { layer, color };
    if(e.visible === false) base.hidden = true;
    const mk = (obj) => Object.assign({}, base, obj);

    // LINE
    if(e.type === 'LINE') {
        if(!e.vertices || e.vertices.length < 2) return null;
        const a = e.vertices[0], b = e.vertices[1];
        return mk({ type: 'LINE', x1: tx(a.x, a.y), y1: ty(a.x, a.y), x2: tx(b.x, b.y), y2: ty(b.x, b.y) });
    }
    // CIRCLE
    if(e.type === 'CIRCLE') {
        if(!e.center) return null;
        return mk({ type: 'CIRCLE', cx: tx(e.center.x, e.center.y), cy: ty(e.center.x, e.center.y), radius: (e.radius || 0) * sAbs });
    }
    // ARC: 始点・終点を変換してから角度を求め直す（回転・鏡像に正しく追従）
    if(e.type === 'ARC') {
        if(!e.center) return null;
        const r = e.radius || 0;
        // dxf-parser は ARC の角度（code 50/51）を既にラジアンへ変換して返す。
        // 以前はここでさらに度→ラジアン変換しており、0°〜90°の円弧が約1.6°の欠片になっていた
        // （既定で円弧を非表示にしていたため気付かれにくかった）。文字の回転角は度のまま返る点に注意。
        const sa = e.startAngle || 0, ea = (e.endAngle === undefined ? Math.PI * 2 : e.endAngle);
        const c = { x: tx(e.center.x, e.center.y), y: ty(e.center.x, e.center.y) };
        const sx0 = e.center.x + r * Math.cos(sa), sy0 = e.center.y + r * Math.sin(sa);
        const ex0 = e.center.x + r * Math.cos(ea), ey0 = e.center.y + r * Math.sin(ea);
        const ps = { x: tx(sx0, sy0), y: ty(sx0, sy0) };
        const pe = { x: tx(ex0, ey0), y: ty(ex0, ey0) };
        return mk({ type: 'ARC', cx: c.x, cy: c.y, radius: r * sAbs,
            startAngle: Math.atan2(ps.y - c.y, ps.x - c.x), endAngle: Math.atan2(pe.y - c.y, pe.x - c.x), counterclockwise: !mirrored });
    }
    // LWPOLYLINE / POLYLINE（bulge の円弧セグメントは折れ線近似で展開）
    if(e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
        const verts = (e.vertices || []).filter(v => v && typeof v.x === 'number' && typeof v.y === 'number');
        if(verts.length < 2) return null;
        const closed = !!e.shape;
        const pts = expandBulgeVertices(verts, closed).map(v => ({ x: tx(v.x, v.y), y: ty(v.x, v.y) }));
        if(pts.length >= 2) return mk({ type: 'PLINE', points: pts, closed });
        return null;
    }
    // POINT
    if(e.type === 'POINT') {
        if(!e.position) return null;
        return mk({ type: 'POINT', x: tx(e.position.x, e.position.y), y: ty(e.position.x, e.position.y) });
    }
    // ELLIPSE: 長軸ベクトルを変換して半径・回転を求め直す
    if(e.type === 'ELLIPSE') {
        if(!e.center || !e.majorAxisEndPoint) return null;
        const m = tvec(e.majorAxisEndPoint.x, e.majorAxisEndPoint.y);
        const rx = Math.hypot(m.x, m.y);
        const ry = rx * (e.axisRatio || 1);
        return mk({ type: 'ELLIPSE', cx: tx(e.center.x, e.center.y), cy: ty(e.center.x, e.center.y), rx, ry, rotation: Math.atan2(m.y, m.x) });
    }
    // TEXT / ATTRIB（位置合わせ点は整列指定があるとき code 11 側を使う）
    if(e.type === 'TEXT' || e.type === 'ATTRIB') {
        const h = e.halign || 0, v = e.valign || 0;
        const aligned = (h !== 0 || v !== 0) && e.endPoint && !(h === 3 || h === 5);
        const pos = aligned ? e.endPoint : (e.startPoint || e.position || { x: 0, y: 0 });
        let halign = 'left', valign = 'bottom';
        if(h === 1 || h === 4) halign = 'center'; else if(h === 2) halign = 'right';
        if(v === 2) valign = 'middle'; else if(v === 3) valign = 'top';
        const text = _decodeCadText(e.text || '');
        if(!text) return null;
        return mk({ type: 'TEXT', x: tx(pos.x, pos.y), y: ty(pos.x, pos.y), text, height: (e.textHeight || 2.5) * sAbs,
            rotation: (e.rotation || 0) * D2R + rotation, halign, valign });
    }
    // MTEXT（回転はラジアン。方向ベクトル(11)があればそちらを優先）
    if(e.type === 'MTEXT') {
        const pos = e.position || { x: 0, y: 0 };
        const text = _cleanCadMtext(e.text || '');
        if(!text) return null;
        let halign = 'left', valign = 'top';
        const attach = e.attachmentPoint || 1;
        if(attach === 2 || attach === 5 || attach === 8) halign = 'center';
        else if(attach === 3 || attach === 6 || attach === 9) halign = 'right';
        if(attach >= 4 && attach <= 6) valign = 'middle';
        else if(attach >= 7 && attach <= 9) valign = 'bottom';
        let rot = 0;
        if(e.directionVector && (e.directionVector.x || e.directionVector.y)) rot = Math.atan2(e.directionVector.y, e.directionVector.x);
        else if(e.rotation) rot = e.rotation;
        return mk({ type: 'TEXT', x: tx(pos.x, pos.y), y: ty(pos.x, pos.y), text, height: (e.height || e.nominalTextHeight || 2.5) * sAbs,
            rotation: rot + rotation, halign, valign });
    }
    // HATCH（dxf-parser未対応のため通常は到達しない。境界情報があればポリラインとして取り込む）
    if(e.type === 'HATCH') {
        const results = [];
        const boundaries = e.boundaries || e.boundary || [];
        boundaries.forEach(b => {
            const src = b.polyline || b.vertices;
            if(src && src.length >= 2) results.push(mk({ type: 'PLINE', points: src.map(v => ({ x: tx(v.x, v.y), y: ty(v.x, v.y) })), closed: true }));
        });
        return results.length > 0 ? results : null;
    }
    // SPLINE: 制御点+ノットから曲線を評価。無ければフィット点
    if(e.type === 'SPLINE') {
        let pts = [];
        if(e.controlPoints && e.controlPoints.length >= 2) {
            const samples = Math.min(400, Math.max(16, e.controlPoints.length * 8));
            pts = evalBSplinePoints(e.controlPoints, e.degreeOfSplineCurve || 3, e.knotValues, samples);
        } else if(e.fitPoints && e.fitPoints.length >= 2) {
            pts = e.fitPoints;
        }
        pts = pts.map(v => ({ x: tx(v.x, v.y), y: ty(v.x, v.y) }));
        if(pts.length >= 2) return mk({ type: 'PLINE', points: pts, closed: !!e.closed });
        return null;
    }
    // SOLID / 3DFACE（SOLIDの頂点順は 1-2-4-3 のため 3,4 を入れ替えて多角形化）
    if(e.type === 'SOLID' || e.type === '3DFACE') {
        let src = [];
        if(e.points) src = e.points.filter(p => p);
        else ['corner1', 'corner2', 'corner3', 'corner4', 'firstCorner', 'secondCorner', 'thirdCorner', 'fourthCorner'].forEach(k => { if(e[k]) src.push(e[k]); });
        if(src.length === 4 && e.type === 'SOLID') {
            const p3 = src[2], p4 = src[3];
            src = (Math.abs(p3.x - p4.x) < 1e-9 && Math.abs(p3.y - p4.y) < 1e-9) ? [src[0], src[1], p3] : [src[0], src[1], p4, p3];
        }
        const pts = src.map(p => ({ x: tx(p.x, p.y), y: ty(p.x, p.y) }));
        if(pts.length >= 3) return mk({ type: 'PLINE', points: pts, closed: true });
        return null;
    }
    // DIMENSION（ブロック内の寸法など、expandDimension を経由しない場合の簡易表示）
    if(e.type === 'DIMENSION') {
        const pt = e.middleOfText || e.anchorPoint;
        if(!pt) return null;
        let txt = (e.text !== undefined && e.text !== null) ? String(e.text) : '';
        const measured = (e.actualMeasurement !== undefined) ? String(Math.round(e.actualMeasurement * 100) / 100) : '';
        if(txt === '' || txt === '<>') txt = measured; else if(txt.includes('<>')) txt = txt.replace('<>', measured);
        txt = _decodeCadText(txt);
        if(!txt) return null;
        return mk({ type: 'TEXT', x: tx(pt.x, pt.y), y: ty(pt.x, pt.y), text: txt, height: 2.5 * sAbs, halign: 'center', valign: 'middle' });
    }
    // LEADER
    if(e.type === 'LEADER') {
        const pts = (e.vertices || []).map(v => ({ x: tx(v.x, v.y), y: ty(v.x, v.y) }));
        if(pts.length >= 2) return mk({ type: 'PLINE', points: pts, closed: false });
    }
    return null;
}

// AutoCADカラーインデックス → HEXカラー変換（拡張版）
function aciToHex(aci) {
    const map = {
        1:'#FF0000',2:'#FFFF00',3:'#00FF00',4:'#00FFFF',5:'#0000FF',6:'#FF00FF',7:'#FFFFFF',
        8:'#808080',9:'#C0C0C0',
        10:'#FF0000',11:'#FF7F7F',12:'#CC0000',13:'#CC6666',14:'#990000',15:'#994D4D',
        16:'#7F0000',17:'#7F3F3F',18:'#4C0000',19:'#4C2626',
        20:'#FF3F00',21:'#FF9F7F',22:'#CC3300',23:'#CC7F66',24:'#992600',25:'#995F4D',
        30:'#FF7F00',31:'#FFBF7F',32:'#CC6600',33:'#CC9966',34:'#994D00',35:'#99734D',
        40:'#FFBF00',41:'#FFDF7F',42:'#CC9900',43:'#CCB266',44:'#997300',45:'#99864D',
        50:'#FFFF00',51:'#FFFF7F',52:'#CCCC00',53:'#CCCC66',54:'#999900',55:'#99994D',
        60:'#BFFF00',61:'#DFFF7F',62:'#99CC00',63:'#B2CC66',64:'#739900',65:'#86994D',
        70:'#7FFF00',71:'#BFFF7F',72:'#66CC00',73:'#99CC66',74:'#4D9900',75:'#73994D',
        80:'#3FFF00',81:'#9FFF7F',82:'#33CC00',83:'#7FCC66',84:'#269900',85:'#5F994D',
        90:'#00FF00',91:'#7FFF7F',92:'#00CC00',93:'#66CC66',94:'#009900',95:'#4D994D',
        100:'#00FF3F',101:'#7FFF9F',102:'#00CC33',103:'#66CC7F',104:'#009926',105:'#4D995F',
        110:'#00FF7F',111:'#7FFFBF',112:'#00CC66',113:'#66CC99',114:'#00994D',115:'#4D9973',
        120:'#00FFBF',121:'#7FFFDF',122:'#00CC99',123:'#66CCB2',124:'#009973',125:'#4D9986',
        130:'#00FFFF',131:'#7FFFFF',132:'#00CCCC',133:'#66CCCC',134:'#009999',135:'#4D9999',
        140:'#00BFFF',141:'#7FDFFF',142:'#0099CC',143:'#66B2CC',144:'#007399',145:'#4D8699',
        150:'#007FFF',151:'#7FBFFF',152:'#0066CC',153:'#6699CC',154:'#004D99',155:'#4D7399',
        160:'#003FFF',161:'#7F9FFF',162:'#0033CC',163:'#667FCC',164:'#002699',165:'#4D5F99',
        170:'#0000FF',171:'#7F7FFF',172:'#0000CC',173:'#6666CC',174:'#000099',175:'#4D4D99',
        180:'#3F00FF',181:'#9F7FFF',182:'#3300CC',183:'#7F66CC',184:'#260099',185:'#5F4D99',
        190:'#7F00FF',191:'#BF7FFF',192:'#6600CC',193:'#9966CC',194:'#4D0099',195:'#734D99',
        200:'#BF00FF',201:'#DF7FFF',202:'#9900CC',203:'#B266CC',204:'#730099',205:'#864D99',
        210:'#FF00FF',211:'#FF7FFF',212:'#CC00CC',213:'#CC66CC',214:'#990099',215:'#994D99',
        220:'#FF00BF',221:'#FF7FDF',222:'#CC0099',223:'#CC66B2',224:'#990073',225:'#994D86',
        230:'#FF007F',231:'#FF7FBF',232:'#CC0066',233:'#CC6699',234:'#99004D',235:'#994D73',
        240:'#FF003F',241:'#FF7F9F',242:'#CC0033',243:'#CC667F',244:'#990026',245:'#994D5F',
        250:'#333333',251:'#505050',252:'#696969',253:'#828282',254:'#BEBEBE',255:'#FFFFFF'
    };
    return map[aci] || '#FFFFFF';
}

function hexToAci(hex) {
    const target = (hex || '#FFFFFF').toUpperCase();
    for(let i = 1; i < 256; i++) {
        if(aciToHex(i).toUpperCase() === target) return i;
    }
    // 色番号表に完全一致が無い色（色選択で選んだ任意の色など）は、最も近い色番号にする
    // （以前は常に白(7)になり、書き出すと色が失われていた）
    const rgb = (h) => { const m = /^#?([0-9A-F]{6})$/i.exec(h || ''); if(!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const t = rgb(target);
    if(!t) return 7;
    let best = 7, bestD = Infinity;
    for(let i = 1; i < 256; i++) {
        const c = rgb(aciToHex(i));
        if(!c) continue;
        const dd = (c[0]-t[0])**2 + (c[1]-t[1])**2 + (c[2]-t[2])**2;
        if(dd < bestD) { bestD = dd; best = i; }
    }
    return best;
}

// 図面の取り込み失敗を知らせる（コマンドログはスマホでは畳まれていて見えないため、トーストでも表示）
function reportImportFailure(kind, fileName, err) {
    const msg = (err && err.message) ? err.message : String(err);
    if(typeof showToast === 'function') showToast(`${kind}の読み込みに失敗しました\n${msg}`, 6000);
    if(window.cadErrors) window.cadErrors.record('import', `${kind}読込失敗: ${fileName} - ${msg}`, err && err.stack, { silent: true });
}

// ===== DXFエクスポート =====
function exportDxf() {
    if(typeof window.Drawing !== 'function') {
        addCommandLog('エラー: DXF書き出しライブラリが未ロードです。ページを再読み込みしてください。');
        if(typeof showToast === 'function') showToast('DXF書き出しの準備ができていません。ページを再読み込みしてください', 4000);
        return;
    }
    try {
        const d = new window.Drawing();
        const unitMm = (typeof getSurveyUnit === 'function') && getSurveyUnit() === 'mm';
        d.setUnits(unitMm ? 'Millimeters' : 'Meters');
        // 画層登録（カラー対応）
        layers.forEach(l => { try { d.addLayer(l.name, hexToAci(l.color), 'CONTINUOUS'); } catch(e){} });
        // 寸法出力用の画層を事前登録（未定義のままsetActiveLayerするとエクスポート全体が失敗する）
        if(!layers.find(l => l.name === '寸法')) {
            try { d.addLayer('寸法', 4, 'CONTINUOUS'); } catch(e){}
        }
        // 図形ごとの色（ByLayer 以外）。dxf-writer は図形単位の色に対応していないため、
        // 直前に追加した図形の出力時に「画層(8)の直後に色(62)」を差し込む（既定の 62=256 は置き換え）
        const applyEntityColor = (hex) => {
            if(!hex) return;
            const shapes = d.activeLayer && d.activeLayer.shapes;
            const shape = shapes && shapes[shapes.length - 1];
            if(!shape || typeof shape.tags !== 'function') return;
            const aci = hexToAci(hex);
            const origTags = shape.tags.bind(shape);
            shape.tags = (manager) => {
                const hadOwn = Object.prototype.hasOwnProperty.call(manager, 'push');
                const origPush = manager.push;
                let injected = false;
                manager.push = function(code, value) {
                    if(code === 62 && injected) return;
                    origPush.call(manager, code, value);
                    if(code === 8 && !injected) { origPush.call(manager, 62, aci); injected = true; }
                };
                try { origTags(manager); }
                finally { if(hadOwn) manager.push = origPush; else delete manager.push; }
            };
        };
        const H_ALIGN = { left: 'left', center: 'center', right: 'right' };
        const V_ALIGN = { bottom: 'baseline', middle: 'middle', top: 'top' };
        let skipped = 0;
        // dxf-writer に無い図形（塗りつぶしの HATCH、矢印の SOLID）は、線を1本追加してから
        // その出力内容を差し替えて書く（図形番号・所属は dxf-writer がそのまま管理する）
        const addRaw = (writeBody) => {
            d.drawLine(0, 0, 0, 0);
            const shape = d.activeLayer.shapes[d.activeLayer.shapes.length - 1];
            shape.tags = (m) => {
                m.push(5, shape.handle); m.push(330, shape.ownerObjectHandle);
                writeBody(m, shape.layer.name);
            };
            return shape;
        };
        const writeSolidTriangle = (p1, p2, p3) => addRaw((m, layer) => {
            m.push(100, 'AcDbEntity'); m.push(8, layer); m.push(100, 'AcDbTrace');
            [[10, p1], [11, p2], [12, p3], [13, p3]].forEach(([c, p]) => { m.push(c, p.x); m.push(c + 10, p.y); m.push(c + 20, 0); });
        });
        // 先頭の「0 HATCH / 0 SOLID」は tags の最初に出す必要があるため、差し替えた関数の前に追加する
        const withType = (shape, type) => { const body = shape.tags; shape.tags = (m) => { m.push(0, type); body(m); }; return shape; };
        const writeHatch = (tgt) => {
            let ring = null, circle = null;
            if(tgt.type === 'RECTANG') ring = [{ x: tgt.x1, y: tgt.y1 }, { x: tgt.x2, y: tgt.y1 }, { x: tgt.x2, y: tgt.y2 }, { x: tgt.x1, y: tgt.y2 }];
            else if(tgt.type === 'PLINE' && tgt.points && tgt.points.length >= 3) ring = tgt.points;
            else if(tgt.type === 'CIRCLE') circle = tgt;
            if(!ring && !circle) return false;
            withType(addRaw((m, layer) => {
                m.push(100, 'AcDbEntity'); m.push(8, layer); m.push(100, 'AcDbHatch');
                m.push(10, 0); m.push(20, 0); m.push(30, 0); m.push(210, 0); m.push(220, 0); m.push(230, 1);
                m.push(2, 'SOLID'); m.push(70, 1); m.push(71, 0); m.push(91, 1);
                if(circle) {
                    m.push(92, 1); m.push(93, 1); m.push(72, 2);
                    m.push(10, circle.cx); m.push(20, circle.cy); m.push(40, circle.radius); m.push(50, 0); m.push(51, 360); m.push(73, 1);
                } else {
                    m.push(92, 3); m.push(72, 0); m.push(73, 1); m.push(93, ring.length);
                    ring.forEach(p => { m.push(10, p.x); m.push(20, p.y); });
                }
                m.push(97, 0); m.push(75, 0); m.push(76, 1); m.push(98, 0);
            }), 'HATCH');
            return true;
        };
        // 寸法: 画面と同じ形（寸法線・補助線・矢印・文字）で出力する。文字の高さは図面の大きさから決める
        const dimK = (typeof dimExportTextHeight === 'function' ? dimExportTextHeight() : 2.5) / DIM_TEXT_SIZE;
        const writeDim = (e) => {
            const P = dimExportPrims(e, dimK);
            P.lines.forEach(l => d.drawLine(l.x1, l.y1, l.x2, l.y2));
            P.arcs.forEach(a => d.drawArc(a.cx, a.cy, a.r, a.sa * 180 / Math.PI, a.ea * 180 / Math.PI));
            P.arrows.forEach(a => {
                const c = Math.cos(a.a), s = Math.sin(a.a), bx = a.x - a.size * c, by = a.y - a.size * s, w = a.size / 3;
                withType(writeSolidTriangle({ x: a.x, y: a.y }, { x: bx - w * s, y: by + w * c }, { x: bx + w * s, y: by - w * c }), 'SOLID');
            });
            P.texts.forEach(t => d.drawText(t.x, t.y, t.h, t.ang * 180 / Math.PI, String(t.s), t.ha, t.va));
        };

        // エンティティ出力
        entities.forEach(e => {
            const layerName = layers[e.layer]?.name || '0';
            d.setActiveLayer(layerName);
            let drawn = true;

            if(e.type === 'LINE') { d.drawLine(e.x1, e.y1, e.x2, e.y2); }
            else if(e.type === 'CIRCLE') { d.drawCircle(e.cx, e.cy, e.radius); }
            else if(e.type === 'ARC') {
                // DXFのARCは常に反時計回り。時計回りの弧は開始/終了角を入れ替えて出力する
                let sa = e.startAngle*180/Math.PI, ea = e.endAngle*180/Math.PI;
                if(e.counterclockwise === false) { const t = sa; sa = ea; ea = t; }
                d.drawArc(e.cx, e.cy, e.radius, sa, ea);
            }
            // 長方形・ポリラインは1つのポリライン（LWPOLYLINE）として出力する
            // （以前は線分に分解しており、他のCADで境界を1図形として扱えなかった）
            else if(e.type === 'RECTANG') {
                d.drawPolyline([[e.x1, e.y1], [e.x2, e.y1], [e.x2, e.y2], [e.x1, e.y2]], true);
            }
            else if(e.type === 'PLINE' && e.points && e.points.length >= 2) {
                d.drawPolyline(e.points.map(p => [p.x, p.y]), !!e.closed);
            }
            else if(e.type === 'POINT') { d.drawPoint(e.x, e.y); }
            else if(e.type === 'ELLIPSE') {
                // 長い方の軸を長軸として出力（rx < ry のときは90°回した ry 側が長軸）
                const rot = e.rotation || 0;
                const majorIsX = (e.rx || 0) >= (e.ry || 0);
                const major = majorIsX ? e.rx : e.ry;
                const ang = majorIsX ? rot : rot + Math.PI / 2;
                const ratio = major > 0 ? (majorIsX ? e.ry : e.rx) / major : 1;
                d.drawEllipse(e.cx, e.cy, major * Math.cos(ang), major * Math.sin(ang), ratio);
            }
            else if(e.type === 'TEXT') {
                d.drawText(e.x, e.y, e.height || 2.5, (e.rotation || 0) * 180 / Math.PI, String(e.text || '').replace(/\n/g, ' '),
                    H_ALIGN[e.halign] || 'left', V_ALIGN[e.valign] || 'baseline');
            }
            // 寸法は画面と同じ形の線・矢印・文字として出力（画層「寸法」）
            else if(e.type === 'DIMENSION') { d.setActiveLayer('寸法'); writeDim(e); drawn = false; }
            // 塗りつぶしは HATCH（単色）として出力
            else if(e.type === 'HATCH') { drawn = !!(e.target && writeHatch(e.target)); if(!drawn) skipped++; }
            else { drawn = false; skipped++; }

            if(drawn) applyEntityColor(e.color);
        });
        if(skipped > 0) addCommandLog(`  注意: 書き出しに未対応の図形 ${skipped}個 を省略しました`);
        const blob = new Blob([d.toDxfString()], {type:'application/dxf'});
        downloadBlob(blob, exportFileName('dxf'));
        addCommandLog('-> DXFエクスポート完了');
    } catch(err) {
        addCommandLog(`エラー: DXFエクスポートに失敗 - ${err.message}`);
        console.error('DXFエクスポートエラー:', err);
    }
}

// ===== DWG読み込み（libredwg-web ラッパークラス版） =====
async function loadDwgFile(file) {
    addCommandLog(`DWGファイルを解析中: ${file.name}...`);
    addCommandLog('  libredwg-web を初期化しています...');

    try {
        const buffer = await file.arrayBuffer();
        const fileBytes = new Uint8Array(buffer);

        // DWGヘッダー検証
        const magic = String.fromCharCode(fileBytes[0], fileBytes[1], fileBytes[2], fileBytes[3]);
        if(magic !== 'AC10') {
            addCommandLog('エラー: DWGファイルの形式が不正です');
            if(typeof showToast === 'function') showToast('DWGファイルの形式が不正です（中身がDWGではありません）', 5000);
            return;
        }
        const verStr = String.fromCharCode(...fileBytes.slice(0, 6));
        addCommandLog(`-> DWGバージョン: ${verStr}`);

        // DWG読込エンジン（libredwg-web）はアプリに同梱（src/vendor.js）。
        // 初回のみ数MBを取得し、以降は Service Worker のキャッシュからオフラインでも使える
        let LibreDwg;
        try {
            if(typeof window.loadLibreDwg !== 'function') throw new Error('DWG読込エンジンの読み込み口がありません。ページを再読み込みしてください');
            if(typeof showToast === 'function') showToast('DWG読込エンジンを準備中…', 2500);
            const mod = await window.loadLibreDwg();
            LibreDwg = mod.LibreDwg;
        } catch(importErr) {
            addCommandLog('  DWG読込エンジンの読み込みに失敗しました。');
            if(!navigator.onLine) {
                throw new Error('オフラインのためDWG読込エンジンを取得できません。電波のある場所で一度DWGを開くか、オプションの「DWG読込エンジンを端末に保存」を実行してください', { cause: importErr });
            }
            throw importErr;
        }

        addCommandLog('  WASMモジュールを作成中...');
        // WASM はモジュールに埋め込み済みのため、取得先の指定なしで生成する
        const libredwg = await LibreDwg.create();

        addCommandLog('  DWGデータを展開中...');
        // 0 = Dwg_File_Type.DWG
        const dwg = libredwg.dwg_read_data(fileBytes, 0);

        addCommandLog('  エンティティをJSオブジェクトに変換中...');
        const db = libredwg.convert(dwg);

        // C側のメモリ解放
        libredwg.dwg_free(dwg);

        if(!db || !db.entities || db.entities.length === 0) {
            addCommandLog('注意: エンティティを検出できませんでした。');
            addCommandLog('ヒント: DXF形式に変換して読み込むこともできます。');
            if(typeof showToast === 'function') showToast('DWGから図形を読み取れませんでした\n（ファイル破損または未対応の形式）。DXFに変換して開いてください', 6000);
            return;
        }

        // エンティティ変換
        const importResult = convertDwgDatabaseToApp(db);

        if(importResult.entities.length === 0) {
            addCommandLog('注意: 対応する図形が見つかりませんでした。');
            if(typeof showToast === 'function') showToast('DWG内に表示できる図形が見つかりませんでした', 5000);
            return;
        }

        // エンティティをインポート（画層は変換時に layers へ直接追加済み）
        initLayers();
        importResult.entities.forEach(e => entities.push(e));
        if(typeof ensureEntityIds === 'function') ensureEntityIds();
        if(typeof _bumpGeomEpoch === 'function') _bumpGeomEpoch();
        setDrawingName(file.name);
        addCommandLog(`-> DWGファイル読み込み完了: ${file.name} (${importResult.entities.length}個のオブジェクト)`);
        if(importResult.warnings.length > 0) {
            importResult.warnings.forEach(w => addCommandLog(`  注意: ${w}`));
        }
        if(typeof updateLayerPanel === 'function') updateLayerPanel();
        zoomExtents(); render();
        if(typeof showToast === 'function') showToast(`読み込み完了: ${importResult.entities.length}個の図形`, 4000);
        if(typeof scheduleAutoSave === 'function') scheduleAutoSave();

    } catch(err) {
        addCommandLog(`エラー: DWGファイルの読み込みに失敗 - ${err.message}`);
        reportImportFailure('DWG', file.name, err);
        addCommandLog('ヒント: DXF形式に変換して読み込むこともできます。');
        console.error('DWGパースエラー:', err);
    }
}

// ===== LibreDwg DwgDatabase からアプリ用エンティティへの変換 =====
function convertDwgDatabaseToApp(db) {
    const result = { entities: [], warnings: [] };
    const hideArcs = shouldHideImportedArcs();

    // 画層テーブル: 既存の layers に無いものだけ追加し、以降は「名前→index」で解決する
    // （従来は「既存数 + 新規リスト内の順番」で index を決めていたため、既存と重複する画層があるとずれていた）
    const layerTable = (db.tables && db.tables.LAYER) || (db.tables && db.tables.layer);
    if (layerTable && layerTable.entries) {
        layerTable.entries.forEach(l => {
            let hexColor = '#FFFFFF';
            let cIdx = l.colorIndex;
            if (cIdx === undefined && l.color && l.color.colorIndex !== undefined) cIdx = l.color.colorIndex;
            else if (cIdx === undefined && typeof l.color === 'number') cIdx = l.color;
            if (cIdx !== undefined && cIdx > 0 && cIdx < 256) hexColor = aciToHex(cIdx);
            const lName = l.name || '0';
            if (!layers.find(x => x.name === lName)) layers.push({ name: lName, color: hexColor, visible: !l.off && !l.frozen });
        });
    }
    const layerIndexOf = (name) => {
        const nm = (name === undefined || name === null || name === '') ? '0' : String(name);
        let idx = layers.findIndex(l => l.name === nm);
        if (idx < 0) { layers.push({ name: nm, color: '#FFFFFF', visible: true }); idx = layers.length - 1; }
        return idx;
    };

    // ブロックレコードの準備 (INSERT用)
    const blocks = {};
    if (db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) {
        db.tables.BLOCK_RECORD.entries.forEach(b => { blocks[b.name] = b; });
    }

    let importCount = 0;
    const skipStats = {};
    const noteSkip = (t) => { skipStats[t] = (skipStats[t] || 0) + 1; };
    const push = (ent, gid, blockName) => {
        if (gid) { ent.gid = gid; ent.blockName = blockName; }
        if (hideArcs && ent.type === 'ARC') ent.hidden = true;
        result.entities.push(ent); importCount++;
    };

    // 再帰的にエンティティを展開する内部関数（gid: 最上位INSERT単位のグループID）
    function processDwgEntity(ent, depth, pX, pY, sX, sY, rot, gid, blockName) {
        if (depth > 10) return; // 無限再帰防止
        try {
            // ブロック参照 (INSERT) の再帰展開
            if (ent.type === 'INSERT') {
                const b = blocks[ent.name];
                const gidHere = gid || newGroupId('b');
                const bnHere = blockName || ent.name;
                const topLevel = !gid;
                const startCount = result.entities.length;
                if (b && b.entities && Array.isArray(b.entities)) {
                    const insX = ent.insertionPoint ? ent.insertionPoint.x : 0;
                    const insY = ent.insertionPoint ? ent.insertionPoint.y : 0;
                    const newSx = sX * (ent.xScale !== undefined && ent.xScale !== 0 ? ent.xScale : 1);
                    const newSy = sY * (ent.yScale !== undefined && ent.yScale !== 0 ? ent.yScale : 1);
                    const newRot = rot + (ent.rotation || 0); // ラジアン想定
                    // 挿入点をワールドへ
                    const insWx = pX + (insX * sX * Math.cos(rot) - insY * sY * Math.sin(rot));
                    const insWy = pY + (insX * sX * Math.sin(rot) + insY * sY * Math.cos(rot));
                    // ブロック基点があれば差し引く: world = R·S·(p − 基点) + 挿入点
                    const bp = b.basePoint || b.origin || b.position || null;
                    const bpx = bp ? (bp.x || 0) : 0, bpy = bp ? (bp.y || 0) : 0;
                    const newPx = insWx - (newSx * bpx * Math.cos(newRot) - newSy * bpy * Math.sin(newRot));
                    const newPy = insWy - (newSx * bpx * Math.sin(newRot) + newSy * bpy * Math.cos(newRot));
                    b.entities.forEach(child => processDwgEntity(child, depth + 1, newPx, newPy, newSx, newSy, newRot, gidHere, bnHere));
                }
                // 属性（測点名など）が INSERT に付随している場合
                const attrs = ent.attributes || ent.attribs || ent.attribList;
                if (Array.isArray(attrs)) attrs.forEach(a => processDwgEntity(Object.assign({ type: 'ATTRIB' }, a), depth + 1, pX, pY, sX, sY, rot, gidHere, bnHere));
                // 最上位の挿入点を記録（座標一覧・SIMA出力でブロックの測点を扱うため）
                if (topLevel && ent.insertionPoint) {
                    const ix = pX + (ent.insertionPoint.x * sX * Math.cos(rot) - ent.insertionPoint.y * sY * Math.sin(rot));
                    const iy = pY + (ent.insertionPoint.x * sX * Math.sin(rot) + ent.insertionPoint.y * sY * Math.cos(rot));
                    for (let k = startCount; k < result.entities.length; k++) result.entities[k].ins = { x: ix, y: iy };
                }
                return;
            }

            const tx = (x, y) => pX + (x * sX * Math.cos(rot) - y * sY * Math.sin(rot));
            const ty = (x, y) => pY + (x * sX * Math.sin(rot) + y * sY * Math.cos(rot));
            const sAbs = Math.abs(sX);

            let layerName = '0';
            if (ent.layer) layerName = typeof ent.layer === 'object' ? (ent.layer.name || '0') : ent.layer;
            const layer = layerIndexOf(layerName);

            let color = null; // ByLayer
            if (ent.colorIndex !== undefined && ent.colorIndex !== 256 && ent.colorIndex !== 0) color = aciToHex(ent.colorIndex);
            const base = { layer, color };

            if (ent.type === 'LINE') {
                if (ent.startPoint && ent.endPoint) {
                    push(Object.assign({ type: 'LINE',
                        x1: tx(ent.startPoint.x, ent.startPoint.y), y1: ty(ent.startPoint.x, ent.startPoint.y),
                        x2: tx(ent.endPoint.x, ent.endPoint.y), y2: ty(ent.endPoint.x, ent.endPoint.y) }, base), gid, blockName);
                } else noteSkip('LINE');
            } else if (ent.type === 'CIRCLE') {
                if (ent.center && ent.radius) {
                    push(Object.assign({ type: 'CIRCLE', cx: tx(ent.center.x, ent.center.y), cy: ty(ent.center.x, ent.center.y), radius: ent.radius * sAbs }, base), gid, blockName);
                } else noteSkip('CIRCLE');
            } else if (ent.type === 'ARC') {
                if (ent.center && ent.radius) {
                    const sa = ent.startAngle || 0, ea = (ent.endAngle === undefined || ent.endAngle === null) ? Math.PI * 2 : ent.endAngle;
                    const c = { x: tx(ent.center.x, ent.center.y), y: ty(ent.center.x, ent.center.y) };
                    const r = ent.radius;
                    const ps = { x: tx(ent.center.x + r * Math.cos(sa), ent.center.y + r * Math.sin(sa)), y: ty(ent.center.x + r * Math.cos(sa), ent.center.y + r * Math.sin(sa)) };
                    const pe = { x: tx(ent.center.x + r * Math.cos(ea), ent.center.y + r * Math.sin(ea)), y: ty(ent.center.x + r * Math.cos(ea), ent.center.y + r * Math.sin(ea)) };
                    push(Object.assign({ type: 'ARC', cx: c.x, cy: c.y, radius: r * sAbs,
                        startAngle: Math.atan2(ps.y - c.y, ps.x - c.x), endAngle: Math.atan2(pe.y - c.y, pe.x - c.x),
                        counterclockwise: (sX * sY) >= 0 }, base), gid, blockName);
                } else noteSkip('ARC');
            } else if (ent.type === 'POINT') {
                const pt = ent.position || ent.point;
                if (pt) push(Object.assign({ type: 'POINT', x: tx(pt.x, pt.y), y: ty(pt.x, pt.y) }, base), gid, blockName);
                else noteSkip('POINT');
            } else if (ent.type === 'TEXT' || ent.type === 'ATTRIB') {
                if (ent.type === 'ATTRIB' && (ent.invisible || (ent.flags & 1))) return;
                const pt = ent.alignmentPoint || ent.insertionPoint || ent.insertion_pt || ent.position || ent.startPoint;
                const textStr = _decodeCadText(ent.textValue !== undefined ? ent.textValue : (ent.text || ''));
                let halign = 'left', valign = 'bottom';
                if (ent.horizontalAlignment === 1 || ent.horizontalAlignment === 4) halign = 'center';
                else if (ent.horizontalAlignment === 2) halign = 'right';
                if (ent.verticalAlignment === 2) valign = 'middle';
                else if (ent.verticalAlignment === 3) valign = 'top';
                if (pt && textStr) {
                    push(Object.assign({ type: 'TEXT', x: tx(pt.x, pt.y), y: ty(pt.x, pt.y), text: textStr,
                        height: (ent.height || ent.textHeight || 2.5) * sAbs, rotation: (ent.rotation || 0) + rot, halign, valign }, base), gid, blockName);
                } else noteSkip(ent.type);
            } else if (ent.type === 'MTEXT') {
                const pt = ent.insertionPoint || ent.position;
                const text = _cleanCadMtext(ent.text || ent.textValue || '');
                let halign = 'left', valign = 'top';
                const attach = ent.attachmentPoint || ent.attachment || 1;
                if (attach === 2 || attach === 5 || attach === 8) halign = 'center';
                else if (attach === 3 || attach === 6 || attach === 9) halign = 'right';
                if (attach >= 4 && attach <= 6) valign = 'middle';
                else if (attach >= 7 && attach <= 9) valign = 'bottom';
                let mrot = ent.rotation || 0;
                const dv = ent.direction || ent.xAxisDirection;
                if (dv && (dv.x || dv.y)) mrot = Math.atan2(dv.y, dv.x);
                if (pt && text) {
                    push(Object.assign({ type: 'TEXT', x: tx(pt.x, pt.y), y: ty(pt.x, pt.y), text,
                        height: (ent.textHeight || ent.height || 2.5) * sAbs, rotation: mrot + rot, halign, valign }, base), gid, blockName);
                } else noteSkip('MTEXT');
            } else if (ent.type && ent.type.includes('DIMENSION')) {
                const pt = ent.textPoint || ent.definitionPoint || ent.insertionPoint;
                let dimText = ent.text;
                if (!dimText && ent.measurement !== undefined) dimText = parseFloat(ent.measurement).toFixed(0);
                else if (dimText && dimText.includes('<>')) dimText = dimText.replace('<>', parseFloat(ent.measurement || 0).toFixed(0));
                if (dimText) dimText = _decodeCadText(dimText);
                if (pt && dimText) {
                    push(Object.assign({ type: 'TEXT', x: tx(pt.x, pt.y), y: ty(pt.x, pt.y), text: dimText, height: (ent.textHeight || ent.height || 2.5) * sAbs, halign: 'center', valign: 'middle' }, base), gid || newGroupId('d'), blockName || '寸法');
                } else noteSkip('DIMENSION');
            } else if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE2D' || ent.type === 'POLYLINE_2D') {
                if (ent.vertices && ent.vertices.length > 0) {
                    const verts = ent.vertices.map(v => {
                        const vx = v.x !== undefined ? v.x : (v.point ? v.point.x : 0);
                        const vy = v.y !== undefined ? v.y : (v.point ? v.point.y : 0);
                        return { x: vx, y: vy, bulge: v.bulge || 0 };
                    });
                    const closed = !!ent.closed || !!(ent.flag & 1) || !!ent.isClosed;
                    const pts = expandBulgeVertices(verts, closed).map(v => ({ x: tx(v.x, v.y), y: ty(v.x, v.y) }));
                    if (pts.length >= 2) push(Object.assign({ type: 'PLINE', points: pts, closed }, base), gid, blockName);
                    else noteSkip('POLYLINE');
                } else noteSkip('POLYLINE');
            } else if (ent.type === 'ELLIPSE') {
                const center = ent.center;
                const endPt = ent.majorAxisEndPoint;
                if (center && endPt) {
                    // libredwg-web may return majorAxisEndPoint as absolute or relative depending on context/version.
                    const rx_rel = Math.sqrt(endPt.x ** 2 + endPt.y ** 2);
                    const rx_abs = Math.sqrt((endPt.x - center.x) ** 2 + (endPt.y - center.y) ** 2);
                    const isAbsolute = rx_abs < rx_rel;
                    const dx = isAbsolute ? (endPt.x - center.x) : endPt.x;
                    const dy = isAbsolute ? (endPt.y - center.y) : endPt.y;
                    const rx = Math.sqrt(dx ** 2 + dy ** 2) * sAbs;
                    const ry = rx * (ent.axisRatio || 1);
                    push(Object.assign({ type: 'ELLIPSE', cx: tx(center.x, center.y), cy: ty(center.x, center.y), rx, ry, rotation: Math.atan2(dy, dx) + rot }, base), gid, blockName);
                } else noteSkip('ELLIPSE');
            } else if (ent.type === 'SPLINE') {
                let pts = [];
                const ctrl = ent.controlPoints || ent.ctrlPts;
                if (ctrl && ctrl.length >= 2) pts = evalBSplinePoints(ctrl, ent.degree || 3, ent.knots, Math.min(400, Math.max(16, ctrl.length * 8)));
                else if (ent.fitPoints && ent.fitPoints.length >= 2) pts = ent.fitPoints;
                pts = pts.map(v => ({ x: tx(v.x, v.y), y: ty(v.x, v.y) }));
                if (pts.length >= 2) push(Object.assign({ type: 'PLINE', points: pts, closed: !!ent.closed }, base), gid, blockName);
                else noteSkip('SPLINE');
            } else if ((ent.type === 'SOLID' || ent.type === '3DFACE') && Array.isArray(ent.points || ent.corners)) {
                let src = (ent.points || ent.corners).filter(p => p);
                if (src.length === 4 && ent.type === 'SOLID') src = [src[0], src[1], src[3], src[2]];
                const pts = src.map(p => ({ x: tx(p.x, p.y), y: ty(p.x, p.y) }));
                if (pts.length >= 3) push(Object.assign({ type: 'PLINE', points: pts, closed: true }, base), gid, blockName);
                else noteSkip(ent.type);
            } else {
                noteSkip(ent.type || '?');
            }
        } catch (e) {
            noteSkip(ent && ent.type ? ent.type : '?');
        }
    }

    if (db.entities && Array.isArray(db.entities)) {
        db.entities.forEach(ent => processDwgEntity(ent, 0, 0, 0, 1, 1, 0, null, null));
        const skipTotal = Object.values(skipStats).reduce((a, b) => a + b, 0);
        addCommandLog(`  変換完了: ${importCount}個 (未対応図形スキップ: ${skipTotal}個)`);
        if (skipTotal > 0) {
            const detail = Object.entries(skipStats).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}×${c}`).join(', ');
            addCommandLog(`  未対応・除外: ${detail}`);
        }
    } else {
        result.warnings.push('DwgDatabase に entities が見つかりませんでした。');
    }

    return result;
}

// ===== DWGエクスポート =====
async function exportDwg() {
    addCommandLog('注意: DWG形式では書き出せません。DXF形式で保存します（AutoCAD・Jw_cad などで開けます）');
    if(typeof showToast === 'function') showToast('DWG では書き出せないため、DXF で保存しました\n（AutoCAD・Jw_cad などで開けます）', 5000);
    exportDxf();
}

// エクスポート時のファイル名（図面名があればそれを使う）
function exportFileName(ext) {
    let base = (window._drawingName || '').trim();
    if(!base && document.title && document.title !== 'Web CAD' && document.title !== 'WebCAD') base = document.title.replace(/ - WebCAD$/, '');
    base = (base || 'drawing').replace(/\.(dxf|dwg)$/i, '').replace(/[\\/:*?"<>|]/g, '_');
    return base + '.' + ext;
}

// ===== ファイルダウンロード =====
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ===== ファイルコマンド（cad-core.jsから呼ばれる） =====
function processIOCommand(cmd) {
    if(cmd === 'OPEN' || cmd === 'IMPORT') {
        document.getElementById('dxf-file-input').click();
        return true;
    }
    if(cmd === 'SAVEAS' || cmd === 'EXPORTDXF') { exportDxf(); return true; }
    if(cmd === 'EXPORTDWG') { exportDwg(); return true; }
    return false;
}

// ===== ファイル入力イベント =====
function setupFileIO() {
    const fileInput = document.getElementById('dxf-file-input');
    fileInput.setAttribute('accept', '.dxf,.dwg,.sim,.csv,.txt,.sdr');
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if(!file) return;
        const ext = file.name.split('.').pop().toLowerCase();
        if(ext === 'dxf' || ext === 'dwg') {
            _prepareImportTarget(); // 置き換え/追加の確認（Undo 1回分を保存）
            if(ext === 'dxf') loadDxfFile(file); else loadDwgFile(file);
        }
        else if(ext === 'sim' && typeof loadSimaFile === 'function') { _prepareImportTarget(); loadSimaFile(file); }
        else if((ext === 'csv' || ext === 'txt') && typeof loadCoordCsvFile === 'function') { _prepareImportTarget(); loadCoordCsvFile(file); }
        else if(ext === 'sdr' && typeof loadSdrFile === 'function') { _prepareImportTarget(); loadSdrFile(file); } // トータルステーションの現場データ（SDR33・SDR2x）
        else {
            addCommandLog(`未対応の形式です: .${ext}`);
            if(typeof showToast === 'function') showToast(`未対応の形式です（.${ext}）\nDXF・DWG・SIMA（.sim）・座標CSV・SDR（.sdr）を開けます`, 4000);
        }
        fileInput.value = ''; // リセット
    });
    // DXFボタンにイベント
    document.getElementById('btn-load-dxf').addEventListener('click', () => {
        fileInput.click();
    });
}

// 初期化
document.addEventListener('DOMContentLoaded', setupFileIO);
if(document.readyState !== 'loading') setupFileIO();
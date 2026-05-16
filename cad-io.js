// ===== Web CAD ファイル入出力モジュール =====
// cad-io.js - DXF/DWGの読み込みとエクスポート

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
            // 日本語環境のAutoCAD出力に多いShift-JIS (ANSI_932)でデコード
            const decoder = new TextDecoder('shift-jis');
            const text = decoder.decode(buffer);

            const parser = new window.DxfParser();
            const dxf = parser.parseSync(text);
            importDxfData(dxf);
            setDrawingName(file.name);
            addCommandLog(`-> DXFファイル読み込み完了: ${file.name}`);
        } catch(err) {
            addCommandLog(`エラー: DXFファイルの読み込みに失敗 - ${err.message}`);
            console.error('DXFパースエラー:', err);
        }
    };
    reader.readAsArrayBuffer(file);
}

function importDxfData(dxf) {
    saveUndo();
    let importCount = 0;
    let skipCount = 0;

    // 画層の読み込み
    if(dxf.tables && dxf.tables.layer && dxf.tables.layer.layers) {
        const dxfLayers = dxf.tables.layer.layers;
        Object.keys(dxfLayers).forEach(name => {
            if(!layers.find(l => l.name === name)) {
                const dl = dxfLayers[name];
                layers.push({ name: name, color: aciToHex(dl.color || 7), visible: true });
            }
        });
        initLayers();
    }

    // エンティティの読み込み（INSERT以外）
    if(dxf.entities) {
        dxf.entities.forEach(e => {
            if(e.type === 'INSERT') return; // ブロック参照は後で処理
            // モデル空間のみを読み込む（ペーパースペース/レイアウト空間の図形を除外）
            if(e.inPaperSpace || e.paperSpace) { skipCount++; return; }
            
            try {
                const results = convertDxfEntity(e);
                if(results) {
                    if(Array.isArray(results)) { results.forEach(r => entities.push(r)); importCount += results.length; }
                    else { entities.push(results); importCount++; }
                } else { skipCount++; }
            } catch(err) { skipCount++; console.warn('エンティティ変換エラー:', e.type, err); }
        });
    }

    // ブロック参照(INSERT)の再帰展開
    if(dxf.blocks && dxf.entities) {
        dxf.entities.forEach(e => {
            if(e.type === 'INSERT') {
                try {
                    const expanded = expandInsert(e, dxf.blocks, 0);
                    expanded.forEach(ent => entities.push(ent));
                    importCount += expanded.length;
                } catch(err) { skipCount++; console.warn('ブロック展開エラー:', e.name, err); }
            }
        });
    }

    addCommandLog(`  読み込み: ${importCount}個 / スキップ: ${skipCount}個`);
    zoomExtents();
    render();
}

// ===== ブロック参照(INSERT)の再帰展開 =====
function expandInsert(insertEnt, blocks, depth) {
    if(depth > 10) return []; // 無限再帰防止
    const blockName = insertEnt.name;
    const block = blocks[blockName];
    if(!block || !block.entities) return [];

    const ix = insertEnt.position ? insertEnt.position.x : 0;
    const iy = insertEnt.position ? insertEnt.position.y : 0;
    const sx = insertEnt.xScale || 1, sy = insertEnt.yScale || 1;
    const rot = (insertEnt.rotation || 0) * Math.PI / 180;
    const cols = insertEnt.columnCount || 1, rows = insertEnt.rowCount || 1;
    const colSpacing = insertEnt.columnSpacing || 0, rowSpacing = insertEnt.rowSpacing || 0;

    const result = [];

    for(let col = 0; col < cols; col++) {
        for(let row = 0; row < rows; row++) {
            const baseX = ix + col * colSpacing;
            const baseY = iy + row * rowSpacing;

            block.entities.forEach(be => {
                if(be.type === 'INSERT') {
                    // ネストされたブロック参照を再帰展開
                    const nestedInsert = Object.assign({}, be);
                    if(nestedInsert.position) {
                        const px = nestedInsert.position.x * sx;
                        const py = nestedInsert.position.y * sy;
                        const rx = px * Math.cos(rot) - py * Math.sin(rot);
                        const ry = px * Math.sin(rot) + py * Math.cos(rot);
                        nestedInsert.position = { x: rx + baseX, y: ry + baseY };
                    }
                    if(nestedInsert.xScale) nestedInsert.xScale *= sx;
                    if(nestedInsert.yScale) nestedInsert.yScale *= sy;
                    const nested = expandInsert(nestedInsert, blocks, depth + 1);
                    nested.forEach(n => result.push(n));
                } else {
                    try {
                        const transformed = convertDxfEntity(be, baseX, baseY, sx, sy, rot);
                        if(transformed) {
                            if(Array.isArray(transformed)) transformed.forEach(t => result.push(t));
                            else result.push(transformed);
                        }
                    } catch(err) { console.warn('ブロック内エンティティ変換エラー:', be.type, err); }
                }
            });
        }
    }
    return result;
}

// ===== DXFエンティティ変換（拡張版） =====
function convertDxfEntity(e, offX, offY, scaleX, scaleY, rotation) {
    offX = offX || 0; offY = offY || 0; scaleX = scaleX || 1; scaleY = scaleY || 1; rotation = rotation || 0;
    const tx = (x, y) => {
        const sx = x * scaleX, sy = y * scaleY;
        if(rotation === 0) return sx + offX;
        return sx * Math.cos(rotation) - sy * Math.sin(rotation) + offX;
    };
    const ty = (x, y) => {
        const sx = x * scaleX, sy = y * scaleY;
        if(rotation === 0) return sy + offY;
        return sx * Math.sin(rotation) + sy * Math.cos(rotation) + offY;
    };
    const layerIdx = layers.findIndex(l => l.name === (e.layer || '0'));
    const layer = Math.max(0, layerIdx);
    let color = layers[layer] ? layers[layer].color : '#FFFFFF';
    if(e.colorIndex !== undefined && e.colorIndex !== 256 && e.colorIndex !== 0) {
        color = aciToHex(e.colorIndex);
    }

    // LINE
    if(e.type === 'LINE') {
        if(!e.vertices || e.vertices.length < 2) return null;
        return {type:'LINE', layer, color,
            x1:tx(e.vertices[0].x, e.vertices[0].y), y1:ty(e.vertices[0].x, e.vertices[0].y),
            x2:tx(e.vertices[1].x, e.vertices[1].y), y2:ty(e.vertices[1].x, e.vertices[1].y)};
    }
    // CIRCLE
    if(e.type === 'CIRCLE') {
        if(!e.center) return null;
        return {type:'CIRCLE', layer, color, cx:tx(e.center.x, e.center.y), cy:ty(e.center.x, e.center.y), radius:e.radius*Math.abs(scaleX)};
    }
    // ARC
    if(e.type === 'ARC') {
        if(!e.center) return null;
        let sa = (e.startAngle || 0) * Math.PI / 180;
        let ea = (e.endAngle || 360) * Math.PI / 180;
        if(rotation !== 0) { sa += rotation; ea += rotation; }
        return {type:'ARC', layer, color, cx:tx(e.center.x, e.center.y), cy:ty(e.center.x, e.center.y), radius:e.radius*Math.abs(scaleX), startAngle:sa, endAngle:ea, counterclockwise:true};
    }
    // LWPOLYLINE / POLYLINE
    if(e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
        const pts = (e.vertices || []).map(v => ({x:tx(v.x, v.y), y:ty(v.x, v.y)}));
        if(pts.length >= 2) return {type:'PLINE', layer, color, points:pts, closed:!!e.shape};
    }
    // POINT
    if(e.type === 'POINT') {
        if(!e.position) return null;
        return {type:'POINT', layer, color, x:tx(e.position.x, e.position.y), y:ty(e.position.x, e.position.y)};
    }
    // ELLIPSE
    if(e.type === 'ELLIPSE') {
        if(!e.center || !e.majorAxisEndPoint) return null;
        const rx = Math.sqrt(e.majorAxisEndPoint.x**2 + e.majorAxisEndPoint.y**2) * Math.abs(scaleX);
        const ry = rx * (e.axisRatio || 1);
        let rot = Math.atan2(e.majorAxisEndPoint.y, e.majorAxisEndPoint.x);
        if(rotation !== 0) { rot += rotation; }
        return {type:'ELLIPSE', layer, color, cx:tx(e.center.x, e.center.y), cy:ty(e.center.x, e.center.y), rx:rx, ry:ry, rotation:rot};
    }
    // TEXT
    if(e.type === 'TEXT') {
        const pos = e.startPoint || e.position || {x:0, y:0};
        return {type:'TEXT', layer, color, x:tx(pos.x, pos.y), y:ty(pos.x, pos.y), text:e.text || '', height:(e.textHeight || 2.5)*Math.abs(scaleX)};
    }
    // MTEXT
    if(e.type === 'MTEXT') {
        const pos = e.position || {x:0, y:0};
        // MTEXTの書式コード除去
        let text = (e.text || '').replace(/\\[Ppf].*;/g, '').replace(/\\[A-Za-z][^;]*;/g, '').replace(/\{|\}/g, '').replace(/\\[\\]/g, '');
        return {type:'TEXT', layer, color, x:tx(pos.x, pos.y), y:ty(pos.x, pos.y), text:text, height:(e.height || e.nominalTextHeight || 2.5)*Math.abs(scaleX)};
    }
    // HATCH - 境界パスをPLINEとして読み込み
    if(e.type === 'HATCH') {
        const results = [];
        if(e.boundaries || e.boundary) {
            const boundaries = e.boundaries || e.boundary || [];
            boundaries.forEach(b => {
                // 境界エッジの処理
                if(b.edges) {
                    b.edges.forEach(edge => {
                        if(edge.type === 'LINE' && edge.vertices && edge.vertices.length >= 2) {
                            results.push({type:'LINE', layer, color,
                                x1:tx(edge.vertices[0].x, edge.vertices[0].y), y1:ty(edge.vertices[0].x, edge.vertices[0].y),
                                x2:tx(edge.vertices[1].x, edge.vertices[1].y), y2:ty(edge.vertices[1].x, edge.vertices[1].y)});
                        } else if(edge.type === 'ARC' && edge.center) {
                            const sa = (edge.startAngle || 0) * Math.PI / 180;
                            const ea = (edge.endAngle || 360) * Math.PI / 180;
                            results.push({type:'ARC', layer, color, cx:tx(edge.center.x, edge.center.y), cy:ty(edge.center.x, edge.center.y),
                                radius:(edge.radius || 1)*Math.abs(scaleX), startAngle:sa, endAngle:ea, counterclockwise:!edge.isCounterClockwise});
                        }
                    });
                }
                // ポリライン境界
                if(b.polyline && b.polyline.length >= 2) {
                    const pts = b.polyline.map(v => ({x:tx(v.x, v.y), y:ty(v.x, v.y)}));
                    results.push({type:'PLINE', layer, color, points:pts, closed:true});
                }
                // 頂点リスト
                if(b.vertices && b.vertices.length >= 2) {
                    const pts = b.vertices.map(v => ({x:tx(v.x, v.y), y:ty(v.x, v.y)}));
                    results.push({type:'PLINE', layer, color, points:pts, closed:true});
                }
            });
        }
        return results.length > 0 ? results : null;
    }
    // SPLINE - 制御点でポリライン近似
    if(e.type === 'SPLINE') {
        const pts = (e.controlPoints || e.fitPoints || []).map(v => ({x:tx(v.x, v.y), y:ty(v.x, v.y)}));
        if(pts.length >= 2) return {type:'PLINE', layer, color, points:pts, closed:!!e.closed};
    }
    // SOLID / 3DFACE - 三角形/四角形の塗りつぶし面
    if(e.type === 'SOLID' || e.type === '3DFACE') {
        const pts = [];
        if(e.points) { e.points.forEach(p => pts.push({x:tx(p.x, p.y), y:ty(p.x, p.y)})); }
        else {
            ['corner1','corner2','corner3','corner4','firstCorner','secondCorner','thirdCorner','fourthCorner'].forEach(k => {
                if(e[k]) pts.push({x:tx(e[k].x, e[k].y), y:ty(e[k].x, e[k].y)});
            });
        }
        if(pts.length >= 3) return {type:'PLINE', layer, color, points:pts, closed:true};
    }
    // DIMENSION - 寸法記入は線分+テキストに分解
    if(e.type === 'DIMENSION') {
        const results = [];
        if(e.anchorPoint && e.middleOfText) {
            // 寸法線
            if(e.anchorPoint) results.push({type:'POINT', layer, color, x:tx(e.anchorPoint.x, e.anchorPoint.y), y:ty(e.anchorPoint.x, e.anchorPoint.y)});
            // 寸法値テキスト
            if(e.middleOfText) {
                const val = e.text || '';
                results.push({type:'TEXT', layer, color, x:tx(e.middleOfText.x, e.middleOfText.y), y:ty(e.middleOfText.x, e.middleOfText.y), text:val, height:2.5*Math.abs(scaleX)});
            }
        }
        return results.length > 0 ? results : null;
    }
    // LEADER / MULTILEADER
    if(e.type === 'LEADER') {
        const pts = (e.vertices || []).map(v => ({x:tx(v.x, v.y), y:ty(v.x, v.y)}));
        if(pts.length >= 2) return {type:'PLINE', layer, color, points:pts, closed:false};
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
    return 7; // default white
}

// ===== DXFエクスポート =====
function exportDxf() {
    try {
        const d = new window.Drawing();
        d.setUnits('Millimeters');
        // 画層登録（カラー対応）
        layers.forEach(l => { try { d.addLayer(l.name, hexToAci(l.color), 'CONTINUOUS'); } catch(e){} });
        // エンティティ出力
        entities.forEach(e => {
            if(e.type === 'LINE') { d.setActiveLayer(layers[e.layer]?.name||'0'); d.drawLine(e.x1, e.y1, e.x2, e.y2); }
            else if(e.type === 'CIRCLE') { d.setActiveLayer(layers[e.layer]?.name||'0'); d.drawCircle(e.cx, e.cy, e.radius); }
            else if(e.type === 'ARC') { d.setActiveLayer(layers[e.layer]?.name||'0'); d.drawArc(e.cx, e.cy, e.radius, e.startAngle*180/Math.PI, e.endAngle*180/Math.PI); }
            else if(e.type === 'RECTANG') {
                d.setActiveLayer(layers[e.layer]?.name||'0');
                d.drawLine(e.x1,e.y1,e.x2,e.y1); d.drawLine(e.x2,e.y1,e.x2,e.y2);
                d.drawLine(e.x2,e.y2,e.x1,e.y2); d.drawLine(e.x1,e.y2,e.x1,e.y1);
            }
            else if(e.type === 'PLINE' && e.points.length >= 2) {
                d.setActiveLayer(layers[e.layer]?.name||'0');
                for(let i = 1; i < e.points.length; i++) d.drawLine(e.points[i-1].x, e.points[i-1].y, e.points[i].x, e.points[i].y);
                if(e.closed) d.drawLine(e.points[e.points.length-1].x, e.points[e.points.length-1].y, e.points[0].x, e.points[0].y);
            }
            else if(e.type === 'POINT') { d.setActiveLayer(layers[e.layer]?.name||'0'); d.drawPoint(e.x, e.y); }
            else if(e.type === 'TEXT') { d.setActiveLayer(layers[e.layer]?.name||'0'); d.drawText(e.x, e.y, e.height || 2.5, 0, e.text || ''); }
            // 寸法は補助線+テキストとして出力
            else if(e.type === 'DIMENSION') { exportDimAsDxf(d, e); }
        });
        const blob = new Blob([d.toDxfString()], {type:'application/dxf'});
        downloadBlob(blob, 'drawing.dxf');
        addCommandLog('-> DXFエクスポート完了');
    } catch(err) {
        addCommandLog(`エラー: DXFエクスポートに失敗 - ${err.message}`);
        console.error('DXFエクスポートエラー:', err);
    }
}

function exportDimAsDxf(d, e) {
    d.setActiveLayer('寸法');
    // 寸法は基本図形（線分+テキスト）に分解して出力
    if(e.subType === 'LINEAR' || e.subType === 'ALIGNED') {
        d.drawLine(e.p1.x, e.p1.y, e.p2.x, e.p2.y);
        const val = dist(e.p1.x, e.p1.y, e.p2.x, e.p2.y);
        d.drawText((e.p1.x+e.p2.x)/2, (e.p1.y+e.p2.y)/2 + (e.offset||5), 3, 0, e.textOverride || val.toFixed(2));
    }
    else if(e.subType === 'RADIUS') { d.drawText(e.center.x, e.center.y, 3, 0, e.textOverride || 'R'+e.radius.toFixed(2)); }
    else if(e.subType === 'DIAMETER') { d.drawText(e.center.x, e.center.y, 3, 0, e.textOverride || '⌀'+(e.radius*2).toFixed(2)); }
    else if(e.subType === 'ANGULAR') {
        const a1 = Math.atan2(e.arm1.y-e.vertex.y, e.arm1.x-e.vertex.x);
        const a2 = Math.atan2(e.arm2.y-e.vertex.y, e.arm2.x-e.vertex.x);
        let deg = Math.abs(a2-a1)*180/Math.PI; if(deg>180) deg=360-deg;
        d.drawText(e.vertex.x, e.vertex.y, 3, 0, e.textOverride || deg.toFixed(1)+'°');
    }
    else if(e.subType === 'ORDINATE') {
        const u = wcsToUcs(e.point.x, e.point.y);
        const val = e.isX ? u.x : u.y;
        d.drawText(e.leader.x, e.leader.y, 3, 0, e.textOverride || val.toFixed(2));
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
            return;
        }
        const verStr = String.fromCharCode(...fileBytes.slice(0, 6));
        addCommandLog(`-> DWGバージョン: ${verStr}`);

        // LibreDwg ラッパーの動的読み込み
        const DIST_URL = 'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.6.6/dist/libredwg-web.js';
        const WASM_DIR = 'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.6.6/wasm';
        
        let LibreDwg;
        try {
            const mod = await import(DIST_URL);
            LibreDwg = mod.LibreDwg;
        } catch(importErr) {
            addCommandLog('  ESモジュールのロードに失敗しました。');
            throw importErr;
        }

        addCommandLog('  WASMモジュールを作成中...');
        const libredwg = await LibreDwg.create(WASM_DIR);

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
            return;
        }

        // エンティティ変換
        const importResult = convertDwgDatabaseToApp(db);

        if(importResult.entities.length === 0) {
            addCommandLog('注意: 対応する図形が見つかりませんでした。');
            return;
        }

        // レイヤーの追加
        importResult.layers.forEach(l => {
            if(!layers.find(existing => existing.name === l.name)) {
                layers.push(l);
            }
        });
        if(importResult.layers.length > 0) initLayers();

        // エンティティをインポート
        saveUndo();
        importResult.entities.forEach(e => entities.push(e));
        setDrawingName(file.name);
        addCommandLog(`-> DWGファイル読み込み完了: ${file.name} (${importResult.entities.length}個のオブジェクト)`);
        if(importResult.warnings.length > 0) {
            importResult.warnings.forEach(w => addCommandLog(`  注意: ${w}`));
        }
        zoomExtents(); render();

    } catch(err) {
        addCommandLog(`エラー: DWGファイルの読み込みに失敗 - ${err.message}`);
        addCommandLog('ヒント: DXF形式に変換して読み込むこともできます。');
        console.error('DWGパースエラー:', err);
    }
}

// ===== LibreDwg DwgDatabase からアプリ用エンティティへの変換 =====
function convertDwgDatabaseToApp(db) {
    const result = { entities: [], layers: [], warnings: [] };
    
    // 画層テーブルの処理
    if (db.tables && db.tables.layer && db.tables.layer.entries) {
        db.tables.layer.entries.forEach(l => {
            let hexColor = '#FFFFFF';
            if (l.colorIndex !== undefined && l.colorIndex > 0 && l.colorIndex < 256) {
                hexColor = aciToHex(l.colorIndex);
            }
            result.layers.push({ name: l.name || '0', color: hexColor, visible: !l.off && !l.frozen });
        });
    }

    const defaultLayer = currentLayerIndex;
    const defaultColor = '#FFFFFF';

    // ブロックレコードの準備 (INSERT用)
    const blocks = {};
    if (db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) {
        db.tables.BLOCK_RECORD.entries.forEach(b => {
            blocks[b.name] = b;
        });
    }

    let importCount = 0;
    let skipCount = 0;

    // 再帰的にエンティティを展開する内部関数
    function processDwgEntity(ent, depth, pX, pY, sX, sY, rot) {
        if (depth > 10) return; // 無限再帰防止

        try {
            // ブロック参照 (INSERT) の再帰展開
            if (ent.type === 'INSERT') {
                const b = blocks[ent.name];
                if (b && b.entities && Array.isArray(b.entities)) {
                    const insX = ent.insertionPoint ? ent.insertionPoint.x : 0;
                    const insY = ent.insertionPoint ? ent.insertionPoint.y : 0;
                    
                    // 親の変換を適用した新しい原点
                    const newPx = pX + (insX * sX * Math.cos(rot) - insY * sY * Math.sin(rot));
                    const newPy = pY + (insX * sX * Math.sin(rot) + insY * sY * Math.cos(rot));
                    
                    const newSx = sX * (ent.xScale !== undefined ? ent.xScale : 1);
                    const newSy = sY * (ent.yScale !== undefined ? ent.yScale : 1);
                    const newRot = rot + (ent.rotation || 0); // ラジアン想定
                    
                    b.entities.forEach(child => {
                        processDwgEntity(child, depth + 1, newPx, newPy, newSx, newSy, newRot);
                    });
                }
                return; // INSERT自体は描画オブジェクトではないためスキップ
            }

            // 座標変換ヘルパー関数
            const tx = (x, y) => pX + (x * sX * Math.cos(rot) - y * sY * Math.sin(rot));
            const ty = (x, y) => pY + (x * sX * Math.sin(rot) + y * sY * Math.cos(rot));

            const layerName = ent.layer || '0';
            const appLayerIdx = layers.findIndex(l => l.name === layerName);
            const newLayerIdx = result.layers.findIndex(l => l.name === layerName);
            const layer = appLayerIdx >= 0 ? appLayerIdx : (newLayerIdx >= 0 ? layers.length + newLayerIdx : defaultLayer);
            
            let color = defaultColor;
            if (ent.colorIndex !== undefined && ent.colorIndex !== 256 && ent.colorIndex !== 0) {
                color = aciToHex(ent.colorIndex);
            } else {
                const lObj = result.layers.find(l => l.name === layerName) || layers.find(l => l.name === layerName);
                if (lObj) color = lObj.color;
            }

            if (ent.type === 'LINE') {
                if(ent.startPoint && ent.endPoint) {
                    result.entities.push({type:'LINE', layer, color, 
                        x1:tx(ent.startPoint.x, ent.startPoint.y), y1:ty(ent.startPoint.x, ent.startPoint.y), 
                        x2:tx(ent.endPoint.x, ent.endPoint.y), y2:ty(ent.endPoint.x, ent.endPoint.y)});
                    importCount++;
                } else skipCount++;
            } else if (ent.type === 'CIRCLE') {
                if(ent.center && ent.radius) {
                    result.entities.push({type:'CIRCLE', layer, color, 
                        cx:tx(ent.center.x, ent.center.y), cy:ty(ent.center.x, ent.center.y), 
                        radius:ent.radius * Math.abs(sX)});
                    importCount++;
                } else skipCount++;
            } else if (ent.type === 'ARC') {
                if(ent.center && ent.radius) {
                    let sa = ent.startAngle || 0;
                    let ea = ent.endAngle || (Math.PI * 2);
                    if (rot !== 0) { sa += rot; ea += rot; }
                    result.entities.push({type:'ARC', layer, color, 
                        cx:tx(ent.center.x, ent.center.y), cy:ty(ent.center.x, ent.center.y), 
                        radius:ent.radius * Math.abs(sX), 
                        startAngle:sa, endAngle:ea, counterclockwise:true});
                    importCount++;
                } else skipCount++;
            } else if (ent.type === 'POINT') {
                const pt = ent.position || ent.point;
                if(pt) {
                    result.entities.push({type:'POINT', layer, color, x:tx(pt.x, pt.y), y:ty(pt.x, pt.y)});
                    importCount++;
                } else skipCount++;
            } else if (ent.type === 'TEXT') {
                const pt = ent.insertionPoint || ent.alignmentPoint || ent.insertion_pt || ent.position;
                const textStr = ent.textValue !== undefined ? ent.textValue : (ent.text || '');
                if (pt && textStr) {
                    result.entities.push({type:'TEXT', layer, color, 
                        x:tx(pt.x, pt.y), y:ty(pt.x, pt.y), text:textStr, height:(ent.height || 2.5) * Math.abs(sX)});
                    importCount++;
                } else skipCount++;
            } else if (ent.type === 'MTEXT') {
                const pt = ent.insertionPoint || ent.position;
                let text = ent.text || ent.textValue || '';
                text = text.replace(/\\[A-Za-z0-9][^;]*;/g, '').replace(/\\[Ppf].*;/g, '').replace(/\{|\}/g, '').replace(/\\[\\]/g, '\\');
                if (pt && text) {
                    result.entities.push({type:'TEXT', layer, color, 
                        x:tx(pt.x, pt.y), y:ty(pt.x, pt.y), text:text, height:(ent.textHeight || ent.height || 2.5) * Math.abs(sX)});
                    importCount++;
                } else skipCount++;
            } else if (ent.type && ent.type.includes('DIMENSION')) {
                const pt = ent.textPoint || ent.definitionPoint || ent.insertionPoint;
                let dimText = ent.text;
                if (!dimText && ent.measurement !== undefined) {
                    dimText = parseFloat(ent.measurement).toFixed(0);
                } else if (dimText && dimText.includes('<>')) {
                    dimText = dimText.replace('<>', parseFloat(ent.measurement || 0).toFixed(0));
                }
                if (pt && dimText) {
                    result.entities.push({type:'TEXT', layer, color, 
                        x:tx(pt.x, pt.y), y:ty(pt.x, pt.y), text:dimText, height: 2.5 * Math.abs(sX)});
                    importCount++;
                } else skipCount++;
            } else if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE2D' || ent.type === 'POLYLINE_2D') {
                if (ent.vertices && ent.vertices.length > 0) {
                    const pts = ent.vertices.map(v => {
                        const vx = v.x !== undefined ? v.x : v.point.x;
                        const vy = v.y !== undefined ? v.y : v.point.y;
                        return { x: tx(vx, vy), y: ty(vx, vy) };
                    });
                    result.entities.push({type:'PLINE', layer, color, points:pts, closed: !!ent.flag || !!ent.closed});
                    importCount++;
                } else skipCount++;
            } else if (ent.type === 'ELLIPSE') {
                const center = ent.center;
                const endPt = ent.majorAxisEndPoint;
                if (center && endPt) {
                    const rx = Math.sqrt(endPt.x**2 + endPt.y**2) * Math.abs(sX);
                    const ry = rx * (ent.axisRatio || 1);
                    const ellipseRot = Math.atan2(endPt.y, endPt.x) + rot;
                    result.entities.push({type:'ELLIPSE', layer, color, 
                        cx:tx(center.x, center.y), cy:ty(center.x, center.y), rx:rx, ry:ry, rotation:ellipseRot}); 
                    importCount++;
                } else skipCount++;
            } else {
                skipCount++;
            }
        } catch(e) {
            skipCount++;
        }
    }

    if (db.entities && Array.isArray(db.entities)) {
        db.entities.forEach(ent => {
            processDwgEntity(ent, 0, 0, 0, 1, 1, 0);
        });
        
        addCommandLog(`  変換完了: ${importCount}個 (未対応図形スキップ: ${skipCount}個)`);
        
    } else {
        result.warnings.push('DwgDatabase に entities が見つかりませんでした。');
    }

    return result;
}

// ===== DWGエクスポート =====
async function exportDwg() {
    addCommandLog('注意: DWG形式での保存は現在DXF形式にフォールバックされます。');
    exportDxf();
    addCommandLog('-> DXF形式として保存されました');
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
    fileInput.setAttribute('accept', '.dxf,.dwg');
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if(!file) return;
        const ext = file.name.split('.').pop().toLowerCase();
        if(ext === 'dxf') loadDxfFile(file);
        else if(ext === 'dwg') loadDwgFile(file);
        else addCommandLog(`未対応の形式です: .${ext}`);
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

// ===== Web CAD DWG の読み込み =====
// cad-dwg.js - DWG を読込エンジン（libredwg-web。WASM）で読み、アプリの図形に直す（cad-io.js から分けた）。
//   塗りつぶし・引出線・寸法のブロックなどの形を直す処理は cad-import-shapes.js（DXF と共通）

// ===== DWG読み込み（libredwg-web ラッパークラス版） =====
async function loadDwgFile(file) {
    busyStart('DWG を読み込み中…');
    const appendMode = (typeof _importMode !== 'undefined' && _importMode === 'append'); // レイアウトを足すか置き換えるか
    addCommandLog(`DWGファイルを解析中: ${file.name}...`);
    addCommandLog('  libredwg-web を初期化しています...');

    try {
        const buffer = await file.arrayBuffer();
        const fileBytes = new Uint8Array(buffer);

        // DWGヘッダー検証
        const magic = String.fromCharCode(fileBytes[0], fileBytes[1], fileBytes[2], fileBytes[3]);
        if(magic !== 'AC10') {
            addCommandLog('エラー: DWGファイルの形式が不正です');
            if(typeof _restoreAfterFailedImport === 'function') _restoreAfterFailedImport(); // 置き換えで消した図面を戻す
            if(typeof showToast === 'function') showToast('DWGファイルの形式が不正です（中身がDWGではありません）', { kind: 'error', ms: 5000 });
            return;
        }
        const verStr = String.fromCharCode(...fileBytes.slice(0, 6));
        addCommandLog(`-> DWGバージョン: ${verStr}`);

        // DWG読込エンジン（libredwg-web）はアプリに同梱（src/vendor.js）。
        // 初回のみ数MBを取得し、以降は Service Worker のキャッシュからオフラインでも使える
        let LibreDwg;
        try {
            if(typeof window.loadLibreDwg !== 'function') throw new Error('DWG読込エンジンの読み込み口がありません。ページを再読み込みしてください');
            await busyStep('  DWG の読込エンジンを準備中…');
            const mod = await window.loadLibreDwg();
            LibreDwg = mod.LibreDwg;
        } catch(importErr) {
            addCommandLog('  DWG読込エンジンの読み込みに失敗しました。');
            if(!navigator.onLine) {
                throw new Error('オフラインのためDWG読込エンジンを取得できません。電波のある場所で一度DWGを開くか、オプションの「DWG読込エンジンを端末に保存」を実行してください', { cause: importErr });
            }
            throw importErr;
        }

        await busyStep('  DWG の読込エンジンを起動中…');
        // WASM はモジュールに埋め込み済みのため、取得先の指定なしで生成する
        const libredwg = await LibreDwg.create();

        await busyStep('  DWG のデータを展開中…');
        // 0 = Dwg_File_Type.DWG
        const dwg = libredwg.dwg_read_data(fileBytes, 0);

        await busyStep('  図形に変換中…');
        const db = libredwg.convert(dwg);
        db.__layerLt = readDwgLayerLinetypes(libredwg, dwg); // 画層の線種（読込エンジンは空にしているので引き直す。cad-ltype.js）

        // C側のメモリ解放
        libredwg.dwg_free(dwg);

        if(!db || !db.entities || db.entities.length === 0) {
            addCommandLog('注意: エンティティを検出できませんでした。');
            addCommandLog('ヒント: DXF形式に変換して読み込むこともできます。');
            if(typeof _restoreAfterFailedImport === 'function') _restoreAfterFailedImport(); // 置き換えで消した図面を戻す
            if(typeof showToast === 'function') showToast('DWGから図形を読み取れませんでした\n（ファイル破損または未対応の形式）。DXFに変換して開いてください', { kind: 'error', ms: 6000 });
            return;
        }

        // エンティティ変換
        const importResult = convertDwgDatabaseToApp(db);

        if(importResult.entities.length === 0 && !(importResult.layouts || []).length) {
            addCommandLog('注意: 対応する図形が見つかりませんでした。');
            if(typeof _restoreAfterFailedImport === 'function') _restoreAfterFailedImport(); // 置き換えで消した図面を戻す
            if(typeof showToast === 'function') showToast(importResult.paperSkipped ? paperOnlyNote(importResult.paperSkipped) : 'DWG内に表示できる図形が見つかりませんでした', { kind: 'error', ms: 5000 });
            return;
        }

        // エンティティをインポート（画層は変換時に layers へ直接追加済み）
        initLayers();
        importResult.entities.forEach(e => entities.push(e));
        // レイアウト（図枠・表題欄・ビューポート）は別の画面に（cad-layout.js）
        const layoutCount = (typeof layoutsFromImport === 'function') ? layoutsFromImport(importResult.layouts, appendMode) : 0;
        const layoutNote = (typeof layoutImportNote === 'function') ? layoutImportNote(layoutCount) : '';
        if(layoutNote) addCommandLog('  ' + layoutNote);
        if(typeof ensureEntityIds === 'function') ensureEntityIds();
        if(typeof _bumpGeomEpoch === 'function') _bumpGeomEpoch();
        setDrawingName(file.name);
        addCommandLog(`-> DWGファイル読み込み完了: ${file.name} (${importResult.entities.length}個のオブジェクト)`);
        if(importResult.warnings.length > 0) {
            importResult.warnings.forEach(w => addCommandLog(`  注意: ${w}`));
        }
        if(typeof updateLayerPanel === 'function') updateLayerPanel();
        // DWG の単位（INSUNITS）に「図面の1単位」を合わせる（新しく開いたとき。追加のときは知らせるだけ）。
        // 以前は DWG の単位を見ておらず、mm の図面でも 1m のまま座標寸法などを小数3桁（0.001mm）で出していた
        const unitNote = applyFileUnit(db.header && db.header.INSUNITS, 'DWG');
        if(unitNote) addCommandLog('-> ' + unitNote);
        zoomExtents(); render();
        const skipNote = importResultNote(importResult.skipStats, importResult.hiddenFills) + (importResult.warnings.length ? `\n（読めなかったものが ${importResult.warnings.length}件あります。詳しくはコマンド欄）` : '');
        if(importResult.entities.length === 0 && layoutCount > 0) {
            // モデルに図形が無く、レイアウトだけある: そのレイアウトを出す
            layoutShow(cadLayouts.length - layoutCount);
            if(typeof showToast === 'function') showToast(`モデル空間に図形がありません。レイアウト「${cadLayouts[cadLayouts.length - layoutCount].name}」を出しました（画面の下のタブで切り替え）`, { kind: 'warn', ms: 6000 });
        } else if(typeof showToast === 'function') showToast(`読み込み完了: ${importResult.entities.length}個の図形` + (unitNote ? '\n' + unitNote : '') + skipNote + (layoutNote ? '\n' + layoutNote : ''), { kind: (importResult.warnings.length || Object.keys(importResult.skipStats || {}).length) ? 'warn' : 'success', ms: (unitNote || skipNote || layoutNote) ? 7000 : 4000 });
        if(typeof scheduleAutoSave === 'function') scheduleAutoSave();

    } catch(err) {
        addCommandLog(`エラー: DWGファイルの読み込みに失敗 - ${err.message}`);
        // 読込エンジン（WASM）が途中で止まったとき: ファイルの中に、エンジンが読めない作りがある
        const engineDown = /memory access out of bounds|unreachable|RuntimeError|Aborted|out of memory/i.test(String(err && err.message));
        reportImportFailure('DWG', file.name, engineDown ? new Error('この DWG は、読込エンジンが読めない作りを含んでいます。AutoCAD で DXF に書き出して開いてください（' + err.message + '）') : err);
        addCommandLog('ヒント: DXF形式に変換して読み込むこともできます。');
        console.error('DWGパースエラー:', err);
    } finally { busyEnd(); }
}

// 塗りつぶしの辺: 読込エンジンの形（type 1 線・2 円弧・3 楕円弧・4 スプライン。角度はラジアン）を、共通の形（cad-import-shapes.js）にする
function _dwgHatchEdge(ed) {
    if(!ed) return null;
    if(ed.type === 1 && ed.start && ed.end) return { t: 'line', a: ed.start, b: ed.end };
    if(ed.type === 2 && ed.center) return { t: 'arc', c: ed.center, r: ed.radius || 0, a0: ed.startAngle || 0, a1: ed.endAngle || 0, ccw: !!ed.isCCW };
    if(ed.type === 3 && ed.center && ed.end) return { t: 'ell', c: ed.center, mx: ed.end.x, my: ed.end.y, ratio: ed.lengthOfMinorAxis || 1, a0: ed.startAngle || 0, a1: ed.endAngle || 0, ccw: !!ed.isCCW };
    if(ed.type === 4) return { t: 'spline', deg: ed.degree || 3, knots: ed.knots, ctrl: ed.controlPoints, fit: ed.fitDatum };
    return null;
}

// ===== LibreDwg DwgDatabase からアプリ用エンティティへの変換 =====
function convertDwgDatabaseToApp(db) {
    const result = { entities: [], warnings: [], paperSkipped: 0, skipStats: {}, hiddenFills: 0 };
    const dh = db.header || {};
    _beginImport(dh.INSUNITS, dh.DIMTXT, dh.DIMSCALE, dh.DIMASZ); // 寸法の値の桁・文字と矢印の大きさ（ファイルの単位・寸法の設定）
    // 線種表と線種の尺度（LTSCALE）。cad-ltype.js
    registerFileLinetypes(((db.tables && db.tables.LTYPE && db.tables.LTYPE.entries) || []).map(t => ({ name: t.name, d: (t.pattern || []).map(p => p.elementLength), desc: t.description })));
    applyFileLtscale(dh.LTSCALE);
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
            if (!layers.find(x => x.name === lName)) {
                const lay = { name: lName, color: hexColor, visible: !l.off && !l.frozen };
                const lt = (db.__layerLt || {})[lName], lw = dwgLineweight(l.lineweight);
                if (lt && String(lt).toUpperCase() !== 'CONTINUOUS') lay.lt = lt;
                if (typeof lw === 'number') lay.lw = lw;
                layers.push(lay);
            }
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
    const skipStats = result.skipStats;
    const noteSkip = (t) => { skipStats[t] = (skipStats[t] || 0) + 1; };
    const push = (ent, gid, blockName) => {
        if (gid) { ent.gid = gid; ent.blockName = blockName; }
        if (hideArcs && ent.type === 'ARC') { ent.hidden = true; ent.hiddenBy = 'arc'; }
        result.entities.push(ent); importCount++;
    };

    // 再帰的にエンティティを展開する内部関数（gid: 最上位INSERT単位のグループID）
    function processDwgEntity(ent, depth, pX, pY, sX, sY, rot, gid, blockName, blk) {
        if (depth > 10) return; // 無限再帰防止
        try {
            // ブロック参照 (INSERT) の再帰展開
            // アプリが書き出した測点（ブロック「測点」と属性）は、座標一覧の点に戻す
            if (ent.type === 'INSERT' && ent.name === '測点' && !gid && typeof surveyPointFromInsert === 'function') {
                const ip = ent.insertionPoint || {};
                const attrs = (ent.attribs || ent.attributes || []).map(a => { const q = a.insertionPoint || a.startPoint || a.position || {}; return { tag: a.tag, text: a.textValue !== undefined ? a.textValue : a.text, x: q.x || 0, y: q.y || 0, h: a.textHeight || a.height, layer: layerIndexOf(typeof a.layer === 'object' ? (a.layer && a.layer.name) : a.layer), invisible: !!(a.invisible || (Number(a.flags) & 1)) }; });
                surveyPointFromInsert({ x: ip.x || 0, y: ip.y || 0, z: ip.z || 0 }, layerIndexOf(typeof ent.layer === 'object' ? (ent.layer && ent.layer.name) : ent.layer), attrs).forEach(o => push(o));
                return;
            }
            if (ent.type === 'INSERT') {
                const b = blocks[ent.name];
                const gidHere = gid || newGroupId('b');
                const bnHere = blockName || ent.name;
                const topLevel = !gid;
                const startCount = result.entities.length;
                // ブロック参照の線種・太さ（中の BYBLOCK の図形に渡す）
                const insStyle = insertLineStyle(importLineStyle(ent.lineType, dwgLineweight(ent.lineweight), 1, blk), layerIndexOf(typeof ent.layer === 'object' ? (ent.layer && ent.layer.name) : ent.layer), blk);
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
                    b.entities.forEach(child => processDwgEntity(child, depth + 1, newPx, newPy, newSx, newSy, newRot, gidHere, bnHere, insStyle));
                }
                // 属性（測点名など）が INSERT に付随している場合
                const attrs = ent.attributes || ent.attribs || ent.attribList;
                if (Array.isArray(attrs)) attrs.forEach(a => processDwgEntity(Object.assign({ type: 'ATTRIB' }, a), depth + 1, pX, pY, sX, sY, rot, gidHere, bnHere, insStyle));
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
            const xf = { pt: (x, y) => ({ x: tx(x, y), y: ty(x, y) }), vec: (x, y) => ({ x: x * sX * Math.cos(rot) - y * sY * Math.sin(rot), y: x * sX * Math.sin(rot) + y * sY * Math.cos(rot) }), k: sAbs };

            let layerName = '0';
            if (ent.layer) layerName = typeof ent.layer === 'object' ? (ent.layer.name || '0') : ent.layer;
            const layer = layerIndexOf(layerName);

            let color = null; // ByLayer
            if (ent.colorIndex !== undefined && ent.colorIndex !== 256 && ent.colorIndex !== 0) color = aciToHex(ent.colorIndex);
            const base = Object.assign({ layer, color }, importLineStyle(ent.lineType, dwgLineweight(ent.lineweight), ent.lineTypeScale, blk)); // 線種・線の太さ（cad-ltype.js）

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
            } else if (ent.type === 'ATTDEF') {
                const flags = Number(ent.flags) || 0;
                if (ent.invisible || (flags & 1)) return;
                const str = gid ? ((ent.constant || (flags & 2)) ? (ent.text || '') : '') : (ent.tag || ent.text || '');
                if (str) processDwgEntity(Object.assign({}, ent, { type: 'TEXT', text: str, textValue: str }), depth, pX, pY, sX, sY, rot, gid, blockName, blk);
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
                // アプリが書き出した寸法（拡張データ WEBCAD に中身がある）は、アプリの寸法に戻す
                const own = (!gid && typeof webcadEntityFromXdata === 'function') ? webcadEntityFromXdata(webcadXdataStringsDwg(ent)) : null;
                if (own) { own.layer = layer; push(own); return; }
                const db0 = ent.name && blocks[ent.name];
                if (db0 && Array.isArray(db0.entities) && db0.entities.length) {
                    const start = result.entities.length;
                    const g = gid || newGroupId('d'), bn = blockName || '寸法'; // 寸法1つを1つのまとまりに
                    const dimStyle = insertLineStyle(importLineStyle(ent.lineType, dwgLineweight(ent.lineweight), 1, blk), layer, blk);
                    db0.entities.forEach(child => processDwgEntity(child, depth + 1, pX, pY, sX, sY, rot, g, bn, dimStyle));
                    if (result.entities.length > start) { unhideFills(result.entities.slice(start)); return; } // 矢印（塗り）は非表示にしない
                }
                const pt = ent.textPoint || ent.definitionPoint || ent.insertionPoint;
                // 測定値の文字（種類ごと: 長さ・半径 R・直径 ⌀・角度 °・座標）。ブロックを拡大縮小して置くときは、長さも同じだけ倍にする
                const dkind = _dimKindDwg(ent.subclassMarker);
                const dmeas = (typeof ent.measurement === 'number' && dkind !== 'angular') ? ent.measurement * sAbs : ent.measurement;
                const dimText = importedDimText(dkind, dmeas, ent.text);
                if (pt && dimText) {
                    push(Object.assign({ type: 'TEXT', x: tx(pt.x, pt.y), y: ty(pt.x, pt.y), text: dimText, height: (ent.textHeight || ent.height || _importDimTxt.h) * sAbs, halign: 'center', valign: 'middle' }, base), gid || newGroupId('d'), blockName || '寸法');
                } else noteSkip('DIMENSION');
            } else if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE2D' || ent.type === 'POLYLINE_2D' || ent.type === 'POLYLINE3D') {
                if (ent.vertices && ent.vertices.length > 0) {
                    const verts = ent.vertices.map(v => {
                        const vx = v.x !== undefined ? v.x : (v.point ? v.point.x : 0);
                        const vy = v.y !== undefined ? v.y : (v.point ? v.point.y : 0);
                        return { x: vx, y: vy, bulge: v.bulge || 0 };
                    });
                    // 閉じているか: DWG（libredwg-web）の LWPOLYLINE は flag の 512 が「閉じている」（1 は法線あり・256 は線種の連続）。
                    // 以前は 1 で判定していたため、閉じた四角形の閉じる辺（最後の点→最初の点。左上から描いた長方形では左の辺）が消え、
                    // 逆に法線を持つ開いた線が閉じていた。POLYLINE2D の flag は DXF と同じく 1 が「閉じている」
                    const closed = !!ent.closed || !!ent.isClosed || (ent.type === 'LWPOLYLINE' ? !!(ent.flag & 512) : !!(ent.flag & 1));
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
            } else if (ent.type === 'SOLID' || ent.type === '3DFACE' || ent.type === 'TRACE') {
                let src = Array.isArray(ent.points || ent.corners) ? (ent.points || ent.corners).filter(p => p) : ['corner1', 'corner2', 'corner3', 'corner4'].map(k => ent[k]).filter(Boolean);
                // SOLID の角の順は 1-2-4-3（3 と 4 が同じなら三角）
                if (src.length === 4 && ent.type !== '3DFACE') { const p3 = src[2], p4 = src[3]; src = (Math.abs(p3.x - p4.x) < 1e-9 && Math.abs(p3.y - p4.y) < 1e-9) ? [src[0], src[1], p3] : [src[0], src[1], p4, p3]; }
                const pts = src.map(p => ({ x: tx(p.x, p.y), y: ty(p.x, p.y) }));
                // SOLID・TRACE は塗り（塗りつぶしと同じくオプションで非表示）。3DFACE は面の縁の線
                const f = ent.type === '3DFACE' ? (pts.length >= 3 ? Object.assign({ type: 'PLINE', points: pts, closed: true }, base) : null) : makeImportedFill(pts, base, _importHideFills);
                if (f) push(f, gid, blockName); else noteSkip(ent.type);
            } else if (ent.type === 'HATCH') {
                // 塗りつぶし: 境界（ふくらみ付きの折れ線、または辺）を輪にし、模様は線の定義のまま持つ（cad-import-shapes.js）。オプションで非表示
                const paths = (ent.boundaryPaths || []).map(bp => Array.isArray(bp.vertices) ? { poly: bp.vertices.map(v => ({ x: v.x, y: v.y, bulge: v.bulge || 0 })) } : { edges: (bp.edges || []).map(_dwgHatchEdge).filter(Boolean) });
                const lines = (ent.definitionLines || []).map(l => ({ a: l.angle || 0, bx: (l.base && l.base.x) || 0, by: (l.base && l.base.y) || 0, ox: (l.offset && l.offset.x) || 0, oy: (l.offset && l.offset.y) || 0, d: l.dashLengths || [] }));
                const h = makeImportedHatch(paths, xf, { base, solid: ent.solidFill === 1, name: ent.patternName, lines, angle: (ent.patternAngle || 0) * 180 / Math.PI, scale: ent.patternScale, hide: _importHideFills });
                if (h) push(h, gid, blockName); else noteSkip('HATCH');
            } else if (ent.type === 'LEADER') {
                // 引出線: 折れ線と、始めの点の矢印（大きさは寸法の設定 DIMASZ × DIMSCALE）
                const pts = (ent.vertices || []).map(v => ({ x: tx(v.x, v.y), y: ty(v.x, v.y) }));
                const out = makeImportedLeader(pts, base, _importDimTxt.asz * sAbs, ent.isArrowheadEnabled !== false);
                if (out.length) out.forEach(o => push(o, gid, blockName)); else noteSkip('LEADER');
            } else {
                noteSkip(ent.type || '?');
            }
        } catch (e) {
            noteSkip(ent && ent.type ? ent.type : '?');
        }
    }

    if (db.entities && Array.isArray(db.entities)) {
        const isPaper = dwgPaperSpaceTester(db); // レイアウト（ペーパー空間）はモデルに入れない（下で別の画面のレイアウトにする）
        const inInsert = new Set();
        db.entities.forEach(ent => { if (ent && ent.type === 'INSERT') (ent.attribs || ent.attributes || []).forEach(a => inInsert.add(a)); });
        db.entities.forEach(ent => { if(isPaper(ent)) { result.paperSkipped++; return; } if (inInsert.has(ent)) return; processDwgEntity(ent, 0, 0, 0, 1, 1, 0, null, null); });
        result.hiddenFills = result.entities.filter(e => e.hiddenBy === 'fill').length;
        const skipTotal = Object.values(skipStats).reduce((a, b) => a + b, 0);
        addCommandLog(`  変換完了: ${importCount}個 / 取り込めなかった図形: ${skipTotal}個`);
        if (skipTotal > 0) addCommandLog(`  取り込めなかった図形: ${importSkipText(skipStats, true)}`);
        if (result.hiddenFills > 0) addCommandLog(`  塗りつぶし ${result.hiddenFills}個は非表示にしました（画層管理の「塗りつぶしを表示」で表示。オプションで初めから表示にもできます）`);
        if (result.paperSkipped > 0) addCommandLog(`  ${PAPER_SPACE_LABEL}の図形 ${result.paperSkipped}個は、モデルには入れません`);
    } else {
        result.warnings.push('DwgDatabase に entities が見つかりませんでした。');
    }

    // ===== レイアウト（ペーパー空間）: 図枠・表題欄・ビューポートを、モデルとは別に変える（別の画面で見る。cad-layout.js） =====
    result.layouts = [];
    if (typeof makeImportedLayout === 'function') {
        const los = (db.objects && db.objects.LAYOUT) || [];
        ((db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) || []).forEach(br => {
            if (!br || !PAPER_SPACE_RE.test(br.name || '')) return;
            const lo = los.find(l => l && l.paperSpaceTableId !== undefined && String(l.paperSpaceTableId).toUpperCase() === String(br.handle).toUpperCase()) || null;
            const raw = (br.entities || []).filter(Boolean);
            const own = new Set();
            raw.forEach(en => { if (en.type === 'INSERT') (en.attribs || en.attributes || []).forEach(a => own.add(a)); });
            // 変えた図形はレイアウトの入れ物へ（モデルの数・入れ物には入れない）
            const saved = result.entities, n0 = importCount, list = [];
            result.entities = list;
            raw.forEach(en => { if (en.type !== 'VIEWPORT' && !own.has(en)) processDwgEntity(en, 0, 0, 0, 1, 1, 0, null, null); });
            result.entities = saved; importCount = n0;
            const mainVp = lo && lo.viewportId !== undefined ? String(lo.viewportId).toUpperCase() : null;
            const vps = raw.filter(en => en.type === 'VIEWPORT').map(v => dwgLayoutViewport(v, mainVp, layerIndexOf));
            const lim = (lo && lo.minLimit && lo.maxLimit) ? { x0: lo.minLimit.x, y0: lo.minLimit.y, x1: lo.maxLimit.x, y1: lo.maxLimit.y } : null;
            const lay = makeImportedLayout({ name: lo && lo.layoutName ? lo.layoutName : br.name.replace(/^\*/, ''), order: lo ? lo.tabOrder : 99, lim, ents: list, vps });
            if (lay) result.layouts.push(lay);
        });
    }

    return result;
}

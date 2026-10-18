// ===== Web CAD 座標変換・UCS・画面表示 =====
// cad-view.js - 画面座標とWCS/UCSの相互変換、UCS（ユーザー座標系）の設定・保存、
//               画面の向き合わせ（PLAN）とズーム
// （cad-core.js から分割。ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

// ===== 座標変換 =====
function screenToWcs(sx, sy) {
    let rwx = (sx - view.x) / view.scale;
    let rwy = -(sy - view.y) / view.scale;
    if (view.rotation !== 0) {
        const c = Math.cos(-view.rotation), s = Math.sin(-view.rotation);
        return { x: rwx*c - rwy*s, y: rwx*s + rwy*c };
    }
    return { x: rwx, y: rwy };
}
function wcsToScreen(wx, wy) {
    let dx = wx, dy = wy;
    if (view.rotation !== 0) {
        const c = Math.cos(view.rotation), s = Math.sin(view.rotation);
        dx = wx*c - wy*s;
        dy = wx*s + wy*c;
    }
    return { x: dx*view.scale + view.x, y: -dy*view.scale + view.y };
}
// ズーム時のビュー再配置: WCS座標(wb)が画面座標(sx,sy)に来るようにview.x/yを計算
function _reanchorView(sx, sy, wb) {
    let dx = wb.x, dy = wb.y;
    if (view.rotation !== 0) {
        const c = Math.cos(view.rotation), s = Math.sin(view.rotation);
        dx = wb.x*c - wb.y*s;
        dy = wb.x*s + wb.y*c;
    }
    view.x = sx - dx * view.scale;
    view.y = sy + dy * view.scale;
}
function ucsToWcs(ux,uy) {
    // 回転→平行移動
    const c=Math.cos(ucs.angle), s=Math.sin(ucs.angle);
    return { x: ux*c - uy*s + ucs.originX, y: ux*s + uy*c + ucs.originY };
}
function wcsToUcs(wx,wy) {
    // 平行移動→逆回転
    const dx=wx-ucs.originX, dy=wy-ucs.originY;
    const c=Math.cos(-ucs.angle), s=Math.sin(-ucs.angle);
    return { x: dx*c - dy*s, y: dx*s + dy*c };
}
function screenToUcs(sx,sy) { const w=screenToWcs(sx,sy); return wcsToUcs(w.x,w.y); }
// 量（ベクトル）を UCS の向きで見る（平行移動は含めない）。動かした量・寸法の向きなど
function ucsVector(dx, dy) {
    const c = Math.cos(-ucs.angle), s = Math.sin(-ucs.angle);
    return { x: dx*c - dy*s, y: dx*s + dy*c };
}

// ===== UCS管理 =====
// name: 登録した UCS を使うときの名前（下の欄・全画面に出す。cad-ucs.js）。新しく決めたときは無し
function setUCS(wx, wy, angle, name) {
    ucs.originX = wx; ucs.originY = wy; ucs.angle = angle || 0;
    if(typeof ucsSetCurrentName === 'function') ucsSetCurrentName(name || null);
    const degStr = ucs.angle !== 0 ? ` ∠${angleText(ucs.angle * 180 / Math.PI)}` : '';
    addCommandLog(`-> 原点設定: ${coordPairText(wx, wy)}（WCS）${degStr}`);
    resetCommand();
    render();
}
function resetUCS() {
    ucs.originX = 0; ucs.originY = 0; ucs.angle = 0;
    if(typeof ucsSetCurrentName === 'function') ucsSetCurrentName(null);
    resetCommand();
    addCommandLog('-> WCSにリセット');
    render();
}

// ===== UCS保存・読込処理（登録・管理の画面は cad-ucs.js） =====
function saveUCS() { ucsRegister(); } // ☰・全画面の「＋ 登録」

// 「UCS読込」の欄で選んでいる（今の）UCS を消す。今の座標系はそのまま（以前は WCS に戻っていた）
function deleteUCS() {
    if(navigator.vibrate) navigator.vibrate([20, 20, 20]);
    const fsSel = document.getElementById('fs-ucs-select');
    const ucsSel = document.getElementById('ucs-select');
    // 全画面のセレクトボックス、または通常のセレクトボックスから値を取得
    const idxStr = (fsSel && fsSel.value !== '') ? fsSel.value : (ucsSel && ucsSel.value !== '' ? ucsSel.value : '');
    if(idxStr === '') {
        showToast('消す UCS を、上の一覧から選んでください（UCS 管理でも消せます）', { kind: 'warn', ms: 3000 });
        return;
    }
    ucsDeleteAt(parseInt(idxStr));
}
function loadUCS(indexStr) {
    if(indexStr === '') return;
    const idx = parseInt(indexStr);
    if(savedUCSList[idx]) {
        const u = ucsEntry(savedUCSList[idx]); // 以前の図面一式の形（originX・originY）も読む
        setUCS(u.x, u.y, u.angle, u.name);
        addCommandLog(`-> UCS読込: ${u.name}`);
        // もしPLAN機能がON（view.rotationが0以外）なら、自動的に新しいUCSに合わせる
        if(view.rotation !== 0) {
            view.rotation = -ucs.angle;
        }
        render();
    }
}

function updateUCSDropdowns() {
    ['ucs-select', 'fs-ucs-select'].forEach(id => {
        const sel = document.getElementById(id);
        if(!sel) return;
        sel.innerHTML = '<option value="">--読込--</option>';
        savedUCSList.forEach((u, i) => {
            const opt = document.createElement('option');
            opt.value = i; opt.textContent = u.name;
            sel.appendChild(opt);
        });
    });
    if(typeof ucsStatusUpdate === 'function') ucsStatusUpdate(); // 今の UCS を選んだ状態に
}

// ===== 画面方向合わせ (PLAN) =====
function togglePlanView() {
    if(typeof layoutActive === 'function' && layoutActive()) layoutShowModel(); // PLAN はモデルの画面で（cad-layout.js）
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const targetWcs = screenToWcs(cx, cy); // 画面中央のWCSを維持する

    // rotation のトグル：既にUCSに合致しているなら WCS(0)に戻す、違えばUCSの回転幅に合わせる
    const targetRot = (view.rotation === -ucs.angle && ucs.angle !== 0) ? 0 : -ucs.angle;
    view.rotation = targetRot;

    // targetWcs が再度 cx, cy にマッピングされるよう view.x, view.y を逆算
    _reanchorView(cx, cy, targetWcs);

    addCommandLog(`-> 画面方向: ${targetRot === 0 ? 'リセット(WCS)' : 'UCS方向(PLAN)'}`);
    render();
}

function zoomToOrigin() { if(typeof layoutActive === 'function' && layoutActive()) layoutShowModel(); view.scale=1; _reanchorView(canvas.width/2, canvas.height/2, {x:ucs.originX, y:ucs.originY}); render(); addCommandLog('原点へズーム'); }
// quiet: true ならコマンド欄・練習ツアーに知らせない（図面一式の表紙の図。cad-webcad.js）
// plain: true なら浮かぶバーの分を空けずに四方同じ余白（バーの写らない表紙の図。v5.51.1）
function zoomExtents(quiet, plain) {
    if(layoutZoomExtents()) return; // レイアウトの画面: 用紙全体（cad-layout.js）
    if(entities.length===0){zoomToOrigin();return;}
    const items = _extentsItems();
    if(!items.length){zoomToOrigin();return;}
    // v5.51: 公共座標の図面に混ざった原点の近くの図形（原点から現場へ引いた線も）・桁違いに遠い図形は除き、図形の集まっている所に合わせる
    const { main, far } = extentsSplit(items);
    _zoomToBox(_itemsBox(main), plain === true);
    if(quiet === true) return;
    addCommandLog(far.length ? `全体表示（離れた図形 ${far.length}個 は入れていません。全部を入れるには ZOOMALL）` : '全体表示');
    if(far.length && typeof showSnack === 'function') {
        // 押したときに図面が変わっていれば何もしない（↩・別の図面を開いた・消したあとに、違う図形を選ばないよう。図形は ID で持つ）
        const st = { epoch: _geomEpoch, ents: entities, ids: far.map((b) => entities[b.idx] && entities[b.idx].id) };
        showSnack(`離れた所に図形が ${far.length}個 あります（全体表示には入れていません）`,
            { kind: 'warn', ms: 8000, action: { label: '🔍 見る', run: () => zoomToFarEntities(st) }, action2: { label: '全部を表示', run: () => zoomExtentsAll() } });
    }
    if(typeof guideNotify === 'function') guideNotify('extents');
}
// 見えている図形の外枠（idx・minX・minY・maxX・maxY）
function _extentsItems() {
    const out = [];
    const isVisible = (e) => (e.layer === undefined || !layers[e.layer] || layers[e.layer].visible) && !e.hidden;
    entities.forEach((e, idx) => {
        if(!e || !isVisible(e)) return;
        let b = null;
        const grow = (x, y) => { if(!isFinite(x) || !isFinite(y)) return; if(!b) b = { idx, minX: x, minY: y, maxX: x, maxY: y }; else { if(x < b.minX) b.minX = x; if(y < b.minY) b.minY = y; if(x > b.maxX) b.maxX = x; if(y > b.maxY) b.maxY = y; } };
        const growBox = (bb) => { if(bb) { grow(bb.minX, bb.minY); grow(bb.maxX, bb.maxY); } };
        if(e.type === 'DIMENSION') {
            if(e.p1) { grow(e.p1.x, e.p1.y); grow(e.p2.x, e.p2.y); }
            if(e.center) { grow(e.center.x - (e.radius || 0), e.center.y - (e.radius || 0)); grow(e.center.x + (e.radius || 0), e.center.y + (e.radius || 0)); }
            if(e.vertex) { grow(e.vertex.x, e.vertex.y); grow(e.arm1.x, e.arm1.y); grow(e.arm2.x, e.arm2.y); }
            if(e.point) grow(e.point.x, e.point.y);
            if(e.leaderCoord) grow(e.leaderCoord.x, e.leaderCoord.y);
        }
        else if(e.type === 'HATCH') { if(e.target) growBox(calcBBox(e.target)); }
        else growBox(e.bbox || (e.bbox = calcBBox(e)));
        if(b) out.push(b);
    });
    return out;
}
function _itemsBox(items) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for(const b of items) { if(b.minX < minX) minX = b.minX; if(b.minY < minY) minY = b.minY; if(b.maxX > maxX) maxX = b.maxX; if(b.maxY > maxY) maxY = b.maxY; }
    return { minX, minY, maxX, maxY };
}
function _zoomToBox(bb, plain) {
    const ins=plain ? { left: 50, right: 50, top: 50, bottom: 50 } : _viewInsets(50), w=bb.maxX-bb.minX||1, h=bb.maxY-bb.minY||1;
    const aw=canvas.width-ins.left-ins.right, ah=canvas.height-ins.top-ins.bottom;
    view.scale=Math.min(aw/w, ah/h);
    _reanchorView(ins.left+aw/2, ins.top+ah/2, {x:(bb.minX+bb.maxX)/2, y:(bb.minY+bb.maxY)/2});
    render();
}
// 図面に重なって浮かぶバー（左のツールバー・上のバー・下のバー）の分だけ余白を広げる（v5.51.1）。
// 以前は四方に同じ 50px だけ空けていたので、全体表示で図面の左端が左のツールバーの下に隠れていた。
// 隠れているバー（座標読取の全画面など）は数えない。空けると図面の場所が狭くなりすぎるときは四方 pad に戻す
function _viewInsets(pad) {
    const ins = { left: pad, right: pad, top: pad, bottom: pad };
    if(!canvas.getBoundingClientRect) return ins;
    const cv = canvas.getBoundingClientRect(), gap = 12;
    const shown = (id) => {
        const el = document.getElementById(id);
        if(!el || el.inert) return null;
        const r = el.getBoundingClientRect();
        if(r.width < 1 || r.height < 1) return null;
        const cs = getComputedStyle(el);
        return (cs.display === 'none' || cs.visibility === 'hidden' || (cs.opacity !== '' && Number(cs.opacity) === 0)) ? null : r;
    };
    const tb = shown('toolbar'), top = shown('top-bar'), sb = shown('status-bar');
    if(tb && tb.left - cv.left < canvas.width / 3) ins.left = Math.max(pad, tb.right - cv.left + gap);
    if(top && top.top - cv.top < canvas.height / 3) ins.top = Math.max(pad, top.bottom - cv.top + gap);
    if(sb && cv.bottom - sb.bottom < canvas.height / 3) ins.bottom = Math.max(pad, cv.bottom - sb.top + gap);
    if(canvas.width - ins.left - ins.right < 120 || canvas.height - ins.top - ins.bottom < 120) return { left: pad, right: pad, top: pad, bottom: pad };
    return ins;
}
// 図形の外枠を、集まっている所（main）と離れた図形（far）に分ける。
// 1) 図形の中心の真ん中（X・Y それぞれの中央値）に近い半分を「芯」にする
// 2) 芯が原点から遠い（芯の大きさの 5 倍より遠い）ときは、原点に近い側（原点から芯までの半分より原点寄り）に
//    かかる図形を離れた図形とする（公共座標の図面に混ざった原点の近くの図形・原点から現場へ引いた線）
// 3) どこにあっても、芯から芯の大きさの 1000 倍より遠い図形は離れた図形とする
// 4) 離れた図形が「全体の 1/4 以下」のときだけ除く。図形が2つ以下・芯の大きさが 0 なら分けない
// 道路の中心線のように芯から長く伸びる図形・数 km 先の基準点は、原点の側でなければ除かない（v5.51 の点検で直した）
const EXTENTS_FAR_ORIGIN = 5, EXTENTS_FAR_HUGE = 1000, EXTENTS_FAR_SHARE = 0.25;
function extentsSplit(items) {
    const n = items.length, all = { main: items.slice(), far: [] };
    if(n < 3) return all;
    const cxOf = (b) => (b.minX + b.maxX) / 2, cyOf = (b) => (b.minY + b.maxY) / 2;
    // 大きな図面（20万図形など）でも速いよう、数の並べ替えは Float64Array で
    const median = (a) => { a.sort(); const h = a.length >> 1; return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2; };
    const mx = median(Float64Array.from(items, cxOf)), my = median(Float64Array.from(items, cyOf));
    const dist = Float64Array.from(items, (b) => Math.hypot(cxOf(b) - mx, cyOf(b) - my));
    const dCore = Float64Array.from(dist).sort()[Math.ceil(n / 2) - 1];
    const box = _itemsBox(items.filter((b, i) => dist[i] <= dCore));
    const span = Math.max(box.maxX - box.minX, box.maxY - box.minY);
    if(!(span > 0)) return all; // 芯の大きさが 0（同じ所の点だけ）なら決めない
    // 外枠と外枠の近さ（重なっていれば 0）
    const gap = (b, c) => Math.hypot(Math.max(c.minX - b.maxX, 0, b.minX - c.maxX), Math.max(c.minY - b.maxY, 0, b.minY - c.maxY));
    const O = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const D = gap(box, O), useOrigin = D > EXTENTS_FAR_ORIGIN * span, R = D / 2;
    const far = items.filter((b) => (useOrigin && gap(b, O) <= R) || gap(b, box) > EXTENTS_FAR_HUGE * span);
    if(!far.length || far.length > Math.max(1, Math.floor(n * EXTENTS_FAR_SHARE))) return all;
    const fs = new Set(far);
    return { main: items.filter((b) => !fs.has(b)), far };
}
// 除かずに全部を入れて表示（全体表示の知らせの「全部を表示」・コマンド ZOOMALL）
function zoomExtentsAll() {
    if(typeof layoutActive === 'function' && layoutActive()) { zoomExtents(); return; }
    const items = _extentsItems();
    if(!items.length) { zoomToOrigin(); return; }
    _zoomToBox(_itemsBox(items));
    addCommandLog('全体表示（離れた図形も入れる）');
}
// 離れた図形へ移って選ぶ（消すなら選んだときのバーの 🗑）。コマンドの途中では選ばずに移るだけ
function zoomToFarEntities(st) {
    if(st.ents !== entities || st.epoch !== _geomEpoch) { if(typeof showToast === 'function') showToast('図面が変わったので、もう一度「全体」を押してください', { kind: 'warn', ms: 3000 }); return; }
    const idxs = st.ids.map((id) => entityIndexById(id)).filter((i) => i >= 0);
    if(!idxs.length) return;
    if(typeof layoutActive === 'function' && layoutActive()) layoutShowModel();
    _zoomToBox(_itemsBox(_extentsItems().filter((b) => idxs.includes(b.idx))));
    if(cmdState.mode !== 'IDLE') { addCommandLog(`-> 離れた図形 ${idxs.length}個 の所へ移りました`); return; }
    const sel = [...new Set(idxs.flatMap((i) => (typeof expandGroupTargets === 'function') ? expandGroupTargets(i) : [i]))];
    cmdState.selectedIndices = sel; cmdState.highlightIdx = sel.length === 1 ? sel[0] : -1;
    if(typeof updatePropertiesPanel === 'function') updatePropertiesPanel();
    if(typeof updateSelectionBar === 'function') updateSelectionBar();
    render();
    addCommandLog(`-> 離れた図形 ${idxs.length}個 を選びました（いらなければ 🗑 で消せます。「全体」で元の表示に戻ります）`);
}

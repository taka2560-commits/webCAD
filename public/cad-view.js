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

// ===== UCS管理 =====
function setUCS(wx, wy, angle) {
    ucs.originX = wx; ucs.originY = wy; ucs.angle = angle || 0;
    if(ucsStatusDisplay) { ucsStatusDisplay.textContent = 'UCS'; ucsStatusDisplay.style.color = 'var(--ucs-color)'; }
    if(ucsLabel) { ucsLabel.textContent = 'UCS'; ucsLabel.style.color = 'var(--ucs-color)'; }
    const degStr = ucs.angle !== 0 ? ` ∠${(ucs.angle * 180 / Math.PI).toFixed(1)}°` : '';
    addCommandLog(`-> 原点設定: WCS(${formatCoordValue(wx, 'loupe')},${formatCoordValue(wy, 'loupe')})${degStr}`);
    resetCommand();
    render();
}
function resetUCS() {
    ucs.originX = 0; ucs.originY = 0; ucs.angle = 0;
    if(ucsStatusDisplay) { ucsStatusDisplay.textContent = 'WCS'; ucsStatusDisplay.style.color = 'var(--highlight-color)'; }
    if(ucsLabel) { ucsLabel.textContent = 'WCS'; ucsLabel.style.color = 'var(--highlight-color)'; }
    resetCommand();
    addCommandLog('-> WCSにリセット');
    render();
}

// ===== UCS保存・読込処理 =====
function saveUCS() {
    const name = prompt("現在のUCSに名前を付けて保存します:", `UCS_${savedUCSList.length + 1}`);
    if(!name) return;
    savedUCSList.push({ name: name, x: ucs.originX, y: ucs.originY, angle: ucs.angle });
    updateUCSDropdowns();
    addCommandLog(`-> UCS保存: ${name}`);
}

function deleteUCS() {
    if(navigator.vibrate) navigator.vibrate([20, 20, 20]);
    const fsSel = document.getElementById('fs-ucs-select');
    const ucsSel = document.getElementById('ucs-select');
    // 全画面のセレクトボックス、または通常のセレクトボックスから値を取得
    const idxStr = (fsSel && fsSel.value !== '') ? fsSel.value : (ucsSel && ucsSel.value !== '' ? ucsSel.value : '');
    
    if(idxStr === '') {
        alert("ドロップダウンから消去するUCSを選択してください。");
        return;
    }
    const idx = parseInt(idxStr);
    if(savedUCSList[idx]) {
        if(confirm(`保存されたUCS「${savedUCSList[idx].name}」を消去しますか？`)) {
            savedUCSList.splice(idx, 1);
            updateUCSDropdowns();
            resetUCS(); // 消去した場合は元のWCSにリセット
            addCommandLog('-> UCS消去完了');
        }
    }
}
function loadUCS(indexStr) {
    if(indexStr === '') return;
    const idx = parseInt(indexStr);
    if(savedUCSList[idx]) {
        const u = savedUCSList[idx];
        setUCS(u.x, u.y, u.angle);
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
}

// ===== 画面方向合わせ (PLAN) =====
function togglePlanView() {
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

function zoomToOrigin() { view.scale=1; _reanchorView(canvas.width/2, canvas.height/2, {x:ucs.originX, y:ucs.originY}); render(); addCommandLog('原点へズーム'); }
function zoomExtents() {
    if(entities.length===0){zoomToOrigin();return;}
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    const isVisible = (e) => (e.layer === undefined || !layers[e.layer] || layers[e.layer].visible) && !e.hidden;
    const growPt = (x, y) => { if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y; };
    const growBox = (b) => { if(b) { growPt(b.minX, b.minY); growPt(b.maxX, b.maxY); } };
    entities.forEach(e=>{
        if(!isVisible(e)) return;
        if(e.type==='DIMENSION'){
            if(e.p1){growPt(e.p1.x,e.p1.y);growPt(e.p2.x,e.p2.y);}
            if(e.center){growPt(e.center.x-(e.radius||0),e.center.y-(e.radius||0));growPt(e.center.x+(e.radius||0),e.center.y+(e.radius||0));}
            if(e.vertex){growPt(e.vertex.x,e.vertex.y);growPt(e.arm1.x,e.arm1.y);growPt(e.arm2.x,e.arm2.y);}
            if(e.point){growPt(e.point.x,e.point.y);}
            if(e.leaderCoord){growPt(e.leaderCoord.x,e.leaderCoord.y);}
        }
        else if(e.type==='HATCH'){ if(e.target) growBox(calcBBox(e.target)); }
        else { growBox(e.bbox || (e.bbox = calcBBox(e))); }
    });
    if(!isFinite(minX)){zoomToOrigin();return;}
    const pad=50, w=maxX-minX||1, h=maxY-minY||1;
    const sx=(canvas.width-pad*2)/w, sy=(canvas.height-pad*2)/h;
    view.scale=Math.min(sx,sy);
    const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
    _reanchorView(canvas.width/2, canvas.height/2, {x:cx, y:cy});
    render(); addCommandLog('全体表示');
    if(typeof guideNotify === 'function') guideNotify('extents');
}

// ===== Web CAD SIMA の変換の逆（図面を SIMA に合わせる） =====
// cad-helmert-rev.js - 測量計算「SIMA の変換」の張り合わせ点（SIMA の点 ↔ 図面の点）から、図面の図形を SIMA の座標へ動かす（v5.49）。
//
// ・今までの向き（cad-helmert.js）: SIMA の点を図面の座標に変換して取り込む
// ・逆の向き（ここ）: 図面の点 → SIMA の点 の変換（回転・移動。「縮尺も求める」なら縮尺も）を求め、図面の図形（選んだ図形 か すべて）に当てる
//   例: 任意座標（原点が 0,0 付近）で描いた図面を、SIMA（公共座標）に合わせて動かす
// ・↩ で1回で戻せる。動かしたあとは張り合わせ点の図面側も新しい位置にして、計算し直す（残差はほぼ 0 になる）

// 図面 → SIMA の変換を求める（使う組だけ。src: 図面の点、dst: SIMA の点）
function helmReverseSolve() {
    const s = _helm.src;
    if(!s) return { ok: false, error: 'SIMA を読み込んでください' };
    const up = _helm.pairs.filter((p) => p.use && s.points[p.si]).map((p) => ({ src: p.dst, dst: s.points[p.si] }));
    return helmSolve(up, _helm.mode);
}
// 測量の座標での変換 sol を、図面の座標（WCS）の写し方 editXform にする（相似変換なので、1点と2つの向きで決まる）
function helmReverseXform(sol) {
    const f = (x, y) => { const v = wcsToSurvey(x, y), q = helmApply(sol, v.X, v.Y); return surveyToWcs(q.X, q.Y); };
    const o = surveyToWcs(sol.X0, sol.Y0); // 変換元（図面の張り合わせ点）の重心（大きい座標でも桁が落ちないよう、ここを基準に）
    const t = f(o.x, o.y), ex = f(o.x + 1, o.y), ey = f(o.x, o.y + 1);
    return editXform(ex.x - t.x, ex.y - t.y, ey.x - t.x, ey.y - t.y, o, t);
}
function _helmRevDesc(sol) {
    const q = helmApply(sol, sol.X0, sol.Y0), mv = Math.hypot(q.X - sol.X0, q.Y - sol.Y0); // 重心が動く量
    return `回転 ${angleText(sol.rot * 180 / Math.PI)}（右回りが正）・移動 ${formatSurveyNumber(mv)}m` + (sol.mode === 'sim' ? `・縮尺 ${sol.scale.toFixed(6)}` : '・縮尺 1（そのまま）');
}
// 「🔁 図面を SIMA に合わせる」
window.helmReverse = function() {
    const sol = helmReverseSolve();
    if(!sol.ok) { showToast(sol.error || '変換を求められません', { kind: 'warn', ms: 3500 }); return false; }
    const sel = (cmdState.selectedIndices || []).filter((i) => entities[i]);
    const choices = [];
    if(sel.length) choices.push({ label: `選んだ図形（${sel.length}）`, value: 'sel', kind: 'primary' });
    choices.push({ label: `すべての図形（${entities.length}）`, value: 'all', kind: sel.length ? 'sub' : 'primary' });
    const sig = sol.sigma0 === null || sol.sigma0 === undefined ? '' : `\n張り合わせ点の残差の標準偏差: ${formatSurveyNumber(sol.sigma0)}m`;
    cadChoose({ title: '🔁 図面を SIMA に合わせる',
        message: `張り合わせ点 ${sol.n}組から、図面の図形を SIMA の座標へ動かします。\n${_helmRevDesc(sol)}${sig}\n（↩ で戻せます）`, choices }, (v) => {
        if(!v) return;
        helmReverseApply(sol, v === 'sel' ? sel : entities.map((_, i) => i));
    });
    return true;
};
// 図形 idx を sol で動かす（↩ 1回分。張り合わせ点も ↩ で戻る: cad-core.js の _undoSnapshot）。
// すべての図形を動かしたときは、張り合わせ点の図面側も動かして計算し直す（選んだ図形だけなら、張り合わせ点はそのまま）
function helmReverseApply(sol, idx) {
    const T = helmReverseXform(sol), all = idx.length === entities.length;
    saveUndo();
    idx.forEach((i) => { const e = entities[i]; if(e) { editTransformEntity(e, T); delete e.bbox; } });
    if(all) _helm.pairs.forEach((p) => { if(p.dst) { const q = helmApply(sol, p.dst.X, p.dst.Y); p.dst = Object.assign({}, p.dst, { X: q.X, Y: q.Y }); } });
    if(typeof _helmSolveNow === 'function') _helmSolveNow();
    if(typeof _bumpGeomEpoch === 'function') _bumpGeomEpoch();
    if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    addCommandLog(`-> [変換] 図面の図形 ${idx.length}個を SIMA の座標へ動かしました（${_helmRevDesc(sol)}）`);
    if(typeof showUndoSnack === 'function') showUndoSnack(`図形 ${idx.length}個を SIMA の座標へ動かしました`);
    if(typeof zoomExtents === 'function') zoomExtents();
    if(typeof _helmRerender === 'function') _helmRerender();
    if(typeof _helmViewInst !== 'undefined' && _helmViewInst) _helmViewInst.redraw();
    render();
    return idx.length;
}

// ===== Web CAD スナップのシート（指でサッと開いて、変えて、戻す） =====
// cad-snapsheet.js - OSNAP のボタン（下の欄の OSNAP・▼、全画面の ⊕・▼）を長押しするか上へなぞると、
// 画面の下からスナップのシートがバネで上がる（v5.46）。
//
// ・指を離さずにそのまま種類の上へ滑らせて離すと、その種類を入／切して、シートは下へ戻る（1回の指の動きで「開く→変える→戻す」）
// ・種類の上以外で離したら、シートは開いたまま（続けて押して変えられる。外・⌄ を押すと閉じる）
// ・「次の1点だけ」の段の上で離すと、次の1点だけその種類に吸い付く（コマンドの途中）
// ・いちばん上の「OSNAP」で、スナップそのものの入／切（全画面では全画面の ⊕ と同じ）
// ・動き: オプション「UIの動き」が入ならバネ（行き過ぎて収まる。260 / 20）、切なら短くすっと。端末の「動きを減らす」が入なら動かさない
// ・ふつうに押したとき（短いタップ）は今までどおり（OSNAP は入／切、▼ は細かい設定のパネル）

const SNAP_SHEET_HOLD_MS = 280;  // これだけ押し続けたら開く
const SNAP_SHEET_SWIPE_PX = 14;  // これだけ上へなぞったら開く
const SNAP_SHEET_CLOSE_MS = 220; // 種類の上で離してから閉じるまで（変わったのを見せる）
let _ss = null; // { open, pinned, hover }

// バネ（質量 1・ばね k・減衰 c）の 0→1 の動き。閉じた式なので、どの時刻の値もすぐ出る（モーションリファレンスのスプリングシートと同じ）
function snapSheetSpring(t, k, c) {
    if(t <= 0) return 0;
    const w0 = Math.sqrt(k), z = c / (2 * Math.sqrt(k));
    if(z >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
}

function _ssFs() { return document.body.classList.contains('fullscreen-mode'); }
// 全画面は ⊕（全画面のスナップ）の入／切。index.html の fsOsnapEnabled はボタンの aria-pressed に出ている
function _ssMainOn() { const fb = document.getElementById('fs-btn-osnap'); return _ssFs() && fb ? fb.getAttribute('aria-pressed') === 'true' : !!osnapState.main; }
function _ssEl() {
    let el = document.getElementById('snap-sheet');
    if(!el) {
        el = document.createElement('div');
        el.id = 'snap-sheet';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'スナップ');
        document.body.appendChild(el);
        el.addEventListener('click', (e) => {
            const b = e.target.closest('[data-ss]');
            if(b) { snapSheetPick(b.dataset.ss, false); return; }
            if(e.target.closest('.ss-close')) snapSheetClose();
        });
        el.addEventListener('pointerdown', (e) => e.stopPropagation()); // シートの操作で図面が動かないように
    }
    return el;
}
function _ssRender() {
    const el = _ssEl();
    const chip = (key, label, on, cls) => `<button type="button" class="ss-chip${cls ? ' ' + cls : ''}${on ? ' on' : ''}" data-ss="${key}" aria-pressed="${on}">${label}</button>`;
    const ov = typeof snapOverrideLabel === 'function' ? snapOverrideLabel() : null;
    el.innerHTML = '<div class="ss-handle"></div>' +
        `<div class="ss-head"><span>スナップ</span><button type="button" class="ss-close" aria-label="閉じる">⌄</button></div>` +
        `<div class="ss-grid">${chip('main', 'OSNAP ' + (_ssMainOn() ? '入' : '切'), _ssMainOn(), 'ss-main')}` +
        SNAP_TYPES.map((t) => chip(t.key, t.label, !!osnapState[t.key])).join('') + '</div>' +
        `<div class="ss-sec">次の1点だけ${ov ? `（今: ${escapeHtml(ov)}）` : ''}</div>` +
        `<div class="ss-grid ss-once">${SNAP_TYPES.map((t) => chip('once:' + t.key, t.label, ov === t.label, 'ss-once-chip')).join('')}</div>` +
        '<div class="ss-hint">ボタンを長押し（または上へなぞる）→ 指を滑らせて種類の上で離すと、変えてすぐ閉じます</div>';
    if(_ss && _ss.hover) { const h = el.querySelector(`[data-ss="${_ss.hover}"]`); if(h) h.classList.add('hover'); }
}
// 動き: 0（下に隠れた）→ 1（開いた）の値を translateY にする
function _ssApply(v) { const el = _ssEl(); el.style.transform = `translate(-50%, ${((1 - v) * 105).toFixed(2)}%)`; }
function _ssAnimate(from, to, done) {
    const el = _ssEl();
    if(el._anim) window.cancelAnimationFrame(el._anim);
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduce || typeof requestAnimationFrame !== 'function') { _ssApply(to); if(done) done(); return; }
    const bouncy = document.body.classList.contains('motion-ui') && to > from; // 開くときだけバネ（閉じるときは素直に下へ）
    const dur = bouncy ? 600 : (to > from ? 180 : 170), t0 = performance.now();
    const step = (now) => {
        const s = (now - t0) / 1000;
        let k;
        if(bouncy) k = snapSheetSpring(s, 260, 20); // 行き過ぎて（約8%）収まる
        else { const x = Math.min(1, (now - t0) / dur); k = to > from ? 1 - Math.pow(1 - x, 3) : x * x * x; }
        _ssApply(from + (to - from) * k);
        if(now - t0 < dur) el._anim = requestAnimationFrame(step);
        else { el._anim = null; _ssApply(to); if(done) done(); }
    };
    el._anim = requestAnimationFrame(step);
}
function snapSheetOpen(opt) {
    const o = opt || {};
    if(typeof _closeOsnapPanel === 'function') _closeOsnapPanel();
    _ss = { open: true, pinned: !o.gesture, hover: null };
    _ssRender();
    const el = _ssEl();
    el.style.display = 'block';
    document.body.classList.add('snap-sheet-open');
    if(navigator.vibrate) navigator.vibrate(12);
    _ssAnimate(0, 1);
}
function snapSheetClose() {
    if(!_ss) return;
    _ss = null;
    document.body.classList.remove('snap-sheet-open');
    _ssAnimate(1, 0, () => { if(!_ss) _ssEl().style.display = 'none'; });
}
function snapSheetIsOpen() { return !!_ss; }
// 種類を変える。fromGesture: 長押しから滑らせて離したとき（変えたら閉じる）
function snapSheetPick(key, fromGesture) {
    if(!key) return;
    if(key === 'main') {
        if(_ssFs() && typeof window.toggleFsOsnap === 'function') window.toggleFsOsnap(); else if(typeof window.toggleOsnapMain === 'function') window.toggleOsnapMain();
    } else if(key.startsWith('once:')) {
        const k = key.slice(5);
        if(cmdState.mode === 'IDLE') { if(typeof showToast === 'function') showToast('「次の1点だけ」は、線・寸法などのコマンドの途中で使います', 2500); }
        else if(typeof window.setSnapOverride === 'function') window.setSnapOverride(k);
    } else if(SNAP_TYPES.some((t) => t.key === key)) {
        osnapState[key] = !osnapState[key];
        if(typeof _saveOsnapPrefs === 'function') _saveOsnapPrefs();
        if(typeof buildOsnapPanel === 'function') buildOsnapPanel(); // 細かい設定のパネルもそろえる
        const t = SNAP_TYPES.find((x) => x.key === key);
        addCommandLog(`-> スナップ「${t.label}」: ${osnapState[key] ? '入' : '切'}`);
        if(typeof render === 'function') render();
    }
    if(navigator.vibrate) navigator.vibrate(15);
    if(!_ss) return;
    _ss.hover = null;
    _ssRender();
    if(fromGesture) setTimeout(() => { if(_ss && !_ss.pinned) snapSheetClose(); }, SNAP_SHEET_CLOSE_MS);
}

// ===== 指の動き（長押し・上へなぞる → 滑らせる → 離す） =====
function _ssKeyAt(x, y) {
    const el = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
    const b = el && el.closest ? el.closest('#snap-sheet [data-ss]') : null;
    return b ? b.dataset.ss : null;
}
function _ssBind(btn) {
    if(!btn || btn._ssBound) return;
    btn._ssBound = true;
    let g = null; // { x, y, timer, opened, id }
    const open = () => { if(!g || g.opened) return; g.opened = true; snapSheetOpen({ gesture: true }); };
    btn.addEventListener('pointerdown', (e) => {
        if(e.pointerType === 'mouse' && e.button !== 0) return;
        g = { x: e.clientX, y: e.clientY, opened: false, id: e.pointerId };
        g.timer = setTimeout(open, SNAP_SHEET_HOLD_MS);
        try { btn.setPointerCapture(e.pointerId); } catch { /* 取れなくてもよい */ }
    });
    btn.addEventListener('pointermove', (e) => {
        if(!g) return;
        if(!g.opened && g.y - e.clientY > SNAP_SHEET_SWIPE_PX) { clearTimeout(g.timer); open(); }
        if(g.opened && _ss) {
            const k = _ssKeyAt(e.clientX, e.clientY);
            if(k !== _ss.hover) { _ss.hover = k; _ssEl().querySelectorAll('.ss-chip.hover').forEach((c) => c.classList.remove('hover')); if(k) { const c = _ssEl().querySelector(`[data-ss="${k}"]`); if(c) c.classList.add('hover'); if(navigator.vibrate) navigator.vibrate(5); } }
        }
    });
    const end = (e, cancel) => {
        if(!g) return;
        clearTimeout(g.timer);
        const was = g; g = null;
        try { btn.releasePointerCapture(e.pointerId); } catch { /* 外れていてもよい */ }
        if(!was.opened) return; // 短いタップ: ふつうの click（入／切・パネル）に任せる
        btn._ssSkipClick = Date.now(); // このあとの click は使わない（開いたときは入／切しない）
        const k = cancel ? null : _ssKeyAt(e.clientX, e.clientY);
        if(k) snapSheetPick(k, true);
        else if(_ss) { _ss.pinned = true; _ss.hover = null; _ssRender(); } // 種類の外で離したら開いたまま
    };
    btn.addEventListener('pointerup', (e) => end(e, false));
    btn.addEventListener('pointercancel', (e) => end(e, true));
    btn.addEventListener('click', (e) => { if(btn._ssSkipClick && Date.now() - btn._ssSkipClick < 600) { btn._ssSkipClick = 0; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    btn.addEventListener('contextmenu', (e) => e.preventDefault()); // 長押しでメニューを出さない
}
function snapSheetSetup() {
    ['btn-osnap', 'btn-osnap-panel', 'fs-btn-osnap', 'fs-btn-osnap-panel'].forEach((id) => _ssBind(document.getElementById(id)));
    // シートの外を押したら閉じる
    document.addEventListener('pointerdown', (e) => { if(_ss && _ss.pinned && !e.target.closest('#snap-sheet') && !e.target.closest('#btn-osnap, #btn-osnap-panel, #fs-btn-osnap, #fs-btn-osnap-panel')) snapSheetClose(); }, true);
    document.addEventListener('keydown', (e) => { if(e.key === 'Escape' && _ss) snapSheetClose(); });
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', snapSheetSetup); else snapSheetSetup();

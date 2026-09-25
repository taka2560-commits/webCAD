// ===== Web CAD 別窓（小さな図面の窓） =====
// cad-subview.js - 図面とは別の点の集まり（変換元の SIMA など）を、浮かぶ窓の中の小さな図面に表示する部品。
//   窓: 今のフローティングパネルと同じく、見出しをつまんで動かす（位置を覚える・ダブルタップで戻す）。
//       右下のつまみで大きさを変え、▁ でたたむ。スマホの縦画面では、最初は画面の下のほうに出し、たたむと下に寄せる。
//   中の図面: ホイール・2本指で拡大縮小、1本指・ドラッグで移動、タップで onTap（測量座標と画面の位置）。
//   囲む: startShape('rect' | 'lasso', done) のあとの1回のドラッグで、四角・なぞった形を描き、done（測量座標の多角形）を呼ぶ。
//   座標は測量座標（X＝北・Y＝東）。右が東、上が北（図面と同じ向き）。描くのは onDraw（g: 2D コンテキスト, api）。
// （ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

const SUBVIEW_TAP_PX = 8; // これより動いたら、タップではなく移動
const SUBVIEW_DOCK_BOTTOM = 120; // スマホでたたんだ窓を寄せる位置（画面の下からの間。☑確定 の帯・コマンドのボタンより上）
function createSubView(opt) {
    const el = document.createElement('div');
    el.id = opt.id;
    el.className = 'subview glass-panel';
    el.style.display = 'none';
    el.innerHTML = '<div class="subview-head"><span class="subview-title"></span><span class="subview-btns">' +
        '<button class="subview-btn" data-act="fit" title="全体を表示">⤢</button>' +
        '<button class="subview-btn" data-act="fold" title="たたむ・広げる">▁</button>' +
        '<button class="subview-btn" data-act="close" title="閉じる">✕</button></span></div>' +
        '<div class="subview-body"><canvas class="subview-canvas"></canvas><div class="subview-hint"></div><div class="subview-grip" title="大きさを変える"></div></div>';
    document.body.appendChild(el);
    const head = el.querySelector('.subview-head'), body = el.querySelector('.subview-body');
    const cv = el.querySelector('canvas'), g = cv.getContext('2d');
    el.querySelector('.subview-title').textContent = opt.title || '';
    const v = { X: 0, Y: 0, s: 1 }; // 画面の中央の測量座標と、1単位あたりの画素数
    let drawPending = false;
    let shape = null; // 囲む操作 { kind, done, pts: 画面の点の列（描いている途中） }

    const size = () => ({ w: body.clientWidth || cv.width || 320, h: body.clientHeight || cv.height || 240 });
    const api = {
        el, canvas: cv,
        isOpen: () => el.style.display !== 'none',
        get collapsed() { return el.classList.contains('collapsed'); },
        toScreen(X, Y) { const { w, h } = size(); return { x: w / 2 + (Y - v.Y) * v.s, y: h / 2 - (X - v.X) * v.s }; },
        toSurvey(sx, sy) { const { w, h } = size(); return { X: v.X - (sy - h / 2) / v.s, Y: v.Y + (sx - w / 2) / v.s }; },
        scale: () => v.s,
        // 範囲 { minX, maxX, minY, maxY }（測量座標）が収まるように表示する
        fit(b) {
            if(!b || !isFinite(b.minX)) return;
            const { w, h } = size(), pad = 30;
            const ew = Math.max(b.maxY - b.minY, 1e-9), eh = Math.max(b.maxX - b.minX, 1e-9);
            let s = Math.min((w - pad * 2) / ew, (h - pad * 2) / eh);
            if(b.maxY - b.minY < 1e-9 && b.maxX - b.minX < 1e-9) s = 10; // 1点だけ
            v.s = (s > 0 && isFinite(s)) ? s : 1;
            v.X = (b.minX + b.maxX) / 2; v.Y = (b.minY + b.maxY) / 2;
            api.redraw();
        },
        redraw() {
            if(drawPending || !api.isOpen()) return;
            drawPending = true;
            requestAnimationFrame(() => { drawPending = false; api.drawNow(); });
        },
        drawNow() {
            const { w, h } = size();
            if(cv.width !== w) cv.width = w;
            if(cv.height !== h) cv.height = h;
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.fillStyle = (typeof canvasBg !== 'undefined') ? canvasBg : '#000';
            g.fillRect(0, 0, w, h);
            if(opt.onDraw) opt.onDraw(g, api);
            // 囲んでいる途中の形
            if(shape && shape.pts && shape.pts.length > 1) {
                const q = shape.kind === 'rect' ? _subviewRect(shape.pts[0], shape.pts[shape.pts.length - 1]) : shape.pts;
                g.save(); g.strokeStyle = '#00ffff'; g.fillStyle = 'rgba(0,255,255,0.10)'; g.lineWidth = 1.5; g.setLineDash([6, 4]);
                g.beginPath(); q.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill(); g.stroke();
                g.restore();
            }
        },
        // 次の1回のドラッグで囲む（四角 'rect'・なぞる 'lasso'）。done(多角形の測量座標の列) を呼ぶ
        startShape(kind, done) { shape = { kind: kind === 'lasso' ? 'lasso' : 'rect', done, pts: null }; api.open(); },
        cancelShape() { shape = null; api.redraw(); },
        get shaping() { return !!shape; },
        setHint(t) { const hi = el.querySelector('.subview-hint'); if(hi) { hi.textContent = t || ''; hi.style.display = t ? '' : 'none'; } },
        setTitle(t) { el.querySelector('.subview-title').textContent = t || ''; },
        setCollapsed(on) {
            on = !!on;
            const was = api.collapsed;
            el.classList.toggle('collapsed', on);
            // スマホの幅では、たたんだ窓を画面の下に寄せる（図面とパネルを広く使える）。広げると元の位置に戻す
            if(on && !was && window.innerWidth < 700 && api.isOpen()) {
                el.dataset.dockFrom = el.style.top;
                el.style.top = Math.max(60, window.innerHeight - SUBVIEW_DOCK_BOTTOM - (head.offsetHeight || 34)) + 'px';
            } else if(!on && was && el.dataset.dockFrom !== undefined) {
                el.style.top = el.dataset.dockFrom;
                delete el.dataset.dockFrom;
            }
            if(!on) api.redraw();
            api.fitPanel();
        },
        // (X, Y) を窓の真ん中に出す。minScale（1単位あたりの画素数）より小さく表示していれば、そこまで拡大する
        centerOn(X, Y, minScale) {
            if(!isFinite(X) || !isFinite(Y)) return;
            v.X = X; v.Y = Y;
            if(minScale > v.s && isFinite(minScale)) v.s = Math.min(1e6, minScale);
            api.redraw();
        },
        open() {
            if(!api.isOpen()) {
                el.style.display = 'flex';
                el.classList.remove('collapsed'); delete el.dataset.dockFrom; // 開くときは広げて出す
                _subviewPlace(el, opt);
            }
            api.redraw();
            api.fitPanel();
        },
        hide() { el.style.display = 'none'; api.fitPanel(); },
        close() { api.hide(); if(opt.onClose) opt.onClose(); }, // ✕ で閉じたとき
        fitPanel() { _subviewFitPanel(el); },
    };
    // 触った窓を前に出す（プロパティパネルを触ったら、パネルを前に）
    el.addEventListener('pointerdown', () => { el.style.zIndex = '100003'; }, true);
    const pp = document.getElementById('property-panel');
    if(pp) pp.addEventListener('pointerdown', () => { el.style.zIndex = ''; }, true);
    // 見出しで動かしたあと: パネルの高さを合わせ直す。たたんだまま動かしたら、広げてもその場所のまま
    let headTop = null;
    head.addEventListener('pointerdown', () => { headTop = el.style.top; });
    head.addEventListener('pointerup', () => {
        if(headTop !== null && el.style.top !== headTop) delete el.dataset.dockFrom;
        headTop = null;
        setTimeout(api.fitPanel, 0);
    });

    // 見出しのボタン
    el.querySelectorAll('.subview-btn').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = b.dataset.act;
        if(act === 'fit' && opt.onFit) opt.onFit();
        else if(act === 'fold') api.setCollapsed(!api.collapsed);
        else if(act === 'close') api.close();
    }));
    makePanelDraggable(el, head, opt.posKey);

    // 右下のつまみで大きさを変える（大きさは端末に覚える）
    const grip = el.querySelector('.subview-grip');
    let rs = null;
    grip.addEventListener('pointerdown', (e) => {
        const r = el.getBoundingClientRect();
        rs = { id: e.pointerId, x: e.clientX, y: e.clientY, w: r.width, h: r.height };
        try { grip.setPointerCapture(e.pointerId); } catch { /* 取れなくても続行 */ }
        e.preventDefault(); e.stopPropagation();
    });
    grip.addEventListener('pointermove', (e) => {
        if(!rs) return;
        const w = Math.max(220, Math.min(window.innerWidth - 8, rs.w + e.clientX - rs.x));
        const h = Math.max(160, Math.min(window.innerHeight - 40, rs.h + e.clientY - rs.y));
        el.style.width = w + 'px'; el.style.height = h + 'px';
        api.redraw();
        e.preventDefault();
    });
    const endResize = () => {
        if(!rs) return;
        rs = null;
        if(opt.sizeKey) { try { localStorage.setItem(opt.sizeKey, JSON.stringify({ w: el.offsetWidth, h: el.offsetHeight })); } catch { /* 保存できなくても続行 */ } }
        api.fitPanel();
    };
    grip.addEventListener('pointerup', endResize);
    grip.addEventListener('pointercancel', endResize);

    // 中の図面: 移動・拡大縮小・タップ
    cv.style.touchAction = 'none';
    const ptrs = new Map();
    let drag = null, pinch = null;
    const local = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', (e) => {
        const p = local(e), id = e.pointerId === undefined ? 1 : e.pointerId;
        try { cv.setPointerCapture(id); } catch { /* 取れなくても続行 */ }
        ptrs.set(id, p);
        if(shape && ptrs.size === 1) { shape.pts = [p]; drag = null; pinch = null; e.preventDefault(); return; }
        if(shape && ptrs.size === 2) shape.pts = null; // 2本指になったら、囲むのをやめて拡大縮小
        if(ptrs.size === 1) { drag = { x: p.x, y: p.y, X: v.X, Y: v.Y, moved: false }; pinch = null; }
        else if(ptrs.size === 2) {
            const [a, b] = [...ptrs.values()];
            pinch = { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, s: v.s, mid: api.toSurvey((a.x + b.x) / 2, (a.y + b.y) / 2) };
            drag = null;
        }
        e.preventDefault();
    });
    cv.addEventListener('pointermove', (e) => {
        const id = e.pointerId === undefined ? 1 : e.pointerId;
        if(!ptrs.has(id)) return;
        const p = local(e);
        ptrs.set(id, p);
        if(shape && shape.pts && ptrs.size === 1) {
            const last = shape.pts[shape.pts.length - 1];
            if(shape.kind === 'rect') shape.pts = [shape.pts[0], p];
            else if(Math.hypot(p.x - last.x, p.y - last.y) >= 3) shape.pts.push(p);
            api.redraw(); e.preventDefault(); return;
        }
        if(pinch && ptrs.size >= 2) {
            const [a, b] = [...ptrs.values()];
            const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            v.s = Math.max(1e-6, Math.min(1e6, pinch.s * d / pinch.d));
            // 2本指の中点が、同じ測量座標の上にあるように
            const { w, h } = size(), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            v.Y = pinch.mid.Y - (mx - w / 2) / v.s; v.X = pinch.mid.X + (my - h / 2) / v.s;
            api.redraw();
        } else if(drag) {
            if(!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) > SUBVIEW_TAP_PX) drag.moved = true;
            if(drag.moved) { v.Y = drag.Y - (p.x - drag.x) / v.s; v.X = drag.X + (p.y - drag.y) / v.s; api.redraw(); }
        }
        e.preventDefault();
    });
    const up = (e) => {
        const id = e.pointerId === undefined ? 1 : e.pointerId;
        const p = ptrs.get(id) || local(e);
        ptrs.delete(id);
        if(shape && shape.pts && ptrs.size === 0) {
            const s = shape; shape = null;
            const q = s.kind === 'rect' ? _subviewRect(s.pts[0], s.pts[s.pts.length - 1]) : s.pts;
            const big = q.length >= 3 && (s.kind !== 'rect' || (Math.abs(q[2].x - q[0].x) > 4 && Math.abs(q[2].y - q[0].y) > 4));
            api.redraw();
            if(big && s.done) s.done(q.map((pt) => api.toSurvey(pt.x, pt.y)));
            else if(s.done) s.done(null); // 小さすぎる形（タップだけ）は囲まなかったことにする
            return;
        }
        if(drag && !drag.moved && ptrs.size === 0 && opt.onTap) { const q = api.toSurvey(p.x, p.y); opt.onTap(q.X, q.Y, p.x, p.y); }
        if(ptrs.size === 0) { drag = null; pinch = null; }
        else if(ptrs.size === 1) { const [q] = [...ptrs.values()]; drag = { x: q.x, y: q.y, X: v.X, Y: v.Y, moved: true }; pinch = null; }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId === undefined ? 1 : e.pointerId); drag = null; pinch = null; });
    cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const p = local(e), before = api.toSurvey(p.x, p.y);
        v.s = Math.max(1e-6, Math.min(1e6, v.s * (e.deltaY > 0 ? 1 / 1.15 : 1.15)));
        const { w, h } = size();
        v.Y = before.Y - (p.x - w / 2) / v.s; v.X = before.X + (p.y - h / 2) / v.s;
        api.redraw();
    }, { passive: false });
    window.addEventListener('resize', () => { if(api.isOpen()) { applyPanelPosition(el); api.redraw(); } api.fitPanel(); });
    api.setHint(opt.hint || '');
    return api;
}
// 2点を対角とする四角（画面の点の列）
function _subviewRect(a, b) { return [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }]; }
// スマホの幅では、プロパティパネルが別窓の見出しを隠さないように、パネルの高さを別窓の上までにする（中身はスクロール）
function _subviewFitPanel(el) {
    const pp = document.getElementById('property-panel');
    if(!pp) return;
    let mh = '';
    if(window.innerWidth < 700 && el.style.display !== 'none' && pp.style.display === 'flex') {
        const a = pp.getBoundingClientRect(), b = el.getBoundingClientRect();
        if(a.top < b.top - 120) mh = Math.round(b.top - a.top - 6) + 'px';
    }
    if(pp.style.maxHeight !== mh) pp.style.maxHeight = mh;
}
// 開くときの置き場所と大きさ（覚えている大きさ・位置があればそれ。無ければ、スマホの縦画面は下のほう、それ以外は左下）。
// 左のツールバーは隠さない
function _subviewPlace(el, opt) {
    let sz;
    try { sz = JSON.parse(localStorage.getItem(opt.sizeKey || '') || 'null'); } catch { sz = null; }
    const narrow = window.innerWidth < 700;
    const tb = document.getElementById('toolbar'), tr = tb && tb.offsetParent !== null ? tb.getBoundingClientRect() : null;
    const left = tr && tr.right > 0 && tr.right < window.innerWidth / 3 ? Math.round(tr.right) + 6 : 8;
    const w = sz && sz.w > 0 ? sz.w : (narrow ? window.innerWidth - left - 8 : 360);
    const h = sz && sz.h > 0 ? sz.h : (narrow ? Math.round(window.innerHeight * 0.4) : 300);
    el.style.width = Math.min(w, window.innerWidth - 8) + 'px';
    el.style.height = Math.min(h, window.innerHeight - 40) + 'px';
    if(_panelSavedPos(el.dataset.posKey) || el.dataset.moved === '1') { applyPanelPosition(el); return; }
    el.style.left = left + 'px';
    el.style.top = Math.max(60, window.innerHeight - (parseFloat(el.style.height) || h) - (narrow ? 96 : 80)) + 'px'; // 下のコマンドのボタンに重ならないように
}

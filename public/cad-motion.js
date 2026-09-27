// ===== Web CAD UIの動き（試用） =====
// cad-motion.js - ボタン・パネル・スナップに短い動きを付けて、押した・切り替わった・吸い付いたことを目で分かるようにする
//   （オプション「UIの動き（試用）」。切のときは何もしない＝これまでと同じ。端末の「動きを減らす」が入のときも動かさない）
//   参考: モーションリファレンス（https://motion-reference.takayustudio.jp/）の
//     プレスフィードバック・バウンスプレス・タップリップル（押したとき）、ピルインジケーター・タブインジケーター（切り替えボタンの列）、
//     フェード＋スライド・縮小フェード退場（パネル・別窓の出入り）、モーダルモーフ（▁ たたむ・□ 画面いっぱい）、
//     フォーカスパルス・スナップイン（スナップ）、長押し進行（お気に入りの登録）、エラーシェイク（まちがい）、読込から成功（保存）。
//   道具として速く感じるよう、時間は参考の半分ほどにした。押した結果（コマンド・状態・パネル）は動きを待たずにすぐ変わり、
//   動きはその上に重ねるだけ。見た目の CSS は index.html の body.motion-ui・.mo-*
// （ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

const MOTION_EASE_OUT = 'cubic-bezier(0.33, 1, 0.68, 1)'; // easeOutCubic（止まるときに減速）
const MOTION_EASE_IN = 'cubic-bezier(0.32, 0, 0.67, 0)';  // easeInCubic（消えるときに加速）

// 端末の「動きを減らす（視差効果を減らす・アニメーションを削除）」が入か
function motionReducedByDevice() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
}
// 動きを付けるか（オプションが入で、端末の「動きを減らす」が切）
function motionOn() { return displayPref('motion') === true && !motionReducedByDevice(); }
// 入・切（お気に入りの「動き」ボタン・コマンド MOTION）。端末の設定で動かないときは、そのことも知らせる
window.toggleMotionUI = function() {
    const on = displayPref('motion') !== true;
    setDisplayPref('motion', on ? 'on' : 'off');
    addCommandLog(`-> UIの動き（試用）: ${on ? '入' : '切'}`);
    const msg = !on ? '切' : motionReducedByDevice() ? '入（ただし、この端末は「動きを減らす」が入なので動きません）' : '入（ボタン・パネル・スナップに動き）';
    showToast(`✨ UIの動き（試用）: ${msg}`, on && motionReducedByDevice() ? 4000 : 2000);
};

// ---- 共通 ----
const _moBox = (r) => ({ left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
function _moZ(el) { const z = parseInt(getComputedStyle(el).zIndex, 10); return isFinite(z) ? z : 100002; }
// 動きの終わりに消す（animate が使えないブラウザでも、時間で必ず消す）
function _moRemoveLater(el, ms) { setTimeout(() => el.remove(), ms + 80); }
// 窓の形の写し（縁と背景だけ。中身は写さない）。消える・形が変わる動きに使う
function _moShape(r, z) {
    const g = document.createElement('div');
    g.className = 'mo-shape';
    Object.assign(g.style, _moBox(r), { zIndex: String(z) });
    document.body.appendChild(g);
    return g;
}

// ===== 押したとき: 押した位置から波紋（タップリップル）=====
// ボタンと同じ形の枠を上に重ねて、その中に描く（ボタンの中身・大きさ・押せる範囲は変えない）。
// 沈み込みと、離したときの弾みは CSS（:active）
const MOTION_RIPPLE_MS = 450;
document.addEventListener('pointerdown', (e) => {
    if((e.button !== undefined && e.button !== 0) || !motionOn()) return;
    const b = e.target && e.target.closest ? e.target.closest('button') : null;
    if(b && !b.disabled) motionRipple(b, e.clientX, e.clientY);
}, true);
function motionRipple(b, x, y) {
    const r = b.getBoundingClientRect();
    if(r.width < 4 || r.height < 4) return null;
    const cs = getComputedStyle(b);
    const host = document.createElement('span');
    host.className = 'mo-ripple-host';
    Object.assign(host.style, _moBox(r), { borderRadius: cs.borderRadius });
    // 押した位置から、いちばん遠い角まで届く大きさ
    const d = 2 * Math.max(Math.hypot(x - r.left, y - r.top), Math.hypot(x - r.right, y - r.top), Math.hypot(x - r.left, y - r.bottom), Math.hypot(x - r.right, y - r.bottom));
    const dot = document.createElement('span');
    dot.className = 'mo-ripple';
    Object.assign(dot.style, { left: (x - r.left - d / 2) + 'px', top: (y - r.top - d / 2) + 'px', width: d + 'px', height: d + 'px', color: cs.color });
    host.appendChild(dot);
    document.body.appendChild(host);
    _moRemoveLater(host, MOTION_RIPPLE_MS);
    return host;
}

// ===== 切り替えボタンの列（測量計算のタブ・種類、オプション）: 選んだ印が、前の場所から滑って移る =====
// （ピルインジケーター。一度両方を包むまで伸びてから、選んだほうへ縮む＝タブインジケーター）
const MOTION_SEG_SEL = '.cogo-seg, .opt-pref-seg';
const MOTION_PILL_MS = 340;
document.addEventListener('click', (e) => {
    if(!motionOn()) return;
    const b = e.target && e.target.closest ? e.target.closest('button') : null;
    const seg = b && b.closest(MOTION_SEG_SEL);
    const from = seg && [...seg.children].find((c) => c.classList.contains('active'));
    if(!from || from === b) return;
    const a = from.getBoundingClientRect(), sig = _moSegSig(seg);
    setTimeout(() => { // 押したあとの処理（パネルの描き直しを含む）が済んでから、新しく選ばれたボタンを探す
        const seg2 = _moSegFind(sig), to = seg2 && [...seg2.children].find((c) => c.classList.contains('active'));
        if(to) motionSlidePill(a, to.getBoundingClientRect());
    }, 0);
}, true);
// 列の見分け: パネルの中身（か画面全体）で何番目の列か、と中のボタンの文字（描き直しても同じ列を探せるように）
function _moSegSig(seg) {
    const inPanel = !!seg.closest('#property-panel-content');
    const root = inPanel ? document.getElementById('property-panel-content') : document;
    return { inPanel, i: [...root.querySelectorAll(MOTION_SEG_SEL)].indexOf(seg), labels: [...seg.children].map((c) => c.textContent).join('|') };
}
function _moSegFind(sig) {
    const root = sig.inPanel ? document.getElementById('property-panel-content') : document;
    const seg = root && root.querySelectorAll(MOTION_SEG_SEL)[sig.i];
    return seg && [...seg.children].map((c) => c.textContent).join('|') === sig.labels ? seg : null;
}
// 印を a（前に選んでいたボタンの四角）から b（新しく選んだボタン）へ動かす
function motionSlidePill(a, b) {
    if(!a.width || !b.width || (Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1)) return null;
    const pill = document.createElement('span');
    pill.className = 'mo-pill';
    Object.assign(pill.style, _moBox(b), { opacity: '0' });
    document.body.appendChild(pill);
    const u = { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top) };
    u.width = Math.max(a.right, b.right) - u.left; u.height = Math.max(a.bottom, b.bottom) - u.top;
    if(typeof pill.animate === 'function') {
        pill.animate([
            Object.assign(_moBox(a), { opacity: 1 }),
            Object.assign(_moBox(u), { opacity: 1, offset: 0.4 }),
            Object.assign(_moBox(b), { opacity: 1, offset: 0.8 }),
            Object.assign(_moBox(b), { opacity: 0 }),
        ], { duration: MOTION_PILL_MS, easing: MOTION_EASE_OUT });
    }
    _moRemoveLater(pill, MOTION_PILL_MS);
    return pill;
}

// ===== パネル・別窓: 出るときは少し下から上がりながら（フェード＋スライド）、閉じるときは形の写しが縮みながら薄くなる（縮小フェード退場）=====
// 本物はすぐ出る・すぐ閉じる（閉じた状態を見る処理が、動きを待たずに正しく分かるように）
function motionEnter(el) {
    if(!motionOn() || !el || typeof el.animate !== 'function') return;
    el.animate([{ opacity: 0, translate: '0 10px' }, { opacity: 1, translate: '0 0' }], { duration: 220, easing: MOTION_EASE_OUT });
}
function motionExit(el) {
    if(!motionOn() || !el || getComputedStyle(el).display === 'none') return null;
    const r = el.getBoundingClientRect();
    if(!r.width || !r.height) return null;
    const g = _moShape(r, _moZ(el));
    if(typeof g.animate === 'function') g.animate([{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.94' }], { duration: 180, easing: MOTION_EASE_IN, fill: 'forwards' });
    _moRemoveLater(g, 180);
    return g;
}

// ===== ▁ たたむ・□ 画面いっぱい: 窓の形が、前の大きさから新しい大きさへつながって変わる（モーダルモーフ）=====
// change() で実際に大きさを変える（すぐ変わる）。形の写しが前から後へ動き、そのあいだ本物は薄くしておいて最後に出す
function motionMorph(el, change) {
    const on = motionOn() && !!el && getComputedStyle(el).display !== 'none';
    const a = on ? el.getBoundingClientRect() : null;
    change();
    if(!a || !a.width || !a.height) return null;
    const b = el.getBoundingClientRect();
    if(!b.width || !b.height || ['left', 'top', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) < 1)) return null;
    const g = _moShape(a, _moZ(el) + 1);
    if(typeof g.animate === 'function') {
        g.animate([Object.assign(_moBox(a), { opacity: 1 }), Object.assign(_moBox(b), { opacity: 1, offset: 0.8 }), Object.assign(_moBox(b), { opacity: 0 })],
            { duration: 300, easing: MOTION_EASE_OUT, fill: 'forwards' });
        if(typeof el.animate === 'function') el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], { duration: 300 });
    }
    _moRemoveLater(g, 300);
    return g;
}

// ===== スナップ: 別の点に吸い付いたとき、印を大きめから元の大きさへ（スナップイン）、輪を1回広げる（フォーカスパルス）=====
// cad-render.js の drawSnapMarker から呼ぶ。同じ点に吸い付いているあいだは繰り返さない。
// 点をなぞって次々に吸い付くときは、輪を始め直さずに追いかける（短い間隔で繰り返すと警告のように見えるため）
const MOTION_SNAP_MS = 420;
const MOTION_SNAP_GAP_MS = 180;
let _moSnap = { key: '', t0: -1e9 };
// いまの印の大きさの倍率（吸い付いた直後だけ 1.6 → 1）
function motionSnapScale() {
    if(!motionOn() || !snapResult) return 1;
    const key = `${snapResult.type}|${snapResult.wcsX}|${snapResult.wcsY}`, now = performance.now();
    if(key !== _moSnap.key) _moSnap = { key, t0: (now - _moSnap.t0 < MOTION_SNAP_GAP_MS) ? _moSnap.t0 : now };
    const t = (now - _moSnap.t0) / MOTION_SNAP_MS;
    if(t >= 1) return 1;
    renderOverlay(); // 動いているあいだは次の画面も描く（図形は描き直さない）
    return 1 + 0.6 * Math.pow(1 - Math.min(1, t * 2), 3);
}
// 吸い付きが外れた（離れてから同じ点に戻ったときも、また知らせる）
function motionSnapReset() { _moSnap.key = ''; }
// 吸い付いた点の周りに広がって消える輪（c: 描く先の 2D コンテキスト）
function motionSnapPulse(c, x, y) {
    if(!motionOn() || !snapResult) return;
    const t = (performance.now() - _moSnap.t0) / MOTION_SNAP_MS;
    if(t < 0 || t >= 1) return;
    const e = 1 - Math.pow(1 - t, 3);
    c.save();
    c.strokeStyle = '#00ff00'; c.globalAlpha = 0.8 * (1 - e); c.lineWidth = lineWidthPx(2, 1.5);
    c.beginPath(); c.arc(x, y, 7 + 17 * e, 0, Math.PI * 2); c.stroke();
    c.restore();
}

// ===== 長押し（お気に入りの登録）: 押しているあいだ、ボタンの周りに輪を描き進める（長押し進行）=====
// ふつうのタップでは出さない（押して 150ms たってから）。途中で離すとすぐ消し、満了したら ✓。
// 返すもの: { cancel(), done() }（cad-fav.js の長押しから呼ぶ）
const MOTION_HOLD_DELAY = 150;
function motionHoldStart(el, ms) {
    if(!motionOn() || !el) return null;
    let ring = null;
    const t = setTimeout(() => {
        const r = el.getBoundingClientRect();
        if(!r.width) return;
        const s = Math.max(r.width, r.height) + 12;
        ring = document.createElement('span');
        ring.className = 'mo-hold';
        Object.assign(ring.style, { left: (r.left + r.width / 2 - s / 2) + 'px', top: (r.top + r.height / 2 - s / 2) + 'px', width: s + 'px', height: s + 'px' });
        ring.style.setProperty('--mo-hold-ms', Math.max(0, ms - MOTION_HOLD_DELAY) + 'ms');
        ring.innerHTML = '<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" pathLength="100"></circle></svg><b>✓</b>';
        document.body.appendChild(ring);
    }, MOTION_HOLD_DELAY);
    return {
        cancel() { clearTimeout(t); if(ring) { ring.remove(); ring = null; } },
        done() { clearTimeout(t); if(ring) { ring.classList.add('done'); _moRemoveLater(ring, 500); ring = null; } },
    };
}

// ===== まちがいの知らせ: 左右に短く揺らして、元の位置に戻す（エラーシェイク）=====
function motionShake(el) {
    if(!motionOn() || !el) return;
    el.classList.remove('mo-shake');
    void el.offsetWidth; // 続けて起きたときも、始めから揺らす
    el.classList.add('mo-shake');
    clearTimeout(el._moShakeTimer);
    el._moShakeTimer = setTimeout(() => el.classList.remove('mo-shake'), 420);
}

// ===== できたときの知らせ（保存）: ボタンの上に ✓ を出して消す（読込から成功）=====
function motionSuccess(el) {
    if(!motionOn() || !el) return;
    el.classList.remove('mo-success');
    void el.offsetWidth;
    el.classList.add('mo-success');
    clearTimeout(el._moSuccessTimer);
    el._moSuccessTimer = setTimeout(() => el.classList.remove('mo-success'), 950);
}

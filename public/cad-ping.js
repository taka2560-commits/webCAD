// ===== Web CAD ピンの知らせ（ポンと立って、円の波が広がる） =====
// cad-ping.js - 写真・メモのピンを立てたとき・一覧から開いたときに、その場所を目立たせる（v5.47）。
//
// ・ピンはポンと立つ（0 → 少し越えて → 元の大きさ。0.3 秒。outBack）
// ・ピンの先から円の波が2つずつ2回広がる（0.03・0.31 秒と 0.98・1.26 秒に始まり、1 秒で広がりながら消える）
// ・現在地（🛰）が出ていれば、ピンの横に「現在地から 64m」を出す
// ・図面は動かさず、地点だけを知らせる。端末の「動きを減らす」が入なら、動かさずに二重の円を少し出すだけ

const PING_DUR = 2.3;                       // 秒
const PING_RINGS = [0.03, 0.31, 0.98, 1.26]; // 波の始まり（秒）
const PING_RING_SEC = 1.0, PING_RING_PX = 40, PING_POP_SEC = 0.3;
const PING_COLOR = '#ff9f43';               // ピンと同じ色
let _pings = [];   // { x, y, id, t0, color }
let _pingRaf = 0;

function _pingReduce() { return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
const _pingOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const _pingOutCubic = (x) => 1 - Math.pow(1 - x, 3);
function _pingNow() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000; }

// 地点 (x, y)（図面の座標）を知らせる。id: ピンの ID（ポンと立てる）、color: 波の色（無ければピンの橙）
function pingAt(x, y, id, color) {
    if(!isFinite(x) || !isFinite(y)) return;
    _pings = _pings.filter((p) => p.id === undefined || p.id !== id);
    _pings.push({ x, y, id, t0: _pingNow(), color: color || PING_COLOR });
    if(navigator.vibrate) navigator.vibrate(12);
    _pingTick();
}
function pingPin(pin) { if(pin) pingAt(pin.x, pin.y, pin.id); }
function _pingTick() {
    if(_pingRaf) return;
    const step = () => {
        _pingRaf = 0;
        const now = _pingNow(), life = _pingReduce() ? 1.2 : PING_DUR;
        _pings = _pings.filter((p) => now - p.t0 < life);
        if(typeof renderOverlay === 'function') renderOverlay(); else if(typeof render === 'function') render();
        if(_pings.length && typeof requestAnimationFrame === 'function') _pingRaf = requestAnimationFrame(step);
    };
    if(typeof requestAnimationFrame === 'function') _pingRaf = requestAnimationFrame(step); else step();
}
// ピンの大きさ（drawPhotoPins から。ポンと立つ途中なら 0〜1.1、それ以外は 1）
function pingPinScale(id) {
    if(_pingReduce()) return 1;
    const p = _pings.find((q) => q.id !== undefined && q.id === id);
    if(!p) return 1;
    const t = (_pingNow() - p.t0) / PING_POP_SEC;
    return t >= 1 ? 1 : Math.max(0.01, _pingOutBack(Math.max(0, t)));
}
// しずく形のピン（先が (sx, sy)。写真・メモのピンと同じ形）。label を丸の中に。scale はポンと立つ途中の大きさ
function drawPinMark(sx, sy, color, label, scale) {
    const k = scale === undefined ? 1 : scale, r = 10, cy = sy - r - 6;
    ctx.save();
    if(k !== 1) { ctx.translate(sx, sy); ctx.scale(k, k); ctx.translate(-sx, -sy); }
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - r * 0.6, cy + r * 0.8); ctx.arc(sx, cy, r, Math.PI * 0.8, Math.PI * 0.2); ctx.closePath();
    ctx.fillStyle = color; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.fill(); ctx.stroke();
    if(label !== undefined && label !== '') { ctx.fillStyle = '#1b1b1b'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(label), sx, cy + 0.5); }
    ctx.restore();
}
// 波と距離（描画の重ね。cad-render.js）
function drawPingOverlay() {
    if(!_pings.length) return;
    const now = _pingNow(), reduce = _pingReduce();
    ctx.save();
    ctx.setLineDash([]);
    _pings.forEach((p) => {
        const s = wcsToScreen(p.x, p.y), t = now - p.t0;
        ctx.strokeStyle = p.color || PING_COLOR; ctx.lineWidth = 2;
        if(reduce) { // 動かさない: 二重の円を少しのあいだ
            [14, 26].forEach((r) => { ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke(); });
        } else {
            PING_RINGS.forEach((t0) => {
                const k = (t - t0) / PING_RING_SEC;
                if(k <= 0 || k >= 1) return;
                const e = _pingOutCubic(k);
                ctx.globalAlpha = 1 - k;
                ctx.beginPath(); ctx.arc(s.x, s.y, 5 + PING_RING_PX * e, 0, Math.PI * 2); ctx.stroke();
            });
        }
        // 現在地からの距離
        const g = (typeof _gnss !== 'undefined' && _gnss && _gnss.fix) ? _gnss.fix : null;
        if(g && typeof lengthText === 'function') {
            const a = reduce ? 1 : Math.min(1, Math.max(0, (t - 0.08) / 0.2)) * Math.min(1, Math.max(0, (PING_DUR - 0.2 - t) / 0.2));
            ctx.globalAlpha = a;
            ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            const txt = `現在地から ${lengthText(Math.hypot(p.x - g.x, p.y - g.y))}`;
            const w = ctx.measureText(txt).width;
            ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(s.x + 22, s.y - 46, w + 12, 20);
            ctx.fillStyle = PING_COLOR; ctx.fillText(txt, s.x + 28, s.y - 36);
        }
    });
    ctx.restore();
}

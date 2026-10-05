// ===== Web CAD 起動処理 =====
// cad-boot.js - すべてのスクリプトを読み込んだあとに実行する初期化とキー割り当て
//               （index.html の一番最後に読み込む）
// （cad-core.js から分割。ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）


if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); setTimeout(resizeCanvas, 100); });
} else {
    init();
    setTimeout(resizeCanvas, 100);
}
window.addEventListener('load', () => { resizeCanvas(); });

// 画面全体（body）はスクロールさせない。画面の外の部品にフォーカスが移ると、ブラウザがそれを見せようと body を横にずらし、
// 画面全体が左にずれて右に黒い帯が残る。index.html の overflow:clip で起きないようにしているが、
// clip に対応していない古いブラウザでは、ずれたらすぐ戻す
function resetPageScroll() {
    const b = document.body, r = document.documentElement;
    if(b.scrollLeft || b.scrollTop) { b.scrollLeft = 0; b.scrollTop = 0; }
    if(r.scrollLeft) r.scrollLeft = 0; // ページの縦は、疑似全画面のアドレスバー隠し（scrollTo(0, 1)）のために触らない
}
document.body.addEventListener('scroll', resetPageScroll);
window.addEventListener('scroll', resetPageScroll);

// iPhone・iPad の Safari は、viewport の user-scalable=no を無視する。パネルやボタンの上で2本指を広げると、
// ページ全体が拡大されたままになり、ボタンが画面の外に出て戻しにくい。ページの拡大だけを止める
// （gesturestart は Safari だけの出来事。図面の2本指の拡大・回転は touch の出来事で動くので変わらない）
['gesturestart', 'gesturechange'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));

// F3, F8 キーバインド
document.addEventListener('keydown', (e) => {
    if(e.key==='F3') { e.preventDefault(); toggleOsnapMain(); }
    if(e.key==='F8') { e.preventDefault(); toggleOrtho(); }
});

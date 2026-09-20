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


// F3, F8 キーバインド
document.addEventListener('keydown', (e) => {
    if(e.key==='F3') { e.preventDefault(); toggleOsnapMain(); }
    if(e.key==='F8') { e.preventDefault(); toggleOrtho(); }
});

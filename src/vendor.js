// ===== 外部ライブラリ（npm からバンドル） =====
// 以前は CDN から読み込んでいたが、電波の無い現場でも図面の読み書きができるよう
// Vite でアプリに同梱する。ビルド後のファイル名にはハッシュが付くため、
// Service Worker で「一度取得したら不変」として安全にキャッシュできる。
import DxfParser from 'dxf-parser';
import Drawing from 'dxf-writer';

window.DxfParser = DxfParser;
window.Drawing = Drawing;

// DWG 読込エンジン（libredwg-web、WASM 埋め込みで約9MB）は重いため、
// DWG を開いたとき（またはオプションの「オフライン用に保存」）に初めて読み込む。
let _libreDwgPromise = null;
window.loadLibreDwg = function () {
    if (!_libreDwgPromise) {
        _libreDwgPromise = import('@mlightcad/libredwg-web').catch((err) => {
            _libreDwgPromise = null; // 失敗時は次回やり直せるようにする
            throw err;
        });
    }
    return _libreDwgPromise;
};

window.dispatchEvent(new Event('webcad-vendor-ready'));

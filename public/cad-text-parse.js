// ===== Web CAD テキストパースモジュール =====
// cad-text-parse.js - DXF/DWGテキストの書式コード除去と特殊文字デコード
//
// MTEXTの書式コードは過去に正規表現の貪欲マッチで本文が巻き込み消去される
// デグレーションを繰り返したため（更新履歴 2026-05-31 参照）、仕様に沿った
// 順序処理に書き直し、tests/test-text-parse.js で回帰テストを行う。
//
// ブラウザでは <script> で読み込みグローバル関数として公開、
// Node.js では require() でテストから利用できる両対応構成。

(function(global) {
    'use strict';

    // 退避用の制御文字（DXFテキストには現れない）
    const ESC_BS = '\u0001'; // \\  → バックスラッシュ実体
    const ESC_OB = '\u0002'; // \{  → {
    const ESC_CB = '\u0003'; // \}  → }

    // ===== DXF特殊文字のデコード（TEXT/MTEXT共通） =====
    // - \U+XXXX 形式のUnicodeエスケープ（古いDXFの日本語表現）
    // - %%c(直径) %%d(度) %%p(±) %%%(%) %%u/%%o(下線・上線トグルは除去)
    function decodeDxfText(s) {
        if (!s) return '';
        let t = String(s);
        t = t.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        t = t.replace(/%%[cC]/g, 'φ')
             .replace(/%%[dD]/g, '°')
             .replace(/%%[pP]/g, '±')
             .replace(/%%[uUoO]/g, '')
             .replace(/%%%/g, '%');
        return t;
    }

    // ===== MTEXT書式コードの除去 =====
    // MTEXTの文法（要点）:
    //   \\ \{ \}        : エスケープ（実体文字）
    //   \P              : 段落改行（セミコロン終端ではない）
    //   \p...; \f...;   : 段落属性・フォント（セミコロン終端、引数に ; は含まれない）
    //   \H...; \W...; \C...; \c...; \T...; \Q...; \A...; \F...; : 各種属性（同上）
    //   \S上^下; \S上/下; \S上#下; : 分数・公差（本文として残す）
    //   \L \l \O \o \K \k \X : トグル（引数なし、除去）
    //   \~              : ノーブレークスペース
    //   { }             : グループ化（除去）
    function cleanMtextFormatting(s) {
        if (!s) return '';
        let t = String(s);

        // 1) エスケープ文字を退避（以降の書式コード除去に巻き込まれないように）
        t = t.replace(/\\\\/g, ESC_BS)
             .replace(/\\\{/g, ESC_OB)
             .replace(/\\\}/g, ESC_CB);

        // 2) 分数・公差 \S...; は区切りを "/" にして本文を残す
        t = t.replace(/\\S([^;]*);/g, (_, body) => body.replace(/\^\s?/g, '/').replace(/[#]/g, '/'));

        // 3) セミコロン終端の書式コードを非貪欲（[^;]*）で除去
        //    ※ 大文字P（改行）を含めないこと。過去の \\[Ppf].*; は
        //      貪欲マッチで本文中の ; まで巻き込み消去するバグの原因だった
        t = t.replace(/\\[ACcFfHhpQqTtWw][^;]*;/g, '');

        // 4) 段落改行 \P → 改行文字（描画側で複数行として扱う）
        t = t.replace(/\\P/g, '\n');

        // 5) 引数なしトグルの除去・ノーブレークスペース
        t = t.replace(/\\[LlOoKkX]/g, '')
             .replace(/\\~/g, ' ');

        // 6) グループ化の中括弧を除去
        t = t.replace(/[{}]/g, '');

        // 7) 退避したエスケープを実体に戻す
        t = t.replace(new RegExp(ESC_BS, 'g'), '\\')
             .replace(new RegExp(ESC_OB, 'g'), '{')
             .replace(new RegExp(ESC_CB, 'g'), '}');

        return t;
    }

    // ===== MTEXT用: 書式除去＋特殊文字デコードの一括処理 =====
    function parseCadText(s) {
        return decodeDxfText(cleanMtextFormatting(s));
    }

    // ===== DXFバイト列のデコード（UTF-8優先、Shift-JISフォールバック） =====
    // AutoCAD 2007形式(AC1021)以降のDXFはUTF-8。それ以前の日本語環境の
    // 出力はShift-JIS(CP932)が多い。Shift-JISのバイト列はほぼ確実に
    // UTF-8として不正になるため、厳格モードのUTF-8デコードを先に試す。
    function decodeDxfBuffer(buffer) {
        try {
            return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'UTF-8' };
        } catch (_) {
            return { text: new TextDecoder('shift-jis').decode(buffer), encoding: 'Shift-JIS' };
        }
    }

    // 公開
    global.decodeDxfText = decodeDxfText;
    global.cleanMtextFormatting = cleanMtextFormatting;
    global.parseCadText = parseCadText;
    global.decodeDxfBuffer = decodeDxfBuffer;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { decodeDxfText, cleanMtextFormatting, parseCadText, decodeDxfBuffer };
    }
})(typeof window !== 'undefined' ? window : globalThis);

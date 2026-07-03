// ===== cad-text-parse.js の回帰テスト =====
// 実行方法: node tests/test-text-parse.js
//
// MTEXTの書式コード除去は過去に3回のデグレーション
// （貪欲マッチによる本文巻き込み消去、セミコロン抜けタイポ等）を
// 起こした箇所のため、修正時は必ずこのテストを通すこと。

const { decodeDxfText, cleanMtextFormatting, parseCadText, decodeDxfBuffer } = require('../cad-text-parse.js');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
    if (actual === expected) { pass++; console.log(`  OK  ${label}`); }
    else {
        fail++;
        console.error(`  NG  ${label}\n      期待: ${JSON.stringify(expected)}\n      実際: ${JSON.stringify(actual)}`);
    }
}

console.log('--- cleanMtextFormatting / parseCadText ---');

// 平文はそのまま
eq(parseCadText('現場A 基準点'), '現場A 基準点', '平文は変更しない');

// フォント指定＋グループ化（日本語フォント名）
eq(parseCadText('{\\fMS ゴシック|b0|i0|c128|p49;テスト文字}'), 'テスト文字', 'フォントコード＋グループ除去');

// 全角フォント名（過去バグ: ＭＳゴシック消失）
eq(parseCadText('{\\fＭＳ ゴシック;本文テキスト}'), '本文テキスト', '全角フォント名');
eq(parseCadText('{\\fＭＳ 明朝|c128;図面注記}'), '図面注記', '全角フォント名（明朝）');

// ★ 過去デグレの核心: 本文にセミコロンが含まれるケース
//   貪欲マッチ(\\[Ppf].*;)だと「現場A;現場B」の途中まで消える
eq(parseCadText('\\fMS Gothic|c128;現場A;現場B'), '現場A;現場B', '本文中のセミコロンを巻き込まない');

// ★ \P は改行（セミコロン終端ではない）
eq(parseCadText('1行目\\P2行目'), '1行目\n2行目', '\\P → 改行');
eq(parseCadText('A\\PB\\PC'), 'A\nB\nC', '連続する\\P');

// \P の直後に平文（貪欲マッチだと後続の書式コードまで巻き込む）
eq(parseCadText('\\A1;寸法値\\P\\H2.5x;注記'), '寸法値\n注記', '\\P後の書式コード');

// 文字高さ・色・幅コード
eq(parseCadText('\\H3.5x;高さ指定文字'), '高さ指定文字', '\\H...; 除去');
eq(parseCadText('\\C1;赤文字\\C256;通常'), '赤文字通常', '\\C...; 除去');
eq(parseCadText('\\W0.8;幅指定'), '幅指定', '\\W...; 除去');
eq(parseCadText('\\pxqc;中央揃え本文'), '中央揃え本文', '\\p...; 段落属性除去');

// エスケープ（実体文字として残す）
eq(parseCadText('A\\\\B'), 'A\\B', '\\\\ → バックスラッシュ実体');
eq(parseCadText('\\{注記\\}'), '{注記}', '\\{ \\} → 中括弧実体');

// エスケープと書式コードの混在（\\ が書式コードに巻き込まれない）
eq(parseCadText('{\\fMS Gothic;C:\\\\DWG\\\\図面.dwg}'), 'C:\\DWG\\図面.dwg', 'パス文字列の保護');

// 分数・公差
eq(parseCadText('\\S1^2;'), '1/2', '\\S 分数（^区切り）');
eq(parseCadText('公差\\S+0.1#-0.2;'), '公差+0.1/-0.2', '\\S 公差（#区切り）');

// トグルコード
eq(parseCadText('\\L下線付き\\l'), '下線付き', '\\L \\l 下線トグル除去');
eq(parseCadText('前\\~後'), '前 後', '\\~ ノーブレークスペース');

console.log('--- decodeDxfText ---');

// Unicodeエスケープ（古いDXFの日本語）
eq(decodeDxfText('\\U+30C6\\U+30B9\\U+30C8'), 'テスト', '\\U+XXXX デコード');
eq(decodeDxfText('KP\\U+FF0B123'), 'KP＋123', '\\U+XXXX 全角記号');

// %%特殊コード
eq(decodeDxfText('%%c100'), 'φ100', '%%c → φ');
eq(decodeDxfText('45%%d'), '45°', '%%d → °');
eq(decodeDxfText('%%p0.5'), '±0.5', '%%p → ±');
eq(decodeDxfText('%%u重要%%u'), '重要', '%%u 下線トグル除去');
eq(decodeDxfText('50%%%'), '50%', '%%% → %');

console.log('--- decodeDxfBuffer（文字コード自動判定） ---');

const encUtf8 = new TextEncoder().encode('0\nSECTION\n1\nテキスト');
const utf8Res = decodeDxfBuffer(encUtf8);
eq(utf8Res.encoding, 'UTF-8', 'UTF-8バイト列の判定');
eq(utf8Res.text.includes('テキスト'), true, 'UTF-8本文の復元');

// Shift-JISの「テスト」= 83 65 83 58 83 67（UTF-8として不正なバイト列）
const sjisBytes = new Uint8Array([0x30, 0x0a, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67]);
const sjisRes = decodeDxfBuffer(sjisBytes.buffer);
eq(sjisRes.encoding, 'Shift-JIS', 'Shift-JISバイト列の判定');
eq(sjisRes.text.includes('テスト'), true, 'Shift-JIS本文の復元');

// ASCIIのみはUTF-8として成功（どちらでも同一内容）
const asciiRes = decodeDxfBuffer(new TextEncoder().encode('0\nEOF\n'));
eq(asciiRes.encoding, 'UTF-8', 'ASCIIのみはUTF-8扱い');

console.log(`\n結果: ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail > 0 ? 1 : 0);

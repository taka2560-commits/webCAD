// ===== Web CAD 操作ガイド: 機能の練習ツアー =====
// cad-guide-tours.js - 測量計算・SIMA の変換・杭打ち・点を動かす・写真・印刷を、練習用の図面で操作しながら覚えるツアー。
//   進め方（操作すると次へ・指し示し・元の図面に戻す）は cad-guide.js。ここは手順だけ。
//   練習用の図面: 測点 A(0,0)・B(0,30)・C(20,30)・D(20,0)（X＝北・Y＝東、m）と「練習区画」、道路の線、マンホール。
//   機能の状態（点の欄・変換・杭打ち・印刷の設定）は onStart で控え、onEnd で元に戻す（図面はツアーのしくみが戻す）。
// （ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

const _gtB = () => _gP(0, 30);
// パネルが開いているか（題で見る）
function _gtPanelIs(title) {
    const p = document.getElementById('property-panel'), t = document.getElementById('property-panel-title');
    return !!(p && p.style.display === 'flex' && t && t.textContent === title);
}
function _gtMenuOpen() { const m = document.getElementById('top-menu-modal'); return !!m && m.style.display === 'flex'; }
// 点の欄が、練習用の図面の測点（X, Y）になっているか
function _gtSlotAt(key, X, Y) { const s = _cogo.slots[key]; return !!s && _gAt(s, _gP(X, Y)); }
// 図面で点を指定しているあいだは図面の点を、それ以外はパネルのボタンを指す
function _gtPickOr(wcs, sel) { return () => (cogoIsPicking() ? { wcs, r: 34 } : { sel }); }
// 練習用の図面の道路の線
function _gtRoadIdx() { return entities.findIndex((e) => e && e.type === 'LINE' && e.color === '#aaaaaa'); }
function _gtRoadSelected() { const i = _gtRoadIdx(); return i >= 0 && (cmdState.highlightIdx === i || (cmdState.selectedIndices || []).includes(i)); }
function _gtSelectRoad() {
    const i = _gtRoadIdx();
    if(i < 0) return;
    cmdState.selectedIndices = []; cmdState.highlightIdx = i;
    if(typeof updateSelectionBar === 'function') updateSelectionBar();
    render();
}
// 練習用の SIMA: 練習用の図面の測点を、別の座標（25° 回して、北へ 1000・東へ 2000 ずらした仮の座標）で測ったもの。
// 張り合わせる A〜D と、区画の中の K1・K2、張り合わせ点で囲んだ範囲の外の E1
function _gtHelmSima() {
    const th = -25 * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), nl = String.fromCharCode(13, 10);
    const pts = [['1', 'A', 0, 0], ['2', 'B', 0, 30], ['3', 'C', 20, 30], ['4', 'D', 20, 0], ['5', 'K1', 10, 15], ['6', 'K2', 5, 24], ['7', 'E1', -6, 40]];
    const L = ['G00,01,練習現場,', 'Z00,座標ﾃﾞｰﾀ,,', 'A00,'];
    pts.forEach(([n, name, X, Y]) => L.push(`A01,${n},${name},${(1000 + c * X - s * Y).toFixed(3)},${(2000 + s * X + c * Y).toFixed(3)},,`));
    L.push('A99,');
    return L.join(nl) + nl;
}
function _gtHelmIdx(name) { return _helm.src ? _helm.src.points.findIndex((p) => p.name === name) : -1; }
// 別窓の中の点（画面の四角）。別窓が出ていなければ null
function _gtHelmViewRect(name) {
    const i = _gtHelmIdx(name);
    if(i < 0 || !_helmViewInst || !_helmViewInst.isOpen() || _helmViewInst.collapsed) return null;
    const p = _helm.src.points[i], cr = _helmViewInst.canvas.getBoundingClientRect(), q = _helmViewInst.toScreen(p.X, p.Y), r = 22;
    return { left: cr.left + q.x - r, top: cr.top + q.y - r, width: r * 2, height: r * 2, round: true };
}
let _gtPrintScale0 = null; // 印刷のツアー: 縮尺を選ぶ前の縮尺

Object.assign(GUIDE_TOURS, {
    cogo: {
        title: '測量計算（求積・逆計算）', sample: true, screen: 'normal',
        onStart: () => {
            const k = { slots: _cogo.slots, area: _cogo.area, tab: _cogo.tab, vals: _cogo.vals };
            Object.assign(_cogo, { slots: {}, area: null, vals: {}, tab: 'area' });
            return k;
        },
        onEnd: (k) => { if(k) Object.assign(_cogo, k); hidePropertyPanel(); },
        steps: [
            { title: 'メニューを開く', text: '上のバーの右端の ⋯ を押します。', target: '#btn-top-menu', done: () => _gtMenuOpen() || _gtPanelIs(COGO_TITLE) },
            { title: '🧮 測量計算', text: 'メニューの「🧮 測量計算」を押します。', target: { sel: '#top-menu-modal button[onclick^="showCogoPanel"]' }, done: () => _gtPanelIs(COGO_TITLE) },
            { title: '求積', text: '上の「求積」を押します（座標法で面積を出します）。', target: { sel: `.cogo-seg button[onclick="cogoSetTab('area')"]` },
                done: () => _gtPanelIs(COGO_TITLE) && _cogo.tab === 'area', skipIf: () => _cogo.tab === 'area' },
            { title: '区画を選ぶ', text: '「👆 求積する区画をタップ」を押します。', target: { sel: 'button[onclick="cogoPickLot()"]' }, done: () => cmdState.mode === 'WAITING_COGO_LOT' || !!_cogo.area },
            { title: '区画をタップ', text: '図面の練習区画の、線か内側をタップします。', target: { wcs: () => _gP(10, 15), r: 44 }, done: () => !!_cogo.area && cmdState.mode === 'IDLE' },
            { title: '求積表', text: '座標法の求積表（倍面積・面積・地積）が出ました。練習区画は 20m × 30m で 600㎡ です。\n「📋 求積表を図面に置く」で、図面に表を置けます。', target: { sel: '#cogo-result' }, next: true },
            { title: '逆計算', text: '上の「逆計算」を押します（2点の距離と方向角を出します）。', target: { sel: `.cogo-seg button[onclick="cogoSetTab('inv')"]` }, done: () => _cogo.tab === 'inv' },
            { title: '始点を指定', text: { touch: '始点の欄の 📍 を押し、測点 A までなぞって ☑確定 します（欄に「A」と入れても指定できます）。', pc: '始点の欄の 📍 を押し、測点 A をクリックします（欄に「A」と入れても指定できます）。' },
                target: _gtPickOr(_gA, `button.cogo-pick[onclick="cogoPick('IA')"]`), done: () => _gtSlotAt('IA', 0, 0) },
            { title: '終点を指定', text: { touch: '続けて、測点 C までなぞって ☑確定 します。', pc: '続けて、測点 C をクリックします。' },
                target: _gtPickOr(_gC, `button.cogo-pick[onclick="cogoPick('IB')"]`), done: () => _gtSlotAt('IB', 20, 30) && !cogoIsPicking() },
            { title: '距離と方向角', text: 'A から C までの水平距離（36.056 m）と方向角（度 分 秒）が出ました。「終点から次の点へ ▶」で続けて計算できます。', target: { sel: '#cogo-result' }, next: true },
            { title: 'おわり', text: '同じパネルの「点の追加」（方向角と距離・後視点と夾角）・「交点」・「変換」（SIMA の張り合わせ）も使えます。\nパネルの見出しの ？ で、その画面の使い方が出ます。', next: 'おわる' },
        ],
    },
    helm: {
        title: 'SIMA の変換（張り合わせ）', sample: true, screen: 'normal',
        onStart: () => { const k = { helm: helmSaveState(), tab: _cogo.tab }; helmRestoreState(null); return k; },
        onEnd: (k) => { hidePropertyPanel(); if(k) { helmRestoreState(k.helm); _cogo.tab = k.tab; } },
        steps: [
            { title: '変換の画面', text: '別の座標（現場の仮の座標など）で測った SIMA を、図面の座標に合わせて取り込みます。\nふだんは ⋯ → 🧮 測量計算 →「変換」で開きます（練習では、ここで開きました）。',
                onEnter: () => showCogoPanel('helm'), target: { sel: `.cogo-seg button[onclick="cogoSetTab('helm')"]` }, next: true },
            { title: 'SIMA を読み込む', text: '「📁 SIMA を読み込む」で SIMA のファイルを選びます。\n練習では「練習用の SIMA を読む」を押します。',
                target: { sel: 'button[onclick="helmPickFile()"]' }, act: { label: '練習用の SIMA を読む', run: () => helmLoadSimaText(_gtHelmSima(), '練習用.sim') }, done: () => !!_helm.src },
            { title: '別窓の点をタップ', text: '別窓（小さな図面の窓）に、SIMA の点が出ました。別窓の点 A をタップします（別窓の中は、2本指・ホイールで拡大できます）。',
                target: { rect: () => _gtHelmViewRect('A') }, done: () => (_helm.sel >= 0 && _helm.sel === _gtHelmIdx('A')) || _helm.pairs.length > 0 },
            { title: '図面で同じ点を指定', text: { touch: '図面の測点 A までなぞって、☑確定 を押します（そのあいだ、別窓はたたまれます）。', pc: '図面の測点 A をクリックします。' },
                target: { wcs: _gA, r: 34 }, done: () => _helm.pairs.length >= 1 && !cogoIsPicking() },
            { title: '点名で組にする', text: 'ほかの点も同じように指定できますが、点名が同じなら「🔗 点名が同じ点を組にする」でまとめて組にできます。',
                target: { sel: 'button[onclick="helmPairByName()"]' }, done: () => _helm.pairs.length >= 3 },
            { title: '精度を確かめる', text: '回転・縮尺と、標準偏差 σ₀・組ごとの較差が出ました。図面には、変換した点が水色で重なります。\n張り合わせ点で囲んだ範囲の外の点（E1）は、黄色で知らせます。',
                target: { sel: '#cogo-result' }, next: true },
            { title: '図面に取り込む', text: '「✅ 図面に取り込む」を押します。新しい画層「変換_練習用」に入ります（元の点はそのまま）。',
                target: { sel: 'button[onclick="helmImport()"]' }, done: () => !!_helm.applied },
            { title: 'おわり', text: '取り込む点は、▭ 四角・✎ なぞる や「📋 SIMA の点を表で選ぶ」で選べます。変換後の SIMA・結果の CSV・結果の表も作れます。\n（練習で取り込んだ点は、ツアーのあとで消えます）', next: 'おわる' },
        ],
    },
    stake: {
        title: '杭打ち（器械点から）', sample: true, screen: 'normal',
        onStart: () => {
            const k = { mode: _stake.mode, idx: _stake.idx, list: _stake.list, loose: _stake.loose, KS: _cogo.slots.KS, KB: _cogo.slots.KB, KT: _cogo.slots.KT };
            ['KS', 'KB', 'KT'].forEach((s) => { delete _cogo.slots[s]; });
            Object.assign(_stake, { mode: 'gnss', idx: -1, list: [], loose: new Map() });
            return k;
        },
        onEnd: (k) => {
            hidePropertyPanel();
            if(!k) return;
            Object.assign(_stake, { mode: k.mode, idx: k.idx, list: k.list, loose: k.loose });
            ['KS', 'KB', 'KT'].forEach((s) => { if(k[s]) _cogo.slots[s] = k[s]; else delete _cogo.slots[s]; });
        },
        steps: [
            { title: '杭打ちの画面', text: '打つ杭（測点）を順に選んで、距離と向き・角度を案内します。ふだんは ⋯ → 📍 杭打ち で開きます（練習では、ここで開きました）。\n範囲選択した測点、無ければ図面のすべての測点が、順番の杭になります。',
                onEnter: () => showStakePanel(), target: { sel: '#stake-count' }, next: true },
            { title: '器械点から', text: '「器械点から」を押します（トータルステーションを据えた点と後視点から案内します）。', target: { sel: `.cogo-seg button[onclick="stakeSetMode('ts')"]` }, done: () => _stake.mode === 'ts' },
            { title: '器械点を指定', text: { touch: '器械点の欄の 📍 を押し、測点 A までなぞって ☑確定 します（欄に「A」と入れても指定できます）。', pc: '器械点の欄の 📍 を押し、測点 A をクリックします（欄に「A」と入れても指定できます）。' },
                target: _gtPickOr(_gA, `button.cogo-pick[onclick="cogoPick('KS', 'stake')"]`), done: () => _gtSlotAt('KS', 0, 0) },
            { title: '後視点を指定', text: { touch: '続けて、後視点の測点 B までなぞって ☑確定 します。', pc: '続けて、後視点の測点 B をクリックします。' },
                target: _gtPickOr(_gtB, `button.cogo-pick[onclick="cogoPick('KB', 'stake')"]`), done: () => _gtSlotAt('KB', 0, 30) && !cogoIsPicking() },
            { title: '次の杭へ', text: '▶ で次の杭にします。測点 C まで進めます。', target: { sel: 'button[onclick="stakeStep(1)"]' }, done: () => !!_cogo.slots.KT && _cogo.slots.KT.name === 'C' },
            { title: '夾角と距離', text: '後視（B）を 0° とした右回りの夾角と、水平距離が出ました。機械をこの角度に向けて、距離を測って杭を打ちます。', target: { sel: '#stake-result' }, next: true },
            { title: '✓ 済', text: '杭を打ったら「✓ 済」を押します。次の済んでいない杭へ進みます（記録は図面と一緒に保存されます）。',
                target: { sel: 'button[onclick="stakeToggleDone()"]' }, done: () => _stake.list.some((p) => p.name === 'C' && _stakeIsDone(p)) },
            { title: 'おわり', text: '「現在地から」（スマホの GNSS）でも案内できます。📋 杭打ち表を図面に置く・📄 CSV 出力もあります。\n（練習の記録は、ツアーのあとで消えます）', next: 'おわる' },
        ],
    },
    grip: {
        title: '点を動かす（グリップ）', sample: true, screen: 'normal',
        steps: [
            { title: '線を選ぶ', text: '道路の線（区画の下の灰色の線）をタップして選びます。', target: { wcs: () => _gP(-8, 16), r: 30 }, done: () => _gtRoadSelected() },
            { title: '端の点を動かす', text: { touch: '線の端に青い四角（グリップ）が出ました。右端の四角に指を置いたまま、少しなぞって離します（ルーペ・スナップが使えます）。', pc: '線の端に青い四角（グリップ）が出ました。右端の四角を押したまま少し動かして離します（クリックしてから、動かす先をクリックしても動きます）。' },
                target: { wcs: () => _gP(-8, 42), r: 26 }, done: (b) => undoStack.length > b.undo },
            { title: '元に戻す', text: '↩ で動かす前に戻ります。', target: '#btn-undo', on: 'undo' },
            { title: '選んだ図形のバー', text: '図形を選ぶと、下のバーから ✥移動・⊞複写・↻回転・⇋鏡像・⤢尺度・▦配列・⋈結合・✖削除 ができます。\n左のツールバーの ✂トリム・↗延長・◱オフセット なども使えます。',
                onEnter: () => _gtSelectRoad(), target: '#sel-actionbar', next: true },
            { title: 'おわり', text: 'ポリラインの辺の中の薄い四角は、点を足します。寸法の測った点・寸法線の位置も、同じように動かせます。\n四角の上から始めなければ、なぞっても図形は動きません。',
                onEnter: () => { if(typeof clearSelection === 'function') clearSelection(); render(); }, next: 'おわる' },
        ],
    },
    photo: {
        title: '写真・メモ（ピン）', sample: true, screen: 'normal',
        onEnd: () => { hidePropertyPanel(); if(typeof _ph !== 'undefined') { _ph.editing = null; _ph.viewing = null; } },
        steps: [
            { title: 'ピンを立てる', text: '図面の場所にピンを立てて、メモと写真を付けます（境界標の状態・立会いの記録など）。ふだんは ⋯ → 📷 写真・メモ で開きます（練習では、ここで開きました）。\n「📍 ピンを立てる」を押します。',
                onEnter: () => showPhotoPanel(), target: { sel: 'button[onclick="photoStartAdd()"]' }, done: () => cogoIsPicking() && _guidePickOwner() === 'photo' },
            { title: 'ピンの場所', text: { touch: '測点 C までなぞって ☑確定 します（測点に吸い付きます）。', pc: '測点 C をクリックします（測点に吸い付きます）。' },
                target: { wcs: _gC, r: 34 }, done: () => entities.some((e) => e && e.type === 'PIN') },
            { title: 'メモと写真', text: 'メモを書きます（例: 境界標 コンクリート杭 良好）。「📷 撮る」でその場で撮影、「🖼 選ぶ」で写真を付けます（練習では付けなくてかまいません）。',
                target: { sel: '#ph-text' }, next: true },
            { title: '一覧へ戻る', text: '「◀ 一覧へ」で一覧に戻ります。図面のピン（橙のしずく形）をタップしても開きます。',
                target: { sel: 'button[onclick="showPhotoPanel()"]' }, done: () => _gtPanelIs(PHOTO_TITLE) && !document.getElementById('ph-text') },
            { title: 'おわり', text: '「📄 写真台帳 PDF」で、写真・場所・座標・日時・メモを A4 に3件ずつまとめた PDF を作れます。ピンは図面と一緒に保存され、↩ で戻せます。\n（練習のピンは、ツアーのあとで消えます）', next: 'おわる' },
        ],
    },
    print: {
        title: '印刷・PDF', sample: true, screen: 'normal',
        onStart: () => { try { return { opts: localStorage.getItem(PRINT_OPTS_KEY) }; } catch { return null; } },
        onEnd: (k) => {
            hidePropertyPanel();
            try { if(k && k.opts !== null) localStorage.setItem(PRINT_OPTS_KEY, k.opts); else localStorage.removeItem(PRINT_OPTS_KEY); } catch { /* 保存できなくても続行 */ }
        },
        steps: [
            { title: '印刷・PDF の画面', text: '用紙（A4〜A1・横縦）・縮尺・白黒／カラーを選ぶと、図面に用紙の枠（黄色の点線）が重なります。\nふだんは ⋯ → 🖨 印刷・PDF で開きます（練習では、ここで開きました）。',
                onEnter: () => showPrintPanel(), target: 'canvas', next: true },
            { title: '縮尺を選ぶ', text: '縮尺を選びます（「画面に合わせる」を押すと、今の画面が入る縮尺になります）。',
                onEnter: () => { _gtPrintScale0 = printOpts().scale; }, target: { sel: `select[onchange="printSet('scale', this.value)"]` }, done: () => printOpts().scale !== _gtPrintScale0 },
            { title: '枠の中に入れる', text: { touch: '2本指で画面を動かす・拡大縮小して、印刷したい所を枠の中に入れます（画面の中央が用紙の中央）。', pc: '画面を動かす・拡大縮小して、印刷したい所を枠の中に入れます（画面の中央が用紙の中央）。' },
                target: 'canvas', done: (b) => _gPanned(b) || _gZoomed(b) },
            { title: 'PDF にする', text: '「📄 PDF を保存」で PDF ファイルに、「🖨 開いて印刷」で印刷できます。印刷するときは「実際のサイズ（100%）」を選びます（練習では押さなくてかまいません）。',
                target: { sel: 'button[onclick="printMakePdf(false)"]' }, next: true },
            { title: 'おわり', text: '図枠・表題欄（図面名・縮尺・日付・作成者）・方位記号・縮尺バーつきの PDF ができます。', next: 'おわる' },
        ],
    },
});

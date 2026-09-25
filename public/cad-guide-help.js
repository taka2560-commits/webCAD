// ===== Web CAD 操作ガイド: ヘルプ（❓） =====
// cad-guide-help.js - ヘルプの中身（機能ごとの説明・よくある質問・コマンド一覧）と表示。
//   説明は「何ができる（lead）・どこにある（where）・手順（steps）・コツ（tips）」に分けて、分類ごとに出す。
//   探す: 題・説明・読み（keys。ひらがなでも見つかる）で絞り込む。コマンド一覧も絞る。
//   「開く」でその機能をすぐ開き、「▶ やってみる」で練習ツアー（cad-guide.js・cad-guide-tours.js）を始める。
//   パネルの見出しの「？」から、その画面の説明を開く（「◀ 戻る」で元のパネルに戻る）。
// 文字は、スマホ（指）と PC（マウス）で書き分けたもの（{ touch, pc }）なら、今の端末に合う方を使う（_gt）。
// （ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

const GUIDE_HELP_TITLE = '❓ ヘルプ・操作ガイド';
const GUIDE_HELP_CATS = [
    ['start', '🔰 はじめに'],
    ['draw', '✏️ 描く・直す'],
    ['dim', '📐 測る・寸法'],
    ['survey', '📍 測量'],
    ['file', '📁 図面・ファイル・印刷'],
    ['setting', '⚙ 表示・設定'],
    ['faq', '🆘 困ったとき'],
];

// 機能ごとの説明。{ id, cat, title, keys（探すための読み・言いかえ）, lead, where, steps, tips, tour, open: { label, run } }
const GUIDE_TOPICS = [
    // ---- はじめに ----
    { id: 'screen', cat: 'start', title: '画面の見方', keys: 'がめん みかた ぼたん ばー めにゅー つーるばー すてーたすばー 使い方',
        lead: '上のバー・左のツールバー・下のステータスバーと、⋯ メニューでできています。',
        steps: [
            '上のバー: 📁開く・💾保存・↩↪（元に戻す・やり直し）・画層の選択と 👁画層管理・🧩ブロック・🔍全体・🎯座標読取・📋プロパティ・⋯ メニュー。',
            '左のツールバー: 上から 描く（線分・ポリライン・長方形・円・円弧・楕円・文字・塗りつぶし）、直す（トリム・延長・削除・移動・複写・オフセット・回転・鏡像・尺度・配列・分割・結合・角の処理）、寸法・測定。上下にスクロールできます。',
            '下のステータスバー: 座標系（WCS・UCS）・範囲選択・ORTHO（水平・垂直だけ）・OSNAP（点に吸い付く）と ▼（種類）・今の座標（X＝北・Y＝東）。',
            '⋯ メニュー: 保存一覧・DXF 出力・印刷・座標一覧・測量計算・TS連携・杭打ち・写真・現在地・UCS・オプション・地図・下絵など。',
            '右下の ？ でこのヘルプ、「コマンド」でコマンド欄を開きます。',
        ],
        tips: ['パネル（このヘルプなど）の見出しの ？ で、その画面の使い方が出ます。', 'よく使うコマンドは、⋯ →「⭐ お気に入り」で、浮かぶボタンに登録できます。', 'はじめての方は、下の「🚀 はじめてツアー」がおすすめです（約3分）。'] },
    { id: 'view', cat: 'start', title: '画面の動かし方', tour: 'view', keys: 'がめん うごかす かくだい しゅくしょう ずーむ ぱん 拡大 縮小 移動 ズーム',
        lead: { touch: '2本指で拡大・縮小・移動します。1本指でなぞると、ルーペと座標が出ます。', pc: 'ホイールで拡大・縮小、ホイール（中ボタン）を押したままドラッグで移動します。' },
        steps: [
            { touch: '2本指で広げると拡大、つまむと縮小します。', pc: 'マウスのホイールを回すと拡大・縮小します。' },
            { touch: '2本指で触れたまま、スライドすると画面が動きます。', pc: 'ホイール（中ボタン）を押したままドラッグすると画面が動きます。' },
            '🔍全体 で図面全体を表示します。⋯ → 🔍原点へズーム で原点を表示します。',
        ],
        tips: [{ touch: '1本指では画面は動きません（位置や座標を読む操作になります）。コマンドの途中でも2本指で動かせます。', pc: 'コマンドの途中でも画面を動かせます。' }] },
    { id: 'coord', cat: 'start', title: '座標を読む（ルーペ・座標読取モード）', tour: 'fullscreen', keys: 'ざひょう よむ るーぺ かくだいきょう ざひょうよみとり 座標読取 全画面',
        lead: '座標は X＝北・Y＝東（測量の並び）で表示します。',
        steps: [
            { touch: '1本指で図面をなぞると、指の上にルーペ（拡大鏡）と座標が出ます。', pc: 'カーソルを動かすと、右下に座標が出ます。' },
            '測点に近づくと緑の記号（スナップ）が出て、その点に吸い付きます。',
            '上のバーの 🎯座標読取 で、図面を広く見ながら座標を読むモードになります。なぞると上に X・Y が出て、指を離しても左上に残ります。✕ で通常の画面に戻ります。',
            '座標読取モードの道具箱（右端の ◀）: 📍座標（引出線で座標を書き込む）・📏連続寸法・📐基点測定・UCS・画層・座標一覧・現在地。',
        ],
        tips: ['座標の文字の大きさ・桁は、オプションの「表示・操作」で変えられます。'] },
    { id: 'select', cat: 'start', title: '図形を選ぶ', keys: 'えらぶ せんたく はんいせんたく まどせんたく こうさせんたく 選択 範囲 交差 窓',
        lead: '図形をタップ（クリック）すると選べます。選ぶと、下に操作のバーが出ます。',
        steps: [
            '図形をタップすると選べます。何も無い所をタップすると解除します。',
            '下のステータスバーの「範囲」を ON にすると、枠を描いてまとめて選べます（スマホは1本指でなぞる、PC はドラッグ）。左→右に描く（青い枠）と枠に全部入った図形、右→左（緑の枠）だと枠に触れた図形を選びます。',
            '選んでいるときの下のバー: ✥移動・⊞複写・↻回転・⇋鏡像・⤢尺度・▦配列・⋈結合・✖削除・🚫隠す・🧩グループ化（まとまりなら 分解）・🔍（選んだ図形へ）・✕（解除）。',
            'ブロック（記号・測点など）は、1つタップするとまとまりごと選びます（オプションで切り替え）。',
        ],
        tips: ['選んだ図形の色・画層・座標などは、📋プロパティで数値を直せます。', '文字・寸法は、長押しすると消せます（何もしていないとき）。消えたら ↩ で戻せます。'] },
    { id: 'undo', cat: 'start', title: '元に戻す・やり直す', keys: 'もどす やりなおす あんどぅ りどぅ 取り消し まちがえた',
        lead: '↩ で1つ前の状態に戻り、↪ でやり直します（PC は Ctrl+Z・Ctrl+Y）。',
        steps: ['描いた・直した・消した図形、取り込んだ点、図面に置いた表などは、↩ 1回で戻せます。', 'コマンドの途中でやめるときは ❌終了、同じボタンをもう一度、または Esc キー。'] },

    // ---- 描く・直す ----
    { id: 'draw', cat: 'draw', title: '図形を描く（線分・ポリライン・長方形・円・円弧・楕円）', keys: 'かく さくず せん せんぶん ぽりらいん ふくせん ながしかく ちょうほうけい えん えんこ だえん 作図 線 複線 四角',
        lead: '左のツールバーの描くボタンを押し、点をタップ（クリック）していきます。上に手順が出ます。',
        steps: [
            '／線分: 始点 → 次の点 …（続けて引けます）。終わるときは「線分」をもう一度押すか ❌終了。',
            '∧ポリライン（複線）: 点を続けて指定し、☑確定 で完了、⭘閉じる で閉じた形（区画など）に。',
            '□長方形: 2つの角。幅×高さをパネルで入れることもできます。',
            '◯円: 中心 → 半径の位置（半径をパネルで入れることもできます）。⌒円弧: 始点 → 通る点 → 終点。⬭楕円: 中心 → 横の端 → 縦の端。',
            { touch: 'なぞるとルーペが出るので、点に吸い付かせて指を離すと決まります（寸法・測定・点の指定は、指を離したあと ☑確定）。', pc: 'スナップ（緑の記号）で点に吸い付きます。Esc か右クリックで終わります。' },
        ],
        tips: ['座標を数値で入れるときは、コマンド欄に「X,Y」（→「座標で点を入れる」）。', '描く画層は、上のバーの画層の選択で決めます。', 'ORTHO を ON にすると、水平・垂直にだけ引けます。'] },
    { id: 'text', cat: 'draw', title: '文字・塗りつぶし', keys: 'もじ てきすと ぬりつぶし はっち 文字 塗りつぶし 塗潰',
        steps: [
            'A 文字: パネルに文字と大きさを入れ、置く位置をタップして ☑確定。',
            '塗潰（塗りつぶし）: 閉じた図形（長方形・円・閉じたポリライン）をタップすると、半透明で塗ります。',
            '文字の内容・大きさは、文字を選んで 📋プロパティで直せます。',
        ] },
    { id: 'edit', cat: 'draw', title: '図形を直す（移動・複写・回転・削除・オフセット・トリム・延長）', keys: 'なおす へんしゅう いどう ふくしゃ こぴー かいてん さくじょ けす おふせっと とりむ えんちょう 編集 コピー 消す',
        steps: [
            '✥移動・⊞複写: 図形を選ぶ → つかむ点（基点）→ 移動先。複写は続けて置けます。',
            '↻回転: 図形 → 回転の中心 → 角度を決める点（パネルで角度を数値でも）。',
            '✖削除: 消す図形をタップ（先に選んでからでも）。',
            '◱オフセット: パネルに距離 → 平行に写す線 → ずらす側。',
            { touch: '✂トリム: 消したい部分を指でなぞると、交わる線の間が消えます。↗延長: 伸ばしたい線の端の近くをなぞります。', pc: '✂トリム: 消したい部分をドラッグでなぞると、交わる線の間が消えます。↗延長: 伸ばしたい線の端の近くをなぞります。' },
        ],
        tips: ['先に図形を選んでから、下のバーの ✥移動 などを押しても使えます。', '間違えたら ↩。'] },
    { id: 'edit2', cat: 'draw', title: '鏡像・尺度・配列・分割・結合・角の処理', keys: 'きょうぞう みらー しゃくど すけーる はいれつ ぶんかつ とうぶん けつごう ふぃれっと めんとり すみきり 鏡 拡大縮小 等分 隅切り',
        lead: '左のツールバー（直すの欄）か、図形を選んだときの下のバーから使います。',
        steps: [
            '⇋鏡像: 2点の線を鏡にして映します（元を残すか選べます。文字は読める向きのまま）。',
            '⤢尺度: 基点を中心に大きさを変えます（倍率、または今の長さ → 新しい長さ）。',
            '▦配列: 縦横に（UCS の向き）、または中心の周りに並べます。',
            '÷分割: 図形を1点で2つに分けるか、等分します（閉じた形は、その点で開きます）。',
            '⋈結合: 線をタップすると、つながった線（分かれ道まで）をまとめて選び、☑確定 で1本のポリラインにします（一周すれば閉じた形になり、🧮求積に使えます）。',
            '╭角の処理: 2本の線を丸める（半径 0 で角を出す）か、面取り（隅切り。角からの長さ・底辺の長さ）します。ポリラインの角も面取りできます。',
        ] },
    { id: 'grip', cat: 'draw', title: '点を動かす（グリップ）', tour: 'grip', keys: 'ぐりっぷ てん うごかす ちょうてん はし 頂点 端点 つかむ',
        lead: '選んだ図形の端・頂点・中心に出る青い四角（グリップ）をつかんで、その点を動かします。',
        steps: [
            '図形をタップして選ぶと、端点・頂点・中心などに青い四角が出ます。',
            { touch: '四角に指を置いたまま、動かす先までなぞって離すと、その点が動きます（ルーペ・スナップが使えます）。', pc: '四角を押したまま動かして離すと、その点が動きます（スナップが使えます）。' },
            '四角をタップだけすると、つかんだ状態（緑）になり、次にタップした所へ動かします。',
            'ポリラインの辺の中の薄い四角は、点を足します。寸法の測った点・寸法線の位置も動かせます。',
        ],
        tips: ['四角の上から始めなければ、なぞっても図形は動かないので、座標を読むときも安心です。', { touch: 'やめるときは ❌終了。', pc: 'やめるときは Esc。' }] },
    { id: 'snap', cat: 'draw', title: 'スナップ（点に吸い付く）', tour: 'snap', keys: 'すなっぷ おすなっぷ すいつく たんてん ちゅうてん こうてん OSNAP 吸着',
        steps: [
            '点の近くでは緑の記号が出て、その点に吸い付きます（端点・中点・交点・中心など）。',
            '下の OSNAP で ON/OFF、▼ で吸い付く種類を選びます（図心・等分点は、必要なときだけ）。',
            '▼ の「次の1点だけ」: 押した種類だけに、次の1点だけ吸い付きます。',
            '線の上で少し止めると、線を延ばした先（延長・延長交点）にも吸い付きます。候補が重なったら ⇄（PC は Tab）で切り替えます。',
        ],
        tips: ['吸い付く範囲の広さは、オプションの「表示・操作」で変えられます。', 'ORTHO を ON にすると、水平・垂直にだけ引けます。'] },
    { id: 'input', cat: 'draw', title: '座標で点を入れる', keys: 'ざひょう にゅうりょく すうち そうたい こまんどらん 数値 相対 @',
        steps: [
            'コマンド欄（右下の「コマンド」）に「X,Y」の順（X＝北・Y＝東。画面の座標表示と同じ）で入れて Enter。例: 100,200 → X（北）100・Y（東）200。',
            '「@5,-3」のように @ を付けると、直前の点から 北へ5・西へ3 の点になります。',
            'OSNAP の ▼ の「相対入力」では、距離と方向角でも入れられます。「2点の中点」もあります。',
        ] },
    { id: 'props', cat: 'draw', title: '数値で直す（プロパティ）', keys: 'ぷろぱてぃ すうち いろ がそう ざひょう はんけい 色 画層 半径',
        lead: '選んだ図形の色・画層・座標・半径・文字などを、数値で直せます。',
        steps: ['図形を選ぶと、プロパティのパネルが出ます（上のバーの 📋 で表示・非表示）。', '欄の数値を直すと、すぐ図形に反映されます（↩ で戻せます）。'] },

    // ---- 測る・寸法 ----
    { id: 'measure', cat: 'dim', title: '測る（基点測定）', tour: 'measure', keys: 'はかる そくてい きてん きょり 距離 測定 基点',
        lead: '基点からの X・Y・直線の距離を、出したまま確かめます。',
        steps: [
            { touch: '左の 📐測定 → 基点にしたい点までなぞって ☑確定。', pc: '左の 📐測定 → 基点にしたい点をクリック。' },
            { touch: '測りたい点へなぞると、基点からの X・Y・直線の距離が出たままになります。', pc: 'カーソルを測りたい点へ動かすと、基点からの X・Y・直線の距離が出ます。' },
            '📐記入 で寸法として残す、📍基点 で基点を移す、❌終了 でおわり。',
        ] },
    { id: 'dims', cat: 'dim', title: '寸法を記入する', keys: 'すんぽう へいこう せいれつ はんけい ちょっけい かくど ざひょうすんぽう れんぞく 寸法 角度 直径 半径 連続',
        steps: [
            '↔平行（水平・垂直）・⤢整列（斜めも）: 1点目 → 2点目 → 寸法線の位置。',
            'R半径・⌀直径: 円・円弧をタップ → 寸法の位置。',
            '∠角度: 角の頂点 → 1本目の辺の上の点 → 2本目の辺の上の点。',
            'XY座標: 点 → 文字の位置（引出線で X・Y を書き込みます）。',
            '📏連続寸法（座標読取モードの道具箱、コマンド DIMCONT）: 点を続けて指定して、並べて記入します。',
        ],
        tips: [{ touch: '寸法の点は、指を離したあと ☑確定 で決まります。', pc: '寸法の点はクリックで決まります。' }, '寸法の文字の大きさ・桁は、オプションの「表示・操作」で変えられます。'] },

    // ---- 測量 ----
    { id: 'coordlist', cat: 'survey', title: '座標一覧・SIMA／CSV 出力', where: '⋯ メニュー → 📍 座標一覧', keys: 'ざひょういちらん そくてん けんさく しま csv しゅつりょく かきだし 測点 検索 出力 書き出し',
        steps: [
            '測点・区画の頂点を一覧します。点名・点番号で検索し、タップでその点へ移動します。',
            '📄 SIMA出力・📄 CSV出力 で書き出します（SIMA は Shift-JIS）。⋯ メニューの「SIMA 出力」「座標CSV 出力」も同じです。',
        ],
        open: { label: '📍 座標一覧を開く', run: () => showCoordListPanel() } },
    { id: 'cogo-area', cat: 'survey', title: '求積（座標法）', tour: 'cogo', where: '⋯ メニュー → 🧮 測量計算 → 求積', keys: 'きゅうせき めんせき ちせき ざひょうほう くかく 面積 地積 区画 求積表',
        lead: '区画を選ぶと、座標法の求積表（倍面積・面積・地積）を出します。',
        steps: [
            '「👆 求積する区画をタップ」→ 区画（閉じたポリライン・長方形・SIMA の区画）の線か内側をタップします（一覧から選ぶこともできます）。',
            '座標求積表が出ます。地積の端数（0.01㎡未満・1㎡未満の切り捨て）を選べます。',
            '📋 求積表を図面に置く・📏 辺長を記入・㎡ 面積を記入・📄 CSV 出力。',
        ],
        tips: ['区画の線が無いときは、ポリライン（複線）で測点をなぞって ⭘閉じる。', '辺が交わっていると知らせます（頂点の順番を確かめます）。'],
        open: { label: '🧮 求積を開く', run: () => showCogoPanel('area') } },
    { id: 'cogo-calc', cat: 'survey', title: '逆計算・点の追加・交点', tour: 'cogo', where: '⋯ メニュー → 🧮 測量計算 → 逆計算・点の追加・交点', keys: 'ぎゃくけいさん ほうこうかく きょり てんのついか ほうしゃ こうてん 方向角 距離 放射 交点 後視 夾角',
        steps: [
            '点の欄は、📍 で図面の点をなぞって ☑確定（測点に吸い付く）か、点名・点番号・「X,Y」を入れます。空いている欄があれば、続けて次の欄を指定します。',
            '逆計算: 2点の ΔX・ΔY・水平距離・方向角（度 分 秒）。「終点から次の点へ ▶」で続けられます。',
            '点の追加: 座標で／方向角と距離で／後視点と夾角（後視を 0° とした右回り）で、測点を追加します。',
            '交点: 2直線（延長線上も）・方向角×2・距離×2（右側／左側を選ぶ）の交点を、測点として追加します。',
        ],
        tips: ['方向角・夾角は「45.5」（度）か「45 30 15」（度 分 秒）で入れます。', '距離・面積は m・㎡ です（図面の単位が mm でも同じ）。'],
        open: { label: '🧮 逆計算を開く', run: () => showCogoPanel('inv') } },
    { id: 'helm', cat: 'survey', title: 'SIMA の座標変換（ヘルマート変換）', tour: 'helm', where: '⋯ メニュー → 🧮 測量計算 → 変換', keys: 'へんかん へるまーと はりあわせ ざひょうへんかん しま かりざひょう 変換 張り合わせ 座標変換 仮座標',
        lead: '別の座標（現場の仮の座標など）で測った SIMA を、張り合わせ点で図面の座標に合わせて取り込みます。',
        steps: [
            '「📁 SIMA を読み込む」。SIMA は図面に入れず、別窓（小さな図面の窓）に出ます（TS連携で受信した SIMA は「🧮 変換して取り込む」）。',
            '別窓の点をタップ → 図面で同じ点をなぞって ☑確定 で、張り合わせ点に（2組以上）。「🔗 点名が同じ点を組にする」や、表の 📍 でも指定できます。',
            '縮尺: 「1/1（そのまま）」は回転と移動だけ、「縮尺も求める」はヘルマート変換です。',
            '回転・縮尺・移動と、標準偏差 σ₀・組ごとの較差が出ます（精度を確かめるのは3組以上）。',
            '取り込む範囲: ▭四角・✎なぞる で別窓で囲むか、「📋 SIMA の点を表で選ぶ」の ☑ で1点ずつ選びます。',
            '✅ 図面に取り込む → 新しい画層「変換_名前」に入ります（元の点はそのまま）。変換後の SIMA・機械へ送る・結果の CSV・結果の表も作れます。',
        ],
        tips: ['ほかの組と合わない組（点の取り違えの疑い）と、張り合わせ点で囲んだ範囲の外（外挿）の点は、黄色で知らせます。',
            '張り合わせ点は、取り込む範囲を囲むように、離れた点を選ぶと精度が上がります。',
            'スマホでは、別窓を ▁ でたたむと画面の下に寄り、表や図面を広く使えます。'],
        open: { label: '🧮 変換を開く', run: () => showCogoPanel('helm') } },
    { id: 'stake', cat: 'survey', title: '杭打ち（現在地・器械点から案内）', tour: 'stake', where: '⋯ メニュー → 📍 杭打ち', keys: 'くいうち くい せっちあうと げんざいち きかいてん こうし きょうかく 杭 器械点 後視 夾角 杭打ち表',
        steps: [
            '範囲選択した測点（無ければすべて）を、◀ ▶ で順に選びます。杭は点名・「X,Y」・📍 でも指定できます。',
            '現在地から: 「🛰 現在地を使う」で、杭までの距離・向き（矢印）・北へ／東へ を大きく出します。🧭 で矢印をスマホの向きに合わせます。近づくと振動で知らせます。',
            '器械点から: 器械点・後視点を指定すると、杭の夾角（後視を 0° とした右回り）・方向角・水平距離・高低差が出ます。',
            '杭を打ったら ✓ 済。記録（現在地との差・日時）を残して、次の杭へ進みます。📋 杭打ち表を図面に置く・📄 CSV・📄 杭打ち記録 CSV。',
        ],
        tips: ['スマホの GNSS は数 m ずれます。杭のおおよその場所を探すのに使います。', '🔍 で杭を画面の中央に出します。'],
        open: { label: '📍 杭打ちを開く', run: () => showStakePanel() } },
    { id: 'ts', cat: 'survey', title: 'トータルステーション（ソキア）との受け渡し', where: '⋯ メニュー → 📡 TS連携', keys: 'とーたるすてーしょん てぃーえす そきあ きかい つうしん ぶるーとぅーす けーぶる sdr しま TS 機械 通信 Bluetooth',
        steps: [
            'ファイル: 「📁 SIMA を開く」「📄 SIMA で書き出す」で測点・区画をそのまま受け渡します。機械の現場データ（.sdr）を開くと、観測から座標を計算して測点にします。「📄 SDR33 で書き出す」は機械の既知点・杭打ち点に。',
            '通信（PC の Chrome・Edge、Android の Chrome）: 「🔌 機械とつなぐ」→ 機械で「現場管理 → 現場データ送信」（T タイプは APA-SIMA（座標）、S タイプは SD）。届いた点を確かめて「✅ 図面に取り込む」。',
            '機械へ送る: 機械を「既知点 → 外部入力」で待ち受けにしてから、「📤 SIMA で送る」（T タイプ）か「📤 SDR33 で送る」（S タイプ・SD）。',
            'つなぎ方は、パネルの「📖 つなぎ方（ソキア iM-100）」。うまくいかないときは「🔍 受信した生データ」で、機械とのやり取りを見ます。',
        ],
        tips: ['iPhone・iPad は機械とつなげません。ファイル（SIMA・SDR）で受け渡します。', '機械の ACK モードが「標準」のときは、「ACK のやり取りをする」を入れます。'],
        open: { label: '📡 TS連携を開く', run: () => showTsPanel() } },
    { id: 'gnss', cat: 'survey', title: '現在地（GNSS）', where: '⋯ メニュー → 🛰 現在地', keys: 'げんざいち じーぴーえす gps gnss いち けいばんごう 位置 系番号',
        steps: [
            'はじめは、図面の系番号（平面直角座標の系）を選びます。',
            '上に出るバー: 中心へ（現在地を画面の中央に）・追従（動きについていく）・＋点（今の場所に点を追加）・✕（終わる）。',
        ],
        tips: ['精度はスマホの GPS しだい（数 m）です。', '系番号は、オプションで選び直せます。'],
        open: { label: '🛰 現在地を表示する', run: () => toggleGnss() } },
    { id: 'photo', cat: 'survey', title: '現場写真・メモ（ピン）', tour: 'photo', where: '⋯ メニュー → 📷 写真・メモ', keys: 'しゃしん めも ぴん しゃしんだいちょう かめら 写真 メモ ピン 写真台帳',
        steps: [
            '「📍 ピンを立てる」→ 図面の場所までなぞって ☑確定（測点に吸い付きます）。',
            'メモを書き、「📷 撮る」（カメラ）・「🖼 選ぶ」（写真の中から）で写真を付けます。',
            '図面のピン（橙のしずく形）をタップしても開きます。「◀ 一覧へ」で戻ります。',
            '「📄 写真台帳 PDF」で、写真・場所・座標・日時・メモを A4 に3件ずつまとめます。',
        ],
        tips: ['ピンは図面と一緒に保存され、↩ で戻せます。画層「写真・メモ」で隠せます。'],
        open: { label: '📷 写真・メモを開く', run: () => showPhotoPanel() } },

    // ---- 図面・ファイル・印刷 ----
    { id: 'open', cat: 'file', title: '図面を開く（DXF・DWG・SIMA・座標CSV・SDR）', keys: 'ひらく よみこみ ふぁいる dxf dwg しま csv sdr 開く 読み込み ファイル',
        steps: [
            '上のバーの 📁開く → DXF・DWG・SIMA（.sim）・座標CSV・SDR（.sdr）を選びます。',
            '図面があるときは「置き換える」か「追加する」を選びます。',
            '文字コード（UTF-8・Shift-JIS）は自動で判定します。',
        ],
        tips: ['DWG・PDF の読込エンジンは、はじめて使うときに読み込みます（オプションで先に端末へ保存できます）。'],
        open: { label: '📁 ファイルを選ぶ', run: () => { const f = document.getElementById('dxf-file-input'); if(f) f.click(); } } },
    { id: 'save', cat: 'file', title: '保存とオフライン（保存一覧・図面を閉じる）', keys: 'ほぞん ほぞんいちらん おふらいん じどうほぞん とじる でんぱ 保存 保存一覧 自動保存 閉じる 電波',
        steps: [
            '💾保存 で、名前を付けて端末に保存します。作業中の図面は、自動でも保存されます（変更のあと、アプリを裏に回したときなど）。',
            '⋯ → 📂保存一覧 で、保存した図面を開く・消す。',
            '⋯ → ✕ 図面を閉じる で、新しい図面にします。',
            '一度開けば、電波の無い所でも使えます（アプリとして開いているとき）。',
        ],
        tips: ['保存は、この端末（ブラウザ）の中です。ほかの端末へは DXF・SIMA などで書き出して渡します。', 'ホーム画面に追加すると、アプリのように全画面で使えます。'],
        open: { label: '📂 保存一覧を開く', run: () => showProjectList() } },
    { id: 'export', cat: 'file', title: '書き出す（DXF・SIMA・座標CSV・SDR33）', keys: 'かきだし しゅつりょく えくすぽーと dxf しま csv sdr 書き出し 出力 エクスポート',
        steps: [
            '⋯ → DXF 出力: AutoCAD・Jw_cad などで開けます（寸法・塗りつぶしも。DWG では書き出せません）。',
            '⋯ → SIMA 出力・座標CSV 出力: 測点（と区画）を書き出します。',
            '📡TS連携 → 📄 SDR33 で書き出す: 機械の既知点・杭打ち点に使います。',
        ] },
    { id: 'print', cat: 'file', title: '印刷・PDF（縮尺どおり）', tour: 'print', where: '⋯ メニュー → 🖨 印刷・PDF', keys: 'いんさつ ぷりんと pdf しゅくしゃく ようし ずわく 印刷 縮尺 用紙 図枠 表題欄',
        steps: [
            '用紙（A4〜A1・横縦）・縮尺・白黒／カラー・図面名・作成者を選びます。',
            '図面に用紙の枠（黄色の点線）が重なります。画面を動かす・拡大して、印刷したい所を枠の中に入れます（画面の中央＝用紙の中央）。',
            '📄 PDF を保存、または 🖨 開いて印刷。図枠・表題欄・方位記号・縮尺バーつきです。',
        ],
        tips: ['印刷するときは「実際のサイズ（100%）」を選びます（用紙に合わせると縮尺が変わります）。', '「画面に合わせる」で、今の画面が入る縮尺にします。'],
        open: { label: '🖨 印刷・PDF を開く', run: () => showPrintPanel() } },
    { id: 'underlay', cat: 'file', title: '背景地図・下絵', where: '⋯ メニュー → 🗺 地図・下絵', keys: 'ちず したえ ちりいん くうちゅうしゃしん こうず ちせきそくりょうず 地図 下絵 地理院 公図 画像',
        steps: [
            '地図: 標準・淡色・写真 を選ぶと、国土地理院の地図を図面の下に重ねます（系番号が要ります）。濃さも変えられます。',
            '下絵: 「📁 画像・PDF を読み込む」→「📍 2点で合わせる」（画像の点1 → 図面の点1 → 画像の点2 → 図面の点2）。',
            '👁 隠す・画面に合わせて置き直す・🗑 下絵を消す。',
        ],
        tips: ['一度見た地図は端末に保存され、電波の無い所でも出ます。', '2点は、離れた点を選ぶと正確に重なります。'],
        open: { label: '🗺 地図・下絵を開く', run: () => showUnderlayPanel() } },

    // ---- 表示・設定 ----
    { id: 'layers', cat: 'setting', title: '画層（表示・非表示）', keys: 'がそう れいやー ひょうじ ひひょうじ かくす 画層 レイヤー 非表示 隠す',
        steps: [
            '上のバーの画層の選択: これから描く画層（作図画層）を選びます。',
            '👁（画層一括管理）: 画層ごとに表示・非表示。名前をタップで作図画層に。「すべて表示」「すべて非表示」「🔄 表示反転」。',
            '👆 タッチで非表示: 図面の図形をタップすると、その画層を隠します（続けてできます）。',
            '「非表示画層をうっすら表示する」、🚫隠す で隠した図形を戻す「⭕ 隠れ図形を再表示」。',
        ],
        open: { label: '👁 画層管理を開く', run: () => showLayerManagerPanel() } },
    { id: 'blocks', cat: 'setting', title: 'ブロック・グループ（まとまり）', keys: 'ぶろっく ぐるーぷ まとまり ぶんかい 分解 グループ化 ブロック管理',
        steps: [
            '取り込んだブロック（記号・測点など）や寸法は、まとまり（グループ）として扱います。1つタップすると、まとまりごと選びます（オプションで切り替え）。',
            '🧩（ブロック管理）: ブロック名ごとに表示・非表示・ズーム・まとめて選択。',
            '2つ以上選んで 🧩グループ化。まとまりを選んで 分解。',
        ],
        open: { label: '🧩 ブロック管理を開く', run: () => showBlockManagerPanel() } },
    { id: 'ucs', cat: 'setting', title: 'UCS・PLAN（座標系と向き）', keys: 'ゆーしーえす ざひょうけい げんてん むき ぷらん かいてん 原点 座標系 向き PLAN WCS',
        steps: [
            '⋯ → 🎯原点移動: 好きな点を原点（0,0）にします。',
            '⋯ → 📈2点UCS: 原点 → 向きを決める点。その向きが X（進行方向）になります（現場の通り芯など）。',
            '⋯ → 🧭PLAN表示: UCS の向きを画面の上にして表示します（現場の向きと合わせる）。',
            '⋯ → ↩WCSリセット: 本来の座標に戻します。💾UCS保存・UCS読込 で名前を付けて使い分けます。',
        ],
        tips: ['下のステータスバーの左に、今の座標系（WCS・UCS）が出ます。', 'SIMA・座標CSV・測量計算は、UCS を設定していても図面の本来の座標（WCS）で扱います。'] },
    { id: 'fav', cat: 'setting', title: 'お気に入りのボタン（よく使うコマンド）', where: '⋯ メニュー → ⭐ お気に入り', keys: 'おきにいり ほし すたー とうろく ふろーてぃんぐ ぼたん しょーとかっと よくつかう お気に入り 登録 ショートカット',
        lead: 'よく使うコマンドを登録すると、画面の右に浮かぶバーのボタンから、すぐに始められます。',
        steps: [
            '⋯ →「⭐ お気に入り」で、登録したいコマンドの ☆ を押します（★ になります。もう一度押すと外します）。',
            '左のツールバーや ⋯ メニューのボタンを長押ししても、登録できます。',
            'バーのボタンを押すと、そのコマンドを始めます。描く・直す・寸法は、もう一度押すとやめます。パネルの機能は、開いていれば閉じます。使っているボタンは光ります。',
            'バーの ⠿ をつまむと動かせます（ダブルタップで元の位置）。⭐ でたたむ・広げる、＋ で登録の画面を開きます。',
            '登録の画面で、▲▼ で並べ替え、✕ で外します。向き（縦・横）、名前を出すか、バーを出すか隠すかも選べます。',
        ],
        tips: [`登録できるのは ${FAV_MAX}個までです。`, '座標読取モードでは、バーは出ません。'],
        open: { label: '⭐ お気に入りを開く', run: () => showFavPanel() } },
    { id: 'panel', cat: 'setting', title: 'パネルの移動', tour: 'panel', keys: 'ぱねる いどう うごかす ずらす パネル 移動',
        steps: ['パネルの見出し（⠿ の帯）をつまむと動かせます。置いた場所は次も覚えています。', '見出しをダブルタップすると、画面の中央に戻ります。'] },
    { id: 'prefs', cat: 'setting', title: '表示の設定（ルーペ・文字・吸着）', tour: 'prefs', keys: 'ひょうじ せってい るーぺ もじ おおきさ けた きゅうちゃく 表示 設定 文字 桁 吸着',
        steps: ['オプションの「表示・操作」で、ルーペの大きさ・倍率、座標の文字の大きさと桁、寸法の文字と桁、吸着の範囲を変えられます（端末ごと）。'] },
    { id: 'options', cat: 'setting', title: 'オプション（背景色・単位・系番号など）', keys: 'おぷしょん せってい はいけい たんい けいばんごう えらーろぐ 背景 単位 系番号 エラーログ',
        steps: [
            '背景色（黒・グレー・白）。',
            '表示・操作: ルーペ・座標の文字と桁・寸法の文字と桁・吸着の範囲。',
            '測量: 図面の1単位（1m／1mm）、現在地の系番号。',
            'タップでブロック全体を選択、取り込み時に円弧を非表示、DWG・PDF の読込エンジンを端末に保存、⚠ エラーログ。',
        ],
        open: { label: '⚙ オプションを開く', run: () => showOptionsPanel() } },
    { id: 'hintsSetting', cat: 'setting', title: '手順カード・ひとことヒント', keys: 'てじゅん ひんと ひとこと かーど ガイド 案内',
        steps: [
            'コマンドを始めると、上に手順カードが出て、操作が進むと次の手順に変わります（はじめは各コマンド3回まで）。✕ で、そのコマンドの間は隠せます。',
            'つまずいていそうなとき（1本指で画面を動かそうとした など）は、💡 で一言だけ助けを出します。',
            '出し方は、このヘルプのいちばん下で「最初の3回・常に・出さない」を選べます。',
        ] },

    // ---- 困ったとき ----
    { id: 'faq-pan', cat: 'faq', title: '画面が動かない・拡大できない', keys: 'うごかない かくだい ずーむ がめん',
        lead: { touch: '2本指で操作します。1本指でなぞるのは、位置や座標を読むときです。', pc: 'ホイールで拡大・縮小、ホイール（中ボタン）を押したままドラッグで移動します。' },
        steps: ['🔍全体 で図面全体を表示します。', 'コマンドの途中でも画面は動かせます。'] },
    { id: 'faq-snap', cat: 'faq', title: '点に吸い付かない', keys: 'すいつかない すなっぷ おすなっぷ',
        steps: [
            '下の OSNAP が ON（緑）か確かめます。',
            'OSNAP の ▼ で、吸い付かせたい種類（端点・交点など）に ☑ を入れます。',
            '「次の1点だけ」が残っていると、その種類にしか吸い付きません（点を入れると戻ります）。',
            '非表示の画層の図形には吸い付きません。',
        ] },
    { id: 'faq-select', cat: 'faq', title: '図形が選べない・見えない', keys: 'えらべない みえない きえた ひひょうじ',
        steps: [
            '画層が非表示になっていないか、👁 で確かめます（「非表示画層をうっすら表示する」で見つけられます）。',
            '🚫隠す で隠した図形は、画層管理の「⭕ 隠れ図形を再表示」で出します。',
            'ブロックの一部だけを選びたいときは、分解するか、オプションの「タップでブロック全体を選択」を外します。',
        ] },
    { id: 'faq-undo', cat: 'faq', title: '間違えた・消してしまった', keys: 'まちがえた けしてしまった もどす とりけし',
        steps: [
            '↩（元に戻す）で1つ前に戻ります。↪ でやり直します。',
            'コマンドをやめるときは ❌終了、同じボタンをもう一度、または Esc キー。',
            '文字・寸法を長押しすると消えます（何もしていないとき）。消えたら ↩。',
        ] },
    { id: 'faq-lost', cat: 'faq', title: '図面が見えない・どこかへ行った', keys: 'みえない きえた どこ ずめん',
        steps: ['🔍全体 で図面全体を表示します。', '⋯ → 🔍原点へズーム で原点へ行きます。', '背景と同じ色で見えないときは、オプションで背景色を変えます。'] },
    { id: 'faq-coord', cat: 'faq', title: '座標が合わない・ずれて見える', keys: 'ざひょう あわない ずれる たんい けいばんごう',
        steps: [
            'UCS を設定していると、座標は UCS で表示されます。⋯ → ↩WCSリセット で本来の座標に戻します。',
            '図面の1単位（1m／1mm）がファイルと合っているか、オプションで確かめます。',
            '現在地・地図がずれるときは、系番号（平面直角座標の系）を確かめます。',
            '座標の順は X（北）,Y（東）です。',
        ] },
    { id: 'faq-file', cat: 'faq', title: 'ファイルが開けない・文字化けする', keys: 'ひらけない もじばけ よめない ふぁいる',
        steps: [
            '開けるのは DXF・DWG・SIMA（.sim）・座標CSV・SDR（.sdr）です。',
            'DWG は、はじめて開くときに読込エンジンを読み込みます（通信が必要。オプションで先に端末へ保存できます）。',
            '文字化けするときは、元のソフトで DXF に保存し直して開いてみます。',
        ] },
    { id: 'faq-offline', cat: 'faq', title: '電波の無い所で使える？', keys: 'でんぱ おふらいん けんがい ねっと',
        lead: 'はい。一度開いたアプリは、電波が無くても動きます。',
        steps: ['ホーム画面に追加して、アプリとして開きます。', 'DWG・PDF を開くなら、オプションで読込エンジンを端末に保存しておきます。', '地図は、一度見た範囲だけ出ます。'] },
    { id: 'faq-update', cat: 'faq', title: '新しい版にする・ホーム画面に追加', keys: 'こうしん あっぷでーと さいしん ほーむがめん あぷり',
        steps: [
            'アプリを開くと、自動で新しい版になります。使っている途中で届いたときは「再読み込み」の案内が出ます。',
            'ホーム画面に追加: iPhone は Safari の共有ボタン →「ホーム画面に追加」、Android は Chrome のメニュー →「ホーム画面に追加」（アプリをインストール）。',
        ] },
    { id: 'faq-ts', cat: 'faq', title: 'TS（トータルステーション）につながらない', keys: 'つながらない ぶるーとぅーす きかい TS',
        steps: [
            'iPhone・iPad はつなげません（ファイルで受け渡します）。',
            'Android は Chrome 137 以降、PC は Chrome・Edge 117 以降です。',
            '機械を Bluetooth の待ち受け（観測画面4ページ目のキー）にしてから「🔌 機械とつなぐ」。',
            '詳しくは 📡TS連携 の「📖 つなぎ方」。やり取りは「🔍 受信した生データ」で見られます。',
        ] },
    { id: 'faq-error', cat: 'faq', title: 'うまく動かない（エラー）', keys: 'えらー うごかない ふぐあい おかしい',
        steps: [
            '一度 ❌終了 で止めて、やり直します。',
            'ページを再読み込みすると直ることがあります（作業中の図面は自動で保存されています）。',
            'オプションの「⚠ エラーログ」を見て、内容をコピーして知らせてください。',
        ] },
];

// コマンド一覧（分類ごと）。[コマンド, 短縮, 内容]
const GUIDE_COMMANDS = [
    ['描く', [['LINE', 'L', '線分'], ['PLINE', 'PL', 'ポリライン'], ['RECTANG', 'REC', '長方形'], ['CIRCLE', 'C', '円'], ['ARC', 'A', '円弧'], ['ELLIPSE', 'EL', '楕円'], ['TEXT', 'T', '文字'], ['HATCH', 'H', '塗りつぶし']]],
    ['直す', [['MOVE', 'M', '移動'], ['COPY', 'CO', '複写'], ['ROTATE', 'RO', '回転'], ['ERASE', 'E', '削除'], ['OFFSET', 'O', 'オフセット'], ['TRIM', 'TR', 'トリム'], ['EXTEND', 'EX', '延長'],
        ['MIRROR', 'MI', '鏡像'], ['SCALE', 'SC', '尺度変更'], ['ARRAY', 'AR', '配列'], ['BREAK', 'BR', '分割（点で）'], ['DIVIDE', 'DIV', '等分'], ['JOIN', 'J', '結合'], ['FILLET', 'F', '角を丸める・角を出す'], ['CHAMFER', 'CHA', '面取り（隅切り）'],
        ['GROUP', 'G', 'グループ化'], ['UNGROUP', 'X', '分解（EXPLODE）'], ['UNDO', 'U', '元に戻す'], ['REDO', '-', 'やり直し'], ['CANCEL', '-', 'コマンドをやめる']]],
    ['測る・寸法', [['DIMLINEAR', 'DLI', '平行寸法'], ['DIMALIGNED', 'DAL', '整列寸法'], ['DIMRADIUS', 'DRA', '半径寸法'], ['DIMDIAMETER', 'DDI', '直径寸法'], ['DIMANGULAR', 'DAN', '角度寸法'],
        ['DIMORDINATE', 'DOR', '座標寸法'], ['DIMCONT', '-', '連続寸法'], ['MEASURE', 'MEA', '基点測定（DIST・DI）']]],
    ['測量', [['COORDS', 'ZAHYO', '座標一覧（POINTS）'], ['COGO', 'CALC', '測量計算'], ['AREA', 'AA', '求積（KYUSEKI）'], ['INV', '-', '逆計算（INVERSE）'], ['PTADD', 'RADIATE', '点の追加'], ['INTERS', 'KOUTEN', '交点'],
        ['HELMERT', 'HENKAN', 'SIMA の変換'], ['TS', 'SOKKIA', 'TS連携（TSLINK）'], ['SDROUT', '-', 'SDR33出力'], ['STAKE', 'KUI', '杭打ち（SETOUT）'], ['PHOTO', 'MEMO', '写真・メモ（PIN）'],
        ['GNSS', 'GPS', '現在地'], ['GNSSZONE', '-', '系番号の選択'], ['SIMAOUT', '-', 'SIMA出力'], ['CSVOUT', '-', '座標CSV出力']]],
    ['図面・表示', [['OPEN', '-', '開く（IMPORT）'], ['SAVE', '-', '保存'], ['PROJECTS', '-', '保存一覧（RESTORE）'], ['EXPORTDXF', 'SAVEAS', 'DXF出力'], ['PRINT', 'PDF', '印刷・PDF（PLOT）'],
        ['MAP', 'SHITAE', '地図・下絵（UNDERLAY）'], ['ZOOM', 'ZE', '全体表示'], ['UCS', '-', 'UCS（原点）'], ['UCS2P', '2P', 'UCS（2点）'], ['WCS', '-', 'UCSを戻す'],
        ['BLOCKS', '-', 'ブロック管理'], ['LAYOFF', '-', 'タッチで画層を非表示'], ['SHOWALL', '-', '隠した図形を再表示'], ['FAV', 'OKINI', 'お気に入りの登録'], ['ERRORS', 'ERRLOG', 'エラーログ']]],
];

// パネルの見出しの「？」: パネルの題 → 説明（id、または id を返す関数）と、ヘルプから戻るときに開き直す関数
const GUIDE_PANEL_HELP = {
    '🧮 測量計算': { topic: () => ({ area: 'cogo-area', inv: 'cogo-calc', pt: 'cogo-calc', int: 'cogo-calc', helm: 'helm' })[_cogo.tab] || 'cogo-area', back: () => showCogoPanel() },
    '📡 TS連携': { topic: 'ts', back: () => showTsPanel() },
    '📍 杭打ち': { topic: 'stake', back: () => showStakePanel() },
    '🖨 印刷・PDF': { topic: 'print', back: () => showPrintPanel() },
    '🗺 地図・下絵': { topic: 'underlay', back: () => showUnderlayPanel() },
    '📷 写真・メモ': { topic: 'photo', back: () => showPhotoPanel() },
    '📍 座標一覧': { topic: 'coordlist', back: () => showCoordListPanel() },
    'オプション': { topic: 'options', back: () => showOptionsPanel() },
    '画層一括管理': { topic: 'layers', back: () => showLayerManagerPanel() },
    'ブロック管理': { topic: 'blocks', back: () => showBlockManagerPanel() },
    '⭐ お気に入り': { topic: 'fav', back: () => showFavPanel() },
};

// ===== 探す =====
let _ghQuery = '';   // 探している言葉（描き直しても残す）
let _ghBack = null;  // { label, run }: ヘルプから戻るパネル
let _ghFocus = null; // 開いてすぐ見せる説明の id
// 探すための形: 全角・半角、大文字・小文字、カタカナ・ひらがな をそろえる
function _ghNorm(s) {
    return String(s || '').normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
// 説明の中身すべて（スマホ用・PC 用の両方の文）
function _ghAll(t) {
    if(!t) return '';
    if(Array.isArray(t)) return t.map(_ghAll).join(' ');
    if(typeof t === 'object') return [t.touch, t.pc].join(' ');
    return String(t);
}
const _ghHayCache = new Map();
function _ghHay(t) {
    if(!_ghHayCache.has(t.id)) _ghHayCache.set(t.id, _ghNorm([t.title, t.keys, t.where, _ghAll(t.lead), _ghAll(t.steps), _ghAll(t.tips)].join(' ')));
    return _ghHayCache.get(t.id);
}
function _ghWords(q) { return _ghNorm(q).split(/\s+/).filter(Boolean); } // 全角の空白も NFKC で半角になる
function guideHelpMatches(q) { const w = _ghWords(q); return GUIDE_TOPICS.filter((t) => w.length && w.every((x) => _ghHay(t).includes(x))).map((t) => t.id); }

// ===== 表示 =====
function _ghItems(items, cls, tag) {
    const li = (items || []).map((x) => _gt(x)).filter(Boolean).map((x) => `<li>${escapeHtml(x)}</li>`).join('');
    return li ? `<${tag} class="${cls}">${li}</${tag}>` : '';
}
function _ghTopicHtml(t) {
    const acts = (t.open ? `<button class="prop-btn btn-sub" onclick="guideHelpOpen('${t.id}')">${escapeHtml(t.open.label)}</button>` : '') +
        (t.tour ? `<button class="prop-btn btn-sub" onclick="startGuideTour('${t.tour}')" title="練習用の図面で、操作しながら覚える">▶ やってみる</button>` : '');
    return `<details class="gh-topic" data-id="${t.id}"><summary>${escapeHtml(t.title)}</summary><div class="gh-body">` +
        (t.lead ? `<div class="gh-lead">${escapeHtml(_gt(t.lead))}</div>` : '') +
        (t.where ? `<div class="gh-where"><span>場所</span>${escapeHtml(t.where)}</div>` : '') +
        _ghItems(t.steps, 'gh-steps', 'ol') + _ghItems(t.tips, 'gh-tips', 'ul') +
        (acts ? `<div class="gh-acts">${acts}</div>` : '') + '</div></details>';
}
// 練習ツアーの一覧（ヘルプの上の方）。[ツアー, ボタンの名前]
const GUIDE_TOUR_MENU = [
    ['fullscreen', '🎯 座標読取モードのツアー'], ['cogo', '🧮 測量計算（求積・逆計算）'], ['helm', '🧮 SIMA の変換（張り合わせ）'], ['stake', '📍 杭打ち（器械点から）'],
    ['grip', '✏️ 点を動かす（グリップ）'], ['photo', '📷 写真・メモ（ピン）'], ['print', '🖨 印刷・PDF'], ['view', '🖐 画面の動かし方'], ['measure', '📐 測る（基点測定）'],
    ['snap', '🧲 スナップの設定'], ['panel', '⠿ パネルの移動'], ['prefs', '⚙ 表示の設定'],
];
function _ghToursHtml() {
    const done = (id) => (_guide.tours && _guide.tours[id] === 'done') ? ' ✓' : '';
    const list = GUIDE_TOUR_MENU.filter(([id]) => GUIDE_TOURS[id])
        .map(([id, label]) => `<button class="prop-btn btn-sub gh-tour" onclick="startGuideTour('${id}')">${escapeHtml(label)}${done(id)}</button>`).join('');
    return '<div class="gh-extra"><div class="gh-sec">ツアー（練習用の図面で、操作しながら覚える）</div>' +
        `<button class="prop-btn" onclick="startGuideTour('basic')">🚀 はじめてツアー（約3分）${done('basic')}</button>` +
        `<details class="gh-topic gh-tours"><summary>機能の練習（${GUIDE_TOUR_MENU.filter(([id]) => GUIDE_TOURS[id]).length}）</summary><div class="gh-tour-grid">${list}</div></details></div>`;
}
function _ghCommandsHtml() {
    const rows = GUIDE_COMMANDS.map(([cat, list]) => `<tr class="gh-cmd-cat"><th colspan="3">${escapeHtml(cat)}</th></tr>` +
        list.map((c) => `<tr data-k="${escapeHtml(_ghNorm(c.join(' ')))}"><td>${c[0]}</td><td>${c[1]}</td><td>${escapeHtml(c[2])}</td></tr>`).join('')).join('');
    return '<div class="gh-cmd-sec"><div class="gh-sec">コマンド一覧（コマンド欄に入力）</div>' +
        `<details class="gh-topic"><summary>一覧を開く</summary><table class="gh-cmds"><tr><th>コマンド</th><th>短縮</th><th>内容</th></tr>${rows}</table></details></div>`;
}
function _ghHintsHtml() {
    const hm = guideHintsMode();
    const seg = (m, label) => `<button class="prop-btn opt-bg-btn ${hm === m ? 'active' : ''}" style="flex:1;margin-top:0;" onclick="setGuideHintsMode('${m}')">${label}</button>`;
    return '<div class="gh-extra"><div class="gh-sec">操作中のヒント（手順カード）</div>' +
        `<div style="display:flex;gap:6px;">${seg('auto', '最初の3回')}${seg('always', '常に')}${seg('off', '出さない')}</div>` +
        '<button class="prop-btn btn-sub" onclick="resetGuideHints()">ヒントの回数を最初に戻す</button></div>';
}
function _ghRender() {
    const back = _ghBack ? `<button class="prop-btn btn-sub gh-back" onclick="guideHelpBack()">◀ ${escapeHtml(_ghBack.label)} に戻る</button>` : '';
    const cats = GUIDE_HELP_CATS.map(([id, title]) => {
        const ts = GUIDE_TOPICS.filter((t) => t.cat === id);
        return ts.length ? `<div class="gh-cat" data-cat="${id}"><div class="gh-sec">${escapeHtml(title)}</div>${ts.map(_ghTopicHtml).join('')}</div>` : '';
    }).join('');
    const html = back +
        `<input id="gh-search" class="prop-val gh-search" type="search" autocomplete="off" enterkeyhint="search" placeholder="🔍 さがす（例: 求積・きゅうせき・SIMA・寸法）" value="${escapeHtml(_ghQuery)}" oninput="guideHelpSearch(this.value)">` +
        '<div id="gh-found" class="gh-found"></div>' +
        _ghToursHtml() + cats + _ghCommandsHtml() + _ghHintsHtml();
    showPropertyPanel(GUIDE_HELP_TITLE, html);
    _ghApplySearch();
    if(_ghFocus) {
        const id = _ghFocus;
        _ghFocus = null;
        _ghShowTopic(id);
    }
}
// 説明 id を開いて、見えるところまで送る（少しのあいだ枠を光らせる）
function _ghShowTopic(id) {
    const box = document.getElementById('property-panel-content');
    const d = box ? box.querySelector(`.gh-topic[data-id="${id}"]`) : null;
    if(!d) return false;
    d.open = true;
    d.classList.add('gh-hl');
    setTimeout(() => d.classList.remove('gh-hl'), 1600);
    const r = d.getBoundingClientRect(), br = box.getBoundingClientRect(), back = box.querySelector('.gh-back');
    box.scrollTop += r.top - br.top - 8 - (back ? back.offsetHeight + 6 : 0); // 上に残る「◀ 戻る」の下に見せる
    return true;
}
// 探している言葉で、説明・コマンドを絞る（言葉が無ければ全部。見つかった説明は、3つまで開く）
function _ghApplySearch() {
    const box = document.getElementById('property-panel-content');
    if(!box || !box.querySelector('#gh-search')) return;
    const words = _ghWords(_ghQuery);
    let n = 0;
    box.querySelectorAll('.gh-cat .gh-topic[data-id]').forEach((d) => {
        const t = GUIDE_TOPICS.find((x) => x.id === d.dataset.id);
        const hit = !words.length || (!!t && words.every((w) => _ghHay(t).includes(w)));
        d.style.display = hit ? '' : 'none';
        if(words.length) d.open = hit && n < 3;
        if(hit) n++;
    });
    box.querySelectorAll('.gh-cat').forEach((c) => { c.style.display = [...c.querySelectorAll('.gh-topic')].some((d) => d.style.display !== 'none') ? '' : 'none'; });
    let nc = 0;
    box.querySelectorAll('.gh-cmds tr[data-k]').forEach((tr) => {
        const hit = !words.length || words.every((w) => tr.dataset.k.includes(w));
        tr.style.display = hit ? '' : 'none';
        if(hit) nc++;
    });
    box.querySelectorAll('.gh-cmds tr.gh-cmd-cat').forEach((tr) => { tr.style.display = words.length ? 'none' : ''; });
    const cs = box.querySelector('.gh-cmd-sec');
    if(cs) {
        cs.style.display = (!words.length || nc) ? '' : 'none';
        const d = cs.querySelector('details');
        if(d && words.length) d.open = nc > 0 && nc <= 12;
    }
    box.querySelectorAll('.gh-extra').forEach((e) => { e.style.display = words.length ? 'none' : ''; });
    const f = document.getElementById('gh-found');
    if(f) {
        f.textContent = !words.length ? '' : (n || nc) ? `見つかりました: 説明 ${n}件${nc ? `・コマンド ${nc}件` : ''}`
            : '見つかりませんでした。別の言葉（ひらがなでも）で探してください';
        f.style.display = words.length ? 'block' : 'none';
    }
}
/**
 * ヘルプを開く（探す言葉は空に戻す）。topicId: 開いてすぐ見せる説明、back: { label, run }（「◀ 戻る」で開き直すパネル）
 */
window.showGuideHelp = function(topicId, back) {
    _ghBack = back || null;
    _ghFocus = topicId || null;
    _ghQuery = '';
    _ghRender();
};
// ヘルプを開いていれば、そのまま描き直す（ヒントの設定を変えたとき）
function guideHelpRefresh() {
    const t = document.getElementById('property-panel-title'), p = document.getElementById('property-panel');
    if(!t || !p || p.style.display !== 'flex' || t.textContent !== GUIDE_HELP_TITLE) return;
    const box = document.getElementById('property-panel-content'), top = box ? box.scrollTop : 0;
    const opened = box ? [...box.querySelectorAll('.gh-topic[data-id]')].filter((d) => d.open).map((d) => d.dataset.id) : [];
    _ghRender();
    const box2 = document.getElementById('property-panel-content');
    if(box2) { opened.forEach((id) => { const d = box2.querySelector(`.gh-topic[data-id="${id}"]`); if(d) d.open = true; }); box2.scrollTop = top; }
}
window.guideHelpSearch = function(q) { _ghQuery = String(q || ''); _ghApplySearch(); };
window.guideHelpOpen = function(id) {
    const t = GUIDE_TOPICS.find((x) => x.id === id);
    if(!t || !t.open) return;
    try { t.open.run(); } catch(e) { showToast('開けませんでした: ' + e.message, 3000); }
};
window.guideHelpBack = function() {
    const b = _ghBack;
    _ghBack = null;
    if(b && typeof b.run === 'function') b.run(); else hidePropertyPanel();
};

// ===== パネルの見出しの「？」 =====
// パネルを出すたびに呼ばれる（cad-core.js の showPropertyPanel）。説明があるパネルだけ「？」を出す
function guideUpdatePanelHelp(title) {
    const b = document.getElementById('property-panel-help');
    if(b) b.style.display = GUIDE_PANEL_HELP[title] ? '' : 'none';
}
window.guidePanelHelp = function() {
    const title = (document.getElementById('property-panel-title') || {}).textContent || '';
    const h = GUIDE_PANEL_HELP[title];
    if(!h) { showGuideHelp(); return; }
    let topic = h.topic;
    if(typeof topic === 'function') { try { topic = topic(); } catch { topic = null; } }
    showGuideHelp(topic, { label: title, run: h.back });
};

# Dropbox 連携の準備（アプリキーの作り方）

Web CAD の「☁ Dropbox から開く」「☁ Dropbox へ」（v5.54）を使うには、Dropbox で自分用の「アプリ」を作り、その **App key（アプリキー）** を Web CAD に入れます。PC のブラウザで 10 分ほどです。費用はかかりません。

## 1. Dropbox でアプリを作る

1. PC のブラウザで https://www.dropbox.com/developers/apps を開き、ふだん使っている Dropbox のアカウントでログインします。
2. **「Create app」**（アプリを作成）を押します。
3. 次のように選びます。
   - **1. Choose an API**: 「**Scoped access**」
   - **2. Choose the type of access you need**: 「**Full Dropbox**」（Dropbox から開いた図面と同じフォルダに保存するため）
     - 「App folder」を選ぶと、保存先が「アプリ／（アプリ名）」フォルダの中だけになります。
   - **3. Name your app**: 好きな名前（例: `WebCAD-taka`）。ほかの人と同じ名前は使えません。
4. 同意のチェックを入れて **「Create app」** を押します。

## 2. 使う権限を選ぶ（Permissions のタブ）

1. 作ったアプリの画面の上の **「Permissions」** タブを開きます。
2. 次の 2 つにチェックを入れます。
   - `files.metadata.read`（開いたファイルのフォルダを知る）
   - `files.content.write`（ファイルを保存する）
   - 開くのは Dropbox の Chooser を使うので、読む権限（`files.content.read`）は要りません（入っていても困りません）。
3. いちばん下の **「Submit」** を押します。

※ 権限は、Web CAD で「つなぐ」**前に**決めておきます。あとで変えたときは、Web CAD で「接続を切る」→「つなぐ」をやり直します。

## 3. 設定（Settings のタブ）

1. **「Settings」** タブを開きます。
2. **App key** の値（英数字 15 文字ほど）をコピーします。これが Web CAD に入れるアプリキーです。
   - 隣の **App secret** は使いません。人にも渡さないでください。
3. **Chooser / Saver / Embedder domains** に、Web CAD の場所を足して「Add」を押します。
   - `antigravity-web-cad.vercel.app`
4. **Allow public clients (Implicit Grant & PKCE)** は「**Allow**」のままにします。
5. **OAuth 2 → Redirect URIs** は空のままで大丈夫です（Web CAD は、出てきたコードを貼り付ける形でつなぎます）。

※ 作ったばかりのアプリは「Development」（開発中）です。自分で使うだけなら、そのままで使えます。

## 4. Web CAD にアプリキーを入れる

1. Web CAD の **☰ メニュー → ⚙ オプション** を開き、**☁ Dropbox** の「アプリキー」に、コピーした App key を貼り付けます。
   - アプリキーは秘密のものではありません。全部の端末で入れずに済むよう、アプリに組み込むこともできます（Claude に「アプリキーは ○○○ です」と伝えてください）。
2. **開く**: ☰ → **☁ Dropbox から開く** でファイルを選びます。初めての 1 回は「準備ができました」と出るので、その知らせのボタンをもう一度押します。
3. **保存の準備（1 回だけ）**: オプションの **☁ つなぐ** を押します。
   1. 出てきた欄の **☁ Dropbox の画面を開く** を押し、ログインして「許可」（Allow）を押します。
   2. 画面にコードが出るので、コピーします。
   3. Web CAD に戻り、「Dropbox につなぐ」の欄に貼り付けて **☁ つなぐ** を押します。
4. **保存**: DXF・SIMA・図面一式などを書き出すと、知らせに **☁ Dropbox へ** が出るので押します。
   - Dropbox から開いた図面は、そのファイルと同じフォルダに保存します。
   - ほかの図面は、オプションの「保存先」（初めは `/WebCAD`）に保存します。
   - 同じ名前のファイルがあると、「名前 (1).dxf」のように別の名前で保存します（上書きしません）。

## うまくいかないとき

| 出ること | 直し方 |
|---|---|
| Dropbox の画面に「This app is not configured for this domain」などと出て開けない | 3 の「Chooser / Saver / Embedder domains」に `antigravity-web-cad.vercel.app` を足したか確かめる |
| つなぐときに「invalid_scope」「missing scope」 | 2 の権限 2 つにチェックを入れて Submit し、Web CAD で「接続を切る」→「つなぐ」をやり直す |
| 「コードは 1 回しか使えません」 | 「つなぐ」をもう一度押し、新しいコードを貼り付ける（コードは 30 分のうちに貼り付けます） |
| 「許可が切れました」 | オプションの「☁ つなぐ」をやり直す（Dropbox の設定でアプリの接続を外したときなど） |

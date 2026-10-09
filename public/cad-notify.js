// ===== Web CAD お知らせ =====
// cad-notify.js - 画面の上のお知らせ（トースト）と、画面の下の「元に戻す」つきのお知らせ（スナックバー）、
//                 コマンド欄が畳まれていて見えないときにお知らせでも出す notify
//
// ・トースト（#cad-toast）: 文字だけ。種類（success ✓・warn ⚠・error ✕）で枠と印の色を変える（印は CSS の ::before なので、
//   textContent は文のまま）。図面のタップを邪魔しないよう押せない。読み上げ用に role（エラーは alert）
// ・スナックバー（#cad-snack）: 文と「元に戻す」などのボタン・✕。ボタンだけ押せる。エラーの帯・ガイドのヒントより上に出す

// showToast(msg)・showToast(msg, 3000)・showToast(msg, { ms, kind, action: { label, run } })
// action があるときは、ボタンつきのスナックバーで出す
function showToast(msg, opt) {
    const o = (typeof opt === 'number') ? { ms: opt } : (opt || {});
    if(o.action) { showSnack(msg, o); return; }
    let t = document.getElementById('cad-toast');
    if(!t) { t = document.createElement('div'); t.id = 'cad-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    if(o.kind) t.dataset.kind = o.kind; else delete t.dataset.kind;
    t.setAttribute('role', o.kind === 'error' ? 'alert' : 'status');
    t.setAttribute('aria-live', o.kind === 'error' ? 'assertive' : 'polite');
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), o.ms || 3000);
}

// ボタンつきのお知らせ（画面の下）。o: { ms, kind, action: { label, run } }
function showSnack(msg, o) {
    o = o || {};
    let s = document.getElementById('cad-snack');
    if(!s) {
        s = document.createElement('div');
        s.id = 'cad-snack';
        s.setAttribute('role', 'status');
        s.setAttribute('aria-live', 'polite');
        s.innerHTML = '<span class="sn-msg"></span><button type="button" class="sn-act"></button><button type="button" class="sn-x" aria-label="閉じる">✕</button>';
        s.querySelector('.sn-x').onclick = () => hideSnack();
        document.body.appendChild(s);
    }
    s.querySelector('.sn-msg').textContent = msg;
    const act = s.querySelector('.sn-act');
    if(o.action) {
        act.style.display = '';
        act.textContent = o.action.label;
        act.onclick = () => { hideSnack(); o.action.run(); };
    } else { act.style.display = 'none'; act.onclick = null; }
    if(o.kind) s.dataset.kind = o.kind; else delete s.dataset.kind;
    s.classList.add('show');
    clearTimeout(s._timer);
    s._timer = setTimeout(hideSnack, o.ms || 6000);
}
function hideSnack() {
    const s = document.getElementById('cad-snack');
    if(!s) return;
    s.classList.remove('show');
    clearTimeout(s._timer);
    const act = s.querySelector('.sn-act');
    if(act) act.onclick = null; // 送るファイル（大きい PDF のことも）を持ち続けない
}

// 元に戻せる操作（↩ 1回分）のあとに「元に戻す」を出す。押すまでに別の操作をしていたら（↩ の履歴が進んでいたら）戻さない
function showUndoSnack(msg) {
    const len = undoStack.length;
    showSnack(msg, { kind: 'success', action: { label: '↩ 元に戻す', run: () => {
        if(undoStack.length !== len) { showToast('このあとに別の操作をしたので、ここからは戻せません（↩ で順に戻せます）', { kind: 'warn', ms: 3500 }); return; }
        undo();
        if(typeof updateLayerPanel === 'function') updateLayerPanel();
        showToast('元に戻しました', { kind: 'success', ms: 1800 });
    } } });
}

// コマンド欄の記録に書き、コマンド欄が畳まれていて見えないときはお知らせでも出す（先頭の「-> 」は付けない）
function notify(msg, opt) {
    addCommandLog(msg);
    const area = document.getElementById('command-line-area');
    if(!area || area.classList.contains('collapsed')) showToast(String(msg).replace(/^-> /, ''), opt);
}

// ===== 処理中の印（v5.20） =====
// 時間のかかる処理（読み込み・PDF・TS への送信）のあいだ、画面の上に「回る印＋何をしているか」を出す。
// 重い処理は画面を止めてしまうので、印を出したら busyPaint() で一度画面を描かせてから始める（回る印は CSS の transform なので、止まっていても回って見える）
const _busyTexts = []; // 重なったときは、閉じると前の文に戻す
let _busyDepth = 0;
function busyStart(text) {
    _busyDepth++;
    _busyTexts.push(text);
    _busySet(text);
}
function _busySet(text) {
    let b = document.getElementById('cad-busy');
    if(!b) {
        b = document.createElement('div');
        b.id = 'cad-busy';
        b.setAttribute('role', 'status');
        b.setAttribute('aria-live', 'polite');
        b.innerHTML = '<span class="bz-spin" aria-hidden="true"></span><span class="bz-text"></span>';
        document.body.appendChild(b);
    }
    b.querySelector('.bz-text').textContent = String(text || '処理中…').trim();
    b.classList.add('show');
    document.body.setAttribute('aria-busy', 'true');
}
// 段階を変える（コマンド欄の記録にも書く）。そのあと一度画面を描かせる
async function busyStep(text) {
    addCommandLog(text);
    if(_busyDepth) { _busyTexts[_busyTexts.length - 1] = text; _busySet(text); }
    await busyPaint();
}
function busyEnd() {
    _busyDepth = Math.max(0, _busyDepth - 1);
    _busyTexts.pop();
    if(_busyDepth) { _busySet(_busyTexts[_busyTexts.length - 1]); return; }
    const b = document.getElementById('cad-busy');
    if(b) b.classList.remove('show');
    document.body.removeAttribute('aria-busy');
}
function busyActive() { return _busyDepth > 0; }
// 一度画面を描かせる（裏にあるタブでは requestAnimationFrame が来ないので、時間でも進める）
function busyPaint() {
    return new Promise((resolve) => {
        let done = false;
        const fin = () => { if(!done) { done = true; resolve(); } };
        if(typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(fin, 0));
        setTimeout(fin, 50);
    });
}
// fn のあいだ処理中の印を出す
async function withBusy(text, fn) {
    busyStart(text);
    try { await busyPaint(); return await fn(); } finally { busyEnd(); }
}

// ===== オフラインの印（v5.20） =====
// 電波が無いときは上のバーの下に「📴 オフライン」を出す（押すと説明）。切れた・戻ったときはお知らせでも知らせる
function netSync(announce) {
    const off = (typeof navigator !== 'undefined' && navigator.onLine === false);
    document.body.classList.toggle('offline', off);
    let p = document.getElementById('net-pill');
    if(off && !p) {
        p = document.createElement('button');
        p.id = 'net-pill';
        p.type = 'button';
        p.textContent = '📴 オフライン';
        p.onclick = () => showToast('インターネットにつながっていません。図面の作図・保存と、端末に保存した地図・読込エンジンは使えます。つながると、地図を読み直します', { kind: 'warn', ms: 6000 });
        document.body.appendChild(p);
    }
    if(p) p.style.display = off ? '' : 'none';
    if(announce) showToast(off ? 'オフラインになりました（作図・保存と、端末に保存した地図は使えます）' : 'インターネットにつながりました', { kind: off ? 'warn' : 'success', ms: 3500 });
}
window.addEventListener('offline', () => netSync(true));
window.addEventListener('online', () => netSync(true));
netSync(false);

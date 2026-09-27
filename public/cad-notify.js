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
    } else act.style.display = 'none';
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

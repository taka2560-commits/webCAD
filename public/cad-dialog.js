// ===== Web CAD 確認画面（アプリの中のダイアログ） =====
// cad-dialog.js - ブラウザの confirm・prompt の代わり。大きなボタン・デザイン色・危ない操作は赤いボタンで、
//                 読み込みの「置き換える／追加する／やめる」のように3つ以上から選ぶこともできる
//
// ・cadConfirm(opts, cb) → Promise<true|false>、cadPrompt(opts, cb) → Promise<文字|null>、cadChoose(opts, cb) → Promise<値|null>
//   cb を渡すと答えで呼ぶ（Promise と同じ答え）。一度に1つだけ（新しく出すと前のものは「やめる」で閉じる）
// ・Esc・「やめる」で閉じる。Enter は選んでいるボタン（入力欄では「OK」）。背景を押しても閉じない（押し間違いで決めない）
// ・出しているあいだは、図面の操作・Esc・Ctrl+Z などを止める（cad-input.js が cadDialogOpen() を見る）
// ・自動テスト（tests/helpers/load-app.cjs）は window.__cadNativeDialogs を立て、window.confirm・prompt の差し替えで答える。
//   そのときは cb をその場で呼ぶ（今までの confirm と同じ順に動く）。cadChoose は confirm が true なら1つ目、false なら2つ目

let _dlg = null; // 出している確認画面 { done, cancel, prevFocus }

function cadDialogOpen() { return !!_dlg; }

function _dlgEl() {
    let el = document.getElementById('cad-dialog');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'cad-dialog';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'cad-dialog-title');
    el.innerHTML = '<div class="cd-card"><div class="cd-title" id="cad-dialog-title"></div><div class="cd-msg"></div>' +
        '<div class="cd-field"><input class="cd-input" type="text" autocomplete="off"><div class="cd-err" role="alert"></div></div><div class="cd-btns"></div></div>';
    el.addEventListener('keydown', (e) => {
        if(!_dlg) return;
        e.stopPropagation(); // 図面の Esc・Ctrl+Z などに渡さない
        if(e.key === 'Escape') { e.preventDefault(); _dlgClose(_dlg.cancel); }
        else if(e.key === 'Tab') _dlgTrapTab(e);
    });
    document.body.appendChild(el);
    return el;
}
// Tab でフォーカスが確認画面の外へ出ないようにする
function _dlgTrapTab(e) {
    const items = [..._dlgEl().querySelectorAll('input:not([hidden]), button')].filter((b) => b.offsetParent !== null || b === document.activeElement);
    if(!items.length) return;
    const i = items.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i >= items.length - 1 ? 0 : i + 1);
    e.preventDefault();
    items[next].focus();
}

// opts: { title, message, input: { value, placeholder, inputmode }, validate(v) → 知らせる文 or ''（Promise でもよい）,
//         buttons: [{ label, value, kind: 'primary' | 'danger' | 'sub', focus }], cancel: やめたときの値 }
function _dlgShow(opts, done) {
    if(_dlg) _dlgClose(_dlg.cancel);
    const el = _dlgEl();
    el.querySelector('.cd-title').textContent = opts.title || '';
    el.querySelector('.cd-title').style.display = opts.title ? '' : 'none';
    el.querySelector('.cd-msg').textContent = opts.message || '';
    const field = el.querySelector('.cd-field'), inp = el.querySelector('.cd-input'), err = el.querySelector('.cd-err');
    field.style.display = opts.input ? '' : 'none';
    err.textContent = '';
    inp.removeAttribute('aria-invalid');
    if(opts.input) {
        inp.value = opts.input.value || '';
        inp.placeholder = opts.input.placeholder || '';
        if(opts.input.inputmode) inp.setAttribute('inputmode', opts.input.inputmode); else inp.removeAttribute('inputmode');
    }
    const box = el.querySelector('.cd-btns');
    box.textContent = '';
    let focusBtn = null, okBtn = null;
    for(const b of opts.buttons) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cd-btn cd-' + (b.kind || 'sub');
        btn.textContent = b.label;
        btn.onclick = () => _dlgPick(b.value, opts);
        box.appendChild(btn);
        if(b.focus) focusBtn = btn;
        if(b.kind === 'primary' || b.kind === 'danger') okBtn = btn;
    }
    inp.onkeydown = (e) => { if(e.key === 'Enter' && okBtn) { e.preventDefault(); okBtn.click(); } };
    _dlg = { done, cancel: opts.cancel, prevFocus: document.activeElement };
    el.classList.add('show');
    // 入力欄があればそこへ。危ない操作は「やめる」側（うっかり Enter で決めない）
    const target = opts.input ? inp : (focusBtn || box.querySelector('.cd-sub') || okBtn);
    if(target) { target.focus(); if(opts.input) inp.select(); }
}
async function _dlgPick(value, opts) {
    if(!_dlg) return;
    if(opts.input && value !== opts.cancel) {
        const inp = _dlgEl().querySelector('.cd-input'), err = _dlgEl().querySelector('.cd-err');
        const v = inp.value;
        const msg = opts.validate ? await opts.validate(v) : '';
        if(!_dlg) return;
        if(msg) { // 欄のすぐ下に理由を出し、打った字は残す
            err.textContent = msg;
            inp.setAttribute('aria-invalid', 'true');
            inp.focus();
            if(typeof motionShake === 'function') motionShake(inp);
            return;
        }
        _dlgClose(v);
        return;
    }
    _dlgClose(value);
}
function _dlgClose(value) {
    const d = _dlg;
    if(!d) return;
    _dlg = null;
    _dlgEl().classList.remove('show');
    try { if(d.prevFocus && d.prevFocus.focus) d.prevFocus.focus(); } catch { /* 戻せなくてもよい */ }
    d.done(value);
}

// テストのとき: ブラウザの confirm・prompt（テストが差し替えたもの）で答える
function _dlgNative(opts) {
    const text = (opts.title ? opts.title + '\n' : '') + (opts.message || '');
    if(opts.input) {
        const v = window.prompt(text, opts.input.value || '');
        return (v === null || v === undefined) ? opts.cancel : String(v);
    }
    const yes = window.confirm(text);
    const vals = opts.buttons.filter((b) => b.value !== opts.cancel).map((b) => b.value);
    if(opts.kind === 'confirm') return yes;
    return yes ? vals[0] : (vals.length > 1 ? vals[1] : opts.cancel);
}

function _dlgAsk(opts, cb) {
    return new Promise((resolve) => {
        const done = (v) => { try { if(cb) cb(v); } finally { resolve(v); } };
        if(window.__cadNativeDialogs) { done(_dlgNative(opts)); return; }
        _dlgShow(opts, done);
    });
}

// はい・いいえ。opts: { title, message, ok: 'OK' の文字, cancel: 'やめる' の文字, danger: 危ない操作（赤いボタン・初めは「やめる」を選ぶ） }
function cadConfirm(opts, cb) {
    return _dlgAsk({ kind: 'confirm', title: opts.title, message: opts.message, cancel: false, buttons: [
        { label: opts.cancel || 'やめる', value: false, kind: 'sub', focus: !!opts.danger },
        { label: opts.ok || 'OK', value: true, kind: opts.danger ? 'danger' : 'primary', focus: !opts.danger },
    ] }, cb);
}
// 文字を入れる。opts: { title, message, value, placeholder, inputmode, ok, validate(v) → 知らせる文 or '' }。やめたら null
function cadPrompt(opts, cb) {
    return _dlgAsk({ kind: 'prompt', title: opts.title, message: opts.message, cancel: null,
        input: { value: opts.value, placeholder: opts.placeholder, inputmode: opts.inputmode },
        validate: opts.validate || ((v) => String(v).trim() ? '' : '入れてください'),
        buttons: [{ label: 'やめる', value: null, kind: 'sub' }, { label: opts.ok || 'OK', value: true, kind: 'primary' }] }, cb);
}
// いくつかから選ぶ。opts: { title, message, choices: [{ label, value, kind }] }（「やめる」は最後に付く）。やめたら null
function cadChoose(opts, cb) {
    return _dlgAsk({ kind: 'choose', title: opts.title, message: opts.message, cancel: null,
        buttons: [...opts.choices, { label: 'やめる', value: null, kind: 'sub', focus: true }] }, cb);
}

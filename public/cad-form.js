// ===== Web CAD 入力欄の共通の部品 =====
// cad-form.js - 数の読み取り（全角もよい・範囲）、欄のすぐ下にまちがいの理由を出す fieldError、点名の候補（チップ）
//
// ・まちがいは欄のそば（赤い枠と、欄の下の理由）に出し、その欄へ移る。打った字は消さない（直して打ち直せる）。
//   以前はパネルごとにばらばらで、黙って無視する・前の値で進める・見えないコマンド欄に書くだけ、のこともあった
// ・直し始めたら（欄に打ったら）理由は消える

// 全角の数字・記号を半角に（cad-cogo.js の cogoHalfWidth と同じ）
function _formHalf(s) {
    if(typeof cogoHalfWidth === 'function') return cogoHalfWidth(s);
    return String(s === undefined || s === null ? '' : s).replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
}
// 数の欄を読む。opts: { gt: これより大きい, min, max, allowEmpty, what: '半径' などの名前 }
// 戻り値: { ok, value（空なら null）, error }
function parseNumInput(text, opts) {
    const o = opts || {};
    const s = _formHalf(text).trim();
    if(s === '') return o.allowEmpty ? { ok: true, value: null, error: '' } : { ok: false, value: null, error: `${o.what || '数'}を入れてください` };
    if(!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return { ok: false, value: null, error: '数で入れてください（例 12.5）' };
    const v = Number(s);
    if(o.gt !== undefined && !(v > o.gt)) return { ok: false, value: v, error: `${o.gt} より大きい数を入れてください` };
    if(o.min !== undefined && v < o.min) return { ok: false, value: v, error: `${o.min} 以上の数を入れてください` };
    if(o.max !== undefined && v > o.max) return { ok: false, value: v, error: `${o.max} 以下の数を入れてください` };
    return { ok: true, value: v, error: '' };
}

// 欄のすぐ下にまちがいの理由を出し、その欄へ移る（打った字は残す）
function fieldError(el, msg) {
    if(!el) { if(typeof showToast === 'function') showToast(msg, { kind: 'warn', ms: 3000 }); return; }
    el.setAttribute('aria-invalid', 'true');
    el.classList.add('field-bad');
    let box = _fieldErrBox(el, true);
    box.textContent = msg;
    if(!el.id) el.id = 'fld-' + Math.random().toString(36).slice(2, 8);
    box.id = el.id + '-err';
    el.setAttribute('aria-describedby', box.id);
    if(!el._fieldWatch) { // 直し始めたら理由を消す
        el._fieldWatch = true;
        el.addEventListener('input', () => fieldOk(el));
    }
    try { el.focus(); if(el.select) el.select(); } catch { /* 移れなくてもよい */ }
    if(typeof motionShake === 'function') motionShake(el);
}
function fieldOk(el) {
    if(!el) return;
    el.removeAttribute('aria-invalid');
    el.classList.remove('field-bad');
    const box = _fieldErrBox(el, false);
    if(box) box.remove();
    el.removeAttribute('aria-describedby');
}
// 理由を出す場所: 欄の行（.prop-row）のすぐ下
function _fieldErrBox(el, create) {
    const row = el.closest('.prop-row') || el;
    let box = row.nextElementSibling;
    if(box && box.classList.contains('field-err') && box.dataset.for === (el.id || '')) return box;
    if(!create) return null;
    box = document.createElement('div');
    box.className = 'field-err';
    box.setAttribute('role', 'alert');
    box.dataset.for = el.id || '';
    row.insertAdjacentElement('afterend', box);
    return box;
}
// 数の欄を確かめる。よければ数（空で allowEmpty なら null）、まちがいなら欄に理由を出して undefined
function fieldNum(el, opts) {
    const r = parseNumInput(el ? el.value : '', opts);
    if(!r.ok) { fieldError(el, r.error); return undefined; }
    fieldOk(el);
    return r.value;
}

// ===== 点名の候補 =====
// 点名の欄に打つと、図面の測点の名前・番号から合うものを最大6つ、欄の下にチップで出す（押すと入る）。
// iPhone では datalist の候補が出にくいので、自前で出す
function pointSuggestHtml(inputId) {
    return `<div class="pt-suggest" id="${inputId}-sug" role="listbox" aria-label="点名の候補"></div>`;
}
function pointSuggestUpdate(inputEl, onPick) {
    if(!inputEl) return;
    const box = document.getElementById(inputEl.id + '-sug');
    if(!box) return;
    const q = _formHalf(inputEl.value).trim().toLowerCase();
    box.textContent = '';
    if(!q || /^[-+]?\d*\.?\d*\s*,/.test(q) || typeof collectSurveyPoints !== 'function') return; // 空・「X,Y」のときは出さない
    const seen = new Set(), hits = [];
    for(const p of collectSurveyPoints()) {
        const name = String(p.name || ''), num = String(p.num || '');
        if(!name && !num) continue;
        const label = name || num;
        if(seen.has(label)) continue;
        const n = name.toLowerCase(), m = num.toLowerCase();
        const rank = (n === q || m === q) ? 0 : (n.startsWith(q) || m.startsWith(q)) ? 1 : (n.includes(q) || m.includes(q)) ? 2 : -1;
        if(rank < 0) continue;
        seen.add(label);
        hits.push({ label, sub: name && num ? num : '', rank });
    }
    hits.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'ja', { numeric: true }));
    for(const h of hits.slice(0, 6)) {
        if(h.rank === 0 && hits.length === 1) break; // もう入っている
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pt-chip';
        b.setAttribute('role', 'option');
        b.textContent = h.label + (h.sub ? `（${h.sub}）` : '');
        b.onmousedown = (e) => e.preventDefault(); // 押しても欄のフォーカスを外さない（先に change が走らないように）
        b.onclick = () => { inputEl.value = h.label; box.textContent = ''; onPick(h.label); };
        box.appendChild(b);
    }
}

// ===== 検索の欄の × =====
// 押すと検索の文字を消して、一覧を元に戻す（欄の oninput をそのまま動かす）
function searchClearBtn(inputId) {
    return `<button type="button" class="search-x" onclick="searchClear('${inputId}')" aria-label="検索の文字を消す" title="消す">×</button>`;
}
function searchClear(id) {
    const el = document.getElementById(id);
    if(!el) return;
    el.value = '';
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    el.focus();
}

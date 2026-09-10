// ===== Web CAD エラー記録・表示 =====
// cad-errors.js - どのスクリプトより先に読み込み、想定外のエラーを画面に知らせる。
// スマホでは開発者ツールが使えず「黙って動かない」状態になりやすいため、
// エラーを端末内（localStorage）に記録し、詳細を表示・コピーできるようにする。
(function () {
    'use strict';

    const STORE_KEY = 'cad_error_log';
    const MAX_ENTRIES = 30;
    const SAME_MSG_SILENCE_MS = 10000; // 同じエラーの連続通知を抑える
    const BANNER_MS = 8000;

    let log = [];
    try { log = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { log = []; }
    if (!Array.isArray(log)) log = [];
    let lastNotice = { msg: '', t: 0 };

    function persist() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(log.slice(-MAX_ENTRIES))); } catch { /* 容量不足等は無視 */ }
    }

    function buildInfo() {
        const m = document.querySelector('meta[name="webcad-build"]');
        return m ? { id: m.content, at: m.getAttribute('data-built-at') || '' } : { id: '開発版', at: '' };
    }

    function shortSource(src) {
        if (!src) return '';
        try { return new URL(src, location.href).pathname.split('/').pop().replace(/\?.*$/, ''); } catch { return String(src); }
    }

    function record(kind, message, detail, opts) {
        const entry = {
            t: new Date().toISOString(),
            kind: kind,
            message: String(message || '不明なエラー').slice(0, 500),
            detail: detail ? String(detail).slice(0, 3000) : '',
            build: buildInfo().id
        };
        log.push(entry);
        if (log.length > MAX_ENTRIES) log = log.slice(-MAX_ENTRIES);
        persist();
        try {
            if (typeof window.addCommandLog === 'function') window.addCommandLog('⚠ エラー: ' + entry.message);
        } catch { /* ログ欄が未初期化 */ }
        if (!(opts && opts.silent)) notify(entry);
        updateBadge();
        return entry;
    }

    // ===== 画面表示（他のスクリプトが壊れていても動くよう自己完結で作る） =====
    function injectStyle() {
        if (document.getElementById('cad-err-style')) return;
        const st = document.createElement('style');
        st.id = 'cad-err-style';
        st.textContent = [
            '#cad-err-banner{position:fixed;left:50%;bottom:calc(64px + env(safe-area-inset-bottom,0px));transform:translateX(-50%) translateY(20px);',
            'z-index:200002;display:flex;align-items:center;gap:8px;max-width:min(92vw,520px);padding:8px 8px 8px 12px;',
            'background:rgba(18,22,28,0.96);border:1px solid rgba(255,204,0,0.55);border-radius:12px;color:#e0e0e0;',
            'font:600 12px "Segoe UI",sans-serif;box-shadow:0 6px 20px rgba(0,0,0,0.5);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;}',
            '#cad-err-banner.show{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0);}',
            '#cad-err-banner .msg{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '#cad-err-banner .ico{color:#ffcc00;font-size:14px;flex-shrink:0;}',
            '.cad-err-btn{flex-shrink:0;height:32px;padding:0 12px;border-radius:8px;background:rgba(255,255,255,0.06);',
            'border:1px solid #3a4049;color:#e0e0e0;font:600 12px "Segoe UI",sans-serif;cursor:pointer;}',
            '.cad-err-btn:active{transform:scale(0.94);}',
            '.cad-err-btn.primary{border-color:rgba(0,255,136,0.5);color:#00ff88;}',
            '.cad-err-btn.danger{border-color:rgba(255,107,107,0.5);color:#ff6b6b;}',
            '#cad-err-panel{position:fixed;inset:0;z-index:200003;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);}',
            '#cad-err-panel.show{display:flex;}',
            '#cad-err-panel .card{width:min(94vw,560px);max-height:82vh;display:flex;flex-direction:column;background:#1b1f25;',
            'border:1px solid #3a4049;border-radius:12px;color:#e0e0e0;font:12px "Segoe UI",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,0.6);}',
            '#cad-err-panel .hd{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #3a4049;font-weight:700;font-size:14px;}',
            '#cad-err-panel .bd{overflow:auto;padding:8px 12px;flex:1;}',
            '#cad-err-panel .ft{display:flex;gap:8px;justify-content:flex-end;padding:10px 12px;border-top:1px solid #3a4049;flex-wrap:wrap;}',
            '#cad-err-panel .it{padding:6px 0;border-bottom:1px solid #181c21;}',
            '#cad-err-panel .it .tm{color:#888;font-size:10px;}',
            '#cad-err-panel .it .mg{color:#ffcc00;word-break:break-all;margin-top:2px;}',
            '#cad-err-panel pre{white-space:pre-wrap;word-break:break-all;color:#aaa;font-size:10px;margin:4px 0 0;max-height:140px;overflow:auto;}',
            '#cad-err-panel .env{color:#888;font-size:10px;white-space:pre-wrap;margin-bottom:6px;}'
        ].join('');
        (document.head || document.documentElement).appendChild(st);
    }

    function notify(entry) {
        const now = Date.now();
        if (entry.message === lastNotice.msg && now - lastNotice.t < SAME_MSG_SILENCE_MS) return;
        lastNotice = { msg: entry.message, t: now };
        const show = () => {
            injectStyle();
            let b = document.getElementById('cad-err-banner');
            if (!b) {
                b = document.createElement('div');
                b.id = 'cad-err-banner';
                b.setAttribute('role', 'alert');
                b.innerHTML = '<span class="ico">⚠</span><span class="msg"></span>' +
                    '<button type="button" class="cad-err-btn" data-act="detail">詳細</button>' +
                    '<button type="button" class="cad-err-btn" data-act="close" aria-label="閉じる">✕</button>';
                b.addEventListener('click', (ev) => {
                    const act = ev.target && ev.target.getAttribute('data-act');
                    if (act === 'detail') { hideBanner(); showPanel(); }
                    else if (act === 'close') hideBanner();
                });
                document.body.appendChild(b);
            }
            b.querySelector('.msg').textContent = 'エラーが発生しました: ' + entry.message;
            b.classList.add('show');
            clearTimeout(b._timer);
            b._timer = setTimeout(hideBanner, BANNER_MS);
        };
        if (document.body) show();
        else document.addEventListener('DOMContentLoaded', show, { once: true });
    }

    function hideBanner() {
        const b = document.getElementById('cad-err-banner');
        if (b) b.classList.remove('show');
    }

    function envText() {
        const bi = buildInfo();
        const lines = [
            'Web CAD ビルド: ' + bi.id + (bi.at ? ' (' + bi.at + ')' : ''),
            '日時: ' + new Date().toLocaleString('ja-JP'),
            '端末: ' + navigator.userAgent,
            '画面: ' + window.innerWidth + 'x' + window.innerHeight + ' @' + (window.devicePixelRatio || 1),
            'オンライン: ' + (navigator.onLine ? 'はい' : 'いいえ') +
                ' / SW: ' + ((navigator.serviceWorker && navigator.serviceWorker.controller) ? '有効' : '無効')
        ];
        try { if (typeof entities !== 'undefined') lines.push('図形数: ' + entities.length); } catch { /* 未初期化 */ }
        return lines.join('\n');
    }

    function reportText() {
        const items = log.slice().reverse().map((e) =>
            '[' + e.t + '] (' + e.kind + (e.build ? ', build ' + e.build : '') + ') ' + e.message + (e.detail ? '\n' + e.detail : ''));
        return envText() + '\n\n' + (items.length ? items.join('\n\n') : '記録されたエラーはありません');
    }

    function copyReport() {
        const text = reportText();
        const done = () => { if (typeof window.showToast === 'function') window.showToast('エラー情報をコピーしました'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
        } else {
            fallbackCopy(text, done);
        }
    }

    function fallbackCopy(text, done) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch { alert(text); }
        ta.remove();
    }

    function showPanel() {
        injectStyle();
        let p = document.getElementById('cad-err-panel');
        if (!p) {
            p = document.createElement('div');
            p.id = 'cad-err-panel';
            p.innerHTML = '<div class="card" role="dialog" aria-label="エラーログ">' +
                '<div class="hd"><span>⚠ エラーログ</span><button type="button" class="cad-err-btn" data-act="close" aria-label="閉じる">✕</button></div>' +
                '<div class="bd"></div>' +
                '<div class="ft"><button type="button" class="cad-err-btn danger" data-act="clear">記録を消去</button>' +
                '<button type="button" class="cad-err-btn primary" data-act="copy">コピー（不具合報告用）</button></div></div>';
            p.addEventListener('click', (ev) => {
                if (ev.target === p) { p.classList.remove('show'); return; }
                const act = ev.target && ev.target.getAttribute('data-act');
                if (act === 'close') p.classList.remove('show');
                else if (act === 'copy') copyReport();
                else if (act === 'clear') { log = []; persist(); updateBadge(); renderPanel(); }
            });
            document.body.appendChild(p);
        }
        renderPanel();
        p.classList.add('show');
    }

    function renderPanel() {
        const bd = document.querySelector('#cad-err-panel .bd');
        if (!bd) return;
        bd.textContent = '';
        const env = document.createElement('div');
        env.className = 'env';
        env.textContent = envText();
        bd.appendChild(env);
        if (!log.length) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color:#888;text-align:center;padding:16px;';
            empty.textContent = '記録されたエラーはありません';
            bd.appendChild(empty);
            return;
        }
        log.slice().reverse().forEach((e) => {
            const it = document.createElement('div');
            it.className = 'it';
            const tm = document.createElement('div');
            tm.className = 'tm';
            tm.textContent = new Date(e.t).toLocaleString('ja-JP') + ' / ' + e.kind + (e.build ? ' / build ' + e.build : '');
            const mg = document.createElement('div');
            mg.className = 'mg';
            mg.textContent = e.message;
            it.appendChild(tm);
            it.appendChild(mg);
            if (e.detail) {
                const pre = document.createElement('pre');
                pre.textContent = e.detail;
                it.appendChild(pre);
            }
            bd.appendChild(it);
        });
    }

    // オプション画面などに件数を表示するための要素（.cad-err-count）を更新
    function updateBadge() {
        document.querySelectorAll('.cad-err-count').forEach((el) => { el.textContent = String(log.length); });
    }

    // ===== グローバルなエラー捕捉 =====
    window.addEventListener('error', (ev) => {
        const tgt = ev.target;
        // <script>/<link>/<img> の読み込み失敗（キャプチャ段階でのみ届く）
        if (tgt && tgt !== window && tgt.tagName) {
            const src = tgt.src || tgt.href || '';
            if (tgt.tagName === 'SCRIPT' || tgt.tagName === 'LINK') {
                record('load', '読み込みに失敗しました: ' + shortSource(src), src);
            }
            return;
        }
        const msg = (ev.message || (ev.error && ev.error.message) || '').replace(/^Uncaught\s+/, '');
        if (!msg || /ResizeObserver loop/i.test(msg)) return;
        const where = ev.filename ? shortSource(ev.filename) + ':' + ev.lineno + ':' + ev.colno : '';
        const stack = ev.error && ev.error.stack ? ev.error.stack : '';
        // 詳細の分からないクロスオリジンのエラーは記録のみ（通知しても対処できないため）
        const opaque = msg === 'Script error.' && !ev.filename;
        record('error', msg + (where ? ' (' + where + ')' : ''), stack, { silent: opaque });
    }, true);

    window.addEventListener('unhandledrejection', (ev) => {
        const r = ev.reason;
        const msg = (r && r.message) ? r.message : String(r);
        record('promise', msg, r && r.stack ? r.stack : '');
    });

    // 他モジュールから利用する API
    window.cadErrors = {
        record: record,
        list: () => log.slice(),
        count: () => log.length,
        show: showPanel,
        copy: copyReport,
        clear: () => { log = []; persist(); updateBadge(); },
        buildInfo: buildInfo
    };
})();

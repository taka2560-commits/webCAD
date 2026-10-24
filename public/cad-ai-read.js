// ===== Web CAD 座標表の読み取り（Claude。v5.55） =====
// cad-ai-read.js - 紙の座標表・野帳・スキャンした PDF の写真から、点番号・点名・X・Y・標高を Claude に読ませ、
//   表で確かめて（直して）から座標一覧に取り込む。
//   ・Claude の API キーは使う人がそれぞれ自分のものを ⚙ オプションに入れる（端末にだけ覚える。料金はその人の払い）。
//   ・数は読めた文字のまま（文字列）で受け取り、アプリの側で数にする。計算はしない（座標の値を作らない）。
//   ・読み間違いはあり得るので、必ず確かめる表を出す。自信の無い行は色を付け、元の画像を横に出す。
//   ・SDK は src/vendor.js の window.loadClaudeSdk（使うときに初めて読み込む）。

const AIREAD_MODEL = 'claude-opus-5-5';
const AIREAD_PRICE = { in: 4 / 1e6, out: 20 / 1e6 }; // Claude Opus 5.5 の料金（ドル／トークン）。目安の表示に使う
const AIREAD_MAX_EDGE = 2576; // 画像の長い辺（Claude Opus 5.5 がそのまま読める大きさ。大きい写真は縮める）
const AIREAD_MAX_FILES = 5;
const AIREAD_PDF_MAX = 20 * 1024 * 1024; // PDF 1つ（base64 にすると約 27MB）
const AIREAD_SEND_MAX = 30 * 1024 * 1024; // 送る base64 の合計（API の 1回の大きさの上限より小さく）
const AIREAD_SYSTEM = [
    'あなたは日本の測量の座標表を読み取る係です。画像（写真・スキャン）や PDF に写っている座標の表から、各点の点番号・点名・X・Y・標高を、書かれている文字のとおりに読み取ります。',
    '決まり:',
    '- 数は書かれているとおりの文字で返します。桁・小数点以下の桁数・符号（マイナス）を変えず、丸めたり計算したりしません。カンマ区切りの桁（1,234.567）はカンマを外します。',
    '- 日本の公共座標の決まりで、X は北（縦）、Y は東（横）です。表の見出しが X・Y ならそのまま。見出しが N・E や 北・東 なら、N（北）を x、E（東）を y にします。見出しが無いときは、左の列を x、右の列を y とし、notes にそう書きます。',
    '- 標高（H・Z・高さ）が無ければ z は空文字。点番号・点名が無ければ空文字。',
    '- にじみ・かすれ・手書きのくせなどで1文字でも自信が無い行は unsure を true にし、unsure_reason にどの値のどの文字かを短く書きます。推測で埋めた値も unsure です。',
    '- 表の外のメモ・合計・面積・距離などの行は点に入れません。同じ点が2回写っていても、写っているとおりに返します（消しません）。',
    '- 数の単位: 表に mm と書いてあるか、値が明らかに mm（例: 12345678.9 のように m の公共座標の 1000 倍）なら unit を mm、m なら m、分からなければ unknown。',
    '- 座標の表が見つからなければ points を空にし、notes に理由を書きます。',
].join('\n');

let _airead = null; // { files: [{ name, kind, url, data, mediaType }], rows: [...], unit, notes, cost, mm, model }

function aireadKey() { try { return (localStorage.getItem('cad_claude_key') || '').trim(); } catch { return ''; } }
function aireadEnabled() { return !!aireadKey(); }
window.setAireadKey = function(v) {
    const k = String(v || '').trim();
    if(k && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) { showToast('API キーの形が違います（sk-ant- で始まる文字をそのまま貼り付けてください）', { kind: 'warn', ms: 4000 }); return false; }
    try { if(k) localStorage.setItem('cad_claude_key', k); else localStorage.removeItem('cad_claude_key'); } catch { showToast('この端末に覚えられませんでした', { kind: 'error', ms: 3000 }); return false; }
    if(document.getElementById('opt-airead')) showOptionsPanel();
    else if(document.getElementById('airead-panel')) showAireadPanel();
    return true;
};

// ===== オプションの欄 =====
function aireadOptionsHtml() {
    const has = aireadEnabled();
    return `
        <div id="opt-airead" style="border-top:1px solid rgba(255,255,255,0.1); margin-top:10px; padding-top:10px; display:flex; flex-direction:column; gap:8px;">
            <div style="font-size:11px;color:#aaa;font-weight:700;">📷 座標表の読み取り（Claude）</div>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#ddd;">API キー<input class="prop-val" id="opt-ai-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" style="flex:1;min-width:0;" placeholder="${has ? '（入っています。変えるときだけ貼り付け）' : 'sk-ant- で始まるキー'}" onchange="setAireadKey(this.value)"></label>
            <div style="font-size:11px;color:#ddd;" id="opt-ai-status">${has ? '✅ キーが入っています（この端末だけ）' : 'キーが入っていません'}</div>
            ${has ? '<button class="prop-btn btn-sub" onclick="setAireadKey(\'\')">キーを消す</button>' : ''}
            <div style="color:#888;font-size:10px;">Claude Console（platform.claude.com）で作った自分の API キーを入れます。読み取るたびに、そのキーの持ち主に料金がかかります（1枚でおよそ数円〜十数円）。読み取る画像は Anthropic に送られます。人と共用の端末では入れないでください。</div>
        </div>`;
}

// ===== パネル =====
function showAireadPanel() {
    if(!aireadEnabled()) {
        showPropertyPanel('📷 座標表を読む', `
            <div id="airead-panel" style="display:flex;flex-direction:column;gap:8px;font-size:12px;color:#ddd;">
                <div>紙の座標表・野帳・スキャンした PDF の写真から、点番号・点名・X・Y・標高を読み取り、確かめてから座標一覧に入れます。</div>
                <div>使うには、自分の Claude の API キーが要ります（Claude Console → API Keys で作ります）。</div>
                <input class="prop-val" id="airead-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant- で始まるキーを貼り付け" aria-label="Claude の API キー">
                <button class="prop-btn" onclick="setAireadKey(document.getElementById('airead-key').value)">キーを入れる</button>
                <div style="color:#888;font-size:10px;">キーはこの端末にだけ覚えます。読み取るたびに、キーの持ち主に料金がかかります。</div>
            </div>`);
        return;
    }
    // 読み取った表があれば、それを出し直す（置き換え・追加で「やめる」・✕ で閉じたあとも、料金を払った読み取りと直した所を失わない）
    if(_airead) { aireadRenderReview(); return; }
    showPropertyPanel('📷 座標表を読む', `
        <div id="airead-panel" style="display:flex;flex-direction:column;gap:8px;font-size:12px;color:#ddd;">
            <div>座標表を写した写真（またはスキャンした PDF）を選ぶと、Claude が点番号・点名・X（北）・Y（東）・標高を読み取ります。読み取ったあとに表で確かめ、直してから取り込みます。</div>
            <input type="file" id="airead-file" accept="image/*,application/pdf,.pdf" multiple style="display:none;" onchange="aireadPicked(this.files)">
            <button class="prop-btn" id="airead-pick" onclick="document.getElementById('airead-file').click()"${_aireadBusy ? ' disabled' : ''}>${_aireadBusy ? '読み取っています…' : `📷 写真・PDF を選ぶ（${AIREAD_MAX_FILES}枚まで）`}</button>
            <div style="color:#888;font-size:10px;">こつ: 表を真上から、影を入れずに、表がいっぱいに写るように撮ります。1枚に入らない表は分けて撮り、まとめて選びます。読み取るたびに料金がかかります（1枚でおよそ数円〜十数円）。</div>
        </div>`);
}
window.showAireadPanel = showAireadPanel;
// 読み取った表を捨てて、別の写真を読む
window.aireadRestart = function() { _airead = null; showAireadPanel(); };

let _aireadBusy = false; // 読み取り中（2回送って料金が2回かからないように）
let _aireadSdk = null;   // 読み込んだ SDK（例外の種類を見分ける）
window.aireadPicked = async function(list) {
    const input = document.getElementById('airead-file');
    const files = Array.from(list || []).slice(0, AIREAD_MAX_FILES);
    if(input) input.value = ''; // 同じ写真をもう一度選んでも読めるように
    if(!files.length) return;
    if(_aireadBusy) { showToast('いま読み取っています。終わるまでお待ちください', { kind: 'warn', ms: 2500 }); return; }
    if(list.length > AIREAD_MAX_FILES) showToast(`${AIREAD_MAX_FILES}枚までにしました`, { kind: 'warn', ms: 2500 });
    if(typeof navigator !== 'undefined' && navigator.onLine === false) { showToast('電波が無いので読み取れません', { kind: 'warn', ms: 3000 }); return; }
    _aireadBusy = true;
    const pick = document.getElementById('airead-pick');
    if(pick) { pick.disabled = true; pick.textContent = '読み取っています…'; }
    const busy = typeof busyStart === 'function';
    if(busy) busyStart('Claude が座標表を読んでいます…（1分ほどかかることがあります）');
    try {
        const prepared = [];
        for(const f of files) prepared.push(await aireadPrepFile(f));
        const total = prepared.reduce((a, p) => a + p.data.length, 0);
        if(total > AIREAD_SEND_MAX) throw new Error('写真・PDF が合わせて大きすぎます。枚数を減らすか、PDF を分けてください');
        const r = await aireadRequest(prepared);
        if(!r) return;
        _airead = { files: prepared, rows: r.rows, unit: r.unit, notes: r.notes, cost: r.cost, model: r.model, mm: r.unit === 'mm', zmm: r.unit === 'mm', truncated: r.truncated };
        addCommandLog(`-> 座標表を読み取りました: ${r.rows.length}点（自信の無い行 ${r.rows.filter((x) => x.unsure).length}）`);
        aireadRenderReview();
    } catch(err) {
        showToast(aireadErrorText(err), { kind: 'error', ms: 6000 });
        addCommandLog(`エラー: 座標表の読み取り - ${(err && err.message) || err}`);
    } finally {
        _aireadBusy = false;
        if(busy && typeof busyEnd === 'function') busyEnd();
        const p2 = document.getElementById('airead-pick');
        if(p2) { p2.disabled = false; p2.textContent = `📷 写真・PDF を選ぶ（${AIREAD_MAX_FILES}枚まで）`; }
    }
};

// 画像は長い辺 2576px までに縮めて JPEG に。PDF はそのまま（1つ 20MB まで。base64 にすると約 1.34 倍）
async function aireadPrepFile(file) {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if(isPdf) {
        if(file.size > AIREAD_PDF_MAX) throw new Error(`PDF が大きすぎます（20MB まで）: ${file.name}`);
        const buf = await _aireadBytes(file);
        return { name: file.name, kind: 'pdf', mediaType: 'application/pdf', data: _aireadB64(buf), url: null };
    }
    const img = await _aireadDecodeImage(file);
    const k = Math.min(1, AIREAD_MAX_EDGE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); // 透明な PNG も白地に
    g.drawImage(img, 0, 0, w, h);
    if(typeof img.close === 'function') img.close();
    const url = c.toDataURL('image/jpeg', 0.92);
    return { name: file.name, kind: 'image', mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1), url };
}
function _aireadDecodeImage(file) {
    if(typeof window.createImageBitmap === 'function') return window.createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => _aireadImgEl(file));
    return _aireadImgEl(file);
}
function _aireadImgEl(file) {
    return new Promise((resolve, reject) => {
        const u = URL.createObjectURL(file), im = new window.Image();
        im.onload = () => { resolve(im); setTimeout(() => URL.revokeObjectURL(u), 1000); };
        im.onerror = () => { URL.revokeObjectURL(u); reject(new Error(`画像を読めませんでした（HEIC などは、写真のアプリで JPEG にしてから選んでください）: ${file.name}`)); };
        im.src = u;
    });
}
function _aireadBytes(file) {
    if(typeof file.arrayBuffer === 'function') return file.arrayBuffer().then((b) => new Uint8Array(b));
    return new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(new Uint8Array(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsArrayBuffer(file); });
}
function _aireadB64(bytes) {
    let s = '';
    for(let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

// Claude に読ませる。戻り値 { rows, unit, notes, cost, model, truncated }（断られたときは知らせて null）
// 答えの形（JSON Schema）は送るが、読むのは自分でする（SDK に読ませると、途中で切れた・断られた答えで例外になり、言い分けられないため）
async function aireadRequest(prepared) {
    const sdk = await window.loadClaudeSdk();
    _aireadSdk = sdk;
    const { Anthropic, betaZodOutputFormat, z } = sdk;
    const Schema = z.object({
        points: z.array(z.object({
            num: z.string(), name: z.string(), x: z.string(), y: z.string(), z: z.string(),
            unsure: z.boolean(), unsure_reason: z.string(),
        })),
        unit: z.enum(['m', 'mm', 'unknown']),
        notes: z.string(),
    });
    const fmt = betaZodOutputFormat(Schema);
    const client = new Anthropic({ apiKey: aireadKey(), dangerouslyAllowBrowser: true }); // 使う人が自分のキーを自分の端末で使う（キーはアプリに入っていない）
    const content = [];
    prepared.forEach((p, i) => {
        content.push({ type: 'text', text: `${i + 1}枚目: ${p.name}` });
        if(p.kind === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.data } });
        else content.push({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } });
    });
    content.push({ type: 'text', text: prepared.length > 1 ? 'これらは同じ座標表を分けて写したものです。順に読み、全部の点を1つの points にまとめてください。' : 'この座標表を読み取ってください。' });
    const stream = client.beta.messages.stream({
        model: AIREAD_MODEL,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default', // 安全の判定で断られたら、別のモデルでやり直す
        system: AIREAD_SYSTEM,
        output_config: { effort: 'high', format: { type: fmt.type, schema: fmt.schema } },
        messages: [{ role: 'user', content }],
    });
    const msg = await stream.finalMessage();
    if(msg.stop_reason === 'refusal') {
        showToast('Claude がこの画像の読み取りを断りました。座標表だけが写るように撮り直してください', { kind: 'warn', ms: 5000 });
        return null;
    }
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    // 別のモデルに替わったときは、替わったあとの答えだけを読む（断ったモデルの書きかけを混ぜない）
    let from = 0;
    blocks.forEach((b, i) => { if(b && b.type === 'fallback') from = i + 1; });
    const text = blocks.slice(from).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
    const truncated = msg.stop_reason === 'max_tokens';
    let out;
    try { const j = JSON.parse(text); const v = Schema.safeParse(j); out = v.success ? v.data : null; } catch { out = null; }
    if(!out) {
        if(truncated) throw new Error('表が長く、答えが途中で切れました。表を分けて撮り、少しずつ読ませてください');
        throw new Error('読み取りの結果を受け取れませんでした。もう一度試してください');
    }
    const u = msg.usage || {};
    const tin = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    return {
        rows: out.points.map((p) => ({ num: _aireadTrim(p.num), name: _aireadTrim(p.name), x: _aireadNumText(p.x), y: _aireadNumText(p.y), z: _aireadNumText(p.z), unsure: !!p.unsure, why: _aireadTrim(p.unsure_reason), use: true })),
        unit: out.unit, notes: _aireadTrim(out.notes),
        cost: tin * AIREAD_PRICE.in + (u.output_tokens || 0) * AIREAD_PRICE.out,
        model: msg.model || AIREAD_MODEL,
        truncated,
    };
}
function _aireadTrim(s) { return String(s === undefined || s === null ? '' : s).trim(); }
// 数の文字: 全角を半角に、マイナスの形をそろえる。カンマは「1,234,567.890」のような桁の区切りのときだけ外す。
// それ以外のカンマ・途中の空白は残す（数として読めないので取り込まない。「.」のつもりの「,」で値が 1000 倍になるのを防ぐ）
function _aireadNumText(s) {
    let t = _aireadTrim(s);
    t = (typeof cogoHalfWidth === 'function') ? cogoHalfWidth(t) : t;
    t = t.replace(/[−ー―‐－]/g, '-').trim();
    if(/^[-+]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(t)) t = t.replace(/,/g, '');
    return t;
}
function _aireadIsNum(s) { return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s); }
function aireadErrorText(err) {
    const st = err && err.status;
    const A = _aireadSdk && _aireadSdk.Anthropic;
    if(st === 401) return 'Claude の API キーが違うか、使えなくなっています（⚙ オプションで入れ直してください）';
    if(st === 403) return 'この API キーでは読み取れません（Console で権限・支払いを確かめてください）';
    if(st === 429) return '使える量の上限に達しました。少し待ってから試してください（または Console で上限・残高を確かめてください）';
    if(st === 413) return '画像・PDF が大きすぎます。枚数を減らすか、小さくしてください';
    if(st && st >= 500) return 'Claude が混み合っています。少し待ってから試してください';
    if((A && A.APIConnectionError && err instanceof A.APIConnectionError) || (!st && /connection|network|fetch/i.test((err && err.message) || ''))) return '通信できませんでした（電波を確かめてください）';
    return `読み取れませんでした: ${(err && err.message) || err}`;
}

// ===== 確かめる表 =====
// 行の値を点にする。X・Y が数でない・標高が書いてあるのに数でない行は null（取り込まない）。mm なら m に直す（標高は zmm のときだけ）
function aireadRowToPoint(r, mm, zmm) {
    if(!_aireadIsNum(r.x) || !_aireadIsNum(r.y)) return null;
    if(r.z !== '' && !_aireadIsNum(r.z)) return null;
    const f = mm ? 1000 : 1, fz = (zmm === undefined ? mm : zmm) ? 1000 : 1;
    const z = r.z !== '' ? parseFloat(r.z) / fz : null;
    return { num: r.num, name: r.name, X: parseFloat(r.x) / f, Y: parseFloat(r.y) / f, z };
}
function _aireadRowState(i) {
    const A = _airead, r = A.rows[i];
    const ng = r.use && !aireadRowToPoint(r, A.mm, A.zmm);
    const bad = (k) => r.use && r[k] !== '' && !_aireadIsNum(r[k]) || (r.use && (k === 'x' || k === 'y') && r[k] === '');
    return { ng, bad };
}
function _aireadRowHtml(r, i) {
    const LBL = { num: '点番号', name: '点名', x: 'X（北）', y: 'Y（東）', z: '標高' };
    const st = _aireadRowState(i);
    const cell = (k) => `<input class="prop-val airead-cell airead-${k}${(k === 'x' || k === 'y' || k === 'z') && st.bad(k) ? ' bad' : ''}" data-row="${i}" data-key="${k}" value="${escapeHtml(r[k])}" placeholder="${LBL[k]}" onchange="aireadEdit(${i}, '${k}', this.value)" aria-label="${i + 1}行目の${LBL[k]}">`;
    let h = `<div class="airead-row${r.unsure ? ' unsure' : ''}${st.ng ? ' ng' : ''}${r.use ? '' : ' off'}" id="airead-row-${i}" role="listitem">`;
    h += `<input type="checkbox" class="airead-use" ${r.use ? 'checked' : ''} onchange="aireadEdit(${i}, 'use', this.checked)" aria-label="${i + 1}行目を取り込む">`;
    h += cell('num') + cell('name') + cell('x') + cell('y') + cell('z');
    if(r.unsure) h += `<div class="airead-why">⚠ ${escapeHtml(r.why || 'Claude が自信の無い行です')} <button class="status-btn airead-ok" onclick="aireadConfirm(${i})" title="元の写真と見比べて、正しいと確かめた">✔ 見比べた</button></div>`;
    return h + '</div>';
}
function _aireadSumHtml() {
    const A = _airead;
    const pts = A.rows.map((r) => (r.use ? aireadRowToPoint(r, A.mm, A.zmm) : null));
    const n = pts.filter(Boolean).length;
    const bad = A.rows.filter((r, i) => r.use && !pts[i]).length;
    const nUnsure = A.rows.filter((r) => r.use && r.unsure).length;
    return { n, html: `取り込む点: <b>${n}点</b>${nUnsure ? `（うち見比べていない、自信の無い行 ${nUnsure}）` : ''}${bad ? `<br><span style="color:#ff6b6b;">X・Y・標高が数でない行 ${bad} は取り込みません（赤い欄を直すか、「入れる」を外してください）</span>` : ''}` };
}
function _aireadRefreshSum() {
    const s = _aireadSumHtml();
    const el = document.getElementById('airead-sum');
    if(el) el.innerHTML = s.html;
    const b = document.getElementById('airead-import');
    if(b) { b.disabled = !s.n; b.textContent = `📥 ${s.n}点を取り込む`; }
}
// 1行だけ描き直す（表全体を描き直すと、スマホでは次に押した欄が消えてキーボードが閉じ、表が先頭に戻るため）
function _aireadRefreshRow(i) {
    const el = document.getElementById(`airead-row-${i}`);
    if(!el || !_airead) return;
    const active = document.activeElement, keepKey = active && active.closest && active.closest(`#airead-row-${i}`) ? active.dataset.key : null;
    const t = document.createElement('div');
    t.innerHTML = _aireadRowHtml(_airead.rows[i], i);
    el.replaceWith(t.firstElementChild);
    if(keepKey) { const n = document.querySelector(`#airead-row-${i} [data-key="${keepKey}"]`); if(n) n.focus(); }
}
function aireadRenderReview() {
    const A = _airead;
    if(!A) return;
    const list0 = document.querySelector('#airead-review .airead-list'), keepScroll = list0 ? list0.scrollTop : 0;
    const imgs = A.files.filter((f) => f.url).map((f, i) => `<img src="${f.url}" alt="${escapeHtml(f.name)}" class="airead-img" data-i="${i}" onclick="this.classList.toggle('big')" title="押すと大きく・小さく">`).join('');
    const sum = _aireadSumHtml();
    let h = `<div id="airead-review" style="display:flex;flex-direction:column;gap:8px;font-size:12px;color:#ddd;">`;
    h += `<div>読み取った <b>${A.rows.length}行</b>。元の写真と見比べて、違う所は直してください。<span class="airead-unsure-key">色の付いた行</span>は Claude が自信の無い行です。見比べて正しければ「✔ 見比べた」を押します。</div>`;
    if(A.notes) h += `<div class="cogo-note">Claude のメモ: ${escapeHtml(A.notes)}</div>`;
    if(A.truncated) h += `<div class="cogo-note" style="color:#ff6b6b;">表が長く、途中までしか読めていないかもしれません。分けて撮って読み直してください。</div>`;
    if(imgs) h += `<div class="airead-imgs">${imgs}</div>`;
    else if(A.files.some((f) => f.kind === 'pdf')) h += `<div class="cogo-note">PDF: ${A.files.map((f) => escapeHtml(f.name)).join('・')}（元の PDF と見比べてください）</div>`;
    // 1点を2段に: 上に 入れる・点番号・点名、下に X・Y・標高（スマホの幅でも横に流れず全部見える）
    h += `<div class="airead-list" role="list"><div class="airead-row airead-head" aria-hidden="true"><span></span><span>点番号</span><span>点名</span><span class="r2">X（北）</span><span class="r2">Y（東）</span><span class="r2">標高</span></div>`;
    A.rows.forEach((r, i) => { h += _aireadRowHtml(r, i); });
    h += `</div>`;
    h += `<label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="airead-mm" ${A.mm ? 'checked' : ''} onchange="aireadSetMm(this.checked)"> 表の X・Y は mm（m に直して取り込む）${A.unit === 'mm' ? '　← Claude は mm と読みました' : ''}</label>`;
    if(A.mm) h += `<label style="display:flex;align-items:center;gap:6px;padding-left:18px;"><input type="checkbox" id="airead-zmm" ${A.zmm ? 'checked' : ''} onchange="aireadSetZmm(this.checked)"> 標高も mm（m に直す）</label>`;
    h += `<div class="cogo-note" id="airead-sum">${sum.html}</div>`;
    h += `<div class="cogo-btns"><button class="prop-btn" id="airead-import" onclick="aireadImport()" ${sum.n ? '' : 'disabled'}>📥 ${sum.n}点を取り込む</button><button class="prop-btn btn-sub" onclick="aireadSwapXY()" title="表が 東・北 の順だったとき">⇄ X と Y を入れ替える</button><button class="prop-btn btn-sub" onclick="aireadRestart()" title="この結果を捨てて、別の写真を読む">📷 別の写真を読む</button><button class="prop-btn btn-sub" onclick="aireadCancel()">やめる</button></div>`;
    h += `<div style="color:#888;font-size:10px;">今回の読み取りの料金の目安: 約 $${A.cost.toFixed(3)}（${escapeHtml(A.model)}）</div>`;
    h += `</div>`;
    showPropertyPanel('📷 座標表の読み取り結果', h);
    const list = document.querySelector('#airead-review .airead-list');
    if(list && keepScroll) list.scrollTop = keepScroll;
}
window.aireadEdit = function(i, key, v) {
    const r = _airead && _airead.rows[i];
    if(!r) return;
    if(key === 'use') r.use = !!v;
    else if(key === 'x' || key === 'y' || key === 'z') r[key] = _aireadNumText(v);
    else r[key] = _aireadTrim(v);
    // 「自信が無い」の印は、直しても残す（ほかの欄の疑いが確かめられないまま消えないように）。「✔ 見比べた」で外す
    _aireadRefreshRow(i);
    _aireadRefreshSum();
};
window.aireadConfirm = function(i) {
    const r = _airead && _airead.rows[i];
    if(!r) return;
    r.unsure = false;
    _aireadRefreshRow(i);
    _aireadRefreshSum();
};
window.aireadSetMm = function(on) { if(_airead) { _airead.mm = !!on; _airead.zmm = !!on; aireadRenderReview(); } };
window.aireadSetZmm = function(on) { if(_airead) { _airead.zmm = !!on; _aireadRefreshSum(); } };
window.aireadSwapXY = function() {
    if(!_airead) return;
    _airead.rows.forEach((r) => { const t = r.x; r.x = r.y; r.y = t; });
    aireadRenderReview();
};
window.aireadCancel = function() { _airead = null; hidePropertyPanel(); addCommandLog('-> 座標表の読み取りをやめました'); };
window.aireadImport = function() {
    const A = _airead;
    if(!A) return;
    const points = A.rows.map((r) => (r.use ? aireadRowToPoint(r, A.mm, A.zmm) : null)).filter(Boolean);
    if(!points.length) return;
    hidePropertyPanel();
    _prepareImportTarget(() => {
        const r = addSurveyData(points, []);
        if(typeof _importMode === 'undefined' || _importMode !== 'append') setDrawingName('座標表の読み取り');
        _airead = null;
        zoomExtents();
        render();
        const msg = `座標表の読み取り: 測点 ${r.pointCount}点を取り込みました`;
        addCommandLog('-> ' + msg);
        showToast(msg, { kind: 'success', ms: 4000 });
        if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    }, () => aireadRenderReview()); // 置き換え・追加で「やめる」なら、確かめる表に戻る
};

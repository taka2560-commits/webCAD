// ===== Web CAD 図面一式のファイル（.webcad） =====
// cad-webcad.js - 図面（図形・画層・測点・UCS・線種・図面の単位）に、写真・メモの写真、下絵、系番号を加えて、1つのファイルに書き出し・開く。
//   別の端末（PC ⇔ iPad）への引っ越し・控え・同じアプリを使う人に渡すときに使う。DXF では消えるもの（ピンと写真・下絵・図形のまとまり・隠した図形）もそのまま渡る。
//   中身は JSON（写真・下絵の画像は base64）を gzip で縮めたもの（縮められないブラウザでは JSON のまま。開くときはどちらも読める）。
//   開くときは、人から受け取ったファイルでも安全なように、項目の型を確かめる（文字は決まった項目だけ・写真の番号の形・色の形）。

const WEBCAD_FORMAT = 'webcad';
const WEBCAD_VERSION = 1;
const WEBCAD_EXT = '.webcad';
// 図形の項目で、文字のことがあるもの（実物の DWG・DXF とアプリで作る図形から集めた。ほかの項目の文字は捨てる）
const _WC_STR_KEYS = new Set(['type', 'color', 'lt', 'text', 'halign', 'valign', 'hiddenBy', 'gid', 'blockName', 'name', 'num',
    'lotName', 'lotNum', 'subType', 'dimDir', 'textOverride', 'time', 'desc']);
const _WC_TYPES = new Set(['LINE', 'CIRCLE', 'ARC', 'RECTANG', 'PLINE', 'POINT', 'ELLIPSE', 'TEXT', 'DIMENSION', 'HATCH', 'PIN']);
const _WC_PHOTO_KEY = /^[A-Za-z0-9_-]{1,64}$/; // 写真の番号（画面の onclick に入るので、形を確かめる）
const _WC_COLOR = /^#[0-9a-fA-F]{6}$/;
const _WC_IMAGE_MIME = /^image\/(jpeg|png|webp|gif)$/;

// ===== base64・gzip =====
function _wcToB64(buf) {
    const u = new Uint8Array(buf);
    let s = '';
    for(let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
}
function _wcFromB64(s) {
    const b = atob(String(s || ''));
    const u = new Uint8Array(b.length);
    for(let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u.buffer;
}
async function _wcPipe(bytes, stream) {
    const w = stream.writable.getWriter();
    w.write(bytes).catch(() => {}); w.close().catch(() => {});
    const r = stream.readable.getReader(), parts = [];
    let n = 0;
    for(;;) { const { done, value } = await r.read(); if(done) break; parts.push(value); n += value.length; }
    const out = new Uint8Array(n);
    let o = 0;
    parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
}
// 文字 → gzip のバイト列（縮められないブラウザでは UTF-8 のまま）
async function webcadPack(text) {
    const bytes = new TextEncoder().encode(text);
    return (typeof CompressionStream === 'function') ? _wcPipe(bytes, new CompressionStream('gzip')) : bytes;
}
// バイト列 → 文字（先頭が gzip の印なら戻す）
async function webcadUnpack(buf) {
    const u = new Uint8Array(buf);
    if(u.length >= 2 && u[0] === 0x1F && u[1] === 0x8B) {
        if(typeof DecompressionStream !== 'function') throw new Error('このブラウザでは開けません（ブラウザを新しくしてください）');
        return new TextDecoder().decode(await _wcPipe(u, new DecompressionStream('gzip')));
    }
    return new TextDecoder().decode(u);
}

// ===== 書き出し =====
// 図面一式の中身（JSON の文字）。写真はピンが使っているものだけ、下絵は今の下絵
async function buildWebcadDoc() {
    const name = _currentProjectName || String(window._drawingName || '').replace(/\.[A-Za-z0-9]{1,6}$/, '') || '図面';
    const project = _buildSaveData(name);
    const photos = {};
    let missing = 0;
    const keys = new Set();
    entities.forEach(e => { if(e && e.type === 'PIN' && Array.isArray(e.photos)) e.photos.forEach(k => keys.add(k)); });
    for(const key of keys) {
        const r = await photoLoad(key);
        if(r && r.data) photos[key] = { mime: r.mime || 'image/jpeg', w: r.w, h: r.h, name: r.name || '', time: r.time || '', data: _wcToB64(r.data) };
        else missing++;
    }
    const u = (typeof _ul !== 'undefined') ? _ul.img : null;
    const underlay = (u && u.data) ? { mime: u.mime, w: u.w, h: u.h, ow: u.ow || u.w, oh: u.oh || u.h, T: u.T, opacity: u.opacity, on: u.on !== false, name: u.name || '', data: _wcToB64(u.data) } : null;
    const zone = (typeof getGnssZone === 'function') ? getGnssZone() : null;
    const doc = { format: WEBCAD_FORMAT, version: WEBCAD_VERSION, savedAt: new Date().toISOString(), project, photos, underlay, gnssZone: zone };
    return { text: JSON.stringify(doc), name, photoCount: Object.keys(photos).length, missing, hasUnderlay: !!underlay };
}
function _wcSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; }
// ☰「📦 図面一式」・保存一覧の「書き出す」
async function exportWebcadFile() {
    if(!entities.length) { notify('図面が空なので、書き出すものがありません', { kind: 'warn', ms: 3000 }); return; }
    busyStart('図面一式を書き出しています…');
    try {
        await busyPaint();
        const r = await buildWebcadDoc();
        const bytes = await webcadPack(r.text);
        downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), r.name.replace(/[\\/:*?"<>|]/g, '_') + WEBCAD_EXT);
        notify(`-> 図面一式を書き出しました（${r.name}${WEBCAD_EXT}: 図形 ${entities.length}・写真 ${r.photoCount}枚${r.hasUnderlay ? '・下絵' : ''}、${_wcSize(bytes.length)}）`, { kind: 'success', ms: 3500 });
        if(r.missing) addCommandLog(`  注意: この端末に見つからない写真 ${r.missing}枚 は入れていません`);
    } catch(err) {
        notify(`エラー: 図面一式を書き出せませんでした - ${err.message}`, { kind: 'error', ms: 5000 });
        console.error('図面一式の書き出しエラー:', err);
    } finally { busyEnd(); }
}

// ===== 開く: 中身を確かめる =====
// 値を、項目の型に合うものだけにする（文字は決まった項目だけ。数は有限。__proto__ などは捨てる）
function _wcClean(v, key, depth) {
    if(depth > 12) return undefined;
    if(v === null || typeof v === 'boolean') return v;
    if(typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if(typeof v === 'string') return _WC_STR_KEYS.has(key) ? v.slice(0, 100000) : undefined;
    if(Array.isArray(v)) {
        const out = [];
        v.forEach(x => { const c = _wcClean(x, key, depth + 1); if(c !== undefined) out.push(c); });
        return out;
    }
    if(typeof v === 'object') {
        const out = {};
        Object.keys(v).forEach(k => {
            if(k === '__proto__' || k === 'constructor' || k === 'prototype') return;
            const c = _wcClean(v[k], k, depth + 1);
            if(c !== undefined) out[k] = c;
        });
        return out;
    }
    return undefined;
}
// 図面の中身（_buildSaveData の形）を確かめて、使える形にする
function sanitizeWebcadProject(p) {
    const str = (s, max) => (typeof s === 'string') ? s.slice(0, max || 200) : '';
    const num = (v, d) => (typeof v === 'number' && Number.isFinite(v)) ? v : d;
    const lay = (Array.isArray(p.layers) ? p.layers : []).map(l => _wcClean(l, '', 0)).filter(l => l && typeof l === 'object' && !Array.isArray(l));
    lay.forEach((l, i) => {
        if(typeof l.name !== 'string' || !l.name) l.name = i ? `画層${i}` : '0';
        if(!_WC_COLOR.test(l.color || '')) l.color = '#ffffff';
    });
    if(!lay.length) lay.push({ name: '0', color: '#ffffff', visible: true });
    const ents = [];
    (Array.isArray(p.entities) ? p.entities : []).forEach(e0 => {
        const e = _wcClean(e0, '', 0);
        if(!e || typeof e !== 'object' || Array.isArray(e) || !_WC_TYPES.has(e.type)) return;
        delete e.bbox; delete e._hits;
        if(typeof e.id !== 'number') delete e.id;
        e.layer = (Number.isInteger(e.layer) && e.layer >= 0 && e.layer < lay.length) ? e.layer : 0;
        if(e.color !== undefined && e.color !== null && !_WC_COLOR.test(e.color)) delete e.color;
        if(e.type === 'PIN') {
            e.photos = (Array.isArray(e0.photos) ? e0.photos : []).filter(k => typeof k === 'string' && _WC_PHOTO_KEY.test(k));
            e.x = num(e.x, 0); e.y = num(e.y, 0);
        }
        if(e.type === 'HATCH' && (!e.target || typeof e.target !== 'object' || !_WC_TYPES.has(e.target.type))) return;
        ents.push(e);
    });
    const ucs = _wcClean(p.ucs, '', 0) || {};
    const lineTypes = {};
    if(p.lineTypes && typeof p.lineTypes === 'object') Object.keys(p.lineTypes).slice(0, 500).forEach(k => {
        if(k === '__proto__' || k === 'constructor' || k === 'prototype') return;
        const t = _wcClean(p.lineTypes[k], '', 0);
        if(t && typeof t === 'object' && !Array.isArray(t)) lineTypes[k.slice(0, 200)] = t;
    });
    return {
        name: str(p.name) || '図面', drawingName: str(p.drawingName) || null,
        entities: ents, layers: lay,
        currentLayerIndex: (Number.isInteger(p.currentLayerIndex) && p.currentLayerIndex >= 0 && p.currentLayerIndex < lay.length) ? p.currentLayerIndex : 0,
        view: { x: num(p.view && p.view.x, 0), y: num(p.view && p.view.y, 0), scale: num(p.view && p.view.scale, 1) || 1, rotation: num(p.view && p.view.rotation, 0) },
        ucs: { originX: num(ucs.originX, 0), originY: num(ucs.originY, 0), angle: num(ucs.angle, 0) },
        savedUCSList: (Array.isArray(p.savedUCSList) ? p.savedUCSList : []).map(u => _wcClean(u, '', 0))
            .filter(u => u && typeof u === 'object' && typeof u.name === 'string').map(u => ({ name: u.name.slice(0, 100), originX: num(u.originX, 0), originY: num(u.originY, 0), angle: num(u.angle, 0) })),
        surveyUnit: (p.surveyUnit === 'm' || p.surveyUnit === 'mm') ? p.surveyUnit : undefined,
        lineTypes, ltscale: num(p.ltscale, 0) > 0 ? p.ltscale : null,
    };
}
// 画像（写真・下絵）の記録を確かめる。使えなければ null
function _wcImage(r) {
    if(!r || typeof r !== 'object' || typeof r.data !== 'string') return null;
    let data;
    try { data = _wcFromB64(r.data); } catch { return null; }
    const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : 1;
    return { mime: _WC_IMAGE_MIME.test(r.mime || '') ? r.mime : 'image/jpeg', w: n(r.w), h: n(r.h), name: typeof r.name === 'string' ? r.name.slice(0, 200) : '', data };
}
// ファイルの中身（バイト列）→ 開ける形 { project, photos, underlay, gnssZone, newer }
async function parseWebcadBytes(buf) {
    let doc;
    try { doc = JSON.parse(await webcadUnpack(buf)); } catch(e) {
        if(/ブラウザ/.test(e.message)) throw e;
        throw new Error('図面一式のファイル（.webcad）ではないか、壊れています', { cause: e });
    }
    if(!doc || typeof doc !== 'object' || doc.format !== WEBCAD_FORMAT || !doc.project || typeof doc.project !== 'object') throw new Error('図面一式のファイル（.webcad）ではありません');
    const photos = {};
    if(doc.photos && typeof doc.photos === 'object') Object.keys(doc.photos).forEach(k => {
        if(!_WC_PHOTO_KEY.test(k)) return;
        const r = _wcImage(doc.photos[k]);
        if(r) photos[k] = Object.assign(r, { time: typeof doc.photos[k].time === 'string' ? doc.photos[k].time.slice(0, 40) : '' });
    });
    let underlay = null;
    const u = doc.underlay && _wcImage(doc.underlay);
    if(u) {
        const T = Array.isArray(doc.underlay.T) && doc.underlay.T.length === 6 && doc.underlay.T.every(v => typeof v === 'number' && Number.isFinite(v)) ? doc.underlay.T : null;
        const op = doc.underlay.opacity;
        const dim = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : d; // 縮める前の大きさ（ワールドファイルで合わせ直すとき）
        underlay = Object.assign(u, { T, opacity: (typeof op === 'number' && op >= 0 && op <= 1) ? op : 0.6, on: doc.underlay.on !== false, ow: dim(doc.underlay.ow, u.w), oh: dim(doc.underlay.oh, u.h) });
    }
    const z = doc.gnssZone;
    return { project: sanitizeWebcadProject(doc.project), photos, underlay, gnssZone: (Number.isInteger(z) && z >= 1 && z <= 19) ? z : null, newer: Number(doc.version) > WEBCAD_VERSION };
}

// ===== 開く =====
// 中身を図面にする（写真を端末に入れ、下絵・系番号も合わせる）
async function applyWebcadDoc(d, fileName) {
    for(const k of Object.keys(d.photos)) await photoSave(k, d.photos[k]);
    if(d.underlay) {
        if(!d.underlay.T) d.underlay.T = ulFitTransform(d.underlay.w, d.underlay.h);
        await _dbPut(STORE_AUTOSAVE, UL_DB_KEY, d.underlay);
        await ulRestore();
    }
    if(d.gnssZone && typeof getGnssZone === 'function' && getGnssZone() !== d.gnssZone && typeof window.setGnssZone === 'function') window.setGnssZone(d.gnssZone);
    applyProjectData(d.project);
    // 保存一覧の同じ名前の図面を上書きしないよう、名前は付けずに開く（💾保存で名前を付ける）
    window.setCurrentProjectName(null);
    if(typeof setDrawingName === 'function') setDrawingName(d.project.drawingName || String(fileName || '').replace(/\.webcad$/i, '') || d.project.name);
    if(typeof zoomExtents === 'function') zoomExtents(); // 別の端末では画面の大きさが違う
    if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if(typeof render === 'function') render();
}
async function loadWebcadFile(file) {
    let d;
    try { d = await parseWebcadBytes(await file.arrayBuffer()); } catch(err) {
        notify(`エラー: ${file.name} を開けませんでした - ${err.message}`, { kind: 'error', ms: 5000 });
        return false;
    }
    const warn = (typeof _hasUnsavedProjectChanges === 'function' && _hasUnsavedProjectChanges())
        ? '\n\n⚠ 今の図面には、名前を付けて保存していない変更があります。開くと失われます（必要なら先に「保存」してください）。' : '';
    const n = Object.keys(d.photos).length;
    const what = `図形 ${d.project.entities.length}${n ? `・写真 ${n}枚` : ''}${d.underlay ? '・下絵' : ''}`;
    if(!(await cadConfirm({ title: '図面一式を開く', message: `「${file.name}」（${what}）を開きますか？${d.underlay ? '\n（今の下絵は、このファイルの下絵に変わります）' : ''}${warn}`, ok: '開く', danger: !!warn }))) return false;
    busyStart('図面一式を開いています…');
    try {
        await busyPaint();
        await applyWebcadDoc(d, file.name);
        notify(`-> 図面一式を開きました: ${file.name}（${what}）`, { kind: 'success', ms: 3000 });
        if(d.newer) addCommandLog('  注意: 新しい版のアプリで作ったファイルです。この版で分からない項目は読み飛ばしました');
        return true;
    } catch(err) {
        notify(`エラー: ${file.name} を開けませんでした - ${err.message}`, { kind: 'error', ms: 5000 });
        console.error('図面一式の読み込みエラー:', err);
        return false;
    } finally { busyEnd(); }
}
// 保存一覧の「📂 一式のファイルを開く」
function pickWebcadFile() {
    const inp = document.createElement('input');
    inp.type = 'file';
    const accept = (typeof fileAcceptFor === 'function') ? fileAcceptFor(WEBCAD_EXT) : WEBCAD_EXT; // iPhone・iPad は指定しない（灰色で選べなくなる）
    if(accept) inp.accept = accept;
    inp.onchange = () => { const f = inp.files && inp.files[0]; if(f) { if(typeof hideProjectList === 'function') hideProjectList(); loadWebcadFile(f); } };
    inp.click();
}

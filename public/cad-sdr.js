// ===== Web CAD トータルステーション連携: SDR 形式 =====
// cad-sdr.js - ソキアの SDR 形式（SDR33・SDR2x）の読み書き。画面（📡 TS連携パネル・通信）は cad-ts.js。
//   読み込み: 器械点（02）・目標高（03）・縮尺係数（06）・後視（07）・既知点（08）・観測（09 F1/F2/MD/MC）・
//             縮小値（11）を読み、観測は測量計算（cad-cogo.js）で座標に直す。
//   書き出し: 測点を SDR33 の座標（08KI）で書く（USB メモリや「通信入力」で機械の既知点・杭打ち点にする）。
//   通信: 「通信出力」は STX CR LF・記録・ETX＋チェックサム CR LF（チェックサム＝記録の文字コードの和 mod 65536、5桁）。
// 仕様: Sokkia「Interfacing with the SOKKIA SDR Electronic Field Book」（1999）3章。
//   記録の1〜2文字目が種類、3〜4文字目が由来コード（KI＝手入力、TP＝観測から、F1・F2＝正・反、MC＝補正済みの平均 など）。
//   SDR33 は点名 16桁（14文字）・数値 16桁、SDR2x は点番号 4桁・数値 10桁。座標の欄は北（N）→東（E）→標高。

// 欄の位置（0 始まり [開始, 終了)）
const SDR_LAYOUT = {
    33: {
        '02': { id: [4, 20], N: [20, 36], E: [36, 52], Z: [52, 68], ih: [68, 84], desc: [84, 100] },
        '03': { th: [4, 20] },
        '06': { sf: [4, 20] },
        '07': { from: [4, 20], to: [20, 36], az: [36, 52], h: [52, 68] },
        '08': { id: [4, 20], N: [20, 36], E: [36, 52], Z: [52, 68], desc: [68, 84] },
        '09': { from: [4, 20], to: [20, 36], sd: [36, 52], v: [52, 68], h: [68, 84], desc: [84, 100] },
        '11': { from: [4, 20], to: [20, 36], az: [36, 52], hd: [52, 68], vd: [68, 84], desc: [84, 100] },
    },
    20: {
        '02': { id: [4, 8], N: [8, 18], E: [18, 28], Z: [28, 38], ih: [38, 48], desc: [48, 64] },
        '03': { th: [4, 14] },
        '06': { sf: [4, 14] },
        '07': { from: [4, 8], to: [8, 12], az: [12, 22], h: [22, 32] },
        '08': { id: [4, 8], N: [8, 18], E: [18, 28], Z: [28, 38], desc: [38, 54] },
        '09': { from: [4, 8], to: [8, 12], sd: [12, 22], v: [22, 32], h: [32, 42], desc: [42, 58] },
        '11': { from: [4, 8], to: [8, 12], az: [12, 22], hd: [22, 32], vd: [32, 42], desc: [42, 58] },
    },
};
const SDR_ANGLE_TO_DEG = { '1': 1, '2': 0.9, '3': 360 / 6400 }; // 度・グラード（gon）・ミル
const SDR_DIST_TO_M = { '1': 1, '2': 0.3048 };                  // m・フィート（13DU3 の US フィートは別に扱う）

function _sdrField(line, pos) { return pos ? line.slice(pos[0], pos[1]).trim() : ''; }
// 数値の欄（空は null）
function _sdrReal(line, pos) {
    const s = _sdrField(line, pos);
    if(!s) return null;
    const v = parseFloat(s);
    return isFinite(v) ? v : null;
}

/**
 * SDR を1行ずつ読む（ファイルでも通信でも同じ）。
 * feed(行) で読み進め、result に器械点・点・注意を集める。点は測量座標（X＝北・Y＝東・m）。
 * 同じ点名が何度も出たときは、後のものを使う（SDR の決まり: 新しい座標ほど正しい）。
 */
function sdrParser() {
    const R = {
        format: 0, version: '', job: '', angleUnit: '1', distUnit: '1', vOption: '1',
        stations: [], points: new Map(), obsCount: 0, posCount: 0, warnings: [], checksum: null, lines: 0,
    };
    let fmt = 0, sf = 1, st = null, oc = null, th = 0, dataSum = 0, inFrame = false;
    const warnOnce = new Set();
    const warn = (key, msg) => { if(!warnOnce.has(key)) { warnOnce.add(key); R.warnings.push(msg); } };
    const ang = (v) => v === null ? null : v * (SDR_ANGLE_TO_DEG[R.angleUnit] || 1);
    const dst = (v) => v === null ? null : v * (R.distUnit === 'US' ? 1200 / 3937 : (SDR_DIST_TO_M[R.distUnit] || 1));
    const put = (id, X, Y, Z, desc, src) => {
        if(!id || !isFinite(X) || !isFinite(Y)) return;
        R.points.delete(id); // 後から出た座標を、並びの最後にする
        R.points.set(id, { id, X, Y, Z: (Z === null || Z === undefined || !isFinite(Z)) ? null : Z, desc: desc || '', src });
    };
    // 書式（SDR33 か SDR2x か）: 見出しの版で決まる。見出しが無ければ既知点・器械点の記録から推し量る
    const guessFormat = (line) => {
        if(fmt) return fmt;
        const t = line.slice(0, 2);
        if(t === '02' || t === '08') fmt = /^\d{4}$/.test(line.slice(4, 8)) && isFinite(parseFloat(line.slice(8, 18))) ? 20 : 33;
        else if(t === '09' || t === '07' || t === '11') fmt = /^\d{4}\d{4}/.test(line.slice(4, 12)) ? 20 : 33;
        if(fmt && !R.format) { R.format = fmt; warn('nohdr', '見出し（00）が無いため、書式を ' + (fmt === 33 ? 'SDR33' : 'SDR2x') + ' と見なしました'); }
        return fmt;
    };
    // 観測の点の座標（器械点・向き・目標高から）
    const reduce = (o, deriv) => {
        if(!st) { warn('nost', '器械点（02）より前の観測は計算できません'); return; }
        if(o.sd === null) return; // 角度だけの観測（後視など）
        let z = o.v, h = o.h;
        if(z === null) { warn('nov', '鉛直角の無い観測は、水平として計算しました'); z = 90; }
        if(deriv === 'F2') {
            if(R.vOption === '1') z = 360 - z; // 反の天頂角 → 正
            if(h !== null) h = cogoNormDeg(h - 180);
        } else if(deriv !== 'MC' && R.vOption === '2') z = 90 - z; // 高低角 → 天頂角
        let az;
        if(deriv === 'MC') az = h; // 補正済みの記録は方向角
        else {
            if(oc === null) { warn('nobs', '後視（07）が無い器械点では、水平角をそのまま方向角として計算しました'); }
            az = (h === null ? 0 : h) + (oc || 0);
        }
        const zr = z * Math.PI / 180;
        const hd = o.sd * Math.sin(zr) * sf, vd = o.sd * Math.cos(zr);
        const p = cogoPolar({ X: st.X, Y: st.Y }, az, hd);
        const Z = (st.Z === null) ? null : st.Z + (st.ih || 0) + vd - (th || 0);
        put(o.to, p.X, p.Y, Z, o.desc, 'obs');
        R.obsCount++;
    };
    function feed(raw) {
        let line = String(raw).replace(/[\r\n]+$/, '');
        if(!line) return;
        // 通信の枠（STX・ETX）
        if(line.charCodeAt(0) === 2) { inFrame = true; dataSum = 0; line = line.slice(1); if(!line) return; }
        if(line.charCodeAt(0) === 3) {
            const m = /^(\d{5})/.exec(line.slice(1));
            if(m) R.checksum = { expected: parseInt(m[1], 10), actual: dataSum % 65536, ok: parseInt(m[1], 10) === 0 || parseInt(m[1], 10) === dataSum % 65536 };
            inFrame = false;
            return;
        }
        if(inFrame) for(let i = 0; i < line.length; i++) dataSum += line.charCodeAt(i);
        R.lines++;
        const t = line.slice(0, 2), d = line.slice(2, 4);
        if(!/^\d\d$/.test(t)) return;
        if(t === '00') {
            R.version = _sdrField(line, [4, 20]);
            fmt = R.format = /SDR33/i.test(R.version) ? 33 : 20;
            if(line.length > 40) R.angleUnit = line[40] || '1';
            if(line.length > 41) R.distUnit = line[41] || '1';
            if(R.angleUnit !== '1') warn('ang', '角度の単位が度ではありません（' + (R.angleUnit === '2' ? 'グラード' : 'ミル') + '）。度に直して計算しました');
            if(R.distUnit === '2') warn('ft', '距離の単位がフィートです。m に直しました');
            return;
        }
        if(t === '13') { // 注記。「13DU3」は US フィート
            if(d === 'DU' && line[4] === '3') { R.distUnit = 'US'; warn('usft', '距離の単位が US フィートです。m に直しました'); }
            return;
        }
        if(t === '10') { R.job = _sdrField(line, [4, 20]); return; }
        if(t === '01') { if(line.length > 50 && (line[50] === '1' || line[50] === '2')) R.vOption = line[50]; return; }
        const L = SDR_LAYOUT[guessFormat(line) || 33][t];
        if(!L) return; // 使わない記録（大気・放射・路線など）
        if(t === '02') {
            const id = _sdrField(line, L.id), N = dst(_sdrReal(line, L.N)), E = dst(_sdrReal(line, L.E));
            st = { id, X: N, Y: E, Z: dst(_sdrReal(line, L.Z)), ih: dst(_sdrReal(line, L.ih)) || 0, desc: _sdrField(line, L.desc) };
            oc = null;
            if(N === null || E === null) {
                // 座標の無い器械点は、同じ点名の既知点を使う
                const k = R.points.get(id);
                if(k) { st.X = k.X; st.Y = k.Y; if(st.Z === null) st.Z = k.Z; } else { warn('stxy:' + id, `器械点 ${id} の座標がありません`); st = null; return; }
            }
            R.stations.push({ id, X: st.X, Y: st.Y, Z: st.Z, ih: st.ih });
            put(id, st.X, st.Y, st.Z, st.desc, 'stn');
            return;
        }
        if(t === '03') { th = dst(_sdrReal(line, L.th)) || 0; return; }
        if(t === '06') { const v = _sdrReal(line, L.sf); sf = (v && v > 0) ? v : 1; return; }
        if(t === '07') {
            if(!st) return;
            let az = ang(_sdrReal(line, L.az));
            const hr = ang(_sdrReal(line, L.h)), to = _sdrField(line, L.to);
            if(az === null) { const k = R.points.get(to); if(k) az = cogoInverse(st, k).az; }
            if(az === null) { warn('bsaz:' + st.id, `器械点 ${st.id} の後視の方向角が分かりません`); return; }
            oc = az - (hr || 0);
            return;
        }
        if(t === '08') {
            const N = dst(_sdrReal(line, L.N)), E = dst(_sdrReal(line, L.E));
            if(N === null || E === null) return;
            put(_sdrField(line, L.id), N, E, dst(_sdrReal(line, L.Z)), _sdrField(line, L.desc), 'pos');
            R.posCount++;
            return;
        }
        if(t === '09') {
            reduce({ from: _sdrField(line, L.from), to: _sdrField(line, L.to), sd: dst(_sdrReal(line, L.sd)), v: ang(_sdrReal(line, L.v)), h: ang(_sdrReal(line, L.h)), desc: _sdrField(line, L.desc) }, d);
            return;
        }
        if(t === '11') {
            const from = _sdrField(line, L.from), to = _sdrField(line, L.to), az = ang(_sdrReal(line, L.az)), hd = dst(_sdrReal(line, L.hd)), vd = dst(_sdrReal(line, L.vd));
            const s = (st && st.id === from) ? st : R.points.get(from);
            if(!s || az === null || hd === null) return;
            const p = cogoPolar(s, az, hd * sf);
            put(to, p.X, p.Y, (s.Z === null || s.Z === undefined || vd === null) ? null : s.Z + vd, _sdrField(line, L.desc), 'red');
            R.obsCount++;
        }
    }
    return { feed, result: R };
}
// SDR の文字列を読む。点は並び順の配列にして返す
function parseSdr(text) {
    const p = sdrParser();
    String(text || '').split(/\r\n|\r|\n/).forEach(p.feed);
    const R = p.result;
    return Object.assign({}, R, { points: [...R.points.values()] });
}

// ===== 書き出し（SDR33） =====
// 数値の欄: 左詰め・右を空白で埋める。入りきらなければ小数の桁を減らす（仕様どおり丸めて入れる）
function sdrRealField(v, width) {
    if(v === null || v === undefined || !isFinite(v)) return ' '.repeat(width);
    for(let dp = 8; dp >= 0; dp--) {
        let s = v.toFixed(dp);
        if(/^-0(\.0*)?$/.test(s)) s = s.slice(1);
        if(s.length <= width) return s.padEnd(width);
    }
    return String(Math.round(v)).slice(0, width).padEnd(width);
}
// 文字の欄: 0x20〜0x7E の文字だけ。左詰めで右を空白で埋める
function sdrAlphaField(s, width, maxLen) {
    return String(s === undefined || s === null ? '' : s).replace(/[^\x20-\x7e]/g, '').slice(0, maxLen || width).padEnd(width);
}
// SDR の点名に使えるか（英数字・記号 14文字まで）
function sdrValidId(s) { return /^[\x21-\x7e][\x20-\x7e]{0,13}$/.test(String(s || '')) && String(s).trim() === String(s); }
// 日付の欄「25-Sep-26 12:34 」
function _sdrDate(d) {
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(d.getDate())}-${M[d.getMonth()]}-${p2(d.getFullYear() % 100)} ${p2(d.getHours())}:${p2(d.getMinutes())}`.padEnd(16);
}
/**
 * 測点を SDR33 の記録（見出し・現場・既知点 08KI）にする。
 * points: [{ id, X, Y, Z, desc }]（測量座標・m）。点名が SDR で使えないもの（日本語など）は「P番号」に置き換える。
 * 戻り値: { lines: [...], renamed: [{ from, to }] }
 */
function buildSdr33Records(points, opt) {
    const o = opt || {};
    const lines = [];
    // 見出し: 版・機械番号・日時・角度（度）・距離（m）・気圧（mbar）・温度（℃）・座標の順（N-E-標高）・角度の向き
    lines.push('00NM' + sdrAlphaField('SDR33 V04-04.02', 16) + '0000' + _sdrDate(o.date || new Date()) + '1' + '1' + '3' + '1' + '1' + '1');
    // 現場: 名前・点名の長さ（14）・標高あり・大気補正なし・両差補正なし・屈折係数 0.14・海面補正なし
    lines.push('10NM' + sdrAlphaField(o.job || 'WEBCAD', 16) + '1' + '2' + '1' + '1' + '1' + '1');
    const used = new Set(), renamed = [];
    let n = 0;
    const nextId = () => { let s; do { n++; s = 'P' + String(n).padStart(4, '0'); } while(used.has(s)); return s; };
    points.forEach((p) => {
        let id = String(p.id || '').trim();
        if(!sdrValidId(id) || used.has(id)) { const to = nextId(); renamed.push({ from: id, to }); id = to; }
        used.add(id);
        lines.push('08KI' + sdrAlphaField(id, 16, 14) + sdrRealField(p.X, 16) + sdrRealField(p.Y, 16) + sdrRealField(p.Z, 16) + sdrAlphaField(p.desc, 16));
    });
    return { lines, renamed };
}
// チェックサム（記録の文字コードの和 mod 65536。CR・LF・STX・ETX は含めない）
function sdrChecksum(lines) {
    let s = 0;
    lines.forEach((l) => { for(let i = 0; i < l.length; i++) s += l.charCodeAt(i); });
    return s % 65536;
}
// ファイル（USB メモリなど）: 記録を CR LF でつなぐ
function sdrFileText(lines) { return lines.join('\r\n') + '\r\n'; }
// 通信（通信入力へ送る）: STX CR LF・記録・ETX＋チェックサム5桁 CR LF
function sdrCommsText(lines) {
    return '\x02\r\n' + lines.join('\r\n') + '\r\n\x03' + String(sdrChecksum(lines)).padStart(5, '0') + '\r\n';
}

// ===== 図面との受け渡し =====
// 図面の測点 → SDR33 の点（座標一覧と同じ集め方。点名が無ければ番号）
function sdrPointsFromDrawing(onlyIdx) {
    const src = collectSurveyPoints().filter((p) => !onlyIdx || onlyIdx.has(p.idx));
    return src.map((p, i) => { const s = wcsToSurvey(p.x, p.y); return { id: p.name || String(p.num || '') || ('P' + (i + 1)), X: s.X, Y: s.Y, Z: p.z }; });
}
// 読んだ点を図面の測点にする（点名＝SDR の点名）。戻り値は追加した点の数
function sdrAddToDrawing(parsed) {
    const pts = parsed.points.map((p) => ({ num: '', name: p.id, X: p.X, Y: p.Y, z: p.Z }));
    if(!pts.length) return 0;
    return addSurveyData(pts, []).pointCount;
}
async function loadSdrFile(file) {
    addCommandLog(`SDRファイルを読み込み中: ${file.name}...`);
    try {
        const dec = await _readTextFile(file);
        const r = parseSdr(dec.text);
        if(!r.points.length) {
            addCommandLog('注意: 座標・観測の記録（02・08・09）が見つかりませんでした');
            if(typeof showToast === 'function') showToast('SDR ファイルに点の記録（器械点・既知点・観測）が見つかりませんでした', 5000);
            return null;
        }
        const n = sdrAddToDrawing(r);
        setDrawingName(file.name);
        zoomExtents();
        render();
        const msg = `SDR読み込み（${r.format === 20 ? 'SDR2x' : 'SDR33'}）: 測点 ${n}点` + (r.obsCount ? `（観測から計算 ${r.obsCount}件・器械点 ${r.stations.length}）` : '') +
            (r.checksum && !r.checksum.ok ? '\n⚠ チェックサムが合いません（受信の途中で文字が欠けた可能性があります）' : '') +
            (r.warnings.length ? '\n' + r.warnings.join('\n') : '');
        addCommandLog('-> ' + msg.replace(/\n/g, ' '));
        if(typeof showToast === 'function') showToast(msg, 6000);
        if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
        return r;
    } catch(err) {
        addCommandLog(`エラー: SDRファイルの読み込みに失敗 - ${err.message}`);
        if(typeof reportImportFailure === 'function') reportImportFailure('SDR', file.name, err);
        return null;
    }
}
// 測点を SDR33 ファイルで書き出す（機械の USB メモリへ入れて既知点・杭打ち点に）
window.exportSdr33 = function() {
    const pts = sdrPointsFromDrawing();
    if(!pts.length) { if(typeof showToast === 'function') showToast('出力できる測点がありません（点・属性付きブロック）', 4000); return; }
    const r = buildSdr33Records(pts, { job: _baseName().replace(/[^\x20-\x7e]/g, '').slice(0, 16) || 'WEBCAD' });
    downloadBlob(new Blob([sdrFileText(r.lines)], { type: 'text/plain' }), _baseName() + '.sdr');
    const note = r.renamed.length ? `（点名を使えない ${r.renamed.length}点は P0001 などにしました）` : '';
    addCommandLog(`-> SDR33出力: 測点 ${pts.length}点${note}`);
    if(typeof showToast === 'function') showToast(`SDR33出力: 測点 ${pts.length}点${note ? '\n' + note : ''}`, 4000);
};

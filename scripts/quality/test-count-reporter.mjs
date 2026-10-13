// node --test の報告を受けて、テストの件数（describe の束を除いた it の数）を .quality/test-count.json に書く。
// 品質のチェック（scripts/quality/check.mjs）が README の「自動テスト（N件）」と照らす。
import fs from 'node:fs';
import path from 'node:path';

export default async function* countReporter(source) {
    let pass = 0, fail = 0, skip = 0;
    for await (const ev of source) {
        if (ev.type !== 'test:pass' && ev.type !== 'test:fail') continue;
        const d = ev.data || {};
        if (d.details && d.details.type === 'suite') continue;
        if (d.skip || d.todo) { skip++; continue; }
        if (ev.type === 'test:pass') pass++; else fail++;
    }
    const out = path.resolve('.quality/test-count.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ tests: pass + fail, pass, fail, skip, at: new Date().toISOString() }) + '\n');
    yield '';
}

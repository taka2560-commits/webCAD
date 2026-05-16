import { readFileSync } from 'fs';
import { LibreDwg } from 'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.6.6/dist/libredwg-web.js';

async function test() {
    const fileBytes = readFileSync('20260317_神鋼灘浜棒鋼加工工場6ヤードクレーンレール３Dスキャナー計測.dwg');
    const libredwg = await LibreDwg.create('https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.6.6/wasm');
    const dwg = libredwg.dwg_read_data(fileBytes, 0);
    const db = libredwg.convert(dwg);
    libredwg.dwg_free(dwg);

    const ellipses = db.entities.filter(e => e.type === 'ELLIPSE');
    console.log("Ellipses count:", ellipses.length);
    if (ellipses.length > 0) {
        console.log(ellipses[0]);
    }
    const blocks = Object.values(db.tables.BLOCK_RECORD.entries);
    for (const b of blocks) {
        if (b.entities) {
            const blockEllipses = b.entities.filter(e => e.type === 'ELLIPSE');
            if (blockEllipses.length > 0) {
                console.log(`Ellipses in block ${b.name}:`, blockEllipses.length);
                console.log(blockEllipses[0]);
                break;
            }
        }
    }
}
test().catch(console.error);

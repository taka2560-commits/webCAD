'use strict';
// 自動保存・プロジェクト保存（IndexedDB）のテスト。IndexedDB は fake-indexeddb で再現する。
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('自動保存・プロジェクト保存', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    beforeEach(() => {
        app.window.confirm = () => true;
        app.eval(`
            entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            window.setCurrentProjectName(null);
            setDrawingName('新規図面');
        `);
    });

    const readAutosave = () => app.eval(`_dbGet(STORE_AUTOSAVE, AUTOSAVE_KEY)`);
    const addLine = (x) => app.eval(`saveUndo(); entities.push({ type: 'LINE', layer: 0, x1: ${x}, y1: 0, x2: ${x + 10}, y2: 0 });`);

    it('変更があると未保存になり、flushAutoSave で保存される', async () => {
        addLine(0);
        assert.equal(app.eval('_hasUnsavedChanges()'), true);
        await app.eval('window.flushAutoSave()');
        assert.equal(app.eval('_hasUnsavedChanges()'), false);
        const data = await readAutosave();
        assert.equal(data.entities.length, 1);
        assert.equal(data.entities[0].bbox, undefined, 'bbox は保存しない');
    });

    it('元に戻す/やり直しも自動保存の対象になる', async () => {
        addLine(0);
        addLine(20);
        await app.eval('window.flushAutoSave()');
        app.eval('undo()');
        assert.equal(app.eval('_hasUnsavedChanges()'), true);
        await app.eval('window.flushAutoSave()');
        assert.equal((await readAutosave()).entities.length, 1);
    });

    it('アプリを裏に回した瞬間（visibilitychange=hidden）に保存する', async () => {
        addLine(0);
        app.eval(`setDrawingName('現場A.dxf');`);
        const doc = app.window.document;
        Object.defineProperty(doc, 'visibilityState', { value: 'hidden', configurable: true });
        doc.dispatchEvent(new app.window.Event('visibilitychange'));
        delete doc.visibilityState;
        for (let i = 0; i < 50 && app.eval('_hasUnsavedChanges()'); i++) await new Promise((r) => setTimeout(r, 10));
        const data = await readAutosave();
        assert.equal(data.entities.length, 1);
        assert.equal(data.drawingName, '現場A.dxf');
    });

    it('起動時の復元で図形・プロジェクト名・図面名が戻る', async () => {
        addLine(0);
        app.eval(`window.setCurrentProjectName('測量2026'); setDrawingName('現場B.dxf');`);
        addLine(20);
        await app.eval('window.flushAutoSave()');
        app.eval(`entities.length = 0; window.setCurrentProjectName(null); setDrawingName('新規図面');`);
        let asked = '';
        app.window.confirm = (m) => { asked = m; return true; };
        await app.eval('checkAutoRestore()');
        assert.match(asked, /測量2026/);
        assert.equal(app.eval('entities.length'), 2);
        assert.equal(app.eval('_currentProjectName'), '測量2026');
        assert.equal(app.eval('window._drawingName'), '現場B.dxf');
    });

    it('既に図面を開いている場合は復元しない', async () => {
        addLine(0);
        await app.eval('window.flushAutoSave()');
        let asked = false;
        app.window.confirm = () => { asked = true; return true; };
        await app.eval('checkAutoRestore()');
        assert.equal(asked, false);
        assert.equal(app.eval('entities.length'), 1);
    });

    it('アプリ更新による再読み込みでは確認なしで復元する', async () => {
        addLine(0);
        await app.eval('window.flushAutoSave()');
        app.eval(`entities.length = 0; sessionStorage.setItem('cad_auto_restore', '1');`);
        let asked = false;
        app.window.confirm = () => { asked = true; return false; };
        await app.eval('checkAutoRestore()');
        assert.equal(asked, false);
        assert.equal(app.eval('entities.length'), 1);
        assert.equal(app.eval(`sessionStorage.getItem('cad_auto_restore')`), null);
    });

    it('名前を付けて保存したプロジェクトを一覧から読み込める', async () => {
        addLine(0);
        addLine(20);
        await app.eval(`window.saveProject('道路台帳')`);
        assert.equal(app.eval('_currentProjectName'), '道路台帳');
        app.eval(`entities.length = 0; window.setCurrentProjectName(null);`);
        await app.eval(`window.loadProjectFromList('道路台帳')`);
        assert.equal(app.eval('entities.length'), 2);
        assert.equal(app.eval('_currentProjectName'), '道路台帳');
    });

    it('名前を付けていない変更があるときだけ、読み込み前に失われることを警告する', async () => {
        addLine(0);
        await app.eval(`window.saveProject('P1')`);
        let msg = '';
        app.window.confirm = (m) => { msg = m; return false; };
        await app.eval(`window.loadProjectFromList('P1')`);
        assert.doesNotMatch(msg, /失われます/, '保存直後は警告しない');
        addLine(30);
        await app.eval(`window.loadProjectFromList('P1')`);
        assert.match(msg, /失われます/);
    });

    it('保存に失敗したら（容量不足など）画面に通知する', async () => {
        app.eval(`
            window.__origDbPut = _dbPut;
            _dbPut = () => Promise.reject(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }));
            window.cadErrors.clear();
        `);
        try {
            addLine(0);
            const ok = await app.eval('window.flushAutoSave()');
            assert.equal(ok, false);
            const errs = app.eval('JSON.stringify(window.cadErrors.list())');
            assert.match(errs, /保存容量が不足/);
            assert.equal(app.eval('_hasUnsavedChanges()'), true, '失敗時は未保存のまま');
        } finally {
            app.eval('_dbPut = window.__origDbPut; window.cadErrors.clear(); _autoSaveErrorNotified = false;');
        }
    });

    it('図面の1単位（m / mm）を図面と一緒に保存し、開いたときに戻す（以前の保存データは今の設定のまま）', () => {
        app.eval(`localStorage.setItem('cad_survey_unit', 'mm'); entities.push({ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 1000, y2: 0 });`);
        const data = app.val(`_buildSaveData('mm の図面')`);
        assert.equal(data.surveyUnit, 'mm');
        // 別の図面（m）に切り替えたあと、mm の図面を開くと 1mm に戻る
        app.eval(`localStorage.setItem('cad_survey_unit', 'm')`);
        app.window.__saved = data;
        app.eval(`applyProjectData(window.__saved)`);
        assert.equal(app.eval('getSurveyUnit()'), 'mm');
        // 単位の無い以前の保存データでは変えない
        const old = Object.assign({}, data); delete old.surveyUnit;
        app.window.__old = old;
        app.eval(`localStorage.setItem('cad_survey_unit', 'm'); applyProjectData(window.__old)`);
        assert.equal(app.eval('getSurveyUnit()'), 'm');
        app.eval(`localStorage.removeItem('cad_survey_unit')`);
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});

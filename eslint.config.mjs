import js from "@eslint/js";

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                window: "readonly",
                document: "readonly",
                navigator: "readonly",
                localStorage: "readonly",
                console: "readonly",
                Math: "readonly",
                parseFloat: "readonly",
                parseInt: "readonly",
                isNaN: "readonly",
                Blob: "readonly",
                setTimeout: "readonly",
                // webCAD Global state variables
                layers: "writable",
                currentLayerIndex: "writable",
                entities: "writable",
                view: "writable",
                mouse: "writable",
                ucs: "writable",
                undoStack: "writable",
                redoStack: "writable",
                savedUCSList: "writable",
                cmdState: "writable",
                snapResult: "writable",
                SNAP_R: "readonly",
                ERASE_R: "readonly",
                osnapState: "writable",
                orthoMode: "writable",
                // Core functions often called across files
                addCommandLog: "readonly",
                setPrompt: "readonly",
                render: "readonly",
                saveUndo: "readonly",
                calcBBox: "readonly",
                updateLayerPanel: "readonly",
                updateUCSDropdowns: "readonly",
                zoomExtents: "readonly",
                wcsToUcs: "readonly",
                dimFormat: "readonly",
                initLayers: "readonly",
                setDrawingName: "readonly",
                Drawing: "readonly", // dxf-writer
                DxfParser: "readonly",
                checkAutoRestore: "readonly",
                Promise: "readonly",
                exportDimAsDxf: "readonly",
                Uint8Array: "readonly",
                processIOCommand: "readonly",
                scheduleAutoSave: "readonly",
                processStorageCommand: "readonly",
                // Browser APIs missing
                alert: "readonly",
                confirm: "readonly",
                prompt: "readonly",
                indexedDB: "readonly",
                FileReader: "readonly",
                TextDecoder: "readonly",
                URL: "readonly",
                module: "readonly", // for cad-text-parse.js fallback
                // Browser standard API
                requestAnimationFrame: "readonly",
                clearTimeout: "readonly",
                // cad-core missing variables and functions
                ctx: "readonly",
                wcsToScreen: "readonly",
                hitTestCircleArc: "readonly",
                dist: "readonly",
                hitTestEntity: "readonly",
                setActiveTool: "readonly",
                decodeDxfText: "readonly",
                parseCadText: "readonly",
                decodeDxfBuffer: "readonly",
                // cad-dimension.js functions
                drawAllDimensions: "readonly",
                drawDimRubberBand: "readonly",
                handleDimPointInput: "readonly",
                processDimCommand: "readonly",
                toggleDimContMode: "readonly",
                toggleDimContDir: "readonly",
                populateLayerPanel: "readonly",
                toggleOsnapMain: "readonly",
                toggleOrtho: "readonly",
                getEntityColor: "readonly"
            }
        },
        rules: {
            "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
            "no-undef": "error",
            "no-empty": ["error", { "allowEmptyCatch": true }]
        }
    }
];

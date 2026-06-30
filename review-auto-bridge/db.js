const fs = require('fs');
const path = require('path');
const { createSeedStore } = require('./seed-data');

const STORE_PATH = path.join(__dirname, 'data', 'store.json');

let _cache = null;
let _mtime = null;

function normalizeStore(store) {
    const seeded = createSeedStore();

    return {
        reviews: Array.isArray(store?.reviews) ? store.reviews : seeded.reviews,
        locations: Array.isArray(store?.locations) ? store.locations : seeded.locations,
        approval_queue: Array.isArray(store?.approval_queue) ? store.approval_queue : seeded.approval_queue,
        activity_log: Array.isArray(store?.activity_log) ? store.activity_log : seeded.activity_log,
        scheduler: {
            ...seeded.scheduler,
            ...(store?.scheduler || {}),
        },
        config: {
            ...seeded.config,
            ...(store?.config || {}),
        },
    };
}

function readStore() {
    try {
        const stat = fs.statSync(STORE_PATH);
        if (_cache && _mtime && stat.mtimeMs <= _mtime) {
            return _cache;
        }
        const raw = fs.readFileSync(STORE_PATH, 'utf8');
        _cache = normalizeStore(JSON.parse(raw));
        _mtime = stat.mtimeMs;
        return _cache;
    } catch {
        const seeded = createSeedStore();
        writeStore(seeded);
        return seeded;
    }
}

function writeStore(data) {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const normalized = normalizeStore(data);
    fs.writeFileSync(STORE_PATH, JSON.stringify(normalized, null, 4), 'utf8');
    _cache = normalized;
    _mtime = Date.now();
}

function update(fn) {
    const store = readStore();
    const nextValue = fn(store);
    writeStore(store);
    return nextValue === undefined ? store : nextValue;
}

function log(store, entry) {
    store.activity_log.unshift({ ...entry, ts: new Date().toISOString() });
    if (store.activity_log.length > 200) store.activity_log = store.activity_log.slice(0, 200);
}

module.exports = { readStore, writeStore, update, log };

// Per-store memory layer — brand voice + menu + signature
// JSON-backed, no DB needed.

const fs = require('fs');
const path = require('path');

const MEMORY_PATH = path.join(__dirname, '..', 'data', 'store_memory.json');

const DEFAULT_MEMORY = {
    stores: {
        bakudan_rim: {
            store_id: 'bakudan_rim',
            store_name: 'Bakudan Ramen - The Rim',
            brand_name: 'Bakudan Ramen',
            manager_name_optional: null,
            tone_style: 'friendly, honest, not corporate',
            common_menu_items: ['spicy miso ramen', 'tonkotsu', 'gyoza', 'karaage', 'tonkotsu ramen', 'miso ramen'],
            common_complaints: ['wait time during peak hours', 'parking', 'noise on weekends'],
            reply_signature: 'Bakudan Ramen Team',
            auto_reply_enabled: true,
            approval_required_keywords: ['waited', 'slow', 'rude', 'cold', 'dirty', 'missing'],
            escalation_keywords: ['food poisoning', 'sick', 'lawsuit', 'discriminated', 'roach', 'hair'],
        },
        bakudan_bandera: {
            store_id: 'bakudan_bandera',
            store_name: 'Bakudan Ramen - Bandera',
            brand_name: 'Bakudan Ramen',
            manager_name_optional: null,
            tone_style: 'friendly, honest, not corporate',
            common_menu_items: ['ramen', 'gyoza', 'karaage', 'bento'],
            common_complaints: ['wait', 'parking'],
            reply_signature: 'Bakudan Ramen Team',
            auto_reply_enabled: true,
            approval_required_keywords: ['waited', 'slow', 'rude', 'cold', 'dirty'],
            escalation_keywords: ['food poisoning', 'sick', 'lawsuit'],
        },
        bakudan_stone_oak: {
            store_id: 'bakudan_stone_oak',
            store_name: 'Bakudan Ramen - Stone Oak',
            brand_name: 'Bakudan Ramen',
            tone_style: 'friendly, honest',
            common_menu_items: ['ramen', 'gyoza', 'karaage'],
            common_complaints: ['wait'],
            reply_signature: 'Bakudan Ramen Team',
            auto_reply_enabled: true,
            approval_required_keywords: ['waited', 'rude', 'cold'],
            escalation_keywords: ['food poisoning', 'sick', 'hair'],
        },
        raw_sushi_bistro: {
            store_id: 'raw_sushi_bistro',
            store_name: 'Raw Sushi Bistro',
            brand_name: 'Raw Sushi',
            tone_style: 'warm, casual',
            common_menu_items: ['sushi', 'sashimi', 'spicy tuna roll', 'nigiri'],
            common_complaints: ['price'],
            reply_signature: 'Raw Sushi Team',
            auto_reply_enabled: true,
            approval_required_keywords: ['expensive', 'cold', 'slow'],
            escalation_keywords: ['food poisoning', 'sick', 'lawsuit'],
        },
    },
};

function loadMemory() {
    try {
        if (fs.existsSync(MEMORY_PATH)) {
            const raw = fs.readFileSync(MEMORY_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            return { ...DEFAULT_MEMORY, ...parsed };
        }
    } catch (e) {
        // Fall through to default
    }
    saveMemory(DEFAULT_MEMORY);
    return DEFAULT_MEMORY;
}

function saveMemory(memory) {
    try {
        const dir = path.dirname(MEMORY_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 4), 'utf8');
    } catch (e) {
        // Silent
    }
}

function getStoreMemory(storeId) {
    const mem = loadMemory();
    return mem.stores[storeId] || {
        store_id: storeId,
        store_name: storeId,
        brand_name: storeId,
        tone_style: 'friendly, honest, not corporate',
        common_menu_items: [],
        common_complaints: [],
        reply_signature: `${storeId} Team`,
        auto_reply_enabled: true,
        approval_required_keywords: [],
        escalation_keywords: [],
    };
}

function listStores() {
    const mem = loadMemory();
    return Object.keys(mem.stores).map(k => mem.stores[k].store_name);
}

function upsertStore(storeId, profile) {
    const mem = loadMemory();
    mem.stores[storeId] = { ...mem.stores[storeId], ...profile, store_id: storeId };
    saveMemory(mem);
    return mem.stores[storeId];
}

module.exports = { loadMemory, getStoreMemory, listStores, upsertStore, DEFAULT_MEMORY };
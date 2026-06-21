const fs = require('fs');
const path = require('path');

const LIVE_ROOT = process.cwd();
const GROUP_ID = '120363426386364543@g.us';
const GROUP_NAME = 'LD Agent-Logtest';
const ALLOWED_TEMPLATES = [
  'FoodSafety-Rim-v3',
  'FoodSafety-StoneOak-v3',
  'FoodSafety-Bandera-v3',
];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function abs(rel) {
  return path.join(LIVE_ROOT, rel);
}

function backup(file) {
  const dest = `${file}.bak-dev1-logtest-${stamp}`;
  fs.copyFileSync(file, dest);
  return dest;
}

function patchText(rel, edit) {
  const file = abs(rel);
  let text = fs.readFileSync(file, 'utf8');
  const before = text;
  text = edit(text);
  if (text === before) return { rel, changed: false };
  const backupPath = backup(file);
  fs.writeFileSync(file, text, 'utf8');
  return { rel, changed: true, backupPath };
}

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) {
    if (text.includes(to)) return text;
    throw new Error(`Missing patch target: ${label}`);
  }
  return text.replace(from, to);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setEnvValue(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, line);
  return `${text.replace(/\s+$/g, '')}\n${line}\n`;
}

async function configureDb() {
  const sqlite = require(abs('src/storage/sqlite'));
  const { run, get, all, close } = sqlite;

  await run('CREATE TABLE IF NOT EXISTS group_workflow_config (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL UNIQUE, group_name TEXT, store_id TEXT, store_name TEXT, mi_admin_private_chats TEXT DEFAULT \'\', mi_group_mode TEXT DEFAULT \'mention_only\', agent_group_mode TEXT DEFAULT \'prefix_only\', enabled_workflows TEXT DEFAULT \'food_safety_capture\', active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime(\'now\')), updated_at TEXT DEFAULT (datetime(\'now\')))');
  for (const [col, ddl] of [
    ['group_type', 'TEXT DEFAULT \'production\''],
    ['workflow', 'TEXT DEFAULT \'food_safety_capture\''],
    ['store_resolution_mode', 'TEXT DEFAULT \'group_id\''],
    ['enabled', 'INTEGER DEFAULT 1'],
    ['locked', 'INTEGER DEFAULT 0'],
    ['silent', 'INTEGER DEFAULT 0'],
    ['allowed_templates', 'TEXT DEFAULT \'\''],
  ]) {
    const cols = await all('PRAGMA table_info(group_workflow_config)');
    if (!cols.some(c => c.name === col)) {
      await run(`ALTER TABLE group_workflow_config ADD COLUMN ${col} ${ddl}`);
    }
  }

  await run(
    `INSERT INTO group_workflow_config
      (chat_id, group_name, store_id, store_name, mi_admin_private_chats, mi_group_mode, agent_group_mode,
       enabled_workflows, active, group_type, workflow, store_resolution_mode, enabled, locked, silent, allowed_templates, updated_at)
     VALUES (?, ?, ?, ?, '', 'mention_only', 'prefix_only', 'food_safety_capture', 1,
       'test', 'food_safety_capture', 'form_header', 1, 0, 0, ?, datetime('now'))
     ON CONFLICT(chat_id) DO UPDATE SET
       group_name=excluded.group_name,
       store_id=excluded.store_id,
       store_name=excluded.store_name,
       mi_group_mode=excluded.mi_group_mode,
       agent_group_mode=excluded.agent_group_mode,
       enabled_workflows=excluded.enabled_workflows,
       active=1,
       group_type='test',
       workflow='food_safety_capture',
       store_resolution_mode='form_header',
       enabled=1,
       locked=0,
       silent=0,
       allowed_templates=excluded.allowed_templates,
       updated_at=datetime('now')`,
    [GROUP_ID, GROUP_NAME, 'test', 'Test', JSON.stringify(ALLOWED_TEMPLATES)]
  );

  await run('CREATE TABLE IF NOT EXISTS store_groups (chat_id TEXT PRIMARY KEY, group_name TEXT, store_id TEXT, store_name TEXT, active INTEGER DEFAULT 1, locked INTEGER DEFAULT 0, metadata_json TEXT, created_at TEXT DEFAULT (datetime(\'now\')), updated_at TEXT DEFAULT (datetime(\'now\')))');
  const storeCols = await all('PRAGMA table_info(store_groups)');
  if (!storeCols.some(c => c.name === 'locked')) {
    await run('ALTER TABLE store_groups ADD COLUMN locked INTEGER DEFAULT 0').catch(() => {});
  }
  if (storeCols.some(c => c.name === 'metadata_json')) {
    await run(
      `INSERT INTO store_groups (chat_id, group_name, store_id, store_name, active, locked, metadata_json, updated_at)
       VALUES (?, ?, 'test', 'Test', 1, 0, ?, datetime('now'))
       ON CONFLICT(chat_id) DO UPDATE SET
         group_name=excluded.group_name,
         store_id='test',
         store_name='Test',
         active=1,
         locked=0,
         metadata_json=excluded.metadata_json,
         updated_at=datetime('now')`,
      [GROUP_ID, GROUP_NAME, JSON.stringify({ group_type: 'test', store_resolution_mode: 'form_header' })]
    );
  } else {
    await run(
      `INSERT INTO store_groups (chat_id, group_name, store_id, store_name, active, locked, updated_at)
       VALUES (?, ?, 'test', 'Test', 1, 0, datetime('now'))
       ON CONFLICT(chat_id) DO UPDATE SET
         group_name=excluded.group_name,
         store_id='test',
         store_name='Test',
         active=1,
         locked=0,
         updated_at=datetime('now')`,
      [GROUP_ID, GROUP_NAME]
    );
  }

  await run('CREATE TABLE IF NOT EXISTS whatsapp_group_policies (chat_id TEXT PRIMARY KEY, group_name TEXT, mode TEXT NOT NULL, wake_words_enabled INTEGER DEFAULT 1, bot_workflows TEXT DEFAULT \'\', store_id TEXT DEFAULT \'\', active INTEGER DEFAULT 1, policy_json TEXT, updated_at TEXT DEFAULT (datetime(\'now\')))');
  await run(
    `INSERT INTO whatsapp_group_policies
      (chat_id, group_name, mode, wake_words_enabled, bot_workflows, store_id, active, policy_json, updated_at)
     VALUES (?, ?, 'BOT', 1, 'food_safety_capture', 'test', 1, ?, datetime('now'))
     ON CONFLICT(chat_id) DO UPDATE SET
       group_name=excluded.group_name,
       mode='BOT',
       wake_words_enabled=1,
       bot_workflows='food_safety_capture',
       store_id='test',
       active=1,
       policy_json=excluded.policy_json,
       updated_at=datetime('now')`,
    [GROUP_ID, GROUP_NAME, JSON.stringify({
      source: 'DEV1_P0',
      group_type: 'test',
      workflow: 'food_safety_capture',
      store_resolution_mode: 'form_header',
      silent: false,
      allowed_templates: ALLOWED_TEMPLATES,
    })]
  );

  await run(
    `UPDATE whatsapp_chat_modes
     SET mode='BOT',
         source='stored_policy',
         policy_json=?,
         updated_at=datetime('now')
     WHERE chat_id=?`,
    [JSON.stringify({ mode: 'BOT', source: 'stored_policy', bot_workflows: ['food_safety_capture'] }), GROUP_ID]
  ).catch(() => {});

  const cfg = await get('SELECT * FROM group_workflow_config WHERE chat_id=?', [GROUP_ID]);
  const policy = await get('SELECT * FROM whatsapp_group_policies WHERE chat_id=?', [GROUP_ID]);
  close();
  return { cfg, policy };
}

function patchEnv() {
  return patchText('.env', text => {
    text = setEnvValue(text, 'GROUP_SILENT_MODE', 'false');
    text = setEnvValue(text, 'GROUP_TEXT_COMMANDS_ENABLED', 'true');
    const existing = (text.match(/^FOOD_SAFETY_ENABLED_GROUPS=(.*)$/m) || [])[1] || '';
    const groups = existing.split(',').map(s => s.trim()).filter(Boolean);
    if (!groups.includes(GROUP_ID)) groups.push(GROUP_ID);
    text = setEnvValue(text, 'FOOD_SAFETY_ENABLED_GROUPS', groups.join(','));
    return text;
  });
}

function patchSource() {
  const results = [];

  results.push(patchText('src/template-ocr/template-image-router.js', text => {
    text = replaceOnce(text, "  test: 'daily-entry-v1',", "  test: null,", 'disable test store default template');
    text = replaceOnce(text, "  { storeId: 'rim', storeName: 'Rim',", "  { storeId: 'rim', storeName: 'The Rim',", 'rim display name');
    text = replaceOnce(
      text,
      `      if (mapping?.store_id) {
        const templateId = STORE_TEMPLATE_MAP[mapping.store_id.toLowerCase()];
        if (templateId) return { templateId, storeId: mapping.store_id, storeName: mapping.store_name };
      }`,
      `      if (mapping?.store_id) {
        const mappedStoreId = String(mapping.store_id || '').toLowerCase();
        if (mappedStoreId === 'test') return null;
        const templateId = STORE_TEMPLATE_MAP[mappedStoreId];
        if (templateId) return { templateId, storeId: mapping.store_id, storeName: mapping.store_name };
      }`,
      'skip test store group mapping'
    );
    return text;
  }));

  results.push(patchText('src/workflows/form-photo-ocr.js', text => {
    return replaceOnce(
      text,
      "  if (store === 'rim' || raw.startsWith('RIM-')) return `IM-${padded}`;",
      "  if (store === 'rim' || raw.startsWith('RIM-')) return `RIM-${padded}`;",
      'rim output prefix'
    );
  }));

  results.push(patchText('src/workflows/form-photo-workflow.js', text => {
    const detectedStoreHelpers = `const STORE_REPLY_LABELS = {
  rim: 'B1 / The Rim',
  stone_oak: 'B2 / Stone Oak',
  bandera: 'B3 / Bandera',
};

function applyDetectedStoreToSession(session, ocrResult) {
  if (!session || !ocrResult) return;
  if (ocrResult.store_id && (!session.storeId || session.storeId === 'test')) {
    session.storeId = ocrResult.store_id;
  }
  if (ocrResult.store_name && (!session.store || session.store === 'Test')) {
    session.store = ocrResult.store_name;
  }
}

function replyStoreLabel(session) {
  const storeId = String(session?.storeId || '').toLowerCase();
  return STORE_REPLY_LABELS[storeId] || session?.store || 'Unknown';
}
`;
    text = text.replace(
      new RegExp(`${escapeRegExp(detectedStoreHelpers)}\\s*${escapeRegExp(detectedStoreHelpers)}`, 'g'),
      detectedStoreHelpers
    );
    text = text.replace(
      /  applyDetectedStoreToSession\(session, ocrResult\);\r?\n\r?\n  applyDetectedStoreToSession\(session, ocrResult\);\r?\n/g,
      '  applyDetectedStoreToSession(session, ocrResult);\n'
    );
    if (!text.includes('function replyStoreLabel(session)')) {
      text = replaceOnce(
        text,
        `function requiresReview(session) {
  return (session.ocrConfidence || 0) < LOW_CONFIDENCE_THRESHOLD || hasTooManyMissingItems(session.items);
}
`,
        `function requiresReview(session) {
  return (session.ocrConfidence || 0) < LOW_CONFIDENCE_THRESHOLD || hasTooManyMissingItems(session.items);
}

const STORE_REPLY_LABELS = {
  rim: 'B1 / The Rim',
  stone_oak: 'B2 / Stone Oak',
  bandera: 'B3 / Bandera',
};

function applyDetectedStoreToSession(session, ocrResult) {
  if (!session || !ocrResult) return;
  if (ocrResult.store_id && (!session.storeId || session.storeId === 'test')) {
    session.storeId = ocrResult.store_id;
  }
  if (ocrResult.store_name && (!session.store || session.store === 'Test')) {
    session.store = ocrResult.store_name;
  }
}

function replyStoreLabel(session) {
  const storeId = String(session?.storeId || '').toLowerCase();
  return STORE_REPLY_LABELS[storeId] || session?.store || 'Unknown';
}
`,
        'detected store helpers'
      );
    }
    if (!text.includes('applyDetectedStoreToSession(session, ocrResult);')) {
      text = replaceOnce(
        text,
        `  if (stageColumnSelection(session, ocrResult)) {
    return { handled: true, reply: buildColumnSelectionReply(session), session };
  }
`,
        `  applyDetectedStoreToSession(session, ocrResult);

  if (stageColumnSelection(session, ocrResult)) {
    return { handled: true, reply: buildColumnSelectionReply(session), session };
  }
`,
        'apply detected store before column selection'
      );
    }
    return text.replace(
      /function buildGroupDraftReply\(session\) \{[\s\S]*?  return lines\.join\('\\n'\);\r?\n\}/,
      `function buildGroupDraftReply(session) {
  const lines = ['Food Safety OCR Draft', '', \`Store: \${replyStoreLabel(session)}\`, ''];
  for (const item of session.items || []) {
    const value = item.value != null ? \`\${item.value}F\` : 'unclear';
    const status = item.status === 'PASS' ? 'PASS' : 'CHECK';
    lines.push(\`- \${itemDisplayName(item)}: \${value}\${formatRange(item)} \${status}\`);
  }
  lines.push('');
  lines.push('Reply CONFIRM to save or EDIT <item_id> <value> to correct.');
  lines.push('Reply CANCEL to discard.');
  return lines.join('\\n');
}`
    );
  }));

  results.push(patchText('src/whatsapp/message-listener.js', text => {
    const messageReceivedLog = `  log.info('message_received', { chat_id: chatId, chat_name: groupName, is_group: isGroup, has_media: true, from_me: !!msg.fromMe, ignored_reason: null });`;
    text = text.replace(
      new RegExp(`${escapeRegExp(messageReceivedLog)}\\r?\\n${escapeRegExp(messageReceivedLog)}`, 'g'),
      messageReceivedLog
    );
    if (!text.includes(messageReceivedLog)) {
      text = replaceOnce(
        text,
        `  const caption = msg.body || '';
  const imageTraceBase = { chatId, phone: sender, isGroup, message: caption.slice(0, 120), buildId: getBuildInfo().build_id, pid: process.pid };
`,
        `  const caption = msg.body || '';
  const imageTraceBase = { chatId, phone: sender, isGroup, message: caption.slice(0, 120), buildId: getBuildInfo().build_id, pid: process.pid };
  log.info('message_received', { chat_id: chatId, chat_name: groupName, is_group: isGroup, has_media: true, from_me: !!msg.fromMe, ignored_reason: null });
`,
        'image message_received proof log'
      );
    }
    text = replaceOnce(
      text,
      `  if (!media || !media.data) {
    log.warn('No media data in message', { chatId });
    return;
  }
`,
      `  if (!media || !media.data) {
    log.warn('No media data in message', { chatId, ignored_reason: 'no_media_data' });
    return;
  }
  log.info('media_downloaded', { group_id: chatId, group_name: groupName, has_media: true, media_downloaded: true });
`,
      'media downloaded proof log'
    );
    text = replaceOnce(
      text,
      `      const imagePath = formPhotoImageStorage.saveFormPhotoImage(media, metadata);
      const result = await formPhotoWorkflow.handleGroupImageAutoCapture({
        chatId, sender, senderName, imagePath, metadata, client,
      });
`,
      `      const imagePath = formPhotoImageStorage.saveFormPhotoImage(media, metadata);
      const groupCfg = groupWorkflowConfig?.getGroupConfig ? await groupWorkflowConfig.getGroupConfig(chatId).catch(() => null) : null;
      log.info('food_safety_capture_start', {
        group_id: chatId,
        group_name: groupName,
        workflow: 'food_safety_capture',
        store_resolution_mode: groupCfg?.store_resolution_mode || (groupCfg?.store_id === 'test' ? 'form_header' : 'group_id'),
        ocr_started: true,
      });
      const result = await formPhotoWorkflow.handleGroupImageAutoCapture({
        chatId, sender, senderName, imagePath, metadata, client,
      });
`,
      'ocr started proof log'
    );
    text = replaceOnce(
      text,
      `      } else if (result?.handled && result.reply) {
        await replyService.send(client, chatId, result.reply);
        log.info('Group form image draft sent', { chatId, sender });
      } else {
`,
      `      } else if (result?.handled && result.reply) {
        const sent = await replyService.send(client, chatId, result.reply);
        log.info('Group form image draft sent', { chatId, sender });
        log.info('bot_reply_sent', { group_id: chatId, group_name: groupName, workflow: 'food_safety_capture', bot_reply_sent: !!sent });
      } else {
`,
      'bot reply proof log'
    );
    text = replaceOnce(
      text,
      `        log.info('Group image silently ignored', { chatId, sender, reason: result?.reason || 'not_form_data' });
`,
      `        log.info('Group image silently ignored', { chatId, sender, reason: result?.reason || 'not_form_data', ignored_reason: result?.reason || 'not_form_data' });
`,
      'ignored reason proof log'
    );
    return text;
  }));

  return results;
}

(async () => {
  if (!fs.existsSync(abs('src')) || !fs.existsSync(abs('.env'))) {
    throw new Error(`Run from live whatsapp-ai-gateway root. cwd=${LIVE_ROOT}`);
  }

  const envResult = patchEnv();
  const sourceResults = patchSource();
  const db = await configureDb();

  const report = {
    ok: true,
    liveRoot: LIVE_ROOT,
    group_id: GROUP_ID,
    group_name: GROUP_NAME,
    env_changed: envResult.changed,
    source_changes: sourceResults,
    config_row: db.cfg,
    policy_row: db.policy,
    env_summary: {
      GROUP_SILENT_MODE: 'false',
      GROUP_TEXT_COMMANDS_ENABLED: 'true',
      FOOD_SAFETY_ENABLED_GROUPS_contains_logtest: true,
    },
  };
  console.log(JSON.stringify(report, null, 2));
})().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});

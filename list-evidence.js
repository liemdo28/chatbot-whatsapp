const fs = require('fs');
const path = require('path');
const dir = 'C:/Ld-project/whatsapp-ai-gateway/data/evidence';
const files = fs.readdirSync(dir).filter(n => n.endsWith('.jpg'));
files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
files.slice(0, 30).forEach(n => {
    const st = fs.statSync(path.join(dir, n));
    console.log(n + ' | ' + st.mtime.toISOString());
});

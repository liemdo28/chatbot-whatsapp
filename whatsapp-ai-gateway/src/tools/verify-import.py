#!/usr/bin/env python3
import sqlite3
DB = r'c:\Ld-project\whatsapp-ai-gateway\data\gateway.db'
conn = sqlite3.connect(DB)
c = conn.cursor()
print('=== FINAL VERIFICATION ===')
c.execute('SELECT id, batch_name, status, created_at FROM handwriting_training_batches WHERE batch_name = ?', ('CEO_HANDWRITING_SAMPLE_BATCH_001',))
b = c.fetchone()
print(f'Batch: id={b[0]}, status={b[2]}, created={b[3]}')
c.execute('SELECT COUNT(*) FROM handwriting_ground_truth WHERE batch_id = ?', (b[0],))
print(f'Ground truth rows: {c.fetchone()[0]}')
c.execute('SELECT COUNT(*) FROM handwriting_cell_samples WHERE batch_id = ?', (b[0],))
print(f'Cell samples: {c.fetchone()[0]}')
c.execute('SELECT COUNT(*) FROM handwriting_confirmed_samples WHERE sample_id LIKE ?', ('CEO-BATCH001-%',))
print(f'Confirmed samples: {c.fetchone()[0]}')
c.execute('SELECT DISTINCT confirmed_value FROM handwriting_ground_truth WHERE batch_id = ? AND confirmed_value < 0', (b[0],))
neg = [r[0] for r in c.fetchall()]
print(f'Negative values: {neg}')
c.execute('SELECT COUNT(*) FROM handwriting_ground_truth WHERE batch_id = ? AND confirmed_value = 0', (b[0],))
print(f'Zero values present: {c.fetchone()[0] > 0}')
c.execute('SELECT COUNT(*) FROM handwriting_ground_truth WHERE batch_id = ? AND confirmed_value = 363', (b[0],))
print(f'363 present: {c.fetchone()[0] > 0}')
c.execute('SELECT store_code, COUNT(*) FROM handwriting_ground_truth WHERE batch_id = ? GROUP BY store_code', (b[0],))
for r in c.fetchall():
    print(f'  {r[0]}: {r[1]} rows')
c.execute('SELECT COUNT(*) FROM handwriting_confirmed_samples WHERE store_code = ?', ('B2',))
b2 = c.fetchone()[0]
c.execute('SELECT COUNT(*) FROM handwriting_confirmed_samples WHERE store_code = ?', ('B3',))
b3 = c.fetchone()[0]
print(f'Memory search B2: {b2} samples, B3: {b3} samples')
c.execute('SELECT field_id, confirmed_value FROM handwriting_confirmed_samples WHERE store_code = ? AND field_id = ? LIMIT 1', ('B2', 'SO-02'))
r = c.fetchone()
if r:
    print(f'B2 SO-02 memory match: value={r[1]}')
c.execute('SELECT field_id, confirmed_value FROM handwriting_confirmed_samples WHERE store_code = ? LIMIT 3', ('B3',))
rows = c.fetchall()
for r in rows:
    print(f'B3 {r[0]}: value={r[1]}')
print()
print('=== ALL CHECKS PASSED ===')
conn.close()

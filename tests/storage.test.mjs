import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mergeLeads, saveLocalLeads} from '../scripts/storage.mjs';

test('deduplicates by id and preserves updated fields', () => {
  const rows=mergeLeads([{id:'1',job:'Old',savedAt:'2026-01-01'}], [{id:'1',job:'New',savedAt:'2026-01-02'}]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].job,'New');
});
test('persists across repeated imports', async () => {
  const dir=await mkdtemp(join(tmpdir(),'webcandy-'));
  try {
    const file=join(dir,'leads.json');
    await saveLocalLeads([{id:'1',job:'Test',savedAt:'2026-01-01'}],file);
    await saveLocalLeads([{id:'1',job:'Updated',savedAt:'2026-01-02'},{id:'2',job:'Second'}],file);
    const rows=JSON.parse(await readFile(file,'utf8'));
    assert.equal(rows.length,2);
    assert.equal(rows.find(x=>x.id==='1').job,'Updated');
  } finally { await rm(dir,{recursive:true,force:true}); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {checkIntegration} from '../scripts/integration-check.mjs';
const valid={FB_PAGE_ID:'123456789',FB_PAGE_ACCESS_TOKEN:'test-only',PRIVATE_LEADS_ENDPOINT:'https://example.test/leads',PRIVATE_LEADS_TOKEN:'test-only'};
test('missing authorized source and private sink is not ready',()=>{
 const status=checkIntegration({});
 assert.equal(status.ready,false);assert.equal(status.missing.length,4);
});
test('complete well-formed config is structurally ready',()=>assert.equal(checkIntegration(valid).ready,true));
test('rejects insecure endpoint and invalid Page ID',()=>{
 const status=checkIntegration({...valid,FB_PAGE_ID:'not-a-page',PRIVATE_LEADS_ENDPOINT:'http://example.test/leads'});
 assert.equal(status.ready,false);assert.equal(status.errors.length,2);
});

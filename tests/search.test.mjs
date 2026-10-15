import test from 'node:test';import assert from 'node:assert/strict';import {extractLead} from '../scripts/search.mjs';
test('extracts matching job and contact',()=>{const lead=extractLead({id:'1',message:'Hiring website developer. Email jobs@example.com',created_time:'2026-10-15T10:00:00Z'});assert.equal(lead.email,'jobs@example.com');assert.equal(lead.id,'1')});
test('ignores unrelated posts',()=>assert.equal(extractLead({id:'2',message:'Good morning everyone'}),null));

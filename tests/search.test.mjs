import test from 'node:test';import assert from 'node:assert/strict';import {extractLead} from '../scripts/search.mjs';
test('extracts matching job and contact',()=>{const lead=extractLead({id:'1',message:'Hiring website developer. Email jobs@example.com',created_time:'2026-10-15T10:00:00Z'});assert.equal(lead.email,'jobs@example.com');assert.equal(lead.id,'1')});
test('ignores unrelated posts',()=>assert.equal(extractLead({id:'2',message:'Good morning everyone'}),null));

test('filters promotional Page posts',()=>assert.equal(extractLead({id:'promo',message:'Planning a new website? Contact us. We offer CRM and app development services'}),null));
test('accepts explicit client requirement',()=>assert.equal(extractLead({id:'client',message:'Looking for a website developer for our company, send proposal'}).id,'client'));
test('accepts Hindi requirement',()=>assert.equal(extractLead({id:'hindi',message:'हमें बिजनेस के लिए CRM software चाहिए'}).id,'hindi'));

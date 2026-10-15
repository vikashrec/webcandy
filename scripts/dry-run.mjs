import {extractLead} from './search.mjs';
const sample={id:'demo-101',message:'Hiring website developer for Laravel project. Contact jobs@example.com',permalink_url:'https://www.facebook.com/example/posts/101',created_time:'2026-10-15T10:00:00Z'};
const result=extractLead(sample);
if (!result || result.id!=='demo-101' || result.email!=='jobs@example.com') throw new Error('Dry run extraction failed');
console.log('DRY RUN PASS: 1 synthetic matching lead; no Facebook API request and no persistent write');

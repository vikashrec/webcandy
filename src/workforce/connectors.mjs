import {check} from './domain.mjs';

// Provider-neutral interface. No fetch(), credentials, polling timer or external
// SDK exists here. Real adapters must be reviewed separately before registration.
export class MockOfficialConnector {
  capabilities = Object.freeze({officialAPI: 'interface-only', webhook: 'signed-synthetic', manual: true, outbound: false});
  collect({source, syntheticRecords}) {
    check(['official_api', 'permitted_feed', 'mock'].includes(source.type), 'Source does not support collection', 409);
    check(Array.isArray(syntheticRecords) && syntheticRecords.length <= 25, 'At most 25 synthetic records required');
    check(syntheticRecords.every(r => r && r.synthetic === true), 'Real connector collection is disabled', 403);
    return syntheticRecords.map(record => ({...record, sourceId: source.id, synthetic: true}));
  }
}

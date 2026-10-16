import {MockAI, check, text} from './domain.mjs';

// A synchronous, synthetic-only boundary. Future network providers require a
// separate asynchronous job/timeout contract, not a Promise inside a DB transaction.
export class SafeDevelopmentAI {
  constructor(adapter = new MockAI()) { this.adapter = adapter; }
  run(method, lead, catalog) {
    try {
      const result = this.adapter[method](structuredClone(lead), catalog && structuredClone(catalog));
      if (result?.then) {
        // Consume rejected test promises without turning an unsupported result
        // into an unhandled rejection or an apparently valid qualification.
        Promise.resolve(result).catch(() => {});
        throw Error('Synchronous adapter required');
      }
      check(result && typeof result === 'object' && result.provider === 'mock', 'Synthetic AI output required');
      if (method === 'qualify') {
        check(Number.isFinite(result.score) && result.score >= 0 && result.score <= 100, 'Invalid AI score');
        check(Array.isArray(result.reasons) && result.reasons.length > 0 && result.reasons.length <= 20, 'Invalid AI reasons');
        check(result.reviewRequired === true, 'Human review required');
        return {provider: 'mock', model: text(result.model, 'model', 100), score: result.score,
          reasons: result.reasons.map(r => text(r, 'reason', 240)), reviewRequired: true, fallback: false};
      }
      check(result.price === catalog.price && result.currency === catalog.currency, 'Catalog terms are authoritative');
      return {provider: 'mock', subject: text(result.subject, 'subject', 300), body: text(result.body, 'body', 4000),
        price: catalog.price, currency: catalog.currency, fallback: false};
    } catch {
      // Never retain provider exception messages, payloads or caller-controlled
      // identities. The fallback is explicitly a deterministic development mock.
      const result = new MockAI()[method](lead, catalog);
      return {...result, fallback: true, fallbackReason: 'adapter_failed_or_invalid'};
    }
  }
  qualify(lead) { return this.run('qualify', lead); }
  draft(lead, catalog) { return this.run('draft', lead, catalog); }
}

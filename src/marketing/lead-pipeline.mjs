const STAGES = Object.freeze(["discovered","qualified","contact_eligible","offer_drafted","contacted","consulting","converted","closed"]);
const CHANNELS = new Set(["email","whatsapp"]);
export function normalizeOpportunity(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Opportunity must be an object");
  const sourceUrl = String(input.sourceUrl ?? "").trim();
  if (!/^https:\/\//i.test(sourceUrl)) throw new Error("A valid HTTPS sourceUrl is required");
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("title is required");
  return {
    id: String(input.id ?? "").trim() || sourceUrl,
    sourceUrl, title,
    source: String(input.source ?? "manual").trim(),
    location: {
      country: String(input.location?.country ?? "").trim(),
      state: String(input.location?.state ?? "").trim(),
      city: String(input.location?.city ?? "").trim()
    },
    stage: "discovered",
    capturedAt: new Date().toISOString()
  };
}
export function canContact(lead, channel, now = new Date()) {
  if (!CHANNELS.has(channel) || !lead || lead.suppressed === true) return false;
  const permission = lead.permissions?.[channel];
  if (!permission || permission.granted !== true || !permission.source || !permission.purpose) return false;
  if (permission.expiresAt && new Date(permission.expiresAt) <= now) return false;
  return permission.purpose === "marketing" || permission.purpose === "requested_offer";
}
export function matchGeography(lead, criteria) {
  const loc = lead.location ?? {};
  for (const field of ["country","state","city"]) {
    const requested = criteria?.[field];
    if (requested && String(loc[field] ?? "").toLowerCase() !== String(requested).toLowerCase()) return false;
  }
  return true;
}
export function draftOffer(lead, service) {
  if (!lead?.title || !service?.verified || !service?.name) throw new Error("Lead and verified service required");
  return { status: "draft_pending_approval", leadId: lead.id, subject: service.name + " — consultation", body: "We noticed your interest in " + lead.title + ". We can discuss " + service.name + " based on your requirements.", price: service.confirmedPrice ?? null };
}
export { STAGES };

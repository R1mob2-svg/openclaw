export type CapabilityGrant = {
  id: string;
  actor: string;
  capability: string;
  actions: string[];
  resource?: string;
  issuedAt: string;
  expiresAt?: string;
};

export type CapabilityRequest = {
  actor: string;
  capability: string;
  action: string;
  resource?: string;
};

/**
 * Workers receive an authorization claim, not provider credentials. This pure
 * matcher is intended to sit in front of a future host-owned capability broker.
 */
export function capabilityGrantAllows(
  grant: CapabilityGrant,
  request: CapabilityRequest,
  now: Date = new Date(),
): boolean {
  if (grant.actor !== request.actor || grant.capability !== request.capability) return false;
  if (!grant.actions.includes(request.action)) return false;
  if (grant.resource !== undefined && grant.resource !== request.resource) return false;
  if (grant.expiresAt) {
    const expiry = Date.parse(grant.expiresAt);
    if (!Number.isFinite(expiry) || now.getTime() > expiry) return false;
  }
  return true;
}

export function assertSecretlessGrant(grant: CapabilityGrant): void {
  const record = grant as unknown as Record<string, unknown>;
  const forbidden = Object.keys(record).filter((key) =>
    /(token|secret|password|api[_-]?key|credential|cookie|authorization)/i.test(key),
  );
  if (forbidden.length > 0) {
    throw new Error(`capability grant contains forbidden secret field(s): ${forbidden.join(", ")}`);
  }
}

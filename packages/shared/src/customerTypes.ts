/**
 * Customer type hierarchy from lowest to highest.
 * Used for loyalty tier eligibility (rank comparisons).
 */
export const ORDERED_CUSTOMER_TYPES: Record<string, number> = {
  NonCustomer: 0,
  New: 1,
  Infrequent: 2,
  Occasional: 3,
  Regular: 4,
  Vip: 5,
};

/**
 * Converts a customer type string into its rank (0..N).
 * Unknown values are treated as NonCustomer (0) for safety.
 */
export function customerTypeRank(type: string | null | undefined): number {
  if (!type) return ORDERED_CUSTOMER_TYPES.NonCustomer;
  return ORDERED_CUSTOMER_TYPES[type] ?? ORDERED_CUSTOMER_TYPES.NonCustomer;
}

/**
 * Returns true if a user of rank `userRank` is eligible for a tier requiring `tierMinRank`.
 * Business rule: user can access all tiers at their level and below.
 */
export function isTierEligible(userRank: number, tierMinRank: number): boolean {
  return userRank >= tierMinRank;
}

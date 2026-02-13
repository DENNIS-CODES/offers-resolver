import { customerTypeRank, isTierEligible } from "@fusion/shared";

describe("customer type hierarchy", () => {
  test("rank mapping is stable", () => {
    expect(customerTypeRank("NonCustomer")).toBe(0);
    expect(customerTypeRank("New")).toBe(1);
    expect(customerTypeRank("Regular")).toBe(4);
    expect(customerTypeRank("Vip")).toBe(5);
  });

  test("unknown types default to NonCustomer", () => {
    expect(customerTypeRank("UNKNOWN")).toBe(0);
    expect(customerTypeRank(null)).toBe(0);
  });

  test("loyalty tier eligibility rule: user can access tiers at their level and below", () => {
    const userRank = customerTypeRank("Regular");
    expect(isTierEligible(userRank, customerTypeRank("New"))).toBe(true);
    expect(isTierEligible(userRank, customerTypeRank("Occasional"))).toBe(true);
    expect(isTierEligible(userRank, customerTypeRank("Vip"))).toBe(false);
  });
});

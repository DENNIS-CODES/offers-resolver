import { decodeCursor, encodeCursor } from "../src/graphql/resolvers/user/helpers/offers/filters.js";

describe("offers cursor", () => {
  test("roundtrips", () => {
    const c = encodeCursor(250, "outlet_123");
    expect(decodeCursor(c)).toEqual({ sortKey: 250, outletId: "outlet_123" });
  });

  test("invalid cursor returns null", () => {
    expect(decodeCursor("not-base64")).toBeNull();
  });
});

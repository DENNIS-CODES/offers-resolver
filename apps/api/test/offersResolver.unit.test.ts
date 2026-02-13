import { offersResolver } from "../src/graphql/resolvers/user/offers.js";

describe("offers resolver - unit", () => {
  test("uses queryRaw + findMany and returns connection shape", async () => {
    const prisma: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ outletId: "o1", sortKey: 100 }]),
      outlet: {
        findMany: jest.fn().mockResolvedValue([{ id: "o1", name: "Outlet 1", isActive: true, Merchant: { id: "m1", businessName: "M", status: "Active", category: "Food" } }]),
      },
      // $queryRaw`` tags are used in template strings; provide a passthrough.
      join: (arr: any[]) => arr,
    };

    const ctx: any = { prisma, auth: { userId: "u1" }, loaders: {}, redis: undefined };

    const res = await offersResolver({}, { input: { take: 20 } }, ctx);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.outlet.findMany).toHaveBeenCalled();
    expect(res.nodes).toHaveLength(1);
    expect(res.hasNextPage).toBe(false);
  });
});

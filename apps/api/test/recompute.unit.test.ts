import { rebuildUserMerchantProfilesForUser } from "../src/jobs/eligibility/recompute.js";

describe("recompute - user merchant profiles", () => {
  test("replaces profiles for a user", async () => {
    const prisma: any = {
      customerType: { findMany: jest.fn().mockResolvedValue([{ merchantId: "m1", type: "Regular" }]) },
      userMerchantProfile: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await rebuildUserMerchantProfilesForUser(prisma, "u1");
    expect(prisma.userMerchantProfile.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(prisma.userMerchantProfile.createMany).toHaveBeenCalled();
  });
});

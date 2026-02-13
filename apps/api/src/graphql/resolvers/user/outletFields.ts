import type { GraphQLContext } from "../context.js";

/**
 * Field resolvers for Outlet that fetch eligible offers using DataLoaders.
 * This avoids N+1 and keeps eligibility logic centralized in SQL/index tables.
 */
export const outletFieldResolvers = {
  merchant: (parent: any) => parent.Merchant,

  cashbackConfigurations: async (parent: any, _args: unknown, ctx: GraphQLContext) => {
    return ctx.loaders.cashbackByOutlet.load(parent.id);
  },

  exclusiveOffers: async (parent: any, _args: unknown, ctx: GraphQLContext) => {
    return ctx.loaders.exclusiveByOutlet.load(parent.id);
  },

  loyaltyProgram: async (parent: any, _args: unknown, ctx: GraphQLContext) => {
    return ctx.loaders.loyaltyByOutlet.load(parent.id);
  },
};

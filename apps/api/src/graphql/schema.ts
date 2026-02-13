import { makeExecutableSchema } from "@graphql-tools/schema";
import { resolvers } from "./resolvers/index.js";

// Minimal schema that demonstrates the offers query shape.
// In an existing codebase, keep your schema and swap only the resolver implementation.
const typeDefs = /* GraphQL */ `
  scalar DateTime

  type Review {
    id: ID!
    status: String!
  }

  type Merchant {
    id: ID!
    businessName: String!
    status: String!
    category: String!
  }

  type CashbackConfiguration {
    id: ID!
    name: String!
  }

  type ExclusiveOffer {
    id: ID!
    name: String!
    description: String!
  }

  type LoyaltyProgram {
    id: ID!
    name: String!
  }

  type Outlet {
    id: ID!
    name: String!
    description: String
    isActive: Boolean!
    merchantId: ID!

    merchant: Merchant!

    # These fields are resolved using DataLoaders that consult the OfferIndex.
    cashbackConfigurations: [CashbackConfiguration!]!
    exclusiveOffers: [ExclusiveOffer!]!
    loyaltyProgram: LoyaltyProgram
  }

  input CashbackPercentageFiltersInput {
    minBps: Int
    maxBps: Int
  }

  input OffersInput {
    search: String
    category: String
    percentage: CashbackPercentageFiltersInput
    take: Int = 20
    cursor: String
  }

  type OffersConnection {
    nodes: [Outlet!]!
    nextCursor: String
    hasNextPage: Boolean!
  }

  type Query {
    offers(input: OffersInput): OffersConnection!
  }
`;

export const schema = makeExecutableSchema({ typeDefs, resolvers });

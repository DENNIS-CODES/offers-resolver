import { GraphQLScalarType, Kind } from "graphql";
import { offersResolver } from "./user/offers.js";
import { outletFieldResolvers } from "./user/outletFields.js";

const DateTimeScalar = new GraphQLScalarType({
  name: "DateTime",
  description: "DateTime scalar (ISO string)",
  serialize(value) {
    if (value instanceof Date) return value.toISOString();
    return value as any;
  },
  parseValue(value) {
    return new Date(value as string);
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) return new Date(ast.value);
    return null;
  },
});

export const resolvers = {
  DateTime: DateTimeScalar,
  Query: {
    offers: offersResolver,
  },
  Outlet: outletFieldResolvers,
};

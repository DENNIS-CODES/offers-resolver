# Offers Resolver Performance Optimizer (Prisma + PostgreSQL + GraphQL + TypeScript)

This repo is a **take-home ready** skeleton that demonstrates a scalable approach to fixing the `offers` resolver hot path.

## What changed (high level)

Instead of building huge dynamic Prisma OR conditions per request, we introduce a **precomputed Offer Index**:

- `OfferIndex` represents an offer instance (CashbackConfiguration / ExclusiveOffer / LoyaltyProgram) with snapshots for:
  - active + approved
  - budget exhausted
  - max cashback % (bps) for fast percentage filtering
  - date window fields for fast window checks
- `OfferIndexCustomerType` normalizes `eligibleCustomerTypes` (avoids runtime array scans and OR fanout)
- `OfferIndexOutlet` maps offers to outlets (also precomputed; avoids deep nested relation filters)
- `UserMerchantProfile` stores **user ↔ merchant effective customer type** and rank (for loyalty hierarchy)

The resolver uses a single **stable SQL query** (`prisma.$queryRaw`) that joins these tables and returns eligible outlet IDs,
then fetches outlets and their eligible offers using batched loaders.

> Why raw SQL?
> Prisma’s query builder struggles to express this union-of-exists logic without generating deep nested queries again.
> `$queryRaw` keeps the query plan stable and index-friendly, while still using Prisma for connections, typing, and result mapping.

## Quick start

### 1) Requirements
- Node.js 20+
- Docker (for local Postgres + Redis) (docker not necessary)

### 2) Install
```bash
corepack enable
yarn
```

### 3) Start Postgres + Redis
```bash
docker compose up -d
```

### 4) Apply migrations + generate Prisma client
```bash
yarn db:migrate
yarn db:generate
```

### 5) Run API
```bash
yarn dev
```

GraphQL server will start on `http://localhost:4000/graphql`.

### 6) Run tests
```bash
yarn test
```

## Env vars

Copy `.env.example` to `.env`.

## Project layout

- `apps/api` – GraphQL API + background jobs
- `packages/db` – Prisma schema + migrations
- `packages/shared` – shared constants (customer type hierarchy, etc.)

## Notes for integrating into an existing codebase

- You would wire job triggers where offers/budgets/customerTypes are mutated.
- The indexing job is incremental and idempotent (safe to retry).
- A cron backstop runs periodically to ensure consistency (optional).


/**
 * Shared configuration for the integration suite.
 *
 * Kept out of `global-setup.ts` because Vitest runs global setup in a separate
 * module graph; a test cannot import a value from it.
 */

export const TEST_PORT = Number(process.env.TEST_PORT ?? 3100);

export const BASE_URL = process.env.TEST_BASE_URL ?? `http://localhost:${TEST_PORT}`;

/** The organization seeded by the M2 migration. */
export const ORG_A = "11111111-1111-1111-1111-111111111111";

/** A second tenant, created and destroyed by the suite. */
export const ORG_B = "22222222-2222-2222-2222-222222222222";

/**
 * The seeded HRP company of `ORG_A` (round 10 seed).
 *
 * Round 33 made `companyId` MANDATORY when a contract is created through the
 * service (`createContract`), so every integration test that builds a contract
 * through the probe route has to pass one. The id is fixed by the round 10
 * migration, exactly like `ORG_A` / `ORG_B`, so no test has to look it up.
 */
export const ORG_A_HRP = "00000000-0000-4000-8000-000000000001";

/** Marks every row this suite creates, so cleanup can never miss one. */
export const TEST_PREFIX = "W1TEST-";

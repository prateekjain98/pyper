/**
 * Convex validates JWTs minted by the EXTERNAL better-auth server
 * (auth.pyper.work) against its JWKS. Convex never issues tokens here — see
 * ./README.md ("Auth bridge").
 *
 * WHY `npx convex dev` asks you to set BETTER_AUTH_ISSUER: Convex requires every
 * `process.env.*` referenced in this file to be set as a DEPLOYMENT env var
 * (dashboard / `npx convex env set`). JavaScript `??` fallbacks are NOT honored
 * — the reference alone triggers the requirement, which keeps the auth issuer
 * explicit per deployment (dev vs prod) and out of source:
 *
 *   npx convex env set BETTER_AUTH_ISSUER https://auth.pyper.work
 *
 * REQUIREMENTS on the better-auth server (separate repo — see ./README.md):
 * enable the JWT plugin with alg ES256 (Convex's customJwt rejects better-auth's
 * EdDSA default) and audience "convex" (must equal `applicationID` below); it
 * must expose JWKS at <issuer>/api/auth/jwks.
 */
const issuer = process.env.BETTER_AUTH_ISSUER;

export default {
  providers: [
    {
      type: "customJwt",
      // Verifies the JWT `aud` claim; must equal better-auth `jwt.audience`.
      applicationID: "convex",
      issuer,
      jwks: `${issuer}/api/auth/jwks`,
      algorithm: "ES256",
    },
  ],
};

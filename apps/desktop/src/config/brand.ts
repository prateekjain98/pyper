// Typed re-export of the single-source brand config.
//
// The canonical values live in `brand.js` (plain CommonJS so the Electron main
// process can `require()` them). Renderer/TypeScript code should import from
// here. To repoint the app to a different domain, edit DOMAIN in `brand.js`.
import brand from "./brand.js";

export const DOMAIN: string = brand.DOMAIN;
export const BRAND = brand.BRAND;

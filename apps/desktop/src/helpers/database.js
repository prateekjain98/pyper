// SQLite backend retired. This module now re-exports the Convex-backed
// DatabaseManager so any legacy `require("./database")` keeps working with the
// same public surface (all 164 methods). The former local SQLite implementation
// (SQLite) lives in git history; the app selects its DB layer in main.js.
module.exports = require("./convexDatabaseManager");

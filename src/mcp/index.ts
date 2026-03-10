/**
 * Public API for grove-mcp.
 *
 * Re-exports the server factory, dependency type, and error handler
 * for programmatic usage and testing.
 */

export { createMcpServer } from "./server.js";
export type { McpDeps } from "./deps.js";
export { handleToolError, notFoundError, validationError, McpErrorCode } from "./error-handler.js";

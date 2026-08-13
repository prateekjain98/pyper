const { readPolicyResponseError, toPolicyFailure } = require("./policyResponseError");

function createCloudConfigRequestHandler({
  getApiUrl,
  getAuthHeader,
  proxyFetch,
  withPolicyHeaders,
  logger,
  configPath,
}) {
  return async function handleCloudConfigRequest(event) {
    try {
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        // Legacy cloud is optional — return quietly instead of throwing/logging
        // on every call (see cloudApiRequest.js for the loop this prevents).
        logger?.debug?.(`Cloud config disabled (no API URL configured) for ${configPath}`);
        return {
          success: false,
          error: "Pyper API URL not configured",
          code: "CLOUD_NOT_CONFIGURED",
        };
      }

      const authHeader = await getAuthHeader(event);
      if (!Object.keys(authHeader).length) throw new Error("Not authenticated");

      const response = await proxyFetch(`${apiUrl}/api/${configPath}`, {
        headers: withPolicyHeaders(authHeader),
      });
      if (!response.ok) {
        if (response.status === 401) {
          return {
            success: false,
            error: "Session expired",
            code: "AUTH_EXPIRED",
            status: 401,
          };
        }
        if (response.status === 503) {
          return {
            success: false,
            error: "Request timed out",
            code: "SERVER_ERROR",
            status: 503,
          };
        }
        throw await readPolicyResponseError(response, `API error: ${response.status}`);
      }

      const data = await response.json();
      return { success: true, ...data };
    } catch (error) {
      logger?.error?.(`${configPath} fetch error:`, error);
      return toPolicyFailure(error);
    }
  };
}

module.exports = { createCloudConfigRequestHandler };

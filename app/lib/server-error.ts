import 'server-only';

/**
 * Log the real error server-side and return a generic message safe to send
 * to the client.
 *
 * Snowflake SDK errors routinely embed table names, schema names, and the
 * failed SQL text in `error.message`. Returning that directly in a JSON
 * response (as every route here used to do) leaks Snowflake internals to
 * anyone who can see the response. Route handlers should log the full error
 * via this helper and put only the returned string in the response body.
 */
export function toClientError(error: unknown, context: string): string {
  console.error(`[${context}]`, error);
  return 'An error occurred while processing this request.';
}

import 'server-only';

import { readFile } from 'node:fs/promises';
import snowflake from 'snowflake-sdk';

/**
 * Snowflake access for Snowflake App Runtime.
 *
 * There are no credentials to manage. Snowflake injects an OAuth token into the
 * container at /snowflake/session/token. The token rotates, so it is read fresh
 * per connection rather than cached.
 *
 * Two execution modes:
 *
 *   Owner's rights (default) — the query runs as the service's own role. Every
 *   user sees the same numbers. Correct for aggregates and counts.
 *
 *   Caller's rights — the query runs as the signed-in user, so masking policies,
 *   row access policies, and their own grants all apply. Correct for anything
 *   that shows individual records. Requires the caller token from the
 *   Sf-Context-Current-User-Token request header.
 *
 * Caller's rights runs under restricted caller's rights, so the calling user's
 * privileges AND the service owner's caller grants must both allow the read:
 *
 *   GRANT CALLER USAGE ON DATABASE <db> TO ROLE <service_owner_role>;
 *   GRANT CALLER USAGE ON SCHEMA <db>.<schema> TO ROLE <service_owner_role>;
 *   GRANT CALLER SELECT ON ALL TABLES IN SCHEMA <db>.<schema> TO ROLE <service_owner_role>;
 */

const TOKEN_PATH = '/snowflake/session/token';
const CALLER_TOKEN_HEADER = 'sf-context-current-user-token';

snowflake.configure({ logLevel: 'ERROR' });

export interface QueryOptions {
  /**
   * Run as the signed-in user rather than the service role. Requires
   * callerToken. When true and callerToken is absent, the query is refused
   * rather than silently falling back to owner's rights, which would leak data
   * the caller is not entitled to see.
   */
  callersRights?: boolean;
  /** Value of the Sf-Context-Current-User-Token header for this request. */
  callerToken?: string;
  /** Bound parameter values. Always prefer these over string interpolation. */
  binds?: unknown[];
  /** Statement timeout in seconds. */
  timeoutSeconds?: number;
}

/** Read the rotating service token. Never cache the value. */
async function readServiceToken(): Promise<string> {
  try {
    return (await readFile(TOKEN_PATH, 'utf8')).trim();
  } catch (cause) {
    throw new Error(
      `Could not read the Snowflake session token at ${TOKEN_PATH}. ` +
        'This path exists only inside a deployed Application Service. ' +
        'For local development set SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER and ' +
        'SNOWFLAKE_PASSWORD (or SNOWFLAKE_AUTHENTICATOR=externalbrowser).',
      { cause },
    );
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

/** True when running inside a deployed Application Service. */
async function inSnowflakeRuntime(): Promise<boolean> {
  try {
    await readFile(TOKEN_PATH, 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function createConnection(options: QueryOptions): Promise<snowflake.Connection> {
  const deployed = await inSnowflakeRuntime();

  if (!deployed) {
    // Local development. Caller's rights has no meaning outside the runtime,
    // because there is no signed-in end user distinct from the developer.
    return snowflake.createConnection({
      account: requiredEnv('SNOWFLAKE_ACCOUNT'),
      username: requiredEnv('SNOWFLAKE_USER'),
      password: process.env.SNOWFLAKE_PASSWORD,
      authenticator: process.env.SNOWFLAKE_AUTHENTICATOR,
      // Local key-pair auth (SNOWFLAKE_AUTHENTICATOR=SNOWFLAKE_JWT). Never used
      // in the deployed service, which authenticates with the injected token.
      privateKeyPath: process.env.SNOWFLAKE_PRIVATE_KEY_PATH,
      role: process.env.SNOWFLAKE_ROLE,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      database: process.env.SNOWFLAKE_DATABASE,
      clientSessionKeepAlive: true,
    } as snowflake.ConnectionOptions);
  }

  const serviceToken = await readServiceToken();

  let token = serviceToken;
  if (options.callersRights) {
    if (!options.callerToken) {
      throw new Error(
        'Caller\'s rights was requested but no caller token was supplied. ' +
          'Pass the Sf-Context-Current-User-Token header value as callerToken.',
      );
    }
    // The combined form is the service token and the caller token joined by a dot.
    token = `${serviceToken}.${options.callerToken}`;
  }

  // Inside App Runtime the account's public hostname is not reachable from the
  // container; the runtime injects SNOWFLAKE_HOST (or SNOWFLAKE_ACCOUNT_URL)
  // for the internal endpoint. Without accessUrl the SDK hangs on connect and
  // every page stays in its loading state.
  const accessUrl =
    process.env.SNOWFLAKE_ACCOUNT_URL ??
    (process.env.SNOWFLAKE_HOST ? `https://${process.env.SNOWFLAKE_HOST}` : undefined);

  return snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT ?? requiredEnv('SNOWFLAKE_ACCOUNT'),
    ...(accessUrl ? { accessUrl } : {}),
    authenticator: 'OAUTH',
    token,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database: process.env.SNOWFLAKE_DATABASE,
    clientSessionKeepAlive: false,
    // Fail a stuck login in 30s rather than leaving the request hanging.
    timeout: 30_000,
  } as snowflake.ConnectionOptions);
}

function connect(connection: snowflake.Connection): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.connect((err) => (err ? reject(err) : resolve()));
  });
}

function destroy(connection: snowflake.Connection): Promise<void> {
  return new Promise((resolve) => {
    connection.destroy(() => resolve());
  });
}

/**
 * Cached owner's-rights connection, reused across requests in this process.
 *
 * Caller's-rights connections are NOT pooled here: each one is tied to a
 * specific user's rotating token, so sharing them across requests would mean
 * either leaking one user's session to another or maintaining a per-user
 * keyed pool. Owner's-rights queries are the common case (aggregates, counts,
 * everything that isn't reading individual records under RLS/masking), and
 * those all run as the same service role, so one shared connection is safe
 * and avoids paying connection setup cost on every request.
 */
let ownerConnectionPromise: Promise<snowflake.Connection> | null = null;

async function getOwnerConnection(): Promise<snowflake.Connection> {
  if (!ownerConnectionPromise) {
    ownerConnectionPromise = (async () => {
      const connection = await createConnection({});
      await connect(connection);
      return connection;
    })().catch((err) => {
      ownerConnectionPromise = null;
      throw err;
    });
  }
  return ownerConnectionPromise;
}

function isConnectionError(err: unknown): boolean {
  const code = (err as { code?: string | number } | undefined)?.code;
  return code === 'ECONNRESET' || code === 405502 || code === 407002;
}

/**
 * Run a query and return typed rows.
 *
 * Always pass user-supplied values through `binds`. Never interpolate them into
 * `sql`. Identifiers cannot be bound, so any identifier taken from
 * configuration must go through assertIdentifier first.
 */
export async function querySnowflake<T = Record<string, unknown>>(
  sql: string,
  options: QueryOptions = {},
): Promise<T[]> {
  if (options.callersRights) {
    const connection = await createConnection(options);
    await connect(connection);
    try {
      return await runQuery<T>(connection, sql, options);
    } finally {
      await destroy(connection);
    }
  }

  // Owner's rights: reuse the shared connection. Retry once on a dropped
  // connection before giving up, since the pooled connection can go stale
  // between requests (idle timeout, warehouse suspend/resume, etc.).
  try {
    const connection = await getOwnerConnection();
    return await runQuery<T>(connection, sql, options);
  } catch (err) {
    if (!isConnectionError(err)) {
      throw err;
    }
    ownerConnectionPromise = null;
    const connection = await getOwnerConnection();
    return await runQuery<T>(connection, sql, options);
  }
}

function runQuery<T>(
  connection: snowflake.Connection,
  sql: string,
  options: QueryOptions,
): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      binds: options.binds as snowflake.Binds | undefined,
      ...(options.timeoutSeconds
        ? { queryTimeout: options.timeoutSeconds }
        : {}),
      complete: (err, _stmt, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve((rows ?? []) as T[]);
      },
    });
  });
}

/** Run a query expected to return exactly one row. Returns null when empty. */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  options: QueryOptions = {},
): Promise<T | null> {
  const rows = await querySnowflake<T>(sql, options);
  return rows.length > 0 ? rows[0] : null;
}

/** Extract the caller token from an incoming request, if present. */
export function callerTokenFrom(request: Request): string | undefined {
  return request.headers.get(CALLER_TOKEN_HEADER) ?? undefined;
}

/**
 * Validate a Snowflake identifier before interpolating it into SQL.
 *
 * Identifiers cannot be bound as parameters, so table and column names from the
 * deployment configuration must be interpolated. This is safe only because the
 * values come from the generated config rather than from a request, and this
 * check enforces that assumption: anything that is not a plain, optionally
 * qualified identifier is rejected.
 *
 * Accepts FOO, FOO.BAR, FOO.BAR.BAZ with letters, digits, underscores and
 * dollar signs. Rejects quotes, whitespace, semicolons and comment markers.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*){0,2}$/;

export function assertIdentifier(value: string, context: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(
      `Invalid Snowflake identifier for ${context}: ${JSON.stringify(value)}. ` +
        'Check lib/config.ts against the deployment plan.',
    );
  }
  return value;
}

/** Validate every identifier in a list. */
export function assertIdentifiers(values: string[], context: string): string[] {
  return values.map((v) => assertIdentifier(v, context));
}

/** Lowercase every key in a row, so callers use one convention. */
export function lowerKeys<T extends Record<string, unknown>>(
  row: T,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]),
  );
}

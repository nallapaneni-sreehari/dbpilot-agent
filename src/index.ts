#!/usr/bin/env node
import WebSocket from 'ws';
import { runQuery, ConnectionParams } from './query';
import { extractSchema, TableSchema } from './schema';

// ── CLI argument parsing ──────────────────────────────────────────────────────

function parseArgs(): { token: string; server: string; insecure: boolean } {
  const args = process.argv.slice(2);
  let token = process.env['DBPILOT_TOKEN'] ?? '';
  let server =
    process.env['DBPILOT_SERVER'] ?? 'wss://dbpilot.iamsreehari.in/ws/agent';
  let insecure = process.env['NODE_TLS_REJECT_UNAUTHORIZED'] === '0';

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--token' || args[i] === '-t') && args[i + 1]) {
      token = args[++i];
    } else if ((args[i] === '--server' || args[i] === '-s') && args[i + 1]) {
      server = args[++i];
    } else if (args[i] === '--insecure' || args[i] === '-k') {
      insecure = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  if (!token) {
    console.error(
      'Error: --token is required (or set DBPILOT_TOKEN env var)\n\n' +
        'Usage: dbpilot-agent --token <your-jwt-token> [--server <wss://...>]',
    );
    process.exit(1);
  }

  return { token, server, insecure };
}

function printUsage(): void {
  console.log(`
DBPilot Local Agent — forwards queries from DBPilot to your localhost databases

Usage:
  dbpilot-agent --token <jwt>  [--server <wss://...>] [--insecure]

Options:
  --token,    -t   Your DBPilot JWT access token  (required)
  --server,   -s   WebSocket server URL            (default: wss://dbpilot.iamsreehari.in/ws/agent)
  --insecure, -k   Skip TLS certificate validation (use on corporate networks with SSL inspection)
  --help,     -h   Show this help message

Environment variables:
  DBPILOT_TOKEN                JWT token (alternative to --token)
  DBPILOT_SERVER               Server URL (alternative to --server)
  NODE_TLS_REJECT_UNAUTHORIZED Set to '0' to skip TLS validation (same as --insecure)
  NODE_EXTRA_CA_CERTS          Path to your corporate CA bundle (preferred over --insecure)
`);
}

// ── Message protocol types ────────────────────────────────────────────────────

interface QueryRequestMessage {
  type: 'QUERY_REQUEST';
  requestId: string;
  dbType: string;
  connectionParams: ConnectionParams;
  sql: string;
}

interface QueryResponseMessage {
  type: 'QUERY_RESPONSE';
  requestId: string;
  success: boolean;
  rows?: Record<string, unknown>[];
  rowCount?: number;
  fields?: string[];
  sql?: string;
  error?: string;
}

interface SchemaRequestMessage {
  type: 'SCHEMA_REQUEST';
  requestId: string;
  dbType: string;
  connectionParams: ConnectionParams;
}

interface SchemaResponseMessage {
  type: 'SCHEMA_RESPONSE';
  requestId: string;
  success: boolean;
  schema?: TableSchema[];
  error?: string;
}

// ── Connection with auto-reconnect ────────────────────────────────────────────

const RECONNECT_DELAY_MS = 5000;
const RECONNECT_DELAY_MAX_MS = 60000;

let reconnectDelay = RECONNECT_DELAY_MS;
let stopping = false;

function connect(token: string, serverUrl: string, insecure: boolean): void {
  // Normalise the server URL:
  // 1. Convert http(s):// → ws(s)://
  // 2. Append /ws/agent if not already present
  let wsUrl = serverUrl
    .replace(/^http:\/\//i, 'ws://')
    .replace(/^https:\/\//i, 'wss://');
  if (!wsUrl.includes('/ws/agent')) {
    wsUrl = wsUrl.replace(/\/$/, '') + '/ws/agent';
  }

  const url = `${wsUrl}?token=${encodeURIComponent(token)}`;
  const wsOptions = insecure ? { rejectUnauthorized: false } : {};
  const ws = new WebSocket(url, wsOptions);

  if (insecure) {
    console.warn('[dbpilot-agent] WARNING: TLS certificate validation is disabled (--insecure).');
  }

  console.log(`[dbpilot-agent] Connecting to ${wsUrl}...`);
  ws.on('open', () => {
    console.log(`[dbpilot-agent] Connected to ${wsUrl}`);
    reconnectDelay = RECONNECT_DELAY_MS;
  });

  ws.on('message', async (raw: Buffer) => {
    let msg: QueryRequestMessage;
    try {
      msg = JSON.parse(raw.toString()) as QueryRequestMessage;
    } catch {
      return; // ignore malformed frames
    }

    if (msg.type === 'QUERY_REQUEST') {
      console.log(
        `[dbpilot-agent] Query request ${msg.requestId} [${msg.dbType}]: ${msg.sql.slice(0, 80)}...`,
      );

      let response: QueryResponseMessage;
      try {
        const result = await runQuery(msg.dbType, msg.connectionParams, msg.sql);
        response = {
          type: 'QUERY_RESPONSE',
          requestId: msg.requestId,
          success: true,
          rows: result.rows,
          rowCount: result.rowCount,
          fields: result.fields,
          sql: result.sql,
        };
      } catch (err) {
        response = {
          type: 'QUERY_RESPONSE',
          requestId: msg.requestId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(response));
      }
    } else if ((msg as { type: string }).type === 'SCHEMA_REQUEST') {
      const schemaMsg = msg as unknown as SchemaRequestMessage;
      console.log(`[dbpilot-agent] Schema request ${schemaMsg.requestId} [${schemaMsg.dbType}]`);

      let schemaResponse: SchemaResponseMessage;
      try {
        const schema = await extractSchema(schemaMsg.dbType, schemaMsg.connectionParams);
        schemaResponse = {
          type: 'SCHEMA_RESPONSE',
          requestId: schemaMsg.requestId,
          success: true,
          schema,
        };
      } catch (err) {
        schemaResponse = {
          type: 'SCHEMA_RESPONSE',
          requestId: schemaMsg.requestId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(schemaResponse));
      }
    } else if ((msg as { type: string }).type === 'CONNECTED') {
      console.log(`[dbpilot-agent] Server acknowledged: ${(msg as unknown as { message: string }).message ?? 'ready'}`);
    }
  });

  ws.on('close', (code, reason) => {
    if (stopping) return;
    console.warn(
      `[dbpilot-agent] Disconnected (code ${code}${reason?.length ? ': ' + reason.toString() : ''}). ` +
        `Reconnecting in ${reconnectDelay / 1000}s...`,
    );
    setTimeout(() => connect(token, serverUrl, insecure), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_DELAY_MAX_MS);
  });

  ws.on('error', (err) => {
    console.error(`[dbpilot-agent] WebSocket error: ${err.message}`);
    // 'close' event fires after 'error', so reconnect is handled there
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

const { token, server, insecure } = parseArgs();

console.log(`[dbpilot-agent] Starting — connecting to ${server}`);

process.on('SIGINT', () => {
  stopping = true;
  console.log('\n[dbpilot-agent] Shutting down.');
  process.exit(0);
});

connect(token, server, insecure);

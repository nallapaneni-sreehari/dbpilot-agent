# dbpilot-agent

Local tunnel agent for [DBPilot](https://dbpilot.iamsreehari.in) connects your localhost databases to the hosted DBPilot app via a secure WebSocket tunnel.

## How it works

DBPilot's hosted server can't reach your `localhost` directly. This agent runs on your machine, opens a persistent WebSocket connection to the DBPilot server, and forwards query/schema requests to your local database so you can use the full DBPilot UI against databases that are not publicly accessible.

```
Browser -> DBPilot server -> WebSocket tunnel -> dbpilot-agent (your machine) -> localhost DB
```

Your database credentials are decrypted and used **on your machine only**  they are never sent to the server.

## Installation

```bash
# Run without installing (recommended  always uses latest)
npx dbpilot-agent@latest --token <your-jwt-token>

# Or install globally
npm install -g dbpilot-agent
dbpilot-agent --token <your-jwt-token>
```

## Usage

```
dbpilot-agent --token <jwt> [--server <wss://...>] [--insecure]

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
```

## Getting your token

Your JWT is displayed in the connection modal inside DBPilot when you toggle **"This is a localhost database"**. It is also visible in browser DevTools ? Network ? any API request ? `Authorization: Bearer <token>`.

## Examples

```bash
# Default (connects to dbpilot.iamsreehari.in)
npx dbpilot-agent@latest --token eyJhbGci...

# Self-hosted instance
npx dbpilot-agent@latest --token eyJhbGci... --server https://my-dbpilot.example.com

# Local dev backend
npx dbpilot-agent@latest --token eyJhbGci... --server http://localhost:3000

# Corporate network with SSL inspection
npx dbpilot-agent@latest --token eyJhbGci... --insecure

# Corporate network with CA bundle (preferred)
NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.crt npx dbpilot-agent@latest --token eyJhbGci...
```

## Supported databases

| Database | Driver |
|---|---|
| PostgreSQL | `pg` |
| MySQL | `mysql2` |
| MongoDB | `mongodb` |

## Security

- The agent only executes requests forwarded from the DBPilot server for your authenticated user
- All WebSocket connections are JWT-authenticated
- Queries are validated as read-only by the server before being forwarded
- Credentials are decrypted locally and never transmitted through the tunnel
- Use `NODE_EXTRA_CA_CERTS` instead of `--insecure` whenever possible

## Requirements

- Node.js 18+

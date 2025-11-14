# Server environment configuration

This server supports loading collections and Postman-style environment files from configurable directories.

Environment variables

- `COLLECTIONS_DIR` — directory that contains Postman collection JSON files. Defaults to `./data/collections` at the project root (you can override with the COLLECTIONS_DIR env var).
- `ENV_DIR` — directory that contains Postman environment files (JSON or `.postman_environment`). Defaults to `./data/environments` at the project root (you can override with the ENV_DIR env var).

Quick examples (Bash)

Start the server pointing to custom folders for collections and environments:

```bash
# from the project server folder
COLLECTIONS_DIR="$HOME/newman/collections" ENV_DIR="$HOME/newman/environments" node server.js
```

Persisting in the npm start script

Edit `server/package.json` and set the `start` script (Linux/macOS) to export the env vars before starting:

```json
{
  "scripts": {
  "start": "COLLECTIONS_DIR=\"$HOME/newman/collections\" ENV_DIR=\"$HOME/newman/environments\" node server.js"
  }
}
```

Systemd / Docker

- For systemd services, set `Environment=` in the unit file:

```
[Service]
Environment=COLLECTIONS_DIR=/srv/newman/collections
Environment=ENV_DIR=/srv/newman/environments
ExecStart=/usr/bin/node /path/to/server/server.js
```

- For Docker Compose, set the environment in the service block:

```yaml
services:
  newman-server:
    image: node:18
    volumes:
      - ./server:/app/server
      - /srv/newman/collections:/collections
      - /srv/newman/environments:/environments
    working_dir: /app/server
    environment:
      - COLLECTIONS_DIR=/collections
      - ENV_DIR=/environments
    command: node server.js
```

Notes

- The server will auto-create the default `./data/collections` and `./data/environments` directories if they don't exist and are writable.
- The `/apis` endpoint returns basenames (without extension) of collection files found in `COLLECTIONS_DIR`.
- The `/environments` endpoint lists environment basenames found in both `ENV_DIR` and `COLLECTIONS_DIR` (many users keep `.postman_environment` files next to collections).
- If you see unwanted artifacts (e.g. `*.json:Zone`), clean them from the directory or enable filtering in the server config.

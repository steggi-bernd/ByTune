# The sync service

Keeps playlists, where playback stopped and the order of Liked Songs the same on all your devices. Which songs are liked and how often they played doesn't need it: those go through Jellyfin's own favorites and play counts.

It holds no music and has no accounts of its own: a client signs in with its Jellyfin login, and each Jellyfin user has their own documents. Merging is done by the apps; the service stores documents with a revision number and keeps the last 20 versions of the playlists under `versions/`.

## Running it

On the machine with your Jellyfin container:

```bash
JELLYFIN_NETWORK=<network Jellyfin is on> DATA_PATH=/path/for/its/data docker compose up -d --build
```

| Setting | Default | |
|---|---|---|
| `JELLYFIN_NETWORK` | `jellyfin` | the Docker network Jellyfin's container is on (`docker inspect jellyfin`) |
| `JELLYFIN_URL` | `http://jellyfin:8096` | how the service reaches Jellyfin on that network |
| `DATA_PATH` | `./data` | where the documents live; must be writable by user 1000 |
| `SYNC_PORT` | `8196` | the port on your network |

The apps look for it on the same host as your Jellyfin server, on port 8196. Somewhere else: enter its address in the app's settings.

It speaks plain HTTP like a Jellyfin server on your home network does. Anywhere else, put it behind the same TLS proxy or tunnel as Jellyfin: when Jellyfin's address starts with `https://`, the apps look for the service under that name, at `/songsta-sync`. With a Cloudflare tunnel:

```yaml
ingress:
  - hostname: jellyfin.example.org
    path: ^/songsta-sync/
    service: http://localhost:8196
  - hostname: jellyfin.example.org
    service: http://localhost:8096
  - service: http_status:404
```

## Without Docker

Node 24, no dependencies:

```bash
JELLYFIN_URL=http://localhost:8096 DATA_DIR=./data node server.mjs
```

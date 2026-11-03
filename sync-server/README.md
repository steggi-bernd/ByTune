# The sync service

Keeps playlists, where playback stopped, muted songs and the order of Liked Songs the same on all your devices, and lets them see and steer each other. Which songs are liked and how often they played doesn't need it: those go through Jellyfin's own favorites and play counts.

It holds no music and has no accounts of its own: a client signs in with its Jellyfin login, and each Jellyfin user has their own documents. Merging is done by the apps; the service stores documents with a revision number and keeps the last 20 versions of the playlists under `versions/`.

## Running it

On the machine with your Jellyfin container, in this folder or the unpacked `songsta-sync.zip` from the [Releases page](https://github.com/steggi-bernd/Songsta/releases/latest):

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

## What the apps ask of it

Everything takes the client's Jellyfin login.

| | |
|---|---|
| `GET`/`PUT /v1/docs/:name` | a document with its revision: `playlists` (merged by the apps), `queue`, `position`, `likes`, `muted` |
| `GET /v1/changes?since=&wait=&device=` | waits until something changed; answers the revisions and whether commands wait for this device |
| `GET /v1/devices` | the user's devices: what each one plays, and how long ago it said so |
| `PUT /v1/devices/:id` | what this device plays right now |
| `POST /v1/devices/:id/commands` | asks another device for something: play, pause, next, seek, take over |
| `GET /v1/devices/:id/commands` | this device's waiting commands, which leave the list by being read |

Commands stay for 60 seconds and live only in memory: a device that's off isn't surprised by old ones.

## Without Docker

Node 24, no dependencies:

```bash
JELLYFIN_URL=http://localhost:8096 DATA_DIR=./data node server.mjs
```

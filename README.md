# virtualdj-connect

Library to receive track metadata from **VirtualDJ**. Two ways to read what's
playing:

- **M3U history watcher** — polls VirtualDJ's `History/*.m3u` files (title,
  artist, file path). Works on every VirtualDJ install with history enabled.
- **Network Control client** — HTTP-polls VirtualDJ's
  [Network Control Plugin](https://virtualdj.com/wiki/NetworkControlPlugin.html)
  for richer per-deck data (BPM, key, genre, album, duration, audible state).
  Requires the plugin to be enabled in VirtualDJ.

Supports VirtualDJ 7 and 8 on macOS and Windows.

## Installation

```bash
npm install virtualdj-connect
```

## Usage — M3U history watcher

```typescript
import { VirtualDjConnect } from 'virtualdj-connect';

const vdj = new VirtualDjConnect({
  pollIntervalMs: 5000,
});

vdj.on('ready', ({ basePath }) => {
  console.log(`Watching: ${basePath}`);
});

vdj.on('track', (payload) => {
  console.log(`Now playing: ${payload.artist} - ${payload.title}`);
  if (payload.filePath) console.log(`File: ${payload.filePath}`);
});

vdj.on('error', (err) => {
  console.error('Error:', err);
});

await vdj.start();

// Later...
await vdj.stop();
```

## Usage — Network Control Plugin

Enable the Network Control plugin in VirtualDJ first (Options → Network
Control). Then:

```typescript
import { VirtualDjNetworkControl } from 'virtualdj-connect';

const nc = new VirtualDjNetworkControl({
  host: '127.0.0.1',
  port: 8080,
  bearer: 'your-password', // if configured
  pollIntervalMs: 1000,
});

nc.on('track', (payload) => {
  console.log(`Deck ${payload.deck}: ${payload.artist} - ${payload.title}`);
  console.log(`  ${payload.bpm} BPM, key ${payload.key}, ${payload.duration}s`);
});

await nc.start();
```

## API

### `new VirtualDjConnect(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `basePath` | `string` | auto-detected | Path to VirtualDJ settings folder |
| `pollIntervalMs` | `number` | `5000` | How often to poll the M3U history files |
| `logger` | `Logger` | `noopLogger` | Logger implementation |

### `new VirtualDjNetworkControl(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | `string` | `127.0.0.1` | Host running VirtualDJ |
| `port` | `number` | `8080` | Network Control plugin port |
| `bearer` | `string` | — | Bearer password if configured in the plugin |
| `decks` | `number[]` | `[1,2,3,4]` | Decks to scan |
| `pollIntervalMs` | `number` | `1000` | How often to query the plugin |
| `logger` | `Logger` | `noopLogger` | Logger implementation |

### Events

Both classes emit:

| Event | Payload | Description |
|-------|---------|-------------|
| `ready` | `{ basePath }` (M3U only) | Connector is ready |
| `track` | `VirtualDjTrackPayload` | New track detected |
| `error` | `Error` | An error occurred |

### `VirtualDjTrackPayload`

- `title`, `artist`, `remix`, `album`, `genre`, `key`
- `bpm` — original BPM (unaffected by pitch), when known
- `duration` — track length in seconds, when known
- `deck` — deck number (1-4), when known
- `isOnAir` — true when VirtualDJ reported the deck as audible
- `filePath`, `fileLocation`
- `isBeatportStream`, `beatportId` — set when the track is a Beatport stream

### Detection utilities

- `getDefaultVirtualDjPath()` — Returns the default VirtualDJ settings folder
  for the current platform (VDJ 8 preferred, falls back to VDJ 7)
- `detectVirtualDjInstallation(customPath?)` — Returns
  `{ found, path, version, hasHistory, writeHistoryEnabled }`
- `pickOnAirDeck(snapshots)` — Helper to pick the on-air deck from a set of
  Network Control snapshots

### Low-level

- `VirtualDjM3uParser` — Parses VirtualDJ's M3U history files directly

## License

MIT

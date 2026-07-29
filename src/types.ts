import EventEmitter from 'node:events';
import type { StrictEventEmitter } from 'strict-event-emitter-types';
import type { Logger } from './types/logger.js';

/**
 * Configuration options for VirtualDjConnect
 */
export type VirtualDjConnectOptions = {
  /** Custom base path for VirtualDJ settings. If omitted, auto-detects. */
  basePath?: string;
  /** How frequently to poll the history files (ms). Default: 5000 */
  pollIntervalMs?: number;
  /** Logger instance. If omitted, logging is disabled. */
  logger?: Logger;
};

/**
 * A track entry parsed from a VirtualDJ M3U history file
 */
export interface VirtualDjTrack {
  /** Unique hash ID for change detection */
  id: string;
  /** Track title */
  title?: string;
  /** Track artist */
  artist?: string;
  /** Remix/version info */
  remix?: string;
  /** File path or netsearch URL */
  fileLocation: string;
  /** Time the track was played (from M3U) */
  time?: Date;
  /** Timestamp of last play */
  lastPlayTime?: Date;
}

/**
 * A track entry from VirtualDJ's database.xml
 */
export interface VirtualDjDbTrack {
  title?: string;
  artist?: string;
  album?: string;
  label?: string;
  remix?: string;
  bpm?: number;
  key?: string;
  comment?: string;
  filePath?: string;
}

/**
 * Payload emitted when a new track is detected.
 *
 * Extra metadata fields (album, genre, key, bpm, duration, deck) are populated
 * by the Network Control Plugin client when available. The M3U watcher only
 * sets title/artist/filePath.
 */
export type VirtualDjTrackPayload = {
  title: string;
  artist: string;
  remix?: string;
  album?: string;
  genre?: string;
  key?: string;
  /** Original BPM (unaffected by pitch), when known. */
  bpm?: number;
  /** Track length in seconds, when known. */
  duration?: number;
  /** Deck (1-4) the track is loaded on, when known. */
  deck?: number;
  /**
   * Whether VirtualDJ reported this deck as audible (`is_audible`) **at the
   * moment the track was detected**. This is a snapshot, not live state — a
   * track cued silently and then played keeps `isOnAir: false`, because
   * playing it is not a new song and does not re-fire `track`. Subscribe to
   * the `onair` event on VirtualDjNetworkControl for live audibility.
   */
  isOnAir?: boolean;
  filePath?: string;
  fileLocation: string;
  isBeatportStream: boolean;
  beatportId?: number;
};

/**
 * Info about a detected VirtualDJ installation
 */
export type VirtualDjInstallation = {
  /** Whether VirtualDJ was found */
  found: boolean;
  /** Path to VirtualDJ settings folder */
  path: string;
  /** Detected version ('v7' or 'v8') */
  version: 'v7' | 'v8' | 'unknown';
  /** Whether the History directory exists */
  hasHistory: boolean;
  /** Whether writeHistory is enabled in settings */
  writeHistoryEnabled: boolean;
};

/**
 * Events emitted by VirtualDjConnect
 */
export interface VirtualDjConnectEvents {
  /** Emitted when the connector is ready and has loaded initial data */
  ready: (info: { basePath: string }) => void;
  /** Emitted when a new track is detected */
  track: (payload: VirtualDjTrackPayload) => void;
  /** Emitted on errors */
  error: (err: Error) => void;
}

/**
 * Events emitted by VirtualDjNetworkControl, which can additionally report
 * mixer-wide state the M3U history watcher has no visibility into.
 */
export interface VirtualDjNetworkControlEvents extends VirtualDjConnectEvents {
  /**
   * Emitted when VirtualDJ's Sandbox mode is engaged (`true`) or released
   * (`false`). While engaged, deck polling is suspended and the last on-air
   * track is held, so no `track` events are emitted.
   */
  sandbox: (active: boolean) => void;
  /**
   * Emitted when the audible deck changes — including going fully silent
   * (`active === false`, where `deck` is meaningless and reports the deck that
   * just went off air).
   *
   * This is the live counterpart to the `isOnAir` field on a track payload,
   * which is only a snapshot from the moment the song was detected. Audibility
   * changes many times during a song, so it gets its own event rather than
   * re-firing `track` — a `track` event means a new song, and consumers that
   * log history depend on that.
   *
   * Not emitted while Sandbox mode is engaged: deck audibility is meaningless
   * then, and the audience is still hearing the held track.
   */
  onair: (active: boolean, deck: number) => void;
}

export type TypedEmitter = StrictEventEmitter<
  EventEmitter,
  VirtualDjConnectEvents
>;

export type NetworkControlTypedEmitter = StrictEventEmitter<
  EventEmitter,
  VirtualDjNetworkControlEvents
>;

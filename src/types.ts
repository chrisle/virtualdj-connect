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
 * Payload emitted when a new track is detected
 */
export type VirtualDjTrackPayload = {
  title: string;
  artist: string;
  remix?: string;
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

export type TypedEmitter = StrictEventEmitter<EventEmitter, VirtualDjConnectEvents>;

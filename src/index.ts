/**
 * virtualdj-connect - A library for reading VirtualDJ M3U history files.
 *
 * Features:
 * - Real-time history monitoring with events
 * - M3U history file parsing
 * - VirtualDJ installation detection (v7 and v8)
 * - writeHistory setting check
 *
 * @module virtualdj-connect
 */

// Main connector class
export {
  VirtualDjConnect,
  getDefaultVirtualDjPath,
  detectVirtualDjInstallation,
} from './virtualdjConnect.js';

// M3U parser
export { VirtualDjM3uParser } from './m3uParser.js';

// Network Control Plugin client
export { VirtualDjNetworkControl, pickOnAirDeck } from './networkControl.js';
export type { VirtualDjNetworkControlOptions } from './networkControl.js';

// Logger
export type { Logger } from './types/logger.js';
export { noopLogger } from './types/logger.js';

// Core types
export type {
  VirtualDjConnectOptions,
  VirtualDjConnectEvents,
  VirtualDjNetworkControlEvents,
  VirtualDjTrack,
  VirtualDjDbTrack,
  VirtualDjTrackPayload,
  VirtualDjInstallation,
} from './types.js';

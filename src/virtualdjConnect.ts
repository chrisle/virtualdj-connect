/**
 * @fileoverview VirtualDjConnect - Event-based VirtualDJ history reader.
 * Monitors VirtualDJ M3U history files and emits events when tracks change.
 */

import EventEmitter from 'node:events';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { type Logger, noopLogger } from './types/logger.js';
import type { VirtualDjTrack, VirtualDjTrackPayload } from './types.js';
import { VirtualDjM3uParser } from './m3uParser.js';
import type {
  VirtualDjConnectOptions,
  VirtualDjInstallation,
  TypedEmitter,
} from './types.js';

const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * Get the default VirtualDJ settings path based on platform.
 * Checks VDJ 8 first, then VDJ 7.
 */
export function getDefaultVirtualDjPath(): string {
  const checkPath = (p: string): boolean => {
    // Check for settings.xml (always present) or database.xml (created after adding tracks)
    return existsSync(join(p, 'settings.xml')) || existsSync(join(p, 'database.xml'));
  };

  if (process.platform === 'darwin') {
    const vdj8Path = join(homedir(), 'Library', 'Application Support', 'VirtualDJ');
    if (checkPath(vdj8Path)) return vdj8Path;

    const vdj7Path = join(homedir(), 'Documents', 'VirtualDJ');
    if (checkPath(vdj7Path)) return vdj7Path;
  } else if (process.platform === 'win32') {
    const vdj8Path = join(homedir(), 'AppData', 'Local', 'VirtualDJ');
    if (checkPath(vdj8Path)) return vdj8Path;

    const vdj7Path = join(homedir(), 'Documents', 'VirtualDJ');
    if (checkPath(vdj7Path)) return vdj7Path;
  }

  return '';
}

/**
 * Detect VirtualDJ installation and return details.
 */
export function detectVirtualDjInstallation(customPath?: string): VirtualDjInstallation {
  const basePath = customPath || getDefaultVirtualDjPath();

  if (!basePath) {
    return {
      found: false,
      path: '',
      version: 'unknown',
      hasHistory: false,
      writeHistoryEnabled: false,
    };
  }

  const found = existsSync(basePath);
  const hasHistory = found && existsSync(join(basePath, 'History'));

  // Detect version by path
  let version: 'v7' | 'v8' | 'unknown' = 'unknown';
  if (found) {
    if (basePath.includes('Application Support') || basePath.includes('AppData')) {
      version = 'v8';
    } else if (basePath.includes('Documents')) {
      version = 'v7';
    }
  }

  // Check writeHistory setting
  const parser = new VirtualDjM3uParser({ basePath });
  const writeHistoryEnabled = parser.checkWriteHistory();

  return {
    found,
    path: basePath,
    version,
    hasHistory,
    writeHistoryEnabled,
  };
}

/**
 * VirtualDjConnect monitors VirtualDJ M3U history files and emits events
 * when tracks change.
 */
export class VirtualDjConnect extends (EventEmitter as new () => TypedEmitter) {
  private pollIntervalMs: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private m3uParser: VirtualDjM3uParser;
  private lastTrackId: string = '';
  private isRunning: boolean = false;
  private logger: Logger;

  constructor(options: VirtualDjConnectOptions = {}) {
    super();
    this.logger = options.logger ?? noopLogger;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.m3uParser = new VirtualDjM3uParser({
      basePath: options.basePath,
      logger: this.logger,
    });
  }

  /**
   * Get the detected base path.
   */
  get basePath(): string {
    return this.m3uParser.basePath;
  }

  /**
   * Check if currently running.
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Check if writeHistory is enabled in VirtualDJ settings.
   */
  checkWriteHistory(): boolean {
    return this.m3uParser.checkWriteHistory();
  }

  /**
   * Start monitoring VirtualDJ history files.
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    if (!this.m3uParser.basePath) {
      this.emit('error', new Error('VirtualDJ installation not found'));
      return;
    }

    this.isRunning = true;

    // Load initial track
    const currentTrack = this.m3uParser.getLatestTrack();
    if (currentTrack) {
      this.lastTrackId = currentTrack.id;
      this.emit('track', this.buildPayload(currentTrack));
    }

    // Start polling
    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);

    this.logger.info(
      `Monitoring VirtualDJ at ${this.m3uParser.basePath} (poll interval: ${this.pollIntervalMs}ms)`
    );

    this.emit('ready', { basePath: this.m3uParser.basePath });
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.isRunning = false;
    this.lastTrackId = '';
  }

  /**
   * Set the polling interval.
   * Takes effect immediately if currently running.
   */
  setPollInterval(intervalMs: number): void {
    this.pollIntervalMs = intervalMs;

    if (this.isRunning && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => this.poll(), intervalMs);
    }
  }

  /**
   * Get the current polling interval.
   */
  get pollInterval(): number {
    return this.pollIntervalMs;
  }

  /**
   * Build a track payload from a parsed VirtualDJ track.
   */
  private buildPayload(track: VirtualDjTrack): VirtualDjTrackPayload {
    const title = track.title || '';
    const artist = track.artist || '';
    const filePath = track.fileLocation && !track.fileLocation.startsWith('netsearch://')
      ? track.fileLocation : undefined;
    const bpMatch = /netsearch:\/\/bp(\d+)/.exec(track.fileLocation);
    return {
      title: title || 'Unknown Title',
      artist: artist || 'Unknown Artist',
      remix: track.remix,
      filePath,
      fileLocation: track.fileLocation,
      isBeatportStream: !!bpMatch,
      beatportId: bpMatch ? parseInt(bpMatch[1], 10) : undefined,
    };
  }

  /**
   * Poll for track changes.
   */
  private poll(): void {
    try {
      const track = this.m3uParser.getLatestTrack();

      if (!track || !track.id) {
        return;
      }

      if (track.id === this.lastTrackId) {
        return;
      }

      this.lastTrackId = track.id;
      this.emit('track', this.buildPayload(track));
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }
}

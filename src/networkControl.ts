/**
 * @fileoverview VirtualDjNetworkControl - HTTP client for VirtualDJ's
 * Network Control Plugin. Polls `/query` to read VDJScript values for
 * the on-air deck and emits track-change events.
 *
 * Wiki: https://virtualdj.com/wiki/NetworkControlPlugin.html
 */

import EventEmitter from 'node:events';
import { type Logger, noopLogger } from './types/logger.js';
import type {
  TypedEmitter,
  VirtualDjTrackPayload,
} from './types.js';

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;
const DEFAULT_DECKS = [1, 2, 3, 4] as const;

/**
 * Options for VirtualDjNetworkControl.
 */
export type VirtualDjNetworkControlOptions = {
  /** Host running VirtualDJ with Network Control enabled. Default: 127.0.0.1 */
  host?: string;
  /** TCP port the Network Control plugin listens on. Default: 8080 */
  port?: number;
  /** Bearer password configured in the Network Control plugin. Optional. */
  bearer?: string;
  /** Decks to scan for the audible track. Default: [1,2,3,4] */
  decks?: readonly number[];
  /** Poll interval in milliseconds. Default: 1000 */
  pollIntervalMs?: number;
  /** Logger instance. If omitted, logging is disabled. */
  logger?: Logger;
  /** Injectable fetch for testing. Defaults to global fetch. */
  fetchFn?: typeof fetch;
};

type DeckSnapshot = {
  deck: number;
  loaded: boolean;
  audible: boolean;
  title: string;
  artist: string;
  album: string;
  path: string;
};

/**
 * Detect Beatport streaming URLs the same way the M3U parser does.
 */
function detectBeatport(fileLocation: string): { isBeatportStream: boolean; beatportId?: number } {
  const match = /netsearch:\/\/bp(\d+)/.exec(fileLocation);
  if (!match) return { isBeatportStream: false };
  return { isBeatportStream: true, beatportId: parseInt(match[1]!, 10) };
}

/**
 * VirtualDjNetworkControl polls the VirtualDJ Network Control Plugin
 * over HTTP and emits track-change events compatible with
 * VirtualDjConnect's event surface.
 */
export class VirtualDjNetworkControl extends (EventEmitter as new () => TypedEmitter) {
  private host: string;
  private port: number;
  private bearer: string | undefined;
  private decks: readonly number[];
  private pollIntervalMs: number;
  private logger: Logger;
  private fetchFn: typeof fetch;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private lastSignature = '';

  constructor(options: VirtualDjNetworkControlOptions = {}) {
    super();
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
    this.bearer = options.bearer;
    this.decks = options.decks ?? DEFAULT_DECKS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.logger = options.logger ?? noopLogger;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  get running(): boolean {
    return this.isRunning;
  }

  get baseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  get pollInterval(): number {
    return this.pollIntervalMs;
  }

  /**
   * Start polling the plugin. Emits `ready` once the first handshake succeeds,
   * `track` on each new audible track, and `error` on reachability failures.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      await this.handshake();
    } catch (err) {
      this.isRunning = false;
      const e = err instanceof Error ? err : new Error(String(err));
      this.emit('error', new Error(`Network Control handshake failed: ${e.message}`));
      return;
    }

    this.logger.info(
      `Polling VirtualDJ Network Control at ${this.baseUrl} every ${this.pollIntervalMs}ms`,
    );
    this.emit('ready', { basePath: this.baseUrl });

    // Run first poll immediately so we don't wait for the first interval.
    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  /**
   * Stop polling and clear internal state.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isRunning = false;
    this.lastSignature = '';
  }

  /**
   * Update the polling interval. Takes effect immediately if running.
   */
  setPollInterval(intervalMs: number): void {
    this.pollIntervalMs = intervalMs;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => void this.poll(), this.pollIntervalMs);
    }
  }

  /**
   * Evaluate any VDJScript expression and return the raw text response.
   * Public so callers can probe additional state (e.g. get_clock, automix).
   */
  async query(script: string): Promise<string> {
    const url = new URL('/query', this.baseUrl);
    url.searchParams.set('script', script);
    if (this.bearer) url.searchParams.set('bearer', this.bearer);

    const res = await this.fetchFn(url.toString(), {
      method: 'GET',
      headers: this.bearer ? { Authorization: `Bearer ${this.bearer}` } : {},
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} on query "${script}"`);
    }
    return (await res.text()).trim();
  }

  private async handshake(): Promise<void> {
    // `get_clock` is the wiki's canonical smoke-test query. If the plugin is
    // reachable and the bearer is correct, this returns a time value.
    await this.query('get_clock');
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const snapshots = await this.readAllDecks();
      const picked = pickOnAirDeck(snapshots);
      if (!picked) {
        return;
      }

      const signature = `${picked.artist}|${picked.title}|${picked.path}`;
      if (signature === this.lastSignature) return;

      this.lastSignature = signature;
      this.emit('track', this.buildPayload(picked));
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async readAllDecks(): Promise<DeckSnapshot[]> {
    const results: DeckSnapshot[] = [];
    for (const deck of this.decks) {
      const snapshot = await this.readDeck(deck);
      if (snapshot) results.push(snapshot);
    }
    return results;
  }

  private async readDeck(deck: number): Promise<DeckSnapshot | null> {
    const prefix = `deck ${deck} `;
    try {
      // Check if a song is loaded first to avoid querying six fields for empty decks.
      const loaded = parseBool(await this.query(`${prefix}loaded`));
      if (!loaded) {
        return {
          deck,
          loaded: false,
          audible: false,
          title: '',
          artist: '',
          album: '',
          path: '',
        };
      }

      const [audibleRaw, title, artist, album, path] = await Promise.all([
        this.query(`${prefix}is_audible`),
        this.query(`${prefix}get_loaded_song 'title'`),
        this.query(`${prefix}get_loaded_song 'artist'`),
        this.query(`${prefix}get_loaded_song 'album'`),
        this.query(`${prefix}get_path`),
      ]);

      return {
        deck,
        loaded: true,
        audible: parseBool(audibleRaw),
        title: stripQuotes(title),
        artist: stripQuotes(artist),
        album: stripQuotes(album),
        path: stripQuotes(path),
      };
    } catch (err) {
      this.logger.debug(`readDeck ${deck} failed: ${(err as Error).message}`);
      return null;
    }
  }

  private buildPayload(snapshot: DeckSnapshot): VirtualDjTrackPayload {
    const fileLocation = snapshot.path;
    const { isBeatportStream, beatportId } = detectBeatport(fileLocation);

    const filePath =
      fileLocation && !fileLocation.startsWith('netsearch://')
        ? fileLocation
        : undefined;

    return {
      title: snapshot.title || 'Unknown Title',
      artist: snapshot.artist || 'Unknown Artist',
      filePath,
      fileLocation,
      isBeatportStream,
      beatportId,
    };
  }
}

/**
 * Prefer audible decks; fall back to any loaded deck so we still display
 * something in the overlay when the DJ pauses or loads a track silently.
 */
export function pickOnAirDeck(snapshots: DeckSnapshot[]): DeckSnapshot | null {
  const audible = snapshots.find((s) => s.audible && s.loaded);
  if (audible) return audible;
  const anyLoaded = snapshots.find((s) => s.loaded);
  return anyLoaded ?? null;
}

function parseBool(raw: string): boolean {
  return /^true$/i.test(raw.trim());
}

/**
 * VDJScript query responses sometimes come back wrapped in single or double
 * quotes. Strip exactly one matching pair.
 */
function stripQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

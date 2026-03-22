/**
 * @fileoverview VirtualDJ M3U history file parser.
 * Parses VirtualDJ's date-based M3U history files to extract track information.
 */

import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { Logger } from './types/logger.js';
import { noopLogger } from './types/logger.js';
import type { VirtualDjTrack } from './types.js';

/**
 * Parse VirtualDJ M3U history files.
 */
export class VirtualDjM3uParser {
  historyFile: string = '';
  basePath: string = '';
  private logger: Logger;

  constructor(options?: { basePath?: string; logger?: Logger }) {
    this.logger = options?.logger ?? noopLogger;
    this.basePath = options?.basePath || this.findBaseSettingsPath();
  }

  /**
   * Get the latest track from VirtualDJ history.
   */
  getLatestTrack(): VirtualDjTrack | undefined {
    const m3uFile = this.getLastM3uFile();
    if (!m3uFile) {
      return undefined;
    }

    this.historyFile = m3uFile;
    const tracks = this.parseM3uFile();

    if (tracks.length > 0) {
      return tracks[tracks.length - 1];
    }

    return undefined;
  }

  /**
   * Check if writeHistory is enabled in VirtualDJ settings.xml.
   * VirtualDJ needs this enabled to write M3U history files that we parse.
   * Returns true if enabled or if settings.xml can't be read (assume enabled by default).
   */
  checkWriteHistory(): boolean {
    if (!this.basePath) return false;

    const settingsPath = join(this.basePath, 'settings.xml');
    if (!existsSync(settingsPath)) {
      this.logger.debug('No settings.xml found, assuming writeHistory enabled');
      return true;
    }

    try {
      const content = readFileSync(settingsPath, { encoding: 'utf-8' });
      const match = /<writeHistory>(.*?)<\/writeHistory>/i.exec(content);
      if (!match) {
        this.logger.debug('writeHistory not found in settings.xml, assuming enabled');
        return true;
      }

      const value = match[1].trim().toLowerCase();
      const enabled = value === 'yes' || value === 'true' || value === '1';
      this.logger.debug(`writeHistory = ${match[1]} (enabled: ${enabled})`);
      return enabled;
    } catch (error) {
      this.logger.warn('Failed to read settings.xml:', error);
      return true;
    }
  }

  /**
   * Parse the VirtualDJ M3U file.
   */
  private parseM3uFile(): VirtualDjTrack[] {
    const contents = readFileSync(this.historyFile, { encoding: 'utf-8' });
    const lines = contents.split(/\r?\n/);

    const extract = (tag: string, from: string): string => {
      const regex = new RegExp(`<${tag}>(.*)</${tag}>`);
      const result = regex.exec(from);
      return result ? result[1] : '';
    };

    const parseTime = (time: string): Date | undefined => {
      if (!time) return undefined;
      const [hours, minutes] = time.split(':').map(Number);
      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      return date;
    };

    const parseTimestamp = (timestamp: string): Date | undefined => {
      if (!timestamp) return undefined;
      const ms = parseInt(timestamp, 10);
      return isNaN(ms) ? undefined : new Date(ms);
    };

    const tracks: VirtualDjTrack[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^#EXTVDJ/.test(line)) {
        const track: VirtualDjTrack = {
          time: parseTime(extract('time', line)),
          lastPlayTime: parseTimestamp(extract('lastplaytime', line)),
          artist: extract('artist', line) || undefined,
          title: extract('title', line) || undefined,
          remix: extract('remix', line) || undefined,
          fileLocation: lines[i + 1] || '',
          id: '',
        };
        track.id = createHash('md5')
          .update(JSON.stringify(track))
          .digest('hex');
        tracks.push(track);
      }
    }

    return tracks;
  }

  /**
   * Get the most recent M3U history file.
   */
  private getLastM3uFile(): string | undefined {
    if (!this.basePath) {
      this.logger.error('Could not find VirtualDJ base settings path');
      return undefined;
    }

    try {
      const historyPath = join(this.basePath, 'History');
      if (!existsSync(historyPath)) {
        this.logger.error(`VirtualDJ history directory not found: ${historyPath}`);
        return undefined;
      }

      const files = readdirSync(historyPath);
      if (!files.length) {
        this.logger.error('No files in VirtualDJ history directory');
        return undefined;
      }

      const m3uFiles = files
        .filter((f) => /\d{4}-\d{2}-\d{2}\.m3u$/.test(f))
        .sort();

      if (!m3uFiles.length) {
        this.logger.error('No M3U history files found');
        return undefined;
      }

      const lastFile = m3uFiles[m3uFiles.length - 1];
      return join(historyPath, lastFile);
    } catch (error) {
      this.logger.error('Error finding VirtualDJ history:', error);
      return undefined;
    }
  }

  /**
   * Find VirtualDJ 7 or 8 settings path.
   */
  private findBaseSettingsPath(): string {
    const checkPath = (p: string): boolean => {
      return existsSync(join(p, 'database.xml'));
    };

    if (process.platform === 'darwin') {
      const vdj8Path = join(homedir(), 'Library', 'Application Support', 'VirtualDJ');
      if (checkPath(vdj8Path)) {
        this.logger.debug(`Found VDJ8 at: ${vdj8Path}`);
        return vdj8Path;
      }

      const vdj7Path = join(homedir(), 'Documents', 'VirtualDJ');
      if (checkPath(vdj7Path)) {
        this.logger.debug(`Found VDJ7 at: ${vdj7Path}`);
        return vdj7Path;
      }
    } else if (process.platform === 'win32') {
      const vdj8Path = join(homedir(), 'AppData', 'Local', 'VirtualDJ');
      if (checkPath(vdj8Path)) {
        this.logger.debug(`Found VDJ8 at: ${vdj8Path}`);
        return vdj8Path;
      }

      const vdj7Path = join(homedir(), 'Documents', 'VirtualDJ');
      if (checkPath(vdj7Path)) {
        this.logger.debug(`Found VDJ7 at: ${vdj7Path}`);
        return vdj7Path;
      }
    }

    this.logger.warn('Could not find VirtualDJ installation');
    return '';
  }
}

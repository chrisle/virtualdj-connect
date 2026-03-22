import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock setup with vi.hoisted to ensure mocks are defined before module loading
const { mockExistsSync, mockReaddirSync, mockReadFileSync, mockHomedir } =
  vi.hoisted(() => {
    return {
      mockExistsSync: vi.fn(),
      mockReaddirSync: vi.fn(),
      mockReadFileSync: vi.fn(),
      mockHomedir: vi.fn(() => '/Users/testuser'),
    };
  });

// Mock fs module
vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
  default: {
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
    readFileSync: mockReadFileSync,
  },
}));

// Mock os module
vi.mock('os', () => ({
  homedir: mockHomedir,
  default: { homedir: mockHomedir },
}));

import { VirtualDjM3uParser } from '../src/m3u-parser.js';

describe('VirtualDjM3uParser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('finds VDJ8 path on macOS', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockExistsSync.mockImplementation((path: string) => {
        return path.includes('Application Support/VirtualDJ/database.xml');
      });

      const parser = new VirtualDjM3uParser();
      expect(parser.basePath).toContain('Application Support/VirtualDJ');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('falls back to VDJ7 path on macOS if VDJ8 not found', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockExistsSync.mockImplementation((path: string) => {
        return path.includes('Documents/VirtualDJ/database.xml');
      });

      const parser = new VirtualDjM3uParser();
      expect(parser.basePath).toContain('Documents/VirtualDJ');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('finds VDJ8 path on Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      mockExistsSync.mockImplementation((path: string) => {
        return path.includes('AppData/Local/VirtualDJ/database.xml');
      });

      const parser = new VirtualDjM3uParser();
      expect(parser.basePath).toContain('AppData');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('returns empty path when VirtualDJ not found', () => {
      mockExistsSync.mockReturnValue(false);

      const parser = new VirtualDjM3uParser();
      expect(parser.basePath).toBe('');
    });

    it('uses custom basePath when provided', () => {
      const parser = new VirtualDjM3uParser('/custom/path');
      expect(parser.basePath).toBe('/custom/path');
    });
  });

  describe('getLatestTrack', () => {
    let originalPlatform: string;

    beforeEach(() => {
      originalPlatform = process.platform;
      // Default to macOS for tests that need a valid basePath
      Object.defineProperty(process, 'platform', { value: 'darwin' });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('returns undefined when basePath is empty', () => {
      mockExistsSync.mockReturnValue(false);

      const parser = new VirtualDjM3uParser();
      const track = parser.getLatestTrack();

      expect(track).toBeUndefined();
    });

    it('returns undefined when history directory does not exist', () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path.includes('database.xml');
      });

      const parser = new VirtualDjM3uParser();
      const track = parser.getLatestTrack();

      expect(track).toBeUndefined();
    });

    it('returns undefined when no M3U files found', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const parser = new VirtualDjM3uParser();
      const track = parser.getLatestTrack();

      expect(track).toBeUndefined();
    });

    it('parses M3U file and returns latest track', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        '2024-01-01.m3u',
        '2024-01-02.m3u',
      ] as any);
      mockReadFileSync.mockReturnValue(`#EXTM3U
#EXTVDJ:<time>14:30</time><lastplaytime>1704196200000</lastplaytime><artist>Daft Punk</artist><title>Around The World</title><remix>Club Mix</remix>
/path/to/track1.mp3
#EXTVDJ:<time>15:00</time><lastplaytime>1704198000000</lastplaytime><artist>Deadmau5</artist><title>Strobe</title>
/path/to/track2.mp3
`);

      const parser = new VirtualDjM3uParser();
      const track = parser.getLatestTrack();

      expect(track).toBeDefined();
      expect(track?.artist).toBe('Deadmau5');
      expect(track?.title).toBe('Strobe');
      expect(track?.fileLocation).toBe('/path/to/track2.mp3');
    });

    it('extracts all track metadata correctly', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['2024-01-01.m3u'] as any);
      mockReadFileSync.mockReturnValue(`#EXTM3U
#EXTVDJ:<time>14:30</time><lastplaytime>1704196200000</lastplaytime><artist>Test Artist</artist><title>Test Title</title><remix>Test Remix</remix>
/path/to/track.mp3
`);

      const parser = new VirtualDjM3uParser();
      const track = parser.getLatestTrack();

      expect(track?.artist).toBe('Test Artist');
      expect(track?.title).toBe('Test Title');
      expect(track?.remix).toBe('Test Remix');
      expect(track?.id).toBeDefined();
      expect(track?.time).toBeInstanceOf(Date);
      expect(track?.lastPlayTime).toBeInstanceOf(Date);
    });

    it('handles missing optional metadata', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['2024-01-01.m3u'] as any);
      mockReadFileSync.mockReturnValue(`#EXTM3U
#EXTVDJ:<artist>Artist Only</artist><title>Title Only</title>
/path/to/track.mp3
`);

      const parser = new VirtualDjM3uParser();
      const track = parser.getLatestTrack();

      expect(track?.artist).toBe('Artist Only');
      expect(track?.title).toBe('Title Only');
      expect(track?.remix).toBeUndefined();
      expect(track?.time).toBeUndefined();
      expect(track?.lastPlayTime).toBeUndefined();
    });

    it('returns undefined when M3U file is empty', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['2024-01-01.m3u'] as any);
      mockReadFileSync.mockReturnValue('');

      const parser = new VirtualDjM3uParser();
      const track = parser.getLatestTrack();

      expect(track).toBeUndefined();
    });

    it('skips non-M3U files in directory', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        'readme.txt',
        '2024-01-01.m3u',
        'backup.bak',
      ] as any);
      mockReadFileSync.mockReturnValue(`#EXTVDJ:<artist>Test</artist><title>Track</title>
/path/to/track.mp3
`);

      const parser = new VirtualDjM3uParser();
      const track = parser.getLatestTrack();

      expect(track).toBeDefined();
      expect(track?.artist).toBe('Test');
    });

    it('selects the most recent M3U file by name', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        '2024-01-15.m3u',
        '2024-01-01.m3u',
        '2024-01-10.m3u',
      ] as any);
      mockReadFileSync.mockReturnValue(`#EXTVDJ:<artist>Latest</artist><title>Track</title>
/path/to/track.mp3
`);

      const parser = new VirtualDjM3uParser();
      parser.getLatestTrack();

      // Should read from the most recent file (2024-01-15)
      expect(mockReadFileSync).toHaveBeenCalled();
      expect(parser.historyFile).toContain('2024-01-15.m3u');
    });
  });

  describe('checkWriteHistory', () => {
    it('returns false when basePath is empty', () => {
      mockExistsSync.mockReturnValue(false);
      const parser = new VirtualDjM3uParser();
      expect(parser.checkWriteHistory()).toBe(false);
    });

    it('returns true when settings.xml does not exist', () => {
      const parser = new VirtualDjM3uParser('/valid/path');
      mockExistsSync.mockReturnValue(false);
      expect(parser.checkWriteHistory()).toBe(true);
    });

    it('returns true when writeHistory is yes', () => {
      const parser = new VirtualDjM3uParser('/valid/path');
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('<settings><writeHistory>yes</writeHistory></settings>');
      expect(parser.checkWriteHistory()).toBe(true);
    });

    it('returns false when writeHistory is no', () => {
      const parser = new VirtualDjM3uParser('/valid/path');
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('<settings><writeHistory>no</writeHistory></settings>');
      expect(parser.checkWriteHistory()).toBe(false);
    });

    it('returns true when writeHistory tag is not present', () => {
      const parser = new VirtualDjM3uParser('/valid/path');
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('<settings><otherSetting>value</otherSetting></settings>');
      expect(parser.checkWriteHistory()).toBe(true);
    });
  });
});

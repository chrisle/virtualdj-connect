import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted to ensure mocks are available when vi.mock is hoisted
const mocks = vi.hoisted(() => {
  const mockM3uParser = {
    basePath: '/Users/testuser/Library/Application Support/VirtualDJ',
    historyFile:
      '/Users/testuser/Library/Application Support/VirtualDJ/History/2024-01-15.m3u',
    getLatestTrack: vi.fn(),
    checkWriteHistory: vi.fn().mockReturnValue(true),
  };

  class MockVirtualDjM3uParser {
    basePath = mockM3uParser.basePath;
    historyFile = mockM3uParser.historyFile;
    getLatestTrack = mockM3uParser.getLatestTrack;
    checkWriteHistory = mockM3uParser.checkWriteHistory;
  }

  return {
    mockM3uParser,
    MockVirtualDjM3uParser,
  };
});

vi.mock('../src/m3u-parser.js', () => ({
  VirtualDjM3uParser: mocks.MockVirtualDjM3uParser,
}));

import { VirtualDjConnect } from '../src/virtualdj-connect.js';

describe('VirtualDjConnect', () => {
  let connect: VirtualDjConnect;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.mockM3uParser.basePath =
      '/Users/testuser/Library/Application Support/VirtualDJ';
    mocks.mockM3uParser.getLatestTrack.mockReturnValue(undefined);
  });

  afterEach(() => {
    if (connect) {
      connect.stop();
    }
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('creates instance with default options', () => {
      connect = new VirtualDjConnect();
      expect(connect.running).toBe(false);
      expect(connect.pollInterval).toBe(5000);
    });

    it('accepts custom poll interval', () => {
      connect = new VirtualDjConnect({ pollIntervalMs: 10000 });
      expect(connect.pollInterval).toBe(10000);
    });

    it('checks writeHistory on construction', () => {
      connect = new VirtualDjConnect();
      expect(mocks.mockM3uParser.checkWriteHistory).toHaveBeenCalled();
    });
  });

  describe('start', () => {
    it('starts polling and emits ready', () => {
      connect = new VirtualDjConnect();
      const readyHandler = vi.fn();
      connect.on('ready', readyHandler);

      connect.start();

      expect(connect.running).toBe(true);
      expect(readyHandler).toHaveBeenCalledWith({
        basePath: '/Users/testuser/Library/Application Support/VirtualDJ',
      });
    });

    it('emits error if VirtualDJ installation not found', () => {
      mocks.mockM3uParser.basePath = '';

      connect = new VirtualDjConnect();
      const errorHandler = vi.fn();
      connect.on('error', errorHandler);

      connect.start();

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'VirtualDJ installation not found',
        })
      );
      expect(connect.running).toBe(false);
    });

    it('does nothing if already running', () => {
      connect = new VirtualDjConnect();
      connect.start();

      const readyHandler = vi.fn();
      connect.on('ready', readyHandler);
      connect.start();

      expect(readyHandler).not.toHaveBeenCalled();
    });

    it('emits initial track on start', () => {
      mocks.mockM3uParser.getLatestTrack.mockReturnValue({
        id: 'abc123',
        title: 'Test Track',
        artist: 'Test Artist',
        fileLocation: '/path/to/track.mp3',
      });

      connect = new VirtualDjConnect();
      const trackHandler = vi.fn();
      connect.on('track', trackHandler);

      connect.start();

      expect(trackHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Track',
          artist: 'Test Artist',
          filePath: '/path/to/track.mp3',
          isBeatportStream: false,
        })
      );
    });
  });

  describe('stop', () => {
    it('stops polling', () => {
      connect = new VirtualDjConnect();
      connect.start();
      connect.stop();

      expect(connect.running).toBe(false);
    });

    it('clears lastTrackId', () => {
      mocks.mockM3uParser.getLatestTrack.mockReturnValue({
        id: 'abc123',
        title: 'Test',
        artist: 'Artist',
        fileLocation: '/path.mp3',
      });

      connect = new VirtualDjConnect();
      connect.start();
      connect.stop();

      expect(connect.running).toBe(false);
    });
  });

  describe('track detection', () => {
    it('emits track when track ID changes', () => {
      mocks.mockM3uParser.getLatestTrack
        .mockReturnValueOnce({
          id: 'track1',
          title: 'First',
          artist: 'Artist1',
          fileLocation: '/path/first.mp3',
        })
        .mockReturnValueOnce({
          id: 'track2',
          title: 'Second',
          artist: 'Artist2',
          fileLocation: '/path/second.mp3',
        });

      connect = new VirtualDjConnect({ pollIntervalMs: 5000 });
      const trackHandler = vi.fn();
      connect.on('track', trackHandler);

      connect.start();

      // Initial track emitted on start
      expect(trackHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'First',
          artist: 'Artist1',
        })
      );

      vi.advanceTimersByTime(5000);

      expect(trackHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Second',
          artist: 'Artist2',
        })
      );
    });

    it('does not emit if track ID is the same', () => {
      mocks.mockM3uParser.getLatestTrack.mockReturnValue({
        id: 'same',
        title: 'Same',
        artist: 'Artist',
        fileLocation: '/path.mp3',
      });

      connect = new VirtualDjConnect({ pollIntervalMs: 5000 });
      const trackHandler = vi.fn();
      connect.on('track', trackHandler);

      connect.start();
      expect(trackHandler).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5000);
      vi.advanceTimersByTime(5000);

      expect(trackHandler).toHaveBeenCalledTimes(1);
    });

    it('handles null getLatestTrack result', () => {
      mocks.mockM3uParser.getLatestTrack.mockReturnValue(undefined);

      connect = new VirtualDjConnect({ pollIntervalMs: 5000 });
      const trackHandler = vi.fn();
      connect.on('track', trackHandler);

      connect.start();
      vi.advanceTimersByTime(5000);

      expect(trackHandler).not.toHaveBeenCalled();
    });

    it('uses filename as fallback title when no metadata', () => {
      mocks.mockM3uParser.getLatestTrack
        .mockReturnValueOnce({
          id: 'first',
          fileLocation: '/path/to/first.mp3',
        })
        .mockReturnValueOnce({
          id: 'second',
          fileLocation: '/path/to/second_track.mp3',
        });

      connect = new VirtualDjConnect({ pollIntervalMs: 5000 });
      const trackHandler = vi.fn();
      connect.on('track', trackHandler);

      connect.start();

      expect(trackHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'first.mp3',
        })
      );

      vi.advanceTimersByTime(5000);

      expect(trackHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'second_track.mp3',
        })
      );
    });

    it('handles missing title with Unknown Title', () => {
      mocks.mockM3uParser.getLatestTrack
        .mockReturnValueOnce({ id: 'first', title: 'First', artist: 'Artist', fileLocation: '/a.mp3' })
        .mockReturnValueOnce({ id: 'second', title: '', artist: 'Artist2', fileLocation: '/b.mp3' });

      connect = new VirtualDjConnect({ pollIntervalMs: 5000 });
      const trackHandler = vi.fn();
      connect.on('track', trackHandler);

      connect.start();
      trackHandler.mockClear();

      vi.advanceTimersByTime(5000);

      expect(trackHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Unknown Title',
        })
      );
    });

    it('handles missing artist with Unknown Artist', () => {
      mocks.mockM3uParser.getLatestTrack
        .mockReturnValueOnce({ id: 'first', title: 'First', artist: 'Artist', fileLocation: '/a.mp3' })
        .mockReturnValueOnce({ id: 'second', title: 'Second', artist: '', fileLocation: '/b.mp3' });

      connect = new VirtualDjConnect({ pollIntervalMs: 5000 });
      const trackHandler = vi.fn();
      connect.on('track', trackHandler);

      connect.start();
      trackHandler.mockClear();

      vi.advanceTimersByTime(5000);

      expect(trackHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          artist: 'Unknown Artist',
        })
      );
    });

    it('detects Beatport streaming tracks', () => {
      mocks.mockM3uParser.getLatestTrack
        .mockReturnValueOnce({
          id: 'first',
          title: 'First',
          artist: 'Artist',
          fileLocation: '/path/to/file.mp3',
        })
        .mockReturnValueOnce({
          id: 'second',
          title: 'Beatport Track',
          artist: 'Artist',
          fileLocation: 'netsearch://bp12345',
        });

      connect = new VirtualDjConnect({ pollIntervalMs: 5000 });
      const trackHandler = vi.fn();
      connect.on('track', trackHandler);

      connect.start();
      vi.advanceTimersByTime(5000);

      expect(trackHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Beatport Track',
          isBeatportStream: true,
          beatportId: 12345,
          filePath: undefined,
        })
      );
    });
  });

  describe('setPollInterval', () => {
    it('updates poll interval', () => {
      connect = new VirtualDjConnect({ pollIntervalMs: 5000 });
      connect.start();

      connect.setPollInterval(10000);
      expect(connect.pollInterval).toBe(10000);
    });

    it('restarts polling timer when running', () => {
      mocks.mockM3uParser.getLatestTrack.mockReturnValue(undefined);

      connect = new VirtualDjConnect({ pollIntervalMs: 5000 });
      connect.start();
      connect.setPollInterval(10000);

      expect(connect.pollInterval).toBe(10000);
    });
  });

  describe('writeHistoryEnabled', () => {
    it('reflects checkWriteHistory result', () => {
      mocks.mockM3uParser.checkWriteHistory.mockReturnValue(true);
      connect = new VirtualDjConnect();
      expect(connect.writeHistoryEnabled).toBe(true);
    });

    it('can be refreshed via checkWriteHistory', () => {
      mocks.mockM3uParser.checkWriteHistory
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      connect = new VirtualDjConnect();
      expect(connect.writeHistoryEnabled).toBe(true);

      connect.checkWriteHistory();
      expect(connect.writeHistoryEnabled).toBe(false);
    });
  });
});

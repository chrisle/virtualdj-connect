import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    constructor() {
      // Use the current value of basePath at construction time
      this.basePath = mockM3uParser.basePath;
    }
  }

  return {
    mockM3uParser,
    MockVirtualDjM3uParser,
  };
});

vi.mock('./m3uParser.js', () => ({
  VirtualDjM3uParser: mocks.MockVirtualDjM3uParser,
}));

import { VirtualDjConnect } from './virtualdjConnect.js';

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
        title: 'Test',
        artist: 'Artist',
        fileLocation: '/path/to/track.mp3',
      });

      connect = new VirtualDjConnect();
      const trackHandler = vi.fn();
      connect.on('track', trackHandler);

      connect.start();

      expect(trackHandler).toHaveBeenCalledWith({
        track: expect.objectContaining({
          id: 'abc123',
          title: 'Test',
          artist: 'Artist',
        }),
      });
    });
  });

  describe('stop', () => {
    it('stops polling', () => {
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
          fileLocation: '/path/to/first.mp3',
        })
        .mockReturnValueOnce({
          id: 'track2',
          title: 'Second',
          artist: 'Artist2',
          fileLocation: '/path/to/second.mp3',
        });

      connect = new VirtualDjConnect({ pollIntervalMs: 5000 });
      const trackHandler = vi.fn();
      connect.on('track', trackHandler);

      connect.start();

      // Initial track emitted on start
      expect(trackHandler).toHaveBeenCalledWith({
        track: expect.objectContaining({ id: 'track1' }),
      });

      vi.advanceTimersByTime(5000);

      expect(trackHandler).toHaveBeenCalledWith({
        track: expect.objectContaining({ id: 'track2' }),
      });
    });

    it('does not emit if track ID is the same', () => {
      mocks.mockM3uParser.getLatestTrack.mockReturnValue({
        id: 'same',
        title: 'Same',
        artist: 'Artist',
        fileLocation: '/path/to/track.mp3',
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
  });

  describe('setPollInterval', () => {
    it('updates poll interval while running', () => {
      connect = new VirtualDjConnect({ pollIntervalMs: 5000 });
      connect.start();

      connect.setPollInterval(10000);
      expect(connect.pollInterval).toBe(10000);
    });
  });

  describe('checkWriteHistory', () => {
    it('delegates to m3u parser', () => {
      mocks.mockM3uParser.checkWriteHistory.mockReturnValue(true);

      connect = new VirtualDjConnect();
      expect(connect.checkWriteHistory()).toBe(true);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VirtualDjNetworkControl, pickOnAirDeck } from './networkControl.js';

/**
 * Build a mock fetch that returns canned responses based on the `script=`
 * query parameter. Each query is matched exactly.
 */
function buildFetch(map: Record<string, string>, overrides?: {
  notOk?: boolean;
  status?: number;
}): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const script = url.searchParams.get('script') ?? '';
    const body = map[script];
    if (body === undefined) {
      return {
        ok: false,
        status: 500,
        text: async () => `unexpected script: ${script}`,
      } as Response;
    }
    if (overrides?.notOk) {
      return {
        ok: false,
        status: overrides.status ?? 401,
        text: async () => body,
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
}

describe('pickOnAirDeck', () => {
  it('prefers an audible loaded deck', () => {
    const picked = pickOnAirDeck([
      { deck: 1, loaded: true, audible: false, title: 'A', artist: '', album: '', path: '' },
      { deck: 2, loaded: true, audible: true, title: 'B', artist: '', album: '', path: '' },
    ]);
    expect(picked?.deck).toBe(2);
  });

  it('falls back to any loaded deck when none are audible', () => {
    const picked = pickOnAirDeck([
      { deck: 1, loaded: false, audible: false, title: '', artist: '', album: '', path: '' },
      { deck: 2, loaded: true, audible: false, title: 'B', artist: '', album: '', path: '' },
    ]);
    expect(picked?.deck).toBe(2);
  });

  it('returns null when no deck is loaded', () => {
    const picked = pickOnAirDeck([
      { deck: 1, loaded: false, audible: false, title: '', artist: '', album: '', path: '' },
    ]);
    expect(picked).toBeNull();
  });
});

describe('VirtualDjNetworkControl', () => {
  let control: VirtualDjNetworkControl;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    control?.stop();
    vi.useRealTimers();
  });

  it('emits ready after a successful handshake', async () => {
    const fetchFn = buildFetch({ get_clock: '123456' });
    control = new VirtualDjNetworkControl({ fetchFn, decks: [] });
    const ready = vi.fn();
    control.on('ready', ready);

    await control.start();

    expect(ready).toHaveBeenCalledWith({ basePath: 'http://127.0.0.1:8080' });
  });

  it('emits error and stays stopped when handshake fails', async () => {
    const fetchFn = buildFetch({ get_clock: 'unauthorized' }, { notOk: true, status: 401 });
    control = new VirtualDjNetworkControl({ fetchFn, decks: [] });
    const ready = vi.fn();
    const error = vi.fn();
    control.on('ready', ready);
    control.on('error', error);

    await control.start();

    expect(ready).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0].message).toMatch(/handshake failed/i);
    expect(control.running).toBe(false);
  });

  it('emits a track for the audible deck on first poll with full metadata', async () => {
    const fetchFn = buildFetch({
      get_clock: '1',
      'deck 1 loaded': 'true',
      'deck 1 is_audible': 'true',
      "deck 1 get_loaded_song 'title'": '"Strobe"',
      "deck 1 get_loaded_song 'artist'": '"deadmau5"',
      "deck 1 get_loaded_song 'album'": '"For Lack of a Better Name"',
      "deck 1 get_loaded_song 'genre'": 'Progressive House',
      "deck 1 get_loaded_song 'key'": 'Bm',
      'deck 1 get_bpm absolute': '128.00',
      'deck 1 get_time total': '10:33',
      'deck 1 get_filepath': '/Users/dj/Music/Strobe.mp3',
    });

    control = new VirtualDjNetworkControl({ fetchFn, decks: [1] });
    const track = vi.fn();
    control.on('track', track);

    await control.start();
    // First poll runs immediately after handshake. Let the microtasks settle.
    await vi.runOnlyPendingTimersAsync();

    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0]![0]).toMatchObject({
      title: 'Strobe',
      artist: 'deadmau5',
      album: 'For Lack of a Better Name',
      genre: 'Progressive House',
      key: 'Bm',
      bpm: 128,
      duration: 633,
      deck: 1,
      isOnAir: true,
      filePath: '/Users/dj/Music/Strobe.mp3',
      fileLocation: '/Users/dj/Music/Strobe.mp3',
      isBeatportStream: false,
    });
  });

  it('tolerates missing optional fields without dropping the track', async () => {
    // Simulate a VirtualDJ build where get_bpm and get_time total are not
    // implemented — those queries return HTTP 500 from the mock server.
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const script = url.searchParams.get('script') ?? '';
      const okResponses: Record<string, string> = {
        get_clock: '1',
        'deck 1 loaded': 'true',
        'deck 1 is_audible': 'true',
        "deck 1 get_loaded_song 'title'": 'Nightshift',
        "deck 1 get_loaded_song 'artist'": 'Commodores',
        "deck 1 get_loaded_song 'album'": '',
        "deck 1 get_loaded_song 'genre'": '',
        "deck 1 get_loaded_song 'key'": '',
        'deck 1 get_filepath': '/Music/Nightshift.mp3',
      };
      if (script in okResponses) {
        return {
          ok: true,
          status: 200,
          text: async () => okResponses[script]!,
        } as Response;
      }
      return { ok: false, status: 500, text: async () => '' } as Response;
    }) as unknown as typeof fetch;

    control = new VirtualDjNetworkControl({ fetchFn, decks: [1] });
    const track = vi.fn();
    control.on('track', track);

    await control.start();
    await vi.runOnlyPendingTimersAsync();

    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0]![0]).toMatchObject({
      title: 'Nightshift',
      artist: 'Commodores',
      deck: 1,
    });
    expect(track.mock.calls[0]![0].bpm).toBeUndefined();
    expect(track.mock.calls[0]![0].duration).toBeUndefined();
  });

  it('parses duration as raw seconds when VirtualDJ returns a number', async () => {
    const fetchFn = buildFetch({
      get_clock: '1',
      'deck 1 loaded': 'true',
      'deck 1 is_audible': 'true',
      "deck 1 get_loaded_song 'title'": 'x',
      "deck 1 get_loaded_song 'artist'": 'y',
      "deck 1 get_loaded_song 'album'": '',
      "deck 1 get_loaded_song 'genre'": '',
      "deck 1 get_loaded_song 'key'": '',
      'deck 1 get_bpm absolute': '',
      'deck 1 get_time total': '243.5',
      'deck 1 get_filepath': '/m.mp3',
    });

    control = new VirtualDjNetworkControl({ fetchFn, decks: [1] });
    const track = vi.fn();
    control.on('track', track);

    await control.start();
    await vi.runOnlyPendingTimersAsync();

    expect(track.mock.calls[0]![0].duration).toBe(243.5);
  });

  it('does not emit a duplicate track while the audible song is unchanged', async () => {
    const fetchFn = buildFetch({
      get_clock: '1',
      'deck 1 loaded': 'true',
      'deck 1 is_audible': 'true',
      "deck 1 get_loaded_song 'title'": 'Strobe',
      "deck 1 get_loaded_song 'artist'": 'deadmau5',
      "deck 1 get_loaded_song 'album'": '',
      "deck 1 get_loaded_song 'genre'": '',
      "deck 1 get_loaded_song 'key'": '',
      'deck 1 get_bpm absolute': '',
      'deck 1 get_time total': '',
      'deck 1 get_filepath': '/Users/dj/Music/Strobe.mp3',
    });

    control = new VirtualDjNetworkControl({ fetchFn, decks: [1], pollIntervalMs: 1000 });
    const track = vi.fn();
    control.on('track', track);

    await control.start();
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(1100);

    expect(track).toHaveBeenCalledTimes(1);
  });

  it('treats VDJScript "error:-N" responses as empty fields', async () => {
    // The Network Control Plugin returns "error:-2147467259" (E_FAIL) for
    // unrecognized verbs. Passing that string downstream as a file path
    // breaks artwork extraction, so it must be coerced to empty.
    const fetchFn = buildFetch({
      get_clock: '1',
      'deck 1 loaded': 'yes',
      'deck 1 is_audible': 'yes',
      "deck 1 get_loaded_song 'title'": '"Opus"',
      "deck 1 get_loaded_song 'artist'": '"Eric Prydz"',
      "deck 1 get_loaded_song 'album'": '',
      "deck 1 get_loaded_song 'genre'": '',
      "deck 1 get_loaded_song 'key'": '',
      'deck 1 get_bpm absolute': '',
      'deck 1 get_time total': '',
      'deck 1 get_filepath': 'error:-2147467259',
    });

    control = new VirtualDjNetworkControl({ fetchFn, decks: [1] });
    const track = vi.fn();
    control.on('track', track);

    await control.start();
    await vi.runOnlyPendingTimersAsync();

    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0]![0].filePath).toBeUndefined();
    expect(track.mock.calls[0]![0].fileLocation).toBe('');
  });

  it('parses VirtualDJ\'s "yes"/"no" boolean responses', async () => {
    // Real VirtualDJ returns "yes"/"no" for `loaded` and `is_audible`, not
    // "true"/"false". Earlier revisions of parseBool only matched "true",
    // which made the poller think no decks were ever loaded.
    const fetchFn = buildFetch({
      get_clock: '1',
      'deck 1 loaded': 'yes',
      'deck 1 is_audible': 'yes',
      "deck 1 get_loaded_song 'title'": '"Strobe"',
      "deck 1 get_loaded_song 'artist'": '"deadmau5"',
      "deck 1 get_loaded_song 'album'": '',
      "deck 1 get_loaded_song 'genre'": '',
      "deck 1 get_loaded_song 'key'": '',
      'deck 1 get_bpm absolute': '',
      'deck 1 get_time total': '',
      'deck 1 get_filepath': '/Music/Strobe.mp3',
    });

    control = new VirtualDjNetworkControl({ fetchFn, decks: [1] });
    const track = vi.fn();
    control.on('track', track);

    await control.start();
    await vi.runOnlyPendingTimersAsync();

    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0]![0]).toMatchObject({
      title: 'Strobe',
      artist: 'deadmau5',
      isOnAir: true,
      deck: 1,
    });
  });

  it('detects Beatport streaming URLs and omits filePath', async () => {
    const fetchFn = buildFetch({
      get_clock: '1',
      'deck 1 loaded': 'true',
      'deck 1 is_audible': 'true',
      "deck 1 get_loaded_song 'title'": 'Phuture',
      "deck 1 get_loaded_song 'artist'": 'Your Mind',
      "deck 1 get_loaded_song 'album'": '',
      "deck 1 get_loaded_song 'genre'": '',
      "deck 1 get_loaded_song 'key'": '',
      'deck 1 get_bpm absolute': '',
      'deck 1 get_time total': '',
      'deck 1 get_filepath': 'netsearch://bp12345',
    });

    control = new VirtualDjNetworkControl({ fetchFn, decks: [1] });
    const track = vi.fn();
    control.on('track', track);

    await control.start();
    await vi.runOnlyPendingTimersAsync();

    expect(track.mock.calls[0]![0]).toMatchObject({
      isBeatportStream: true,
      beatportId: 12345,
      filePath: undefined,
      fileLocation: 'netsearch://bp12345',
    });
  });

  it('sends bearer auth when configured', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      expect(url.searchParams.get('bearer')).toBe('sekret');
      return {
        ok: true,
        status: 200,
        text: async () => '1',
      } as Response;
    }) as unknown as typeof fetch;

    control = new VirtualDjNetworkControl({
      fetchFn,
      bearer: 'sekret',
      decks: [],
    });

    await control.start();
    expect(fetchFn).toHaveBeenCalled();
  });
});

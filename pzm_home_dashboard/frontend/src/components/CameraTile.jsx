import { memo, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { tilePlacementStyle } from '../lib/placement.js';

const FIT_TO_CSS = {
  fit: 'contain',
  center: 'cover',
  stretch: 'fill',
};

// Live-edge policy: how far playback may drift behind the target live
// position before the watchdog hard-seeks back, how often it checks, and
// how long the picture may stay frozen before the player is torn down and
// rebuilt from scratch. Frozen/seek enforcement only arms once the stream
// has actually played — before that the tile is merely connecting, which
// legitimately takes 10s+ when several backend transcodes cold-start at
// once, and rebuilding mid-connect loops the tile on a black screen
// forever. A separate (much longer) deadline rescues a truly wedged
// connect.
const MAX_BEHIND_LIVE_S = 3;
const WATCHDOG_MS = 2000;
const FROZEN_REBUILD_MS = 8000;
const CONNECT_REBUILD_MS = 45000;

function CameraTile({
  camera,
  col = 1,
  row = 1,
  colSpan = 3,
  rowSpan = 3,
  wide = false,
  fit = 'fit',
  editMode = false,
  onStartMove,
  onStartResize,
  onSetFit,
}) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('connecting');
  const [errorMessage, setErrorMessage] = useState(null);
  // Bumped by the watchdog to tear the whole player down and rebuild it —
  // the only reliable escape from a wedged WebView decoder.
  const [rebuildToken, setRebuildToken] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    setStatus('connecting');
    setErrorMessage(null);

    const src = `hls/${encodeURIComponent(camera.id)}/index.m3u8`;
    let hls = null;
    let destroyed = false;
    let cleanup = null;
    let rebuildTimer = null;
    let hasPlayed = false;

    // Target live position: hls.js exposes it directly; the native-HLS
    // path approximates it as just shy of the seekable end.
    const livePosition = () => {
      if (hls && Number.isFinite(hls.liveSyncPosition)) return hls.liveSyncPosition;
      try {
        const s = video.seekable;
        if (s && s.length > 0) return Math.max(0, s.end(s.length - 1) - 1);
      } catch { /* seekable can throw mid-teardown */ }
      return null;
    };
    const seekToLive = () => {
      // Never fight hls.js's own startup positioning: seeking before the
      // first frames render aborts in-flight buffering and can hold the
      // tile black indefinitely.
      if (!hasPlayed || video.readyState < 2) return;
      const pos = livePosition();
      if (pos != null && pos - video.currentTime > MAX_BEHIND_LIVE_S) {
        video.currentTime = pos;
      }
    };

    if (Hls.isSupported()) {
      hls = new Hls({
        // Speed over quality: hug the live edge (one segment behind),
        // play up to 1.5× to burn off accumulated drift, and keep the
        // buffer tiny so a stall recovers onto fresh frames instead of
        // replaying a backlog.
        lowLatencyMode: true,
        liveSyncDurationCount: 1,
        liveMaxLatencyDurationCount: 4,
        maxLiveSyncPlaybackRate: 1.5,
        maxBufferLength: 6,
        backBufferLength: 0,
        // The backend intentionally holds the playlist request while
        // ffmpeg warms up (up to ~15s, twice that when it falls back to
        // stream copy) — keep the loader timeout above that so a slow
        // cold start reads as "loading", not a fatal manifestLoadError.
        manifestLoadingTimeOut: 20000,
        levelLoadingTimeOut: 20000,
        manifestLoadingRetryDelay: 1000,
        manifestLoadingMaxRetry: 6,
      });
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(src));
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => { /* autoplay may need a gesture */ });
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (destroyed) return;
        if (data.fatal) {
          setStatus('error');
          setErrorMessage(data.details || data.type || 'HLS error');
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR: hls.startLoad(); break;
            case Hls.ErrorTypes.MEDIA_ERROR: hls.recoverMediaError(); break;
            default:
              // Unrecoverable: retry from scratch instead of leaving the
              // tile dead until the next page reload.
              hls.destroy(); hls = null;
              rebuildTimer = setTimeout(() => setRebuildToken((t) => t + 1), 5000);
          }
        }
      });
      const onPlaying = () => { hasPlayed = true; setStatus('playing'); };
      video.addEventListener('playing', onPlaying);
      cleanup = () => video.removeEventListener('playing', onPlaying);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      const onPlaying = () => { hasPlayed = true; setStatus('playing'); };
      const onError = () => { setStatus('error'); setErrorMessage('Playback error'); };
      video.addEventListener('playing', onPlaying);
      video.addEventListener('error', onError);
      video.play().catch(() => { /* autoplay may need a gesture */ });
      cleanup = () => {
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('error', onError);
        video.removeAttribute('src');
        video.load();
      };
    } else {
      setStatus('error');
      setErrorMessage('HLS not supported by this browser');
    }

    // Force-refresh watchdog: keep playback pinned to the live edge, and
    // rebuild the player outright if the picture freezes — Android WebView
    // decoders stall under multi-stream load and leave <video> wedged
    // without ever firing an error event. Until first play the only check
    // is the (long) connect deadline; hls.js's own retries do the rest.
    let lastTime = -1;
    let frozenMs = 0;
    let connectingMs = 0;
    const watchdog = setInterval(() => {
      if (destroyed || document.hidden) return;
      if (!hasPlayed) {
        connectingMs += WATCHDOG_MS;
        if (connectingMs >= CONNECT_REBUILD_MS) {
          connectingMs = 0;
          setRebuildToken((t) => t + 1);
        }
        return;
      }
      seekToLive();
      if (!video.paused && video.currentTime === lastTime) {
        frozenMs += WATCHDOG_MS;
        if (frozenMs >= FROZEN_REBUILD_MS) {
          frozenMs = 0;
          setRebuildToken((t) => t + 1);
        }
      } else {
        frozenMs = 0;
        lastTime = video.currentTime;
      }
    }, WATCHDOG_MS);

    // Returning to the foreground: resume loading and jump straight to
    // live instead of replaying whatever was buffered before the tab slept.
    const onVisibility = () => {
      if (destroyed || document.hidden) return;
      try { hls?.startLoad(); } catch { /* already loading */ }
      seekToLive();
      video.play().catch(() => { /* autoplay may need a gesture */ });
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      destroyed = true;
      clearInterval(watchdog);
      if (rebuildTimer) clearTimeout(rebuildTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      if (cleanup) cleanup();
      if (hls) { try { hls.destroy(); } catch { /* ignore */ } }
    };
  }, [camera.id, rebuildToken]);

  const tileStyle = tilePlacementStyle(col, row, colSpan, rowSpan);

  const objectFit = FIT_TO_CSS[fit] || 'contain';

  const handleTileDown = (e) => {
    if (!editMode) return;
    if (e.button !== 0) return;
    if (e.target.closest('button')) return;
    if (e.target.closest('.tile-resize')) return;
    onStartMove?.(e);
  };

  const handleResizeDown = (e) => {
    if (!editMode) return;
    if (e.button !== 0) return;
    onStartResize?.(e);
  };

  return (
    <div
      className={`tile tile-${status}${wide ? ' tile-wide' : ''}${editMode ? ' tile-editing' : ''}`}
      style={tileStyle}
      onPointerDown={handleTileDown}
    >
      <div className="tile-video-wrap">
        <video
          ref={videoRef}
          className="tile-video"
          style={{ objectFit }}
          muted
          autoPlay
          playsInline
          controls={false}
        />
        {status === 'error' && (
          <div className="tile-overlay">{errorMessage || 'Stream unavailable'}</div>
        )}
        {editMode && (
          <>
            <div className="tile-edit-top">
              <span className="tile-edit-name">{camera.name}</span>
              <span className="tile-edit-size">{colSpan}×{rowSpan}</span>
            </div>
            <div className="tile-edit-bottom">
              <div className="fit-modes" role="group" aria-label="fit mode">
                <button
                  type="button"
                  className={fit === 'fit' ? 'is-active' : ''}
                  onClick={() => onSetFit?.('fit')}
                  title="Fit (contain)"
                >Fit</button>
                <button
                  type="button"
                  className={fit === 'center' ? 'is-active' : ''}
                  onClick={() => onSetFit?.('center')}
                  title="Center (cover, crops)"
                >Center</button>
                <button
                  type="button"
                  className={fit === 'stretch' ? 'is-active' : ''}
                  onClick={() => onSetFit?.('stretch')}
                  title="Stretch (fill, distorts)"
                >Stretch</button>
              </div>
            </div>
            <div
              className="tile-resize"
              onPointerDown={handleResizeDown}
              title="Drag to resize"
            />
          </>
        )}
      </div>
    </div>
  );
}

// Memoised: HLS tiles are the most expensive thing on the wall to re-render.
export default memo(CameraTile);

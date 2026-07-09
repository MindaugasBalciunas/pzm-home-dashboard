import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

const FIT_TO_CSS = {
  fit: 'contain',
  center: 'cover',
  stretch: 'fill',
};

export default function CameraTile({
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const src = `hls/${encodeURIComponent(camera.id)}/index.m3u8`;
    let hls = null;
    let destroyed = false;
    let cleanup = null;

    if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 2,
        maxBufferLength: 10,
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
            default: hls.destroy(); hls = null;
          }
        }
      });
      const onPlaying = () => setStatus('playing');
      video.addEventListener('playing', onPlaying);
      cleanup = () => video.removeEventListener('playing', onPlaying);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      const onPlaying = () => setStatus('playing');
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

    return () => {
      destroyed = true;
      if (cleanup) cleanup();
      if (hls) { try { hls.destroy(); } catch { /* ignore */ } }
    };
  }, [camera.id]);

  const tileStyle = {
    gridColumn: `${col} / span ${colSpan}`,
    gridRow: `${row} / span ${rowSpan}`,
  };

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

import { useEffect, useRef, useState } from 'react';

export function ReferenceVideo({ id, creator, title }: { id: string; creator: string; title: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !reducedMotion) void element.play().catch(() => undefined);
        else element.pause();
      },
      { threshold: 0.25 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      element.pause();
    };
  }, []);
  function togglePlay() {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
  }
  function toggleSound() {
    if (!video.current) return;
    video.current.muted = !video.current.muted;
    setMuted(video.current.muted);
  }
  return (
    <div className={`video-frame clean-video ${playing ? 'is-playing' : ''}`}>
      {/* biome-ignore lint/a11y/useMediaCaption: reference clips contain music and burned-in meme text, with no speech transcript. */}
      <video
        ref={video}
        src={`/media/trend-${id}.mp4`}
        poster={`/media/tiktok-${id}.jpg`}
        muted
        loop
        playsInline
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        aria-label={`${title}, original TikTok reference by @${creator}`}
      />
      <button
        type="button"
        className="reference-play"
        onClick={togglePlay}
        aria-label={playing ? `Pause ${title}` : `Play ${title}`}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          {playing ? <path d="M6 4h4v16H6zm8 0h4v16h-4z" /> : <path d="m7 4 14 8-14 8z" />}
        </svg>
      </button>
      <button
        type="button"
        className="reference-sound"
        onClick={toggleSound}
        aria-label={muted ? `Turn sound on for ${title}` : `Mute ${title}`}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m11 4-6 5H2v6h3l6 5V4Z" />
          {muted ? (
            <path d="m16 9 6 6m0-6-6 6" />
          ) : (
            <>
              <path d="M15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}

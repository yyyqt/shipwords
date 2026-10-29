import { uploadReference } from '@shipwords/jobs/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { renderSVG } from 'uqr';
import { preparePhoto } from '~/site/photo-upload';

// Adapted from tinydeskai-example's phone handoff; this site accepts one portrait.
const HANDOFF_KEY = 'shaking-head:handoff:v1';
const TOKEN = /^[a-f0-9]{32}$/;
const PHOTO = /^\/files\/uploads\/up_[a-z0-9]+\.(jpg|png|webp)$/;
type Handoff = { token: string; expiresAt: number };
type Remote = { paths: string[]; expiresAt: number };

function valid(value: unknown): value is Handoff {
  if (!value || typeof value !== 'object') return false;
  const data = value as Handoff;
  return TOKEN.test(data.token) && Number.isFinite(data.expiresAt) && data.expiresAt > Date.now();
}
function persist(value: Handoff | null) {
  try {
    if (value) sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(HANDOFF_KEY);
  } catch {
    /* Pairing still works without browser storage. */
  }
}
async function revoke(token: string) {
  try {
    await fetch(`/api/handoff/${token}`, { method: 'DELETE', keepalive: true });
  } catch {
    /* Server expiry remains the fallback. */
  }
}

export function PhoneHandoff({
  place,
  disabled,
  photoPath,
}: {
  place: (path: string) => boolean;
  disabled: boolean;
  photoPath: string | null;
}) {
  const [available, setAvailable] = useState(false);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState('');
  const epoch = useRef(0);
  const current = useRef<Handoff | null>(null);
  const openingController = useRef<AbortController | null>(null);
  const placeRef = useRef(place);
  const disabledRef = useRef(disabled);
  const photoAtOpen = useRef(photoPath);
  const latestPhoto = useRef(photoPath);
  latestPhoto.current = photoPath;
  placeRef.current = place;
  disabledRef.current = disabled;

  const save = useCallback((next: Handoff | null) => {
    current.current = next;
    persist(next);
    setHandoff(next);
  }, []);
  const close = useCallback(
    (message = '') => {
      epoch.current++;
      openingController.current?.abort();
      const token = current.current?.token;
      save(null);
      setOpening(false);
      setNotice(message);
      if (token) void revoke(token);
    },
    [save],
  );
  async function open() {
    const version = ++epoch.current;
    openingController.current?.abort();
    const controller = new AbortController();
    openingController.current = controller;
    setOpening(true);
    setNotice('');
    try {
      const response = await fetch('/api/handoff', { method: 'POST', signal: controller.signal });
      if (!response.ok) throw new Error('Could not create a code. Please try again.');
      const data: unknown = await response.json();
      if (!valid(data)) throw new Error('Could not create a code. Please try again.');
      if (version !== epoch.current || controller.signal.aborted) {
        void revoke(data.token);
        return;
      }
      photoAtOpen.current = photoPath;
      save(data);
    } catch (error) {
      if (version === epoch.current && !controller.signal.aborted) {
        setNotice(error instanceof Error ? error.message : 'Could not create a code. Please try again.');
      }
    } finally {
      if (version === epoch.current) setOpening(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: restore the tab's still-valid pairing once.
  useEffect(() => {
    if (!matchMedia('(pointer: fine)').matches) return;
    setAvailable(true);
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) ?? 'null');
      if (valid(saved)) {
        photoAtOpen.current = photoPath;
        save(saved);
      } else persist(null);
    } catch {
      persist(null);
    }
    return () => {
      epoch.current++;
      openingController.current?.abort();
    };
  }, []);

  // A newly chosen desktop photo supersedes the pending phone transfer.
  useEffect(() => {
    if (handoff?.token && current.current && photoAtOpen.current !== photoPath) close();
  }, [photoPath, handoff?.token, close]);

  const token = handoff?.token;
  useEffect(() => {
    if (!token) return;
    const version = epoch.current;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const live = () =>
      !controller.signal.aborted && version === epoch.current && current.current?.token === token;
    async function tick() {
      if (!live()) return;
      if (Date.now() >= (current.current?.expiresAt ?? 0)) {
        close('This code expired. Open a new code.');
        return;
      }
      try {
        const response = await fetch(`/api/handoff/${token}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!live()) return;
        if (response.status === 404 || response.status === 410) {
          close('This code expired. Open a new code.');
          return;
        }
        if (!response.ok) throw new Error('Connection interrupted. Reconnecting…');
        const data = (await response.json()) as Remote;
        if (!live()) return;
        if (
          !Number.isFinite(data.expiresAt) ||
          data.expiresAt <= Date.now() ||
          Date.now() >= (current.current?.expiresAt ?? 0)
        ) {
          close('This code expired. Open a new code.');
          return;
        }
        if (photoAtOpen.current !== latestPhoto.current) {
          close();
          return;
        }
        const path = Array.isArray(data.paths) ? data.paths[0] : null;
        if (typeof path === 'string' && PHOTO.test(path)) {
          if (!disabledRef.current && placeRef.current(path)) {
            close();
            return;
          }
          setNotice('Photo received. Waiting for your current upload or video.');
        } else setNotice('');
      } catch {
        if (live()) setNotice('Connection interrupted. Reconnecting…');
      }
      if (live()) timer = setTimeout(tick, 2000);
    }
    void tick();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, close]);

  if (!available) return null;
  const qr = handoff
    ? `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(`${location.origin}/phone/${handoff.token}`, { border: 3, whiteColor: '#fffdf5', blackColor: '#202035' }))}`
    : '';
  return (
    <div className="phone-handoff">
      {handoff || opening ? (
        <div className="handoff-panel">
          <button
            type="button"
            className="handoff-close"
            aria-label="Close phone upload"
            onClick={() => close()}
          >
            ×
          </button>
          {handoff ? (
            <img src={qr} alt="Scan this QR code with your phone" width="156" height="156" />
          ) : (
            <p role="status">Opening…</p>
          )}
          <p>Scan with your phone to upload one photo.</p>
          {notice && (
            <p className="handoff-notice" role="status">
              {notice}
            </p>
          )}
        </div>
      ) : (
        <>
          <button type="button" className="link-button" disabled={disabled} onClick={() => void open()}>
            Upload from phone
          </button>
          {notice && (
            <p className="handoff-notice" role="status">
              {notice}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function PhoneUploadPage({ token }: { token: string }) {
  const [status, setStatus] = useState<
    'checking' | 'ready' | 'sending' | 'sent' | 'failed' | 'expired' | 'full'
  >('checking');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState('');
  const file = useRef<File | null>(null);
  const uploadedPath = useRef<string | null>(null);
  const epoch = useRef(0);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const endpoint = `/api/handoff/${token}`;

  const check = useCallback(
    async (signal: AbortSignal): Promise<Remote | null> => {
      const response = await fetch(endpoint, { signal, cache: 'no-store' });
      if (signal.aborted) return null;
      if (response.status === 404 || response.status === 410) {
        setStatus('expired');
        return null;
      }
      if (!response.ok) throw new Error('Could not check this code. Please try again.');
      const data = (await response.json()) as Remote;
      if (signal.aborted) return null;
      if (!Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) {
        setStatus('expired');
        return null;
      }
      if (!Array.isArray(data.paths)) throw new Error('Could not check this code. Please try again.');
      return data;
    },
    [endpoint],
  );
  useEffect(() => {
    const version = ++epoch.current;
    const abort = new AbortController();
    controller.current = abort;
    if (!TOKEN.test(token)) {
      setStatus('expired');
      return;
    }
    setStatus('checking');
    file.current = null;
    uploadedPath.current = null;
    setPreview('');
    busy.current = false;
    void check(abort.signal)
      .then((data) => {
        if (version !== epoch.current || abort.signal.aborted || !data) return;
        setStatus(data.paths.length ? 'full' : 'ready');
      })
      .catch(() => {
        if (version === epoch.current && !abort.signal.aborted) {
          setStatus('failed');
          setMessage('Could not check this code. Please try again.');
        }
      });
    return () => {
      epoch.current++;
      abort.abort();
      controller.current?.abort();
    };
  }, [token, check]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function send(picked?: File) {
    if (busy.current) return;
    if (picked) {
      file.current = picked;
      uploadedPath.current = null;
      setPreview(URL.createObjectURL(picked));
    }
    const selected = file.current;
    if (!selected) {
      location.reload();
      return;
    }
    busy.current = true;
    const version = ++epoch.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setStatus('sending');
    setMessage('');
    try {
      const data = await check(abort.signal);
      if (!data || version !== epoch.current || abort.signal.aborted) return;
      if (data.paths.length) {
        setStatus(data.paths[0] === uploadedPath.current ? 'sent' : 'full');
        return;
      }
      if (!uploadedPath.current) {
        const prepared = await preparePhoto(selected);
        if (version !== epoch.current || abort.signal.aborted) return;
        const path = await uploadReference(prepared);
        if (version !== epoch.current || abort.signal.aborted) return;
        uploadedPath.current = path;
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: uploadedPath.current }),
        signal: abort.signal,
      });
      if (version !== epoch.current || abort.signal.aborted) return;
      if (response.status === 404 || response.status === 410) {
        setStatus('expired');
        return;
      }
      if (response.status === 409) {
        setStatus('full');
        return;
      }
      if (!response.ok) throw new Error('Could not send your photo. Please try again.');
      setStatus('sent');
    } catch (error) {
      if (version === epoch.current && !abort.signal.aborted) {
        setStatus('failed');
        setMessage(error instanceof Error ? error.message : 'Could not send your photo. Please try again.');
      }
    } finally {
      if (version === epoch.current) busy.current = false;
    }
  }

  return (
    <section className="phone-upload">
      <a className="phone-brand" href="/">
        Shaking Head AI
      </a>
      <h1>Upload your photo.</h1>
      {preview && <img className="phone-preview" src={preview} alt="Your selected subject" />}
      {status === 'expired' ? (
        <p role="status">This code expired or was closed. Open a new code on your computer.</p>
      ) : status === 'full' ? (
        <p role="status">This code already received a photo. Return to your computer.</p>
      ) : status === 'sent' ? (
        <p role="status">Photo sent. Continue on your computer.</p>
      ) : (
        <>
          <label className="primary phone-pick">
            {status === 'sending' ? 'Sending…' : status === 'checking' ? 'Checking code…' : 'Choose a photo'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="visually-hidden"
              disabled={status === 'sending' || status === 'checking'}
              onChange={(event) => {
                const picked = event.target.files?.[0];
                event.target.value = '';
                if (picked) void send(picked);
              }}
            />
          </label>
          <p className="file-note">JPG, PNG or WebP · up to 10 MB</p>
          {status === 'failed' && (
            <>
              <p className="error" role="alert">
                {message}
              </p>
              <button type="button" className="link-button" onClick={() => void send()}>
                Try again
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}

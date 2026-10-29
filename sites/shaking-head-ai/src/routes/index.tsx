import { pageHead } from '@shipwords/core/seo';
import { type PublicJob, uploadReference } from '@shipwords/jobs/react';
import { createFileRoute, getRouteApi } from '@tanstack/react-router';
import { type ChangeEvent, type DragEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { authClient } from '~/lib/auth';
import { useSafeGeneration } from '~/lib/safe-generation';
import { track } from '~/lib/track';
import { AccountLink } from '~/site/account';
import { FAQS, GENERATED_CAT_EXAMPLE, TIKTOK_REFERENCES } from '~/site/content';
import { MAX_PHOTO_BYTES, PHOTO_TYPES, VIDEO_OPTIONS } from '~/site/generation';
import { Icon } from '~/site/icons';
import { Plans, PricingLink } from '~/site/pricing';
import { ExampleVideo, ReferenceVideo } from '~/site/reference-video';
import { openSignIn } from '~/site/sign-in';
import site from '../../site.config';

export const Route = createFileRoute('/')({
  head: () =>
    pageHead(site, {
      title: 'Shaking Head AI Video Generator — Your Photo, the Viral Head Shake',
      description:
        'Make a shaking head AI video from one pet photo or selfie. Choose a 7.36- or 15-second, 720p vertical MP4 with the original trend sound. One-time packs from $8.80. No subscription.',
      path: '/',
      image: `${site.url}/og-duration-options.png`,
      jsonLd: [
        {
          '@type': 'WebApplication',
          name: site.name,
          url: site.url,
          applicationCategory: 'MultimediaApplication',
          operatingSystem: 'Web',
          offers: {
            '@type': 'Offer',
            price: '8.80',
            priceCurrency: 'USD',
            description: '20 credits: two 7.36-second videos or one 15-second video',
          },
        },
        {
          '@type': 'FAQPage',
          mainEntity: FAQS.map((faq) => ({
            '@type': 'Question',
            name: faq.question,
            acceptedAnswer: { '@type': 'Answer', text: faq.answer },
          })),
        },
      ],
    }),
  component: Home,
});

const root = getRouteApi('__root__');
const STATE_KEY = 'shaking-head:photo:v1';
const DURATION_KEY = 'shaking-head:duration:v1';
type VideoId = (typeof VIDEO_OPTIONS)[number]['id'];
type Photo = { path: string; name: string };
const isActive = (job: PublicJob) => job.status === 'queued' || job.status === 'submitted';

function Home() {
  const config = root.useLoaderData();
  const session = authClient(config.googleClientId).useSession();
  const { jobs, generate, cancel, submitting, uncertain, checking, error, clearError } = useSafeGeneration(
    session.data?.user.id ?? null,
  );
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [selectedId, setSelectedId] = useState<VideoId>('shaking-head');
  const selected = VIDEO_OPTIONS.find((option) => option.id === selectedId) ?? VIDEO_OPTIONS[0];
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [restored, setRestored] = useState(false);
  const [resumed, setResumed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const sendingRef = useRef(false);
  const active = jobs.some(isActive);
  const statuses = useRef(new Map<string, PublicJob['status']>());

  useEffect(() => {
    try {
      const savedDuration = sessionStorage.getItem(DURATION_KEY);
      if (VIDEO_OPTIONS.some((option) => option.id === savedDuration)) {
        setSelectedId(savedDuration as VideoId);
      }
      const saved = JSON.parse(sessionStorage.getItem(STATE_KEY) ?? 'null') as Photo | null;
      if (saved && /^\/files\/uploads\/up_[a-z0-9]+\.(jpg|png|webp)$/.test(saved.path)) setPhoto(saved);
      const url = new URL(location.href);
      if (url.searchParams.has('resume')) {
        setResumed(!!saved);
        url.searchParams.delete('resume');
        history.replaceState(history.state, '', url);
      }
    } catch {
      /* A blocked storage API must not prevent uploads. */
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(DURATION_KEY, selectedId);
      if (photo) sessionStorage.setItem(STATE_KEY, JSON.stringify(photo));
      else sessionStorage.removeItem(STATE_KEY);
    } catch {
      /* The current photo still works when persistence is unavailable. */
    }
  }, [photo, selectedId, restored]);

  useEffect(() => {
    for (const job of jobs) {
      const previous = statuses.current.get(job.id);
      statuses.current.set(job.id, job.status);
      if (previous !== 'queued' && previous !== 'submitted') continue;
      if (job.status === 'succeeded') track('result_ready', { model: job.modelId });
      if (job.status === 'failed') track('result_failed', { code: job.error?.code ?? 'unknown' });
    }
  }, [jobs]);

  async function upload(file: File) {
    if (uploadingRef.current) return;
    setUploadError('');
    clearError();
    if (!PHOTO_TYPES.includes(file.type)) {
      setUploadError('Please choose a JPG, PNG or WebP photo. Convert HEIC to JPG first.');
      return;
    }
    if (file.size === 0 || file.size > MAX_PHOTO_BYTES) {
      setUploadError('Choose a photo smaller than 10 MB.');
      return;
    }
    uploadingRef.current = true;
    setUploading(true);
    try {
      const bitmap = await createImageBitmap(file);
      // Prepare a vertical reference portrait before upload.
      const canvas = new OffscreenCanvas(720, 1280);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image preparation unavailable');
      const scale = Math.max(720 / bitmap.width, 1280 / bitmap.height);
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;
      context.drawImage(bitmap, (720 - width) / 2, (1280 - height) / 2, width, height);
      bitmap.close();
      const prepared = new File(
        [await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })],
        file.name.replace(/\.[^.]+$/, '') + '.jpg',
        { type: 'image/jpeg' },
      );
      const path = await uploadReference(prepared);
      setPhoto({ path, name: file.name });
      track('photo_uploaded', { type: file.type });
    } catch {
      setUploadError(
        'That photo could not be uploaded. Check your connection and try a clear JPG, PNG or WebP.',
      );
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void upload(file);
    event.target.value = '';
  }
  function drop(event: DragEvent<HTMLFieldSetElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  }
  async function selectSample(name: string) {
    try {
      const response = await fetch(`/media/${name}.jpg`);
      if (!response.ok) throw new Error('Photo unavailable');
      await upload(new File([await response.blob()], `${name}.jpg`, { type: 'image/jpeg' }));
    } catch {
      setUploadError('This sample photo is unavailable. Please upload your own photo.');
    }
  }
  async function start(modelId: VideoId = selectedId) {
    if (!photo || sendingRef.current || active || uploadingRef.current || uncertain || checking) return;
    sendingRef.current = true;
    try {
      const job = await generate({ modelId, references: [photo.path] });
      if (job) {
        track('generate_started', { model: job.modelId });
        document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } finally {
      sendingRef.current = false;
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!photo || uploading || submitting || active || uncertain || checking) return;
    track('generate_click', { signedIn: !!session.data, model: selectedId });
    const modelId = selectedId;
    try {
      sessionStorage.setItem(DURATION_KEY, modelId);
    } catch {
      /* The selected option still works when persistence is unavailable. */
    }
    if (!session.data) openSignIn(() => void start(modelId), 'generate');
    else void start(modelId);
  }
  async function cancelJob(id: string) {
    setCancelError('');
    try {
      await cancel(id);
    } catch {
      setCancelError('Could not cancel this video. Please try again; you can still find it in your account.');
    }
  }

  return (
    <>
      {config.preview && (
        <div className="preview-notice" role="status">
          Local preview. Generation is simulated and checkout is disabled.
        </div>
      )}
      <section className="hero" id="create">
        <div className="hero-heading">
          <div>
            <h1>
              Make a <span>shaking head</span>
              <br />
              AI video.
            </h1>
          </div>
          <div className="hero-intro">
            <p>
              Your selfie. Your pet. That smug little shake. <br />
              Turn one photo into the reaction everyone gets.
            </p>
            <div className="spec-list">
              <span>
                <Icon name="film" />
                7.36 or 15 seconds
              </span>
              <span>
                <Icon name="phone" />
                720p · 9:16
              </span>
              <span>
                <Icon name="music" />
                Original trend sound
              </span>
            </div>
          </div>
        </div>
        <div className="creator-layout">
          <form className="upload-card" onSubmit={submit}>
            <div className="card-heading">
              <h2>Your photo goes here.</h2>
            </div>
            <fieldset
              aria-label="Photo upload"
              className={`drop-zone ${dragging ? 'dragging' : ''} ${photo ? 'has-photo' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={drop}
            >
              {photo ? (
                <>
                  <img
                    className="uploaded-photo"
                    src={photo.path}
                    alt={`Your selected photo: ${photo.name}`}
                    onError={() => {
                      setPhoto(null);
                      setUploadError('Your saved photo is no longer available. Please upload it again.');
                    }}
                  />
                  <div className="photo-actions">
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => {
                        setPhoto(null);
                        clearError();
                      }}
                      aria-label="Remove photo"
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty-upload">
                  <span className="upload-illustration">
                    <Icon name="image" />
                    <i>+</i>
                  </span>
                  <strong>Selfie or pet photo?</strong>
                  <span>One clear face, looking at the camera.</span>
                </div>
              )}
              <button
                type="button"
                className={`upload-button ${photo ? 'change-photo' : ''}`}
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
              >
                <Icon name="upload" />
                {uploading ? 'Uploading your photo…' : photo ? 'Change photo' : 'Upload a photo'}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={onFile}
                className="visually-hidden"
                aria-label="Upload a photo"
                disabled={uploading}
              />
            </fieldset>
            <p className="file-note">JPG, PNG or WebP · up to 10 MB</p>
            <div className="sample-photos">
              <span>Or try a photo</span>
              {['dog', 'cat', 'selfie'].map((name) => (
                <button
                  key={name}
                  type="button"
                  disabled={uploading}
                  title={`Try the ${name} sample photo`}
                  onClick={() => void selectSample(name)}
                >
                  <img src={`/media/${name}.jpg`} alt={`${name} example`} width="38" height="38" />
                </button>
              ))}
            </div>
            <div className="duration-options" role="radiogroup" aria-label="Video duration">
              {VIDEO_OPTIONS.map((option) => (
                <label key={option.id}>
                  <input
                    type="radio"
                    name="video-duration"
                    value={option.id}
                    checked={selectedId === option.id}
                    disabled={submitting || active || uncertain || checking}
                    onChange={() => {
                      setSelectedId(option.id);
                      clearError();
                      try {
                        sessionStorage.setItem(DURATION_KEY, option.id);
                      } catch {
                        /* Selection remains available without browser storage. */
                      }
                    }}
                  />
                  <span>
                    {option.seconds}s · {option.credits} credits
                  </span>
                </label>
              ))}
            </div>
            <button
              type="submit"
              className="primary make-button"
              disabled={
                !photo ||
                uploading ||
                submitting ||
                active ||
                uncertain ||
                checking ||
                !config.generationReady
              }
            >
              {submitting ? (
                'Starting your video…'
              ) : uncertain ? (
                'Checking your request…'
              ) : checking ? (
                'Checking your videos…'
              ) : active ? (
                'Your video is generating…'
              ) : (
                <>
                  Make my video · {selected.credits} credits <Icon name="arrow" />
                </>
              )}
            </button>
            <p className="credit-note">
              {selected.credits} credits per video ·{' '}
              <PricingLink source="generator">
                from ${selected.credits === 10 ? '2.88' : '5.76'} with a pack
              </PricingLink>
            </p>
            {!config.generationReady && (
              <p className="notice">Generation is opening soon. You can explore the trend below.</p>
            )}
            {resumed && photo && !error && <p className="notice">Your photo is saved. Ready when you are.</p>}
            {uploadError && (
              <p className="error" role="alert">
                {uploadError}
              </p>
            )}
            {uncertain && (
              <p className="notice" role="status">
                We are checking whether your video started. Please do not submit another request.{' '}
                <AccountLink>Check your creations</AccountLink> or{' '}
                <a href="mailto:support@shakingheadai.org">contact support</a> if this stays unresolved.
              </p>
            )}
            {error && !uncertain && (
              <div className="error" role="alert">
                {error.code === 'insufficient_credits' ? (
                  <>
                    You need {selected.credits} credits for this video.{' '}
                    <PricingLink source="insufficient_credits">Choose a pack</PricingLink>
                  </>
                ) : error.code === 'login_required' ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => openSignIn(() => void start(), 'retry')}
                  >
                    Sign in to make your video
                  </button>
                ) : (
                  'We could not confirm your request. Check your account before starting another video.'
                )}
              </div>
            )}
            <p className="permission-note">
              Use your pet, yourself, or an adult who agreed. <a href="/terms">Terms</a> &amp;{' '}
              <a href="/privacy">privacy</a>.
            </p>
          </form>
          <div className="trend-stage" id="examples">
            <div className="trend-heading">
              <h2>
                <Icon name="spark" />
                The shake that started it.
              </h2>
            </div>
            <div className="tiktok-grid">
              {TIKTOK_REFERENCES.map((video) => (
                <article className="tiktok-card" key={video.id}>
                  <ReferenceVideo id={video.id} creator={video.creator} title={video.title} />
                  <a
                    href={`https://www.tiktok.com/@${video.creator}/video/${video.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    @{video.creator}
                    <Icon name="external" />
                  </a>
                </article>
              ))}
            </div>
            <p className="reference-note">
              Original TikTok references, credited to their creators.{' '}
              <a href="https://www.tiktok.com/tag/shakingheadtrend" target="_blank" rel="noopener noreferrer">
                See the trend ↗
              </a>
            </p>
          </div>
        </div>
        {jobs.length > 0 && (
          <section className="results-section" id="results" aria-live="polite">
            <div className="section-heading">
              <h2>Your videos.</h2>
            </div>
            {cancelError && (
              <p className="error" role="alert">
                {cancelError}
              </p>
            )}
            <div className="results">
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  preview={config.preview}
                  onCancel={() => void cancelJob(job.id)}
                />
              ))}
            </div>
          </section>
        )}
      </section>
      <section className="generated-example" id="generated-example" aria-labelledby="generated-example-title">
        <h2 id="generated-example-title">One photo. That head shake.</h2>
        <div className="photo-to-video">
          <figure>
            <button
              type="button"
              className="example-photo"
              aria-label="Try this cat photo"
              disabled={uploading}
              onClick={() => {
                void selectSample('generated-cat-input-v1');
                document.getElementById('create')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <img
                src={GENERATED_CAT_EXAMPLE.photo}
                alt="Orange-and-white kitten sitting by a window"
                width="720"
                height="1082"
                loading="lazy"
              />
            </button>
            <figcaption>Your photo</figcaption>
          </figure>
          <Icon name="arrow" />
          <figure>
            <ExampleVideo
              src={GENERATED_CAT_EXAMPLE.video}
              poster={GENERATED_CAT_EXAMPLE.photo}
              title={GENERATED_CAT_EXAMPLE.title}
              label="Cat head-shake video generated with Shaking Head AI"
            />
            <figcaption>Generated video</figcaption>
          </figure>
        </div>
      </section>
      <section className="how-section" id="how-it-works">
        <div className="section-heading">
          <h2>
            Three steps.
            <br />
            Zero editing skills.
          </h2>
          <p>
            We handle the motion.
            <br />
            You bring the personality.
          </p>
        </div>
        <div className="steps">
          <article>
            <span>01</span>
            <Icon name="image" />
            <h3>Pick your main character.</h3>
            <p>
              One front-facing photo of your cat, dog or yourself. Clear eyes. Good light. Maximum
              personality.
            </p>
          </article>
          <article>
            <span>02</span>
            <Icon name="spark" />
            <h3>Let the head shake happen.</h3>
            <p>The AI brings the smug grin, the side-to-side shake and that suddenly innocent stare.</p>
          </article>
          <article>
            <span>03</span>
            <Icon name="download" />
            <h3>Download. Add your caption.</h3>
            <p>Get your MP4 with the original trend sound, ready for your caption.</p>
          </article>
        </div>
      </section>
      <section className="pricing-section" id="pricing">
        <div className="section-heading">
          <div>
            <h2>
              A little shake.
              <br />A lot of personality.
            </h2>
          </div>
          <p>
            7.36 seconds: 10 credits. 15 seconds: 20 credits.
            <br />
            Purchased credits never expire.
          </p>
        </div>
        <Plans />
        <p className="pricing-specs">
          7.36 or 15 seconds · 720p vertical MP4 · Original trend sound · No site watermark
        </p>
      </section>
      <section className="faq-section" id="faq">
        <div>
          <h2>Good questions.</h2>
          <p>
            Still wondering?
            <br />
            <a href="mailto:support@shakingheadai.org">support@shakingheadai.org</a>
          </p>
        </div>
        <div className="faq-list">
          {FAQS.map((faq, index) => (
            <details key={faq.question} open={index === 0}>
              <summary>
                {faq.question}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="last-call">
        <h2>Your photo. Your turn.</h2>
        <a className="button primary" href="#create">
          Make my shaking head video <Icon name="arrow" />
        </a>
      </section>
    </>
  );
}

function JobCard({ job, preview, onCancel }: { job: PublicJob; preview: boolean; onCancel: () => void }) {
  const active = isActive(job);
  return (
    <article className="job">
      {job.outputs.map((output) =>
        output.mediaType.startsWith('video/') ? (
          <video
            key={output.url}
            src={output.url}
            controls
            playsInline
            aria-label="Your generated shaking head video"
          >
            <track kind="captions" />
          </video>
        ) : (
          <img
            key={output.url}
            src={output.url}
            alt={preview ? 'Simulated output: original input photo' : 'Your generation result'}
          />
        ),
      )}
      {active && (
        <div className="job-pending">
          <span className="spinner" />
          <h3>Giving it the head shake…</h3>
          <p>
            This can take several minutes.
            <br />
            You can return to your account later.
          </p>
          <button type="button" onClick={onCancel}>
            Cancel video
          </button>
        </div>
      )}
      {job.status === 'succeeded' && (
        <>
          <p>
            {preview
              ? 'Simulated result — original photo returned. This is not an AI-generated video.'
              : 'Your video is ready.'}
          </p>
          {job.outputs.map((output) => (
            <a
              className="button primary"
              key={output.url}
              href={output.url}
              download
              data-rybbit-event="result_download"
            >
              <Icon name="download" />
              {preview ? 'Download test result' : 'Download MP4'}
            </a>
          ))}
        </>
      )}
      {(job.status === 'failed' || job.status === 'canceled') && (
        <p className="error">
          {job.status === 'failed' ? 'This video failed.' : 'Video canceled.'} Your {job.costCredits} credits
          have been returned.
        </p>
      )}
      <p className="job-id">{job.id}</p>
    </article>
  );
}

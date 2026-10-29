# Shaking Head AI

- Domain: https://shakingheadai.org
- Target: shaking head ai, shaking head AI video, shaking head trend
- Status: first release; paid generation quality and payment settlement require separate acceptance
- Product: one photo of an adult or a pet → a 7.36-second or 15-second 720p 9:16 MP4 with the original trend sound
- Model: APIMart `seedance-2.0-mini`, photo identity plus a fixed calf motion-reference video
- Packs: $8.80 / 20 credits; $18.80 / 60 credits; $28.80 / 100 credits. Enough for 2/6/10 short videos or 1/3/5 long videos.
- A 7.36-second video uses 10 credits; a 15-second video uses 20 credits. Packs can mix both lengths. No subscription or signup bonus. Purchased credits do not expire.
- Support: support@shakingheadai.org, forwarded through Cloudflare Email Routing; actual inbox delivery has not been tested.
- Stripe account: `acct_1UVbDcAoOzLdqL1R` (Shaking Head AI, HK); account API confirms charges/payouts enabled. Statement descriptor `SHAKING HEAD AI`, short prefix `SHAKINGAI`. No live purchase has been tested.
- Stripe webhook: `we_1UVbghAoOzLdqL1RUGif7WZ4`, `https://shakingheadai.org/api/webhooks/stripe`, nine checkout/refund/dispute events. Delivery and settlement need verification separately.
- Cloudflare: `explusyqt@gmail.com`, account `80797548dfa9244ddcd458f0375525ae`; Worker `shaking-head-ai`, D1 `59084a06-f04d-4938-acb1-762c7b0f5437`, R2 `shaking-head-ai-outputs`.
- Domain zone: `25f9d44a020d2bfab2d7d93c2147089c`, Free Website, active. Nameservers are `maciej.ns.cloudflare.com` and `wanda.ns.cloudflare.com`.
- Google OAuth: project `shakingheadai-20261029`, External / Production, only OpenID, email and profile. Real Google sign-in passed locally and on the production domain.
- GA4: account `398760142`, property `561185914`, web stream `16223856936`, measurement `G-46QFS3MYRJ`; production page-view and pricing events were observed in collection requests and Realtime.
- GSC: `sc-domain:shakingheadai.org` verified; sitemap processed successfully with five discovered pages. Indexing remains unverified.

## Implementation

Created from `templates/ai-site`. Auth, credits, payments, jobs and Workflows stay in the shared packages. The site owns its pages and visual design. `src/site/generation.ts` fixes the head-shake prompt and `site.models.ts` pins the mode-specific calf reference video; the API accepts one uploaded photo and discards caller-supplied model parameters. Uploaded images are prepared as 720×1280 JPEGs before entering R2, to provide a consistent portrait reference. Seedance renders eight silent seconds for the short option or 15 silent seconds for the long option; the site postprocessor adds the mode-specific pinned AAC track and trims the video to match its duration: 324664/44100 seconds for short, or 15 seconds for long. The short track never loops; the long track is an original-speed audio loop. Neither track is re-encoded during job processing. Video tail packets are discarded; any required H.264 look-ahead frames occupy a sub-millisecond final interval so B-frame decoding stays intact. Missing or modified audio fails the job through the normal credit-refund path.

Direct APIMart support lives in `packages/jobs/src/apimart.ts`. The adapter copies the input from R2 to APIMart's image upload endpoint, submits a job once, polls it and lets the existing runner store the result. Atomic R2 claims prevent duplicate paid POSTs after a replay or an uncertain response. There is no documented upstream cancel API; local cancellation refunds user credits but may not prevent the upstream from charging. First-frame jobs remain compatible. Reference mode uploads the photo in `image_urls` and sends the server-owned clip in `video_urls`, without `image_with_roles`. The local budget guard conservatively counts output seconds plus rounded-up reference seconds at the existing higher no-video rate; it is not enforced by APIMart. Caps are $0.65 for short and $1.20 for long. User credit prices remain 10 and 20.

## Local development

Use Node 24 and pnpm 10.30.1. Local secrets live outside the repository at `~/.config/shipwords/shaking-head-ai.dev.vars`, linked as `.dev.vars`. A real APIMart key was made available by the owner for one paid test. Do not copy it into documentation, source or test fixtures.

```sh
pnpm install
cd sites/shaking-head-ai
pnpm db:migrate:local
PORT=6273 pnpm dev
```

Use `UPSTREAM_MOCK=1` for development without upstream charges. Leave it empty only for an authorized real generation. Local credentials can point to real providers: never assume they are dummy values. Standard or restricted Stripe keys require a webhook secret and `BILLING_ENABLED=1`; sandbox keys enable checkout only in development, while production requires live keys. Nonempty mock configuration closes payment APIs as well as buttons. `EMAIL_LOGIN_ENABLED=0` keeps email sign-in closed until the site's sending domain is configured; Google sign-in stays available. Local email QA can explicitly set it to `1` and use Miniflare's binding without sending external email.

```sh
pnpm --filter @shipwords/jobs check
node --test sites/shaking-head-ai/tests/generation.test.ts
node --test sites/shaking-head-ai/tests/integrations.test.ts
pnpm --filter ./sites/shaking-head-ai typecheck
pnpm --filter ./sites/shaking-head-ai build
```

`pnpm --filter ./sites/shaking-head-ai check` also checks production resource IDs. The configured D1 ID belongs to this site; never replace it with another site's database to bypass an account limit.

## Media sources

The three trend videos are reference clips from these public TikTok originals, not outputs made by this service. Creator links remain visible below each clip. The MP4s are encoded as H.264/AAC for ordinary browser playback without the full TikTok player UI.

- https://www.tiktok.com/@melvdih/video/7698191391867899150
- https://www.tiktok.com/@baller213465/video/7698566580480920863
- https://www.tiktok.com/@sgfxking/video/7673825420571102471

Sample input photos are from Unsplash and are not presented as generated results:

- Dog: `photo-1552053831-71594a27632d`
- Cat: `photo-1514888286974-6c03e2ca1dba`
- Selfie: `photo-1506794778202-cad84cf45f1d`

The approved generated kitten example is `public/media/generated-cat-reference-v1.mp4` (APIMart task `task_01M62NCHYPMCWZ4S51N2QG2P40`, actual cost $0.3564), using the full-body Pexels photo https://images.pexels.com/photos/2071873/pexels-photo-2071873.jpeg and the calf motion reference. It is an actual generated output, distinct from the three credited TikTok clips. The short preset uses that same calf video; the long preset uses its 15-second loop `cow-motion-loop15-v1.mp4`. No new paid render was made for this integration. The generic subject wording supports other pets or adult selfies; it does not guarantee identical expressions or timing.

The favicon, smiley graphic and social card are original code-authored graphics.

## Launch requirements

Deploy production only from `main`. The owner authorized this site's first release, resources, domain cutover, Stripe and Google setup. New paid model tests and payment charges still need their own authorization.

Use this site's isolated Wrangler profile for every remote command; the global CLI belongs to a different account:

```sh
XDG_CONFIG_HOME=/Users/yang/.config/shipwords/cloudflare-80797548 pnpm --filter ./sites/shaking-head-ai exec wrangler whoami
```

Production secrets live in `~/.config/shipwords/shaking-head-ai.production-secrets.json` (0600), outside Git; upload atomically with `wrangler deploy --secrets-file` using that private file. Google and Stripe source credentials have separate private `.env` files under the same directory. `BILLING_ENABLED=1` opens purchases after the owner-approved nonpayment checks; setting it to `0` pauses checkout and reconciliation APIs. `EMAIL_LOGIN_ENABLED` remains `0` until sending is configured; inbound support forwarding does not enable outbound email.

Stripe webhook URL: `https://shakingheadai.org/api/webhooks/stripe`. Checkout creates inline prices from `site.config.ts`; dashboard Products/Prices are not required. The three packs are one-time payments, not subscriptions. Credentials stay outside Git under `~/.config/shipwords/` and in deployed Worker secrets. Never reuse another site's credentials without checking the owning account.

Google OAuth uses the JavaScript origin `https://shakingheadai.org` and redirect URI `https://shakingheadai.org/api/auth/callback/google`. Local origins must be registered separately for the configured development port. The sign-in button is shown only when both Google credentials are present on the server.

GSC ownership, sitemap submission, GA4 configuration and actual event collection each need separate evidence after the domain is live. The production nonpayment review is in `.tmp/qa/acceptance/README.md`; it does not cover payment settlement or a new paid generation.

Raw HTML, metadata, FAQ, mobile layout, media playback, login, upload and job behavior must be verified separately. Prompted ChatGPT feedback is not evidence of natural recommendations to other users. Original-audio packet preservation and 7.36-second playback were verified with existing and synthetic media in workerd, FFmpeg and Chromium; the owner reviewed and approved the new reference-video kitten sample as the visual target. This does not establish frame-exact timing or validate a newly generated 15-second reference clip. A passing build or a local generation is not production evidence.

## Original audio deployment

Before deploying the postprocessor, upload `public/media/original-trend-v1.m4a` to this site's R2 key `assets/shaking-head/original-trend-v1.m4a`. Read it back and verify SHA-256 `4bb2e4e31a960edec23eb5da9fe50ef53bd453eafe7fda61af4d1a2343e55d55`. The worker checks the same hash for every job. The original 319 AAC packets are retained; no generated audio is included. The prompt now requests the fixed calf video’s motion and expressions. Reference conditioning does not guarantee frame-exact model adherence.

Run `node --test sites/shaking-head-ai/tests/*.test.ts` for the site contract and real packet-remux tests. The independent FFmpeg decoder test runs when FFmpeg/ffprobe are installed. `tests/fixtures/generated-eight-seconds.mp4` is a synthetic blue H.264/B-frame clip with an 880 Hz generated-audio test track, never a customer result.

The 15-second option uses `public/media/original-trend-loop15-v1.m4a`, uploaded to R2 key `assets/shaking-head/original-trend-loop15-v1.m4a`, SHA-256 `e2cbf6b3a812d89ded86ac4c01594cc39b09e0b801e42e7f72ec038086cfc79f`. It is an original-speed loop of the reference sound, not a claim of an original continuous 15-second recording. The short option never loops. Server-owned model IDs determine costs and duration; caller-supplied pricing, duration and audio parameters are discarded.

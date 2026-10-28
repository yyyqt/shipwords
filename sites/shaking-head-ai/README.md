# Shaking Head AI

- Domain: https://shakingheadai.org
- Target: shaking head ai, shaking head AI video, shaking head trend
- Status: first release; paid generation quality and payment settlement require separate acceptance
- Product: one photo of an adult or a pet → a 15-second 720p 9:16 MP4 with a newly generated instrumental beat
- Model: APIMart `seedance-2.0-mini`, first-frame image-to-video
- Pricing: $8.80 / 20 credits / 1 video; $18.80 / 60 credits / 3 videos; $28.80 / 100 credits / 5 videos
- Every generation uses 20 credits. No subscription or signup bonus. Purchased credits do not expire.
- Support address to configure before launch: support@shakingheadai.org
- Stripe account: `acct_1UVbDcAoOzLdqL1R` (Shaking Head AI, HK); account API confirms charges/payouts enabled. Statement descriptor `SHAKING HEAD AI`, short prefix `SHAKINGAI`. No live purchase has been tested.
- Stripe webhook: `we_1UVbghAoOzLdqL1RUGif7WZ4`, `https://shakingheadai.org/api/webhooks/stripe`, nine checkout/refund/dispute events. Delivery and settlement need verification separately.
- Cloudflare: `explusyqt@gmail.com`, account `80797548dfa9244ddcd458f0375525ae`; Worker `shaking-head-ai`, D1 `59084a06-f04d-4938-acb1-762c7b0f5437`, R2 `shaking-head-ai-outputs`.
- Domain zone: `25f9d44a020d2bfab2d7d93c2147089c`, Free Website; registrar NS cutover must follow removal and expiry of the old DNSSEC DS.
- Google OAuth: project `shakingheadai-20261029`, External / Production, only OpenID, email and profile. Local real Google sign-in passed; production-domain sign-in must be checked after deployment.
- GA4: account `398760142`, property `561185914`, web stream `16223856936`, measurement `G-46QFS3MYRJ`; production collection must be verified independently of property creation.

## Implementation

Created from `templates/ai-site`. Auth, credits, payments, jobs and Workflows stay in the shared packages. The site owns its pages and visual design. `src/site/generation.ts` fixes the head-shake prompt; the API accepts one uploaded photo and discards caller-supplied model parameters. Uploaded images are prepared as 720×1280 JPEGs before entering R2, so the first frame matches the promised portrait output.

Direct APIMart support lives in `packages/jobs/src/apimart.ts`. The adapter copies the input from R2 to APIMart's image upload endpoint, submits a job once, polls it and lets the existing runner store the result. Atomic R2 claims prevent duplicate paid POSTs after a replay or an uncertain response. There is no documented upstream cancel API; local cancellation refunds user credits but may not prevent the upstream from charging. The cost limit is checked against a published-rate estimate and is not enforced by APIMart.

## Local development

Use Node 24 and pnpm 10.30.1. Local secrets live outside the repository at `~/.config/shipwords/shaking-head-ai.dev.vars`, linked as `.dev.vars`. A real APIMart key was made available by the owner for one paid test. Do not copy it into documentation, source or test fixtures.

```sh
pnpm install
cd sites/shaking-head-ai
pnpm db:migrate:local
PORT=6273 pnpm dev
```

Use `UPSTREAM_MOCK=1` for development without upstream charges. Leave it empty only for an authorized real generation. Local Stripe values are dummy test credentials and never enable checkout. Standard or restricted Stripe keys require a webhook secret and `BILLING_ENABLED=1`; sandbox keys enable checkout only in development, while production requires live keys. Nonempty mock configuration closes payment APIs as well as buttons. `EMAIL_LOGIN_ENABLED=0` keeps email sign-in closed until the site's sending domain is configured; Google sign-in stays available. Local email QA can explicitly set it to `1` and use Miniflare's binding without sending external email.

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

The favicon, smiley graphic and social card are original code-authored graphics.

## Launch requirements

Deploy production only from `main`. The owner authorized this site's first release, resources, domain cutover, Stripe and Google setup. New paid model tests and payment charges still need their own authorization.

Use this site's isolated Wrangler profile for every remote command; the global CLI belongs to a different account:

```sh
XDG_CONFIG_HOME=/Users/yang/.config/shipwords/cloudflare-80797548 pnpm --filter ./sites/shaking-head-ai exec wrangler whoami
```

Production secrets live in `~/.config/shipwords/shaking-head-ai.production-secrets.json` (0600), outside Git; upload with `wrangler secret bulk` using that private file. Google and Stripe source credentials have separate private `.env` files under the same directory. `BILLING_ENABLED=0` pauses checkout and reconciliation APIs; change it to `1` only for the owner-approved opening after nonpayment checks. `EMAIL_LOGIN_ENABLED` remains `0` until sending is configured.

Stripe webhook URL: `https://shakingheadai.org/api/webhooks/stripe`. Checkout creates inline prices from `site.config.ts`; dashboard Products/Prices are not required. The three packs are one-time payments, not subscriptions. Credentials stay outside Git under `~/.config/shipwords/` and in deployed Worker secrets. Never reuse another site's credentials without checking the owning account.

Google OAuth uses the JavaScript origin `https://shakingheadai.org` and redirect URI `https://shakingheadai.org/api/auth/callback/google`. Local origins must be registered separately for the configured development port. The sign-in button is shown only when both Google credentials are present on the server.

Finish the site, generation/audio behavior, Stripe and Google sign-in before GSC or GA4 setup. GSC ownership, sitemap submission, GA4 configuration and actual event collection each need separate evidence after the domain is live.

Raw HTML, metadata, FAQ, mobile layout, media playback, login, upload and job behavior must be verified separately. ChatGPT live access and natural recommendation remain unverified while the domain is unpublished. A passing build or a local generation is not production evidence.

export const FAQS = [
  {
    question: 'What is Shaking Head AI?',
    answer:
      'Shaking Head AI turns one animal photo into a 7.36- or 15-second head-shaking reaction video. The subject closes its eyes in a smug grin, shakes its head from side to side, then opens its eyes in a surprised stare. No prompt or video editing is needed.',
  },
  {
    question: 'Can I use a photo of my cat, dog or another animal?',
    answer:
      'Yes. Use one clear, front-facing photo of one animal, with both eyes visible. JPG, PNG and WebP are supported, up to 10 MB. Close-ups with even lighting work best. The photo is center-cropped to a vertical frame; keep the face near the middle. HEIC files need to be converted to JPG first.',
  },
  {
    question: 'Is it free? How much does one video cost?',
    answer:
      'Generation requires a signed-in account and paid credits, including when using a sample photo. A 7.36-second video costs 10 credits; a 15-second video costs 20. Packs start at $8.80 for 20 credits. You can mix both lengths in one pack. Purchased credits never expire, and there is no subscription.',
  },
  {
    question: 'What video will I get?',
    answer:
      'Choose a 7.36- or 15-second vertical 9:16 video at 720p, delivered as an MP4, with the original trend sound. We do not add a site watermark. AI can vary between runs, so the exact expressions, movement and timing are not guaranteed to match a reference clip.',
  },
  {
    question: 'Is sound included?',
    answer:
      'Yes. Both options include the original trend sound. The 7.36-second video plays it once; the 15-second video loops it.',
  },
  {
    question: 'Are the videos shown here made with Shaking Head AI?',
    answer:
      'The cat example was generated with our photo-and-motion-reference workflow and the original trend sound. The three credited TikTok clips are references from their original creators. Each new generation can vary.',
  },
  {
    question: 'How long does generation take? Can I close the tab?',
    answer:
      'Generation can take several minutes, depending on provider demand. You can close this page and return to the same account to check progress and download your video. If a job is still queued or generating after 35 minutes, refresh your account; contact support with the job ID if it remains unresolved.',
  },
  {
    question: 'What happens if generation fails?',
    answer:
      'A job marked failed or canceled returns its spent credits automatically. This is a credit refund, not an automatic refund to your card. If a completed video cannot be played or downloaded, is missing its main subject, or has another material technical problem, contact support with the job ID for review. Normal AI variation does not trigger an automatic refund. Payment refunds are reviewed separately; see the refund policy.',
  },
  {
    question: 'Do I need an account? What happens to my photo?',
    answer:
      'You need to sign in before purchasing credits or generating. Uploads and videos are stored to process your job and let you download it; unlisted file links should be treated as shareable links. Do not upload sensitive photos. For deletion, email support@shakingheadai.org from your account email with the job IDs or file links, and say whether you want individual files or the whole account removed. We verify ownership before removal; payment and security records may need to be retained. Read the privacy policy for details.',
  },
];

export const TIKTOK_REFERENCES = [
  { id: '7698191391867899150', creator: 'melvdih', title: 'The calf reaction', label: 'The viral one' },
  { id: '7698566580480920863', creator: 'baller213465', title: 'The cat version', label: 'Cat energy' },
  {
    id: '7673825420571102471',
    creator: 'sgfxking',
    title: 'The buffalo head shake',
    label: 'The head shake',
  },
];

export const GENERATED_CAT_EXAMPLE = {
  photo: '/media/generated-cat-input-v1.jpg',
  video: '/media/generated-cat-reference-v1.mp4',
  title: 'The generated cat head shake',
};

export const GENERATED_EXAMPLES = [
  {
    id: 'cat',
    label: 'Cat',
    ...GENERATED_CAT_EXAMPLE,
  },
];

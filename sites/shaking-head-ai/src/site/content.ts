export const FAQS = [
  {
    question: 'What is Shaking Head AI?',
    answer:
      'Shaking Head AI turns one photo of yourself or your pet into a 7.36- or 15-second head-shaking reaction video. The subject closes its eyes in a smug grin, shakes its head from side to side, then opens its eyes in a surprised stare. No prompt or video editing is needed.',
  },
  {
    question: 'Can I use a photo of my cat, dog or myself?',
    answer:
      'Yes. Use one clear, front-facing photo of one pet or consenting adult, with both eyes visible. JPG, PNG and WebP are supported, up to 10 MB. Close-ups with even lighting work best. The photo is center-cropped to a vertical frame; keep the face near the middle. HEIC files need to be converted to JPG first.',
  },
  {
    question: 'Is it free? How much does one video cost?',
    answer:
      'Video generation is paid. A 7.36-second video uses 10 credits; a 15-second video uses 20 credits. Buy 20 credits for $8.80, 60 credits for $18.80, or 100 credits for $28.80. These cover 2, 6 or 10 short videos, or 1, 3 or 5 long videos. You can mix both durations in the same pack. All packs are one-time purchases with no subscription, and purchased credits do not expire.',
  },
  {
    question: 'What video will I get?',
    answer:
      'Choose a 7.36- or 15-second vertical 9:16 video at 720p, delivered as an MP4, with the original trend sound. We do not add a site watermark. AI can vary between runs, so the exact expressions, movement and timing are not guaranteed to match a reference clip.',
  },
  {
    question: 'Does the video include the original TikTok song?',
    answer:
      'Yes. The original audio excerpt is added after generation at its original speed, without AI recreation. The 7.36-second option plays it once; the 15-second option loops it to fill the video. A fixed calf video guides the head-shake motion alongside your photo; AI motion and beat alignment can still vary.',
  },
  {
    question: 'Are the videos shown here made with Shaking Head AI?',
    answer:
      'The orange-and-white cat example was generated with our photo-and-motion-reference workflow and the original trend sound. The three credited TikTok clips are references from their original creators. Each new generation can vary.',
  },
  {
    question: 'How long does generation take? Can I close the tab?',
    answer:
      'Generation can take several minutes, depending on provider demand. You can return to the same account to find recent jobs and results. When email delivery is available, we send a completion notice. There is no guaranteed completion time.',
  },
  {
    question: 'What happens if generation fails?',
    answer:
      'A job marked failed or canceled returns its spent credits automatically. This is a credit refund, not an automatic refund to your card. For a payment refund or a problem with a completed video, contact support with your order or job ID; see the refund policy.',
  },
  {
    question: 'Do I need an account? What happens to my photo?',
    answer:
      'You need to sign in before purchasing credits or generating. Uploads and videos are stored to process your job and let you download it; unlisted file links should be treated as shareable links. Do not upload sensitive photos. You can request account and file deletion through support. Read the privacy policy for details.',
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

export const VIDEO_CREDITS = 20;
export const VIDEO_SECONDS = 15;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// The browser picks a photo; the server owns the model, motion, duration and cost.
// Keep the prompt out of the browser bundle.
export function prepareGeneration(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  if (input.modelId !== 'shaking-head' || !Array.isArray(input.references) || input.references.length !== 1)
    return null;
  const photo = input.references[0];
  if (typeof photo !== 'string' || !/^\/files\/uploads\/up_[a-z0-9]+\.(jpg|png|webp)$/.test(photo))
    return null;
  return {
    modelId: 'shaking-head',
    prompt: [
      'Animate the single subject in the first-frame photo into a playful head-shaking reaction meme.',
      'Keep the exact same subject identity, facial features, fur markings or hair, clothing, body proportions, lighting and background. One continuous locked-off close-up, no camera movement, cuts, new subjects or scene changes.',
      'Repeat this clear two-part reaction three times over fifteen seconds: first squeeze both eyes fully shut, form a smug pleased closed-mouth grin, and gently shake the head left and right; then snap both eyes wide open, look straight into the camera, open the mouth slightly with the tongue tip visible, and pause in an innocent surprised stare. Return to the closed-eye grin and shake for the next round.',
      'Keep the torso and background steady; animate the head and face naturally. No full-body dancing. The playful expression must stay recognizable as the animal or person in the input photo.',
      'Create an original light instrumental percussion and bass beat with no vocals. Time the changes in expression and side-to-side head movement to the beat. No copyrighted song, speech, subtitles, text, logos or watermark.',
    ].join(' '),
    references: [photo],
    parameters: {},
    recaptchaToken: typeof input.recaptchaToken === 'string' ? input.recaptchaToken : null,
  };
}

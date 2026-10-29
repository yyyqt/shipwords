export const VIDEO_CREDITS = 20;
export const VIDEO_SECONDS = 7.36;
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
      'Follow this fixed timeline at normal speed: 0.0–0.6 seconds, look toward the lens with open eyes; 0.6–0.7 seconds, close both eyes into a small smug smile; 0.7–2.0 seconds, gently shake the head left and right with small rotations; 2.0–2.1 seconds, stop and open the eyes wide; 2.1–4.2 seconds, hold a still, innocent stare; 4.2–5.6 seconds, close the eyes, smile and perform the second gentle left-right shake; 5.6–5.8 seconds, stop and reopen the eyes; 5.8–8.0 seconds, hold the still stare.',
      'Only shake during the two closed-eye windows. Do not keep oscillating during the open-eye sections. Do not add another cycle, change the pace or distribute these actions across the whole clip. Keep the torso and background steady. No dancing or full-body bobbing.',
      'Output a silent video. Original audio will be added separately and the final video will end at 7.36 seconds. Do not invent music, vocals, speech, subtitles, text, logos or watermarks.',
    ].join(' '),
    references: [photo],
    parameters: {},
    recaptchaToken: typeof input.recaptchaToken === 'string' ? input.recaptchaToken : null,
  };
}

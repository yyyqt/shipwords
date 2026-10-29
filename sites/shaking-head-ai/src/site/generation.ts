export const VIDEO_CREDITS = 10;
export const VIDEO_SECONDS = 7.36;
export const VIDEO_OPTIONS = [
  { id: 'shaking-head', seconds: 7.36, credits: 10, label: '7.36 seconds' },
  { id: 'shaking-head-15s', seconds: 15, credits: 20, label: '15 seconds' },
] as const;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// The browser picks a photo; the server owns the model, motion, duration and cost.
// Keep the prompt out of the browser bundle.
export function prepareGeneration(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  const option = VIDEO_OPTIONS.find((item) => item.id === input.modelId);
  if (!option || !Array.isArray(input.references) || input.references.length !== 1) return null;
  const photo = input.references[0];
  if (typeof photo !== 'string' || !/^\/files\/uploads\/up_[a-z0-9]+\.(jpg|png|webp)$/.test(photo))
    return null;
  return {
    modelId: option.id,
    prompt: [
      '以图片1中的人物或动物为唯一主体，保留它的外观、毛色或发型、脸、四肢、体型和原照片环境，保留原照片构图及可见的身体和脚爪。',
      '严格参考视频1小牛的头部动作：复制同样清晰可见的左右快速摇头、闭眼得意表情、突然睁大眼睛停住的节奏、每次摇头的幅度和起止时间。只把视频1中的动物换成图片1的主体，不要变成牛，不要复制牛的背景。',
      '摇头必须是明显的左右转头，鼻尖来回摆动，不能只是眨眼、轻微歪头或身体晃动。保持主体的身体和相机稳定，连续镜头，真实自然。不要字幕、标志或水印。',
      option.seconds === 15
        ? '跟随15秒参考视频中的重复动作。输出无声15秒视频，后期添加循环的原版音乐。'
        : '输出无声8秒视频，后期添加原版音乐并截取至7.36秒。',
    ].join(' '),
    references: [photo],
    parameters: {},
    recaptchaToken: typeof input.recaptchaToken === 'string' ? input.recaptchaToken : null,
  };
}

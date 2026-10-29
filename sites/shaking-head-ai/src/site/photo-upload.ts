import { MAX_PHOTO_BYTES, PHOTO_TYPES } from '~/site/generation';

export async function preparePhoto(file: File): Promise<File> {
  if (!PHOTO_TYPES.includes(file.type)) {
    throw new Error('Choose a JPG, PNG or WebP photo. Convert HEIC to JPG first.');
  }
  if (!file.size || file.size > MAX_PHOTO_BYTES) throw new Error('Choose a photo smaller than 10 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 1280;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo preparation is unavailable.');
    const scale = Math.max(720 / bitmap.width, 1280 / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (720 - width) / 2, (1280 - height) / 2, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('Photo preparation failed.');
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}

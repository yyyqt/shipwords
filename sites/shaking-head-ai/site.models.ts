import { defineModels } from '@shipwords/jobs/models';

export default defineModels([
  {
    id: 'shaking-head',
    name: 'Shaking Head',
    kind: 'video',
    upstream: 'apimart',
    upstreamModel: 'seedance-2.0-mini',
    credits: 20,
    guest: false,
    allowedParameters: [],
    defaults: { duration: 8, resolution: '720p', aspect_ratio: '9:16', generate_audio: false },
    maxReferences: 1,
    referenceRole: 'first_frame',
    maxCost: '0.40',
    timeoutMinutes: 20,
  },
]);

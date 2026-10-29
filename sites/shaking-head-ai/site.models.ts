import { defineModels } from '@shipwords/jobs/models';

export default defineModels([
  {
    id: 'shaking-head',
    name: 'Shaking Head',
    kind: 'video',
    upstream: 'apimart',
    upstreamModel: 'seedance-2.0-mini',
    credits: 10,
    guest: false,
    allowedParameters: [],
    defaults: { duration: 8, resolution: '720p', aspect_ratio: '9:16', generate_audio: false },
    maxReferences: 1,
    referenceRole: 'first_frame',
    maxCost: '0.40',
    timeoutMinutes: 20,
  },
  {
    id: 'shaking-head-15s',
    name: 'Shaking Head 15s',
    kind: 'video',
    upstream: 'apimart',
    upstreamModel: 'seedance-2.0-mini',
    credits: 20,
    guest: false,
    allowedParameters: [],
    defaults: { duration: 15, resolution: '720p', aspect_ratio: '9:16', generate_audio: false },
    maxReferences: 1,
    referenceRole: 'first_frame',
    maxCost: '0.75',
    timeoutMinutes: 20,
  },
]);

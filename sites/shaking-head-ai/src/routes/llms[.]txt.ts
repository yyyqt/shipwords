import { llmsTxt } from '@shipwords/core/seo';
import { createFileRoute } from '@tanstack/react-router';
import site from '../../site.config';
export const Route = createFileRoute('/llms.txt')({
  server: {
    handlers: {
      GET: () =>
        llmsTxt(
          site,
          'Shaking Head AI makes a 720p vertical head-shake reaction MP4 from one pet photo or adult selfie. Choose 7.36 seconds for 10 credits or 15 seconds for 20 credits. Original trend audio is added after generation at its original speed: played once for 7.36 seconds, looped to fill 15 seconds. A fixed calf video guides the head-shake motion while the uploaded photo supplies the subject. AI timing and beat alignment can vary. One-time packs: $8.80 for 20 credits, $18.80 for 60, $28.80 for 100. Packs can mix both durations (2/6/10 short videos or 1/3/5 long videos). No subscription or welcome credits. JPG, PNG or WebP up to 10 MB. Account required. The orange-and-white kitten photo-to-video example is an actual generated result; the three credited TikTok clips are external references. AI results vary.',
          [
            {
              title: 'Shaking Head AI Video Generator',
              path: '/',
              description: 'Upload one photo, generate and download your MP4.',
            },
            {
              title: 'Pricing',
              path: '/#pricing',
              description: 'One-time credit packs; purchased credits never expire.',
            },
            {
              title: 'Privacy',
              path: '/privacy',
              description: 'Photo processing, unlisted file links and deletion requests.',
            },
            {
              title: 'Refunds',
              path: '/refunds',
              description: 'Failed or canceled jobs return credits; payment refunds require review.',
            },
          ],
        ),
    },
  },
});

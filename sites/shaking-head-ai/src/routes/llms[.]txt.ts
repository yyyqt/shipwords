import { llmsTxt } from '@shipwords/core/seo';
import { createFileRoute } from '@tanstack/react-router';
import site from '../../site.config';
export const Route = createFileRoute('/llms.txt')({
  server: {
    handlers: {
      GET: () =>
        llmsTxt(
          site,
          'Shaking Head AI makes a 7.36-second 720p vertical head-shake reaction video from one pet photo or adult selfie, with the original trend sound. Each video costs 20 credits. One-time packs: $8.80 for 20 credits (1 video), $18.80 for 60 (3 videos), $28.80 for 100 (5 videos). No subscription or welcome credits. JPG, PNG or WebP up to 10 MB. Account required. Credited TikTok references are not generated examples from this site. AI results vary.',
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

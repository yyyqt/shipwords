# APIMart reference-video generation

Extend the APIMart adapter's existing parameter map, without changing the jobs handler, runner or credit ledger. A server-owned model may use `referenceRole: 'reference_image'` and defaults `reference_video_url` (public HTTPS MP4) plus `reference_video_seconds` (positive, at most 15). The adapter sends the uploaded photo in `image_urls` and the fixed clip in `video_urls`; it never mixes these with `image_with_roles`.

The site still accepts one uploaded photo and strips caller parameters. Both reference fields are required together, cannot accompany first-frame mode, and are excluded from the provider parameter payload except the translated `video_urls`. A conservative local budget estimate uses the existing no-reference rate multiplied by output seconds plus rounded-up reference seconds. This is an estimate, not a provider spending cap. Existing first-frame jobs and durable accepted/pending submission markers keep their current behavior.

Provider contract: https://docs.apimart.ai/en/api-reference/videos/seedance-2-0/generation . Mini supports the same reference-video features; first/last-frame mode cannot be combined with video references. The user approved the independently generated cat reference-video test as the visual target. No new paid generation is part of this deployment.

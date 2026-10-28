# Direct APIMart generation

Shaking Head AI needs direct APIMart Seedance 2.0 Mini generation. Extend the jobs model registry with `apimart`, add optional `APIMART_API_KEY` to JobsEnv and register its adapter. Existing Yir sites keep their behavior and shared billing/lifecycle logic is unchanged.

The first adapter supports image-to-video using one first-frame upload, 480p/720p, 4–15 seconds. It uploads the image from the site's R2, submits through `/v1/videos/generations`, polls `/v1/tasks/:id` and uses provider-reported cost. APIMart has no documented submit-idempotency or cancel endpoint. An atomic R2 submission claim prevents replays/concurrent steps from sending a second paid request. An uncertain submission is held for investigation rather than retried. Canceling stops local delivery and returns user credits; it does not promise an upstream refund.

`maxCost` is checked against the published rate before submit, not enforced by APIMart. Vendor price changes can invalidate the estimate. Recheck rates before launch. A single real 15s/720p test was explicitly requested by the user on 2026-10-29; further paid generations require authorization.

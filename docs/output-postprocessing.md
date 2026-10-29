# Site-owned output postprocessing

Sites may optionally pass `postprocessOutputs` as the third argument to
`defineGenerationWorkflow(models, site, options)`. The callback receives the job ID,
model ID, stored output metadata and this site's R2 bucket. It writes deterministic
keys such as `jobs/<jobId>/1.mp4` and returns only final `StoredOutput` metadata.
The filename must be a numeric index with a lowercase alphanumeric extension
(`\d+\.[a-z0-9]+`), matching the existing public file handler. Named files such as
`final.mp4` are not deliverable through that handler and are rejected even if the
object exists in R2. Use a deterministic unused index rather than overwriting a
raw upstream output that a retried postprocessor still needs to read.

The runner invokes it in the durable `postprocess` step, after effect composition
and before success. A missing, terminal or canceled job skips the callback. Results
must be nonempty, unique, valid media paths inside that job's namespace, and already
exist in R2. Failure uses the existing job failure/refund path; raw upstream media
is never delivered as a fallback. A cancellation during postprocessing remains
terminal because success is still a conditional state transition.

Callbacks may run again if a Workflow step loses its response, so they must be
idempotent and never submit another paid provider task. The hook does not change
upstream submission, billing, auth or effect composition defaults. Sites that do
not supply it retain their current behavior.

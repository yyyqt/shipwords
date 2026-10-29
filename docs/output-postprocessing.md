# Site-owned output postprocessing

Sites may optionally pass `postprocessOutputs` as the third argument to
`defineGenerationWorkflow(models, site, options)`. The callback receives the job ID,
model ID, stored output metadata and this site's R2 bucket. It writes deterministic
keys under `jobs/<jobId>/` and returns only final `StoredOutput` metadata.

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

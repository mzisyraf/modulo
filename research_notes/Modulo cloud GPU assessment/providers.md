# Serverless GPU provider assessment

## Which provider and GPU best fit modulo?

### Takeaway
Recommend Modal Functions with one NVIDIA L4 (24 GB), min_containers=0, buffer_containers=0, max_containers=1, and a short scaledown_window=2 seconds. Use a CPU-facing submit/poll boundary plus a GPU function, keeping the existing local app/backend orchestration and Nemotron Token Factory calls separate. Runner-up: Runpod Serverless Flex, Active workers=0 and max workers=1. This is an architectural recommendation, not a measured performance result.

### Cited Findings
- Modal Functions scale to zero by default. min_containers maintains a warm floor; max_containers limits replicas; buffer_containers overprovisions warm workers. [Modal autoscaling](https://modal.com/docs/guide/scale)
- Modal's SDK allows scaledown_window from 2 to 3600 seconds. The narrative cold-start guide currently says 2 seconds to 20 minutes; 2 seconds is supported by both, so avoids that documentation discrepancy. [SDK Function](https://modal.com/docs/sdk/py/latest/Function), [cold starts](https://modal.com/docs/guide/cold-start)
- Modal charges application loading and warm-container waiting; default tail is 60 seconds. Billing ends once workers scale to zero. Do not repeat the marketing simplification that no idle resource is ever billed. [Modal pricing FAQ](https://modal.com/pricing), [cold starts](https://modal.com/docs/guide/cold-start)
- Modal advertises a $0/month Starter with $30/month included compute, three seats, and GPU concurrency limits. T4 is $0.000164/GPU-second, L4 $0.000222, A10 $0.000306. CPU is $0.0000131/physical-core-second and memory $0.00000222/GiB-second. CPU/RAM charges use the higher of requested or actual usage. Account credit eligibility and available GPU quota are unverified. [Modal pricing](https://modal.com/pricing), [resource metering](https://modal.com/docs/guide/resources)
- Modal requires a payment method, even when using included compute. Workspace budgets cap gross usage before credits; spend limits separately cap net out-of-pocket charges. Both are monthly, so an application-side cumulative allowance remains useful for a $20 TOTAL project cap. [Billing](https://modal.com/docs/guide/billing), [Budgets](https://modal.com/docs/guide/budgets)
- Runpod Flex workers scale to zero, Active workers stay running. Billing includes cold start, processing, and idle timeout (default 5 seconds). Storage charges are separate. [Runpod billing](https://docs.runpod.io/serverless/pricing)
- Runpod Serverless lists 24 GB class (L4/A5000/3090/MIG) at $0.69/hr equivalent and 16 GB class at $0.58/hr, metered per second. It is a class, not a promise of an exact GPU. [Runpod prices, Serverless section](https://www.runpod.io/pricing)

### Inferences
- L4 is a balanced first deployment choice: more memory headroom than T4 while its GPU rate is only 35.4% higher. T4 becomes the cheaper choice if L4 does not reduce runtime enough. GPU-only break-even: L4 must finish in less than 73.9% of T4 time. Benchmark identical real clips before claiming either fastest or cheapest per song.
- With local 6 GB RTX4050 execution supplied as the project baseline, there is no demonstrated need for A100/H100 or multi-GPU. L4/T4 compatibility still requires testing the pinned old Torch/CUDA stack on the provider; do not select Blackwell GPUs without a separately validated stack upgrade.
- Modal beats Runpod for this team's deadline/budget because the existing inference code is Python, credits reduce initial cash outlay, and managed asynchronous invocation/polling avoid running an always-on web server. Runpod is attractive if retaining a conventional Docker job handler is the priority.

### Gaps
- No provider account/card/credit/quota, region capacity, cold-start distribution, local-to-cloud latency, or actual Demucs runtime was tested. No paid calls or deployment occurred.

## What API and storage design avoids surprises?

### Takeaway
Submit a bounded audio job, return an ID, and poll. GPU work must be invoked synchronously within the platform task lifecycle; do not transplant the existing API's background thread into an ephemeral web container. Store artifacts durably outside the GPU container and return signed result URLs rather than large inline JSON/base64.

### Cited Findings
- Modal HTTP calls have a 150-second request boundary, after which they use redirects; underlying functions can run longer. Modal recommends spawning a function and polling its call ID for long work. [HTTP timeouts](https://modal.com/docs/guide/webhook-timeouts)
- Modal function execution defaults to 300 seconds, configurable up to 24 hours. Startup timeout is separate. [Function timeouts](https://modal.com/docs/guide/timeouts)
- Modal supports remote function lookup/spawn and nonblocking result polling from code outside Modal. [Invocation](https://modal.com/docs/guide/trigger-deployed-functions)
- Pre-download weights into the image or a persistent volume; container startup otherwise includes repeated model download/load latency. [Model cold starts](https://modal.com/docs/guide/cold-start)
- Runpod async /run accepts JSON input, queues jobs, and uses /status for results; completed async results are retained for 30 minutes. This does not replace modulo's longer audio-retention storage. [Requests](https://docs.runpod.io/serverless/endpoints/send-requests)
- Beam synchronous endpoints target tasks <=180 seconds; longer tasks use task_queue. Development beam serve sessions bill the entire running session even without requests. [Beam endpoints](https://docs.beam.cloud/v2/endpoint/overview)

### Inferences
- Keep local FastAPI job IDs, validation, auth/budget and reference/preset state. Replace its local subprocess boundary with remote submission/poll/download; this minimizes frontend and shared-contract changes. A persistent backend adapter can keep today's public response shape.
- Direct SDK byte transfer can be simplest for a private local-backend prototype, but 50 MiB input and multiple long WAV outputs should use durable artifacts rather than assume any provider's default JSON body limit. Signed URLs must be constrained to controlled storage, expire, and never allow arbitrary fetches.
- Start with one GPU task at a time, 600s execution cap (matching existing project limit), no automatic business-level retries, and short warm tail. Cap worker concurrency, authenticate requests, preserve idempotency, and expire source/stems as current policy requires.
- Decode/features can run in the same bounded remote task initially to avoid an additional transfer stage; do not create a separate ML service for cheap CPU operations. Browser processing remains local.

### Gaps
- Exact Modal HTTP body/output limits and Runpod per-request payload ceiling were not verified from current official pages. Therefore neither direct 50MiB HTTP upload nor inline 150MiB result is promised. Verify these during implementation, or use object storage.
- No regional latency is quoted; this workload is asynchronous separation, not live guitar monitoring.

## How do costs compare, including Nebius and Beam?

### Takeaway
The monthly included compute makes Modal the best first test; raw GPU-second prices alone do not predict per-song cost. Nebius Serverless Endpoints do not meet the user's automatic pay-per-request expectation as documented.

### Cited Findings
- Beam's 4090 rate is $0.000192/GPU-second, but GPU-attached CPU costs $0.000105/physical-core-second and RAM $0.0000055/GiB-second. Its own example 4090 + 2 physical cores +16GiB totals $1.77/hr. [Beam prices](https://www.beam.cloud/pricing)
- Nebius Serverless runs managed VMs and bills compute/storage for the entire running deployment. Endpoints respond until terminated/stopped; endpoint container disk is removed when stopped. Separate mounted bucket/filesystem billing persists. [Nebius overview](https://docs.nebius.com/serverless/overview), [pricing](https://docs.nebius.com/serverless/pricing-quotas)

### Inferences
Illustrative arithmetic only, NOT measured audio runtime. Suppose one job occupies GPU+2 physical CPU cores+8GiB for the stated duration (no startup, tail, storage, egress, tax):

| Configuration | 60 seconds | 180 seconds |
|---|---:|---:|
| Modal L4 + CPU/RAM | $0.01596 | $0.04787 |
| Modal T4 + CPU/RAM | $0.01248 | $0.03743 |
| Runpod 24GB class GPU worker, listed rate only | $0.01150 | $0.03450 |
| Beam 4090 + CPU/RAM | $0.02676 | $0.08028 |

- Formula: rate times actual occupied seconds; include model load and warm tail in real billing. At the L4 example, 100 x180-second compute jobs total about $4.79 BEFORE those overheads. This is not a forecast of the number of songs $20 buys.
- Trial allocation: at most $2 new cash for one cold/warm and short/full-length benchmark; choose L4 vs T4 using measured total per-job cost afterward. Use included credit if confirmed, leaving the $20 cash allowance untouched as much as possible. Account payment, tax and storage still require verification.
- Do not use Nebius endpoint for bursty unattended judging access unless automatic stop/start is separately built and validated. Its branding says Serverless, but the documented billing model is running deployment time. Nebius batch Jobs terminate on completion but require extra orchestration/storage; not the fastest route for this deadline.
- Beam is viable but does not provide enough advantage here to justify another SDK; its attached CPU/RAM prices make its cheap GPU sticker misleading for decoding/export workloads.

### Gaps
- Provider quotations change. No benchmark or paid-resource test completed; no exact per-song cost, approval of deployed musical quality or production SLA is claimed.

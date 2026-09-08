# The local API

What `backend/` answers, endpoint by endpoint. This is the contract the frontend
codes against.

Every shape below was read from a running server, not from the source alone. The
`curl` lines reproduce it.

## Reaching it

| Fact | Value |
|---|---|
| Base URL | `http://127.0.0.1:8787` |
| Port | `CT_API_PORT`, default `8787` |
| Interface | loopback only (`127.0.0.1`) |
| Start | `make run-backend` |
| Endpoints | 5 (`POST` 2, `GET` 3) |

In development the vite dev server proxies these paths to the backend and strips
the `Origin` header (`frontend/vite.config.ts`). A new endpoint must be added to
`API_PATHS` there, or the dev server answers the page's HTML instead of the API.

## Rules that apply to every endpoint

1. **Decide by `code`, never by status.** Every refusal answers the same body:
   `{"code": "<kebab-case>", "detail": "<one sentence>"}`.
2. **An application refusal answers 400.** The status stopped being the signal.
   Three refusals keep another status because they are about the protocol, not
   about the request: 405, 409 and 503 below.
3. **A `POST` must declare `Content-Type: application/json`.** Otherwise 415.
4. **A body over 8 KiB is refused** with 413 `body-too-large`.
5. **An unknown field in a `POST` body is refused**, not ignored.
6. **Trailing slashes are collapsed**, so `/active-plans/` is `/active-plans`.
7. **A foreign `Origin` is refused** with 403 `foreign-origin`. No `Origin` at
   all is admitted, which is why `curl` works.
8. **A wrong method answers 405** with an `Allow` header naming the right one.
9. **An unknown path answers 404** `not-found`.
10. **An unexpected crash answers 400** `request-failed`, and the reason only
    reaches the backend's stderr. If the UI shows `request-failed`, the detail
    is in the terminal running the backend.

### Codes every endpoint can answer

| Status | `code` | When |
|---|---|---|
| 403 | `foreign-origin` | the `Origin` is not the page this server hosts |
| 404 | `not-found` | no route matched |
| 405 | `method-not-allowed` | the path exists, the method does not |
| 413 | `body-too-large` | the body exceeds 8 KiB |
| 415 | `unsupported-media-type` | a `POST` did not declare JSON |
| 400 | `request-failed` | anything unforeseen; the reason is in stderr |

---

## `POST /start-plan`

Starts a plan: cuts a worktree, opens the plan issue, launches the agent. It is
slow — it runs the target repository's baseline test suite before answering, and
that can take minutes. There is no progress signal while it waits.

**Request**

| Field | Type | Required | Shape |
|---|---|---|---|
| `id` | string | one of `id` / `user_comment` | a user story key, `ABC-123` |
| `user_comment` | string | one of `id` / `user_comment` | free text, not blank |
| `repo` | string | yes | `owner/name` |
| `path` | string | yes | absolute path of the local clone |

`id` and `user_comment` may both be sent. Omit a field to leave it unsaid; do
not send `null`, which is a malformed value.

**202 Accepted**

```json
{"status":"started","id":"ABC-123","repo":"owner/name",
 "issue":{"number":7,"url":"https://github.com/owner/name/issues/7"},
 "agent":"workspace:4","branch":"feat/7",
 "worktree":"/repo/checkout/.worktrees/7","root":"/repo/checkout"}
```

`agent` is the handle `POST /implement-plan` demands later. `root` is git's
canonical path for the checkout, which may differ from the `path` that was sent;
keep the answered one.

**Refusals**

| `code` | Status | Meaning |
|---|---|---|
| `body-not-a-json-object` | 400 | the body did not parse, or is not an object |
| `unknown-field` | 400 | `detail` names the fields, sorted |
| `malformed-id` | 400 | `id` is not a story key |
| `malformed-user-comment` | 400 | `user_comment` is blank or not text |
| `nothing-to-plan` | 400 | neither `id` nor `user_comment` was sent |
| `malformed-repo` | 400 | `repo` is not `owner/name` |
| `malformed-path` | 400 | `path` is not absolute |
| `checkout-not-confirmed` | 400 | `path` is not a checkout of `repo`; `detail` names both the repo asked for and the one the path holds |
| `user-story-not-read` | 400 | Jira refused |
| `user-story-not-understood` | 400 | Jira answered something unreadable |
| `plan-issue-not-created` | 400 | `gh issue create` refused |
| `plan-issue-not-named` | 400 | the created issue could not be identified |
| `plan-issue-not-claimed` | 400 | the claim on the issue failed |
| `plan-agent-not-launched` | 400 | cmux refused |
| `plan-agent-not-named` | 400 | cmux launched but gave no handle |
| `workspace-not-prepared` | 400 | the worktree could not be cut |
| `workspace-not-read` | 400 | git refused when surveying |
| `workspace-not-understood` | 400 | git answered something unreadable |

The last ten carry the tool's own message in `detail`. They are the same failure
family split by cause, so the UI can treat them as one class and show `detail`.

```
curl -s -X POST -H 'Content-Type: application/json' \
  http://127.0.0.1:8787/start-plan \
  -d '{"id":"ABC-1","repo":"owner/name","path":"/repo/checkout"}'
```

---

## `GET /plan-events/:issue?repo=owner/name`

Server-sent events. It reports whether the plan is written and committed. The
stream stays open until the client disconnects, and polls in the meantime.

It only serves an issue whose plan **this process** started or recovered. A
restarted backend has forgotten every session it did not recover from cmux.

**200** with `Content-Type: text/event-stream`. Two frame kinds:

```
data: {"state":"writing"}

data: {"state":"ready"}

event: error
data: {"code":"plan-progress-not-read","detail":"git status refused"}
```

`state` is `writing` or `ready`. A frame is only sent when the state **changes**,
so expect nothing on the wire while the agent works. An `error` frame does not
close the stream; the next poll may succeed.

**Refusals** (before the stream opens, as JSON)

| `code` | Status | Meaning |
|---|---|---|
| `malformed-watched-issue` | 400 | `:issue` is not a positive whole number |
| `malformed-repo` | 400 | `repo` is missing or not `owner/name` |
| `not-watched` | 400 | this process started no plan for that issue |

```
curl -N 'http://127.0.0.1:8787/plan-events/7?repo=owner/name'
```

---

## `POST /implement-plan`

Answers the human gate: records the GO and tells the agent to implement.

**Request**

| Field | Type | Shape |
|---|---|---|
| `agent` | string | the handle `/start-plan` answered, no whitespace |
| `issue` | number | whole, from 1 |
| `repo` | string | `owner/name` |

**202 Accepted**

```json
{"status":"implementing","agent":"workspace:20","issue":33}
```

**It is idempotent.** A second call for a plan already implementing answers the
same 202 without touching anything, and concurrent calls for the same plan are
serialised.

**Refusals**

| `code` | Status | Meaning |
|---|---|---|
| `body-not-a-json-object` | 400 | the body did not parse, or is not an object |
| `unknown-field` | 400 | `detail` names the fields, sorted |
| `malformed-agent` | 400 | `agent` is empty or holds whitespace |
| `malformed-issue` | 400 | `issue` is not a whole number from 1 |
| `malformed-repo` | 400 | `repo` is not `owner/name` |
| `no-live-planning-session` | **409** | no active plan matches that issue **or** its agent handle differs |
| `implementation-phase-uncertain` | **409** | the backend cannot tell whether implementation already began; a person must look before retrying |
| `go-not-recorded` | 400 | the GO marker could not be written |
| `plan-go-not-answered` | 400 | the GO comment on the issue failed |
| `plan-agent-not-resumed` | 400 | cmux would not take the line |

`no-live-planning-session` is the one to expect after a backend restart: send the
`agent` from `/active-plans`, not one the page remembered from an older run.

```
curl -s -X POST -H 'Content-Type: application/json' \
  http://127.0.0.1:8787/implement-plan \
  -d '{"agent":"workspace:20","issue":33,"repo":"owner/name"}'
```

---

## `GET /implement-progress/:issue?root=<abs path>&repo=owner/name`

Where the implementation stands. Poll it; there is no stream. **Both** query
parameters are required — `repo` since the answer may name a pull request.

**200 OK**

```json
{"step":"implement","task":2,"total_tasks":5,"name":"La ruta contesta",
 "attempt":2,"discards":1,"pull_request":null}
```

Six fields plus `pull_request`, always all seven present. `null` means *not
applicable at this step*, not *unknown*.

| Field | Type | Meaning |
|---|---|---|
| `step` | string | see the table below |
| `task` | number \| null | the task in progress |
| `total_tasks` | number \| null | tasks in the plan |
| `name` | string \| null | the task's heading, read from the plan file |
| `attempt` | number \| null | 1 plus every retry so far |
| `discards` | number \| null | work thrown away |
| `pull_request` | `{number, url}` \| null | set only under review |

**Steps**

| `step` | Meaning | Has `task` |
|---|---|---|
| `starting` | the worktree exists, no run file yet | no |
| `implement` | writing the task | yes |
| `controls` | running the controls | yes |
| `judge` | the judge is reading it | yes |
| `advise` | advice is being applied | yes |
| `commit` | committing | yes |
| `reconcile` | reconciling with the base | no |
| `global` | the global gates | no |
| `slice-judge` | the slice judge | no |
| `e2e` | the end-to-end gate | no |
| `delivered` | the pull request is open, nobody on it | no |
| `in-review` | waiting for a person on the pull request | no |
| `fixing` | applying what a person asked for | no |

`starting`, and every `no` row, answer `task`, `name` and `attempt` as `null`.

The last three are the same underlying delivery, told apart by the plan issue's
status: `in-review` from `in-review`, `fixing` from `in-progress`, and
`delivered` from any other. **`pull_request` is only sent for the first two**, so
a delivered slice whose issue never reached the review rung shows `delivered`
with `pull_request: null` even though a pull request is open.

**Refusals**

| `code` | Status | Meaning |
|---|---|---|
| `malformed-root` | 400 | `root` is missing or not absolute |
| `malformed-progress-repo` | 400 | `repo` is missing or not `owner/name` |
| `implementation-progress-not-read` | 400 | see below |

`implementation-progress-not-read` is one code for three different situations —
the worktree is not there, the run file cannot be read, or it is not valid JSON.
Only `detail` tells them apart. Treat it as *keep polling*: a run file caught
mid-write reads as unparsable and the next poll succeeds.

```
curl -s 'http://127.0.0.1:8787/implement-progress/7?root=/repo/checkout&repo=owner/name'
```

---

## `GET /active-plans`

Every plan this backend knows about. No parameters. The page calls it on load to
recover a session it lost — a reload, or a backend restart.

**200 OK**

```json
{"plans":[{"phase":"planning",
  "request":{"id":"ABC-123","repo":"owner/name","path":"/repo/checkout"},
  "plan":{"id":"ABC-123","repo":"owner/name",
    "issue":{"number":7,"url":"https://github.com/owner/name/issues/7"},
    "agent":"workspace:4","branch":"feat/7",
    "worktree":"/repo/checkout/.worktrees/7"}}]}
```

`plans` is empty when nothing is running. Each entry carries `request` — what a
person would have typed — and `plan` — what starting it produced.

| `phase` | Meaning | What the UI can do |
|---|---|---|
| `planning` | the plan is being written | watch `/plan-events`, offer the GO |
| `implementing` | the GO was given | poll `/implement-progress` |
| `uncertain` | the GO was given, but the backend cannot tell whether the work began | show it, refuse the GO; `/implement-plan` answers 409 |

**Refusal**

| `code` | Status | Meaning |
|---|---|---|
| `active-plans-recovery-inconclusive` | **503** | cmux could not be asked, so the list would be a lie |

The 503 is the common failure on a fresh machine: recovery reads the live cmux
workspaces, and without cmux it answers 503 on **every** call and never settles.
The page must show *I cannot tell what is running* rather than *nothing is
running*, and it must not treat this as an empty list.

```
curl -s http://127.0.0.1:8787/active-plans
```

---

## Where the frontend consumes each one

| Endpoint | Client | Types |
|---|---|---|
| `POST /start-plan` | `frontend/src/app/start-plan/client.ts` | `StartPlan.types.ts` |
| `GET /plan-events` | `frontend/src/app/plan-events/client.ts` | `PlanEvents.types.ts` |
| `POST /implement-plan` | `frontend/src/app/implement-plan/client.ts` | `ImplementPlan.types.ts` |
| `GET /implement-progress` | `frontend/src/app/implement-progress/client.ts` | `ImplementProgress.types.ts` |
| `GET /active-plans` | `frontend/src/app/active-plans/client.ts` | `ActivePlan.types.ts` |

A client validates the wire shape before it reaches a component, and projects
snake_case to camelCase. Add a field to the validator, or the component never
sees it.

## Where the contract is decided

| Concern | File |
|---|---|
| One endpoint's request, refusals and answer | `backend/src/infrastructure/<endpoint>-route.js` |
| Mounting, the origin filter, the body limit, the last net | `backend/src/infrastructure/api-server.js`, `http.js` |
| The `{code, detail}` doctrine | `backend/conventions/this-repository.md` |
| That two endpoints never share a `code` by accident | `backend/__tests__/infrastructure/refusal-codes.test.js` |
| The step and phase vocabularies | `domain/value-objects/implementation-state.js`, `infrastructure/active-plans-route.js` |

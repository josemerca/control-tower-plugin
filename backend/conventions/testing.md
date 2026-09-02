# What the backend measures, beyond the repository's rules

Applies to: **every diff under `backend/`**. Everything in
`plugin/conventions/testing.md` binds here and is not restated.

## Where the suite runs

From `backend/`, never the repository root. The fast subset is
`npx vitest run --exclude '**/*-real-process.test.js'`; the excluded files are
the only ones that launch real processes. During a working session, run the
fast subset per change and the whole suite before handing anything over.

## Three rules, and everything below follows from them

1. **A use case is a black box, tested outside-in.** Its ports are doubled at
   the constructor and the assertions are on what each port received and what
   came back. The domain has no tests of its own: every value object, policy
   and guard is reached through the use case that carries it. A guard no use
   case can reach is not a test waiting to be written — it is either dead or an
   invariant that defends itself.
2. **An adapter is tested by cutting right before the external system** and
   asserting the interaction: the literal argv sent, and the parse of literal
   recorded output. The one exception is an adapter that *is* the call — a
   database repository, or here `ToolRunner`, twenty lines around `execFile`
   with nothing left to assert once the process is doubled. Those run the real
   thing, and are the only tests that do.
3. **Integration from the entrypoint covers the happy path, and only that.** A
   real process, one whole request reaching the first real tool. Refusals,
   collisions and cuts are measured in-process at the layer that owns them, or
   not at all.

Where `backend-best-practices` shows something else — its Object Mothers section
illustrates with a test of a domain entity on its own — these three rules win, as
`README.md` already orders. An example teaches by imitation; this is the rule.

## How each layer is tested

Outside-in, and each layer has its own kind of assertion:

| Layer | Doubled | The assertion is on |
|---|---|---|
| Controller (HTTP) | the use case, by constructor | the status and the **literal JSON body** of the answer, through a listening server and `fetch` — never calling the handler as a function |
| Application (actions) | every port, by constructor | what each port **received** and what the use case returned; order is pinned by cut points — when a step fails, the later ports were never asked |
| Domain | — | **nothing**: it is covered along the two paths above, with no exception |
| Adapters | the tool, as a scripted conversation | the **literal argv** sent, and the parse of **literal recorded output** — real transcripts, not invented shapes |
| Boundary payloads | nothing | fed to the **real reader on the other side** when it lives in this repository: what we write for the plugin is read back with the plugin's own `mapGhIssue`, `extractAc`, `parseScope` |
| Entrypoint | nothing | a real process, **happy path only**: see below |

- **A refusal never reaches a double**: every controller test of a refused
  request also asserts the use case was not asked.
- **The fixture class of each test file is its mother**: named scenarios
  (`GhDouble.created()`, `AcliDouble.refusing(said)`, `Flow.run()`) with
  sensible defaults, so a test names only what its case changes. A double that
  answers a scripted conversation raises when asked for an answer nobody wrote
  — the repository's rule, paid for here: the lenient version repeated its last
  answer forever and a broken loop hung the suite instead of failing it.
- **Both failure causes of every adapter are told apart in its tests**: the
  tool refusing (typed `*NotRead`/`*NotCreated`/`*NotLaunched`) and the tool
  answering something unreadable (`*NotUnderstood`/`*NotNamed`), and the test
  proves one is not an instance of the other.

## A real-process test earns its place

Two kinds, and no third:

- **The entrypoint's happy path**: the port line on stdout, and one whole
  request reaching the first real tool so the wiring cannot be swapped
  silently. Nothing else about the entrypoint is measured by spawning it —
  logic that can be observed without a process moves out of the entrypoint
  until it can, which is why `invocation.js` exists.
- **The adapter that is the call** (`ToolRunner`): its budget killing a process,
  a refusal coming back as a code and a reason, a missing binary, the working
  directory honoured. Doubling `execFile` would leave nothing to assert, so this
  one runs the real thing — the same reason a repository test talks to a real
  database.

Every spawned child is killed in `afterEach`, not after the assertion: a failing
test must not leak a process.

## The mutation sweep

After each round, mutate production code one change at a time, run the whole
suite, and hunt **the mutations that leave it green** — each one is a line no
test is watching. The harness discipline, learned from its own false greens:

- A substitution that does not match must fail loudly; a silent miss is a
  green that measured nothing.
- The file is restored and verified identical afterwards; a sweep killed
  mid-run leaves a mutation glued to the tree, so the tree is committed first
  and nothing else runs while it does.
- A mutation that hangs the suite instead of failing it is its own finding:
  a promise loop that never yields starves the runner's timer. The fix is the
  double that raises, above.

## What stays unmeasured, on purpose

A surviving mutation is not always a missing test. The budgets' values (the
process timeout, the retry count, the wait) are policy, not mechanism — the
mechanism is measured, the numbers are decisions. `Object.freeze` on a value
object survives because the only test that could catch it would assert
`Object.isFrozen`, which measures the language. Both are declared here so
nobody chases them.

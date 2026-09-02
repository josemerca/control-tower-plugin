# What the backend measures, beyond the repository's rules

Applies to: **every diff under `backend/`**. Everything in
`plugin/conventions/testing.md` binds here and is not restated.

## Where the suite runs

From `backend/`, never the repository root. The fast subset is
`npx vitest run --exclude '**/*-real-process.test.js'`; the excluded files are
the only ones that launch real processes.

## A real-process test earns its place

Each one measures something no double can: the port line on stdout, surviving
a request cut mid-body (inside vitest an unhandled rejection kills nothing, so
the in-process version of that test was worthless — measured), the exit code of
a refusal, a port collision, a budget actually killing a process. Logic that
can be observed without spawning moves out of the entrypoint until it can
(that is why `invocation.js` exists). Every spawned child is killed in
`afterEach`, not after the assertion.

## The mutation sweep

After each round, mutate production code one change at a time, run the whole
suite, and hunt **the mutations that leave it green** — each one is a line no
test is watching. The harness discipline, learned from its own false greens:

- A substitution that does not match must fail loudly; a silent `sed` miss is
  a green that measured nothing.
- The file is restored and verified identical afterwards; a sweep killed
  mid-run leaves a mutation glued to the tree, so nothing else runs while it
  does and the tree is committed first.
- A mutation that hangs the suite instead of failing it is its own finding:
  a promise loop that never yields starves vitest's timer. The fix is a double
  that raises when asked for an answer nobody wrote.

## What stays unmeasured, on purpose

A surviving mutation is not always a missing test. The budget's value (30 s,
3 retries, 2 s) is policy, not mechanism — the mechanism is measured, the
number is a decision. `Object.freeze` on a value object survives because the
only test that could catch it would assert `Object.isFrozen`, which measures
the language. Both are declared here so nobody chases them.

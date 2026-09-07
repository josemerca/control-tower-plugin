# Review package: task 1/3 of issue #44 (staged, not yet committed)
Review token: 7c146e73538f13a0bc4f5ee5079d3e65e208c45c2dcdeafee2e4e38face67396

## Files changed
 src/issue-claim.js  | 31 +++++++++++++++++++++++++++++++
 test/issue-claim.js | 29 +++++++++++++++++++++++++++++
 2 files changed, 60 insertions(+)


## Rutas tocadas
- src/issue-claim.js
- test/issue-claim.js

## Diff
diff --git a/src/issue-claim.js b/src/issue-claim.js
new file mode 100644
index 0000000..ee9e10e
--- /dev/null
+++ b/src/issue-claim.js
@@ -0,0 +1,31 @@
+import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
+
+export const ClaimOutcome = Object.freeze({
+  TAKEN: 'taken',
+  ALREADY_TAKEN: 'already-taken',
+})
+
+export class Claim {
+  constructor({ outcome, by }) {
+    this.outcome = outcome
+    this.by = by
+    Object.freeze(this)
+  }
+}
+
+export class IssueClaim {
+  constructor({ claims }) {
+    this.claims = claims
+    Object.freeze(this)
+  }
+
+  take({ issue, pid }) {
+    mkdirSync(this.claims.root, { recursive: true })
+    const lock = this.claims.lockOf(issue)
+    if (existsSync(lock)) {
+      return new Claim({ outcome: ClaimOutcome.ALREADY_TAKEN, by: Number(readFileSync(lock, 'utf8')) })
+    }
+    writeFileSync(lock, String(pid))
+    return new Claim({ outcome: ClaimOutcome.TAKEN, by: pid })
+  }
+}
diff --git a/test/issue-claim.js b/test/issue-claim.js
new file mode 100644
index 0000000..dcfadcc
--- /dev/null
+++ b/test/issue-claim.js
@@ -0,0 +1,29 @@
+import { describe, it } from 'node:test'
+import assert from 'node:assert/strict'
+import { mkdtempSync, readFileSync } from 'node:fs'
+import { tmpdir } from 'node:os'
+import { join } from 'node:path'
+import { ClaimsDirectory } from '../src/claims-directory.js'
+import { Claim, ClaimOutcome, IssueClaim } from '../src/issue-claim.js'
+
+class Dispatchers {
+  static overAFreshDirectory() {
+    const root = join(mkdtempSync(join(tmpdir(), 'issue-claim-')), 'claims')
+    return { claim: new IssueClaim({ claims: new ClaimsDirectory({ root }) }), root }
+  }
+}
+
+describe('IssueClaim', () => {
+  it('the first claim of an issue is taken and leaves the pid in the lock', () => {
+    const { claim, root } = Dispatchers.overAFreshDirectory()
+    assert.deepEqual(claim.take({ issue: 7, pid: 100 }), new Claim({ outcome: ClaimOutcome.TAKEN, by: 100 }))
+    assert.equal(readFileSync(join(root, '7.lock'), 'utf8'), '100')
+  })
+
+  it('the second claim of the same issue is refused and names who holds it', () => {
+    const { claim, root } = Dispatchers.overAFreshDirectory()
+    claim.take({ issue: 7, pid: 100 })
+    assert.deepEqual(claim.take({ issue: 7, pid: 200 }), new Claim({ outcome: ClaimOutcome.ALREADY_TAKEN, by: 100 }))
+    assert.equal(readFileSync(join(root, '7.lock'), 'utf8'), '100')
+  })
+})

export const meta = {
  name: 'ship-issue',
  description: 'Implement a ready-for-agent issue, review it until clean, then merge',
  whenToUse: 'One run per issue. args {issue} implements from scratch; {issue?, pr, branch, worktree} reviews and merges an open PR.',
  phases: [
    { title: 'Implement', model: 'sonnet' },
    { title: 'Review', model: 'sonnet' },
    { title: 'Fix', model: 'sonnet' },
    { title: 'Merge', model: 'sonnet' },
  ],
}

const MAX_ROUNDS = 2

const TARGET = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'escalate'] },
    pr: { type: 'integer' },
    branch: { type: 'string' },
    worktree: { type: 'string', description: 'absolute path' },
    reason: { type: 'string', description: 'why it needs the user, when status is escalate' },
  },
  required: ['status'],
}

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' }, description: 'repo-relative paths the fix must touch' },
          line: { type: 'integer' },
          blocking: { type: 'boolean' },
          summary: { type: 'string' },
          failure_scenario: { type: 'string' },
        },
        required: ['files', 'blocking', 'summary', 'failure_scenario'],
      },
    },
  },
  required: ['findings'],
}

const RESULT = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['merged', 'escalate'] },
    reason: { type: 'string' },
  },
  required: ['status'],
}

const target = args.pr
  ? { status: 'ok', pr: args.pr, branch: args.branch, worktree: args.worktree }
  : await agent(
      `Implement issue #${args.issue}, following the "Working an issue" steps 1-7 in CLAUDE.md. ` +
        `Stop after opening the PR; do not review or merge it. ` +
        `If you hit a case from "Escalate to the user", stop and return status escalate with the reason instead of notifying.`,
      { label: `implement:#${args.issue}`, phase: 'Implement', model: 'sonnet', schema: TARGET },
    )
if (!target || target.status !== 'ok') return { status: 'escalate', issue: args.issue, reason: target?.reason ?? 'implementer failed' }

const { pr, branch, worktree } = target
const spec = args.issue ? `issue #${args.issue}` : `the PR #${pr} description`
const where = `Work in the git worktree ${worktree} (branch ${branch}, PR #${pr}).`
const reviewRules =
  `Review only; do not edit files, commit or comment on the PR. ` +
  `Return every finding. blocking=true only for a correctness bug, a security hole, or a spec mismatch ` +
  `(an acceptance criterion of ${spec} missed or contradicted); style, naming and simplification are blocking=false.`
const reviewPrompt =
  `${where} Count changed lines with git diff --shortstat origin/main...HEAD -- . ':!*.lock' ':!*-lock.yaml' ':!**/fixtures/**'. ` +
  `Run the /code-review skill on the branch's changes since its merge-base with origin/main, ` +
  `at level high if insertions + deletions exceed 400, otherwise medium. ` +
  `Also check every acceptance criterion of ${spec} against the code. ${reviewRules}`

// shortcut: groups share no source file, but two groups can still edit the same test file; split tests per group if fixers start conflicting
function groupByFiles(findings) {
  const groups = []
  for (const f of findings) {
    const hits = groups.filter(g => f.files.some(p => g.files.has(p)))
    const merged = { files: new Set(f.files), findings: [f] }
    for (const g of hits) {
      g.files.forEach(p => merged.files.add(p))
      merged.findings.push(...g.findings)
      groups.splice(groups.indexOf(g), 1)
    }
    groups.push(merged)
  }
  return groups
}

const nits = new Map()
let round = 0
let clean = false
while (round < MAX_ROUNDS) {
  round++
  const review = await agent(reviewPrompt, { label: `review:r${round}`, phase: 'Review', model: 'sonnet', schema: FINDINGS })
  if (!review) return { status: 'escalate', pr, reason: `the reviewer failed in round ${round}` }

  review.findings.filter(f => !f.blocking).forEach(f => nits.set(f.summary, f))
  const blocking = review.findings.filter(f => f.blocking)
  log(`round ${round}: ${blocking.length} blocking, ${review.findings.length - blocking.length} non-blocking`)
  if (!blocking.length) { clean = true; break }
  if (round === MAX_ROUNDS) break

  const groups = groupByFiles(blocking)
  await parallel(groups.map((g, i) => () => agent(
    `${where} Fix these review findings:\n${JSON.stringify(g.findings, null, 2)}\n\n` +
      `Touch only these files and their tests: ${[...g.files].join(', ')}. ` +
      `TDD: first write a test that fails because of the finding, then fix it; skip the test only when the finding has no behavior to test (docs, config). ` +
      `If you touch backend code, run its tests with TEST_DB_NAME=pasazhgard_test_pr${pr}_g${i}. ` +
      `Other fixers edit other files in this worktree at the same time: stage only your files by path (never git add -A or git add .), ` +
      `commit once with a Conventional Commit message, and retry the commit if .git/index.lock exists. Do not push. ` +
      `Return one line per finding: fixed, or why not.`,
    { label: `fix:r${round}g${i}`, phase: 'Fix', model: 'sonnet' },
  )))
}

if (!clean) return { status: 'escalate', pr, reason: `blocking findings remain after ${MAX_ROUNDS} review rounds` }

const notes = [...nits.values()].map(f => `- ${f.files.join(', ')}: ${f.summary}`).join('\n') || 'none'
const result = await agent(
  `${where} Merge this PR:\n` +
    `1. git fetch origin, then git merge origin/main into the branch. Resolve conflicts keeping both sides' intent; if one needs a design decision, stop and return escalate.\n` +
    `2. Run the gate: in backend/, TEST_DB_NAME=pasazhgard_test_pr${pr} uv run pytest; in web/, pnpm lint && pnpm build && pnpm smoke. Fix failures this branch caused.\n` +
    `3. git push. Append a "Non-blocking review notes" section to the PR body (gh pr edit ${pr}) with:\n${notes}\n` +
    `4. gh pr checks ${pr} --watch until done. If CI fails because of this branch, fix, push and watch again, at most twice; otherwise return escalate.\n` +
    `5. From the main checkout (not the worktree): git worktree remove ${worktree}, then gh pr merge ${pr} --merge --delete-branch.`,
  { label: `merge:#${pr}`, phase: 'Merge', model: 'sonnet', schema: RESULT },
)
return { ...(result ?? { status: 'escalate', reason: 'merge agent failed' }), pr, rounds: round, nits: nits.size }

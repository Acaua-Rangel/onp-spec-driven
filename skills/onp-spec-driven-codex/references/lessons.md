# Lessons — learning with mechanical grounding

The layer that lets the project improve from feature to feature without
turning into a dead log. The split that keeps it alive:

- **You (the agent) bring the judgment**: reading the failure and phrasing
  the general rule that would have prevented the recurrence.
- **The engine owns everything mechanical**: grounding, IDs, dedup,
  recurrence across distinct features, candidate→confirmed promotion,
  penalize→quarantine, pruning and rendering. You never do this bookkeeping
  by hand — nor edit `lessons.json`/`LESSONS.md` directly.

**The gate that makes this selective**: `lessons add` only accepts a lesson
that cites a REAL signal — an audit finding or a verify failure/skip that the
engine itself recorded in `.spec/verification/signals.json`. A lesson
without a signal is opinion and the engine refuses it (`LESSON_NO_GROUNDING`).
You don't decide alone what's worth a lesson; the history decides with you.

## Files (all owned by the engine)

| File | What it is |
|---|---|
| `.spec/verification/signals.json` | signal history — written by `audit`/`verify`, never by you |
| `.spec/lessons.json` | canonical lesson state — mutate only via `onp-spec lessons` |
| `.spec/LESSONS.md` | readable rendering — read it; never write it |

Lesson status: `candidate` (1 feature — recorded, not yet trusted) →
`confirmed` (recurred in 2+ distinct features — becomes a guide) →
`quarantine` (applied and the failure recurred anyway — ignored).

## READ — during Specify (and during Design, if there's a design.md)

Mandatory and cheap (fixed item cap, doesn't grow with the repo):

```bash
onp-spec lessons list                        # confirmed, max 10
onp-spec lessons list --scope billing         # large project: filter by domain
onp-spec lessons list --query idempotency     # or by term
```

Apply the returned lessons when writing the spec and the design. Don't treat
candidates or quarantined lessons as a guide — they're not yet trusted.

## WRITE — after the gate, never before

Exact moment: after `onp-spec audit --ci` exits 0. The path to that 0 was
recorded on its own in the signal history — you don't need to note anything
during implementation.

1. `onp-spec lessons suggest` — the engine points out signals that recurred
   across distinct features and still have no lesson. Start with those.
2. For each lesson worth recording (**at most 3 per feature**):

```bash
onp-spec lessons add \
  --signal  AC_NO_PROOF \
  --feature homework-delivery \
  --source  AC-042 \
  --text    "Assert the persisted value of the status, not just that the field exists" \
  --scope   billing/invoice
```

3. If the engine refuses for lack of grounding, the signal didn't happen
   here — the lesson doesn't exist. Don't reword the argument to force it in.
4. **Clean path (audit passed on the first try, verify with no failure) →
   no lesson.** That's the correct outcome, not an omission.

### How to phrase it (this is what makes recurrence dedupe)

Dedup is exact-after-normalization (lowercase, no accents, no punctuation) —
it's not semantic. Two lessons that say the same thing need to READ the same:

- **The general rule, not the incident.** ✔ "Assert the persisted value of
  the status, not just that the field exists" · ✘ "The test on line 88 was
  weak"
- **One sentence, terse and canonical** (the engine refuses anything over
  280 characters).
- **One lesson per signal** — don't bundle them.
- `--scope` with the domain (accepts a hierarchy: `billing/invoice`) — this
  is what makes the filter useful once the project has dozens of domains.

### When a confirmed lesson doesn't work

If you loaded a confirmed lesson during Specify and the SAME failure
recurred anyway, the guidance isn't working:

```bash
onp-spec lessons penalize --id L-007
```

Two penalties move it to quarantine. Use sparingly, only for real
recurrences.

## Scale

Designed for projects with many domains and hundreds of features:

- the history is keyed by (signal, feature, ref) — it grows with distinct
  failure points, not with runs — and it's compacted by window and cap;
- the listing has a fixed cap: context cost doesn't grow with the
  repository;
- candidates that don't corroborate within the window are pruned
  automatically.

## No node in the environment

Skip the lessons layer. Don't keep a manual lesson ledger — manual
bookkeeping is exactly the failure this layer exists to prevent. Note in
text, once, that the layer was inactive due to missing runtime.

## Summary
- [ ] Briefly describe the change.

## Risk Assessment
- [ ] Scope is isolated and clearly defined (note impacted files/modules)
- [ ] No backend/API contract changes (or clearly documented if present)
- [ ] No new global mutable state or hidden side effects
- [ ] Edge cases validated (empty/small datasets, re-render/resize cycles, interaction spikes)
- [ ] Dependency/lockfile changes reviewed and expected

## Test Coverage & Verification
- [ ] Install/build/tests pass (list commands run)
- [ ] Manual smoke checks completed for affected user flows
- [ ] Regression checks completed for adjacent flows
- [ ] Reproducible scenario and expected result documented

## Release Impact
- [ ] Release risk classification provided (low/medium/high)
- [ ] Migration/config/rollout impact documented
- [ ] Release note/changelog entry added (if user-facing)
- [ ] Rollback plan defined
- [ ] Post-merge monitoring/alerts identified

## Merge Gates
- [ ] At least 1 reviewer approval
- [ ] Required CI checks green (or documented exceptions)
- [ ] No unresolved review comments
- [ ] Evidence included (logs/screenshots/command output as applicable)

## Verification Scenario
1. Describe exact reproduction/validation steps.
2. Describe expected results.

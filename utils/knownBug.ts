import { test } from '@playwright/test';
import knownBugs from '../scripts/known-bugs.json';

export type KnownBugKey = (typeof knownBugs.bugs)[number]['key'];

/** The GitHub issue of a known bug, or undefined while it has none. */
export function knownBugUrl(key: string): string | undefined {
  const bug = knownBugs.bugs.find((entry) => entry.key === key);
  return bug?.issue ? `https://github.com/${knownBugs.repo}/issues/${bug.issue}` : undefined;
}

/**
 * Mark the running test as hitting a known app bug: it is expected to fail until the bug is fixed.
 * Call it first thing in the test. The bug and its GitHub issue are listed in scripts/known-bugs.json
 * (`npm run known-bugs`).
 *
 * When the test starts passing, Playwright reports "expected to fail, but passed": the bug is
 * probably fixed. Check the issue, close it, and remove this line, so the test then guards against
 * the bug coming back.
 */
export function knownBug(key: KnownBugKey): void {
  const bug = knownBugs.bugs.find((entry) => entry.key === key)!;
  const url = knownBugUrl(key);
  const issue = bug.issue ? `#${bug.issue}` : '(no issue yet)';
  test.info().annotations.push({ type: 'known bug', description: url ?? `${bug.title} ${issue}` });
  test.fail(true, `Known bug ${issue} (found ${bug.found}): ${bug.title}. Remove this line once fixed.`);
}

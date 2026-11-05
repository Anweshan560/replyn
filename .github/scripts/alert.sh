#!/usr/bin/env bash
# Report a problem through one GitHub issue per kind of alert: the first alert opens the issue,
# later ones comment on it while it stays open, so it also keeps the history. GitHub emails people
# watching the repository. The repository is public, so messages hold links and counts, never test
# output. Close the issue once the problem is dealt with.
#
# Usage: alert.sh <label> <issue title> <message>. Needs GH_TOKEN and GH_REPO.
set -euo pipefail

label=$1
title=$2
message=$3

gh label create "$label" --color D73A4A --description 'Opened by the CI alerts' --force
number=$(gh issue list --label "$label" --state open --limit 1 --json number --jq '.[0].number // empty')

if [ -n "$number" ]; then
  gh issue comment "$number" --body "$message"
else
  gh issue create --title "$title" --label "$label" --body "$message"
fi

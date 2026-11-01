#!/bin/sh
# Use only the validated runtime credential; do not write it to repo config.
case "$1" in
  *github.com*Username*|Username*github.com*) printf '%s\n' 'x-access-token' ;;
  *github.com*Password*|Password*github.com*) printf '%s\n' "$GITHUB_PAT" ;;
  *) exit 1 ;;
esac

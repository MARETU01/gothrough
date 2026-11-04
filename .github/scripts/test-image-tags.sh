#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
output="$(mktemp)"
trap 'rm -f "$output"' EXIT
commit="$(git rev-parse HEAD)"

for version in v0.1.0 v1.0.0 v12.34.56 v1.1.0-beta.1 v2.0.0-rc.0 v1.0.0-0; do
    : > "$output"
    REPOSITORY=MARETU01/gothrough VERSION="$version" GITHUB_OUTPUT="$output" \
        bash .github/scripts/image-tags.sh
    grep -Fxq "maretu01/gothrough:$version" "$output"
    grep -Fxq "maretu01/gothrough:sha-$commit" "$output"
    if [[ $version == *-* ]]; then
        if grep -Fxq 'maretu01/gothrough:latest' "$output"; then
            echo "Prerelease incorrectly updates latest: $version" >&2
            exit 1
        fi
    else
        grep -Fxq 'maretu01/gothrough:latest' "$output"
    fi
done

for version in v1 v1.0 1.0.0 v01.0.0 v1.02.0 v1.0.03 v1.0.0-beta.01 v1.0.0- v1.0.0+build v1.0.0-beta_1; do
    : > "$output"
    if REPOSITORY=MARETU01/gothrough VERSION="$version" GITHUB_OUTPUT="$output" \
        bash .github/scripts/image-tags.sh 2>/dev/null; then
        echo "Invalid version was accepted: $version" >&2
        exit 1
    fi
    test ! -s "$output"
done
for repository in '' /gothrough gothrough ghcr.io/user/gothrough user/repo:tag user/-repo; do
    : > "$output"
    if REPOSITORY="$repository" VERSION=v1.0.0 GITHUB_OUTPUT="$output" \
        bash .github/scripts/image-tags.sh 2>/dev/null; then
        echo "Invalid repository was accepted: $repository" >&2
        exit 1
    fi
    test ! -s "$output"
done

: > "$output"
REPOSITORY=my-docker-org/custom_repo VERSION=v1.0.0 GITHUB_OUTPUT="$output" \
    bash .github/scripts/image-tags.sh
grep -Fxq 'my-docker-org/custom_repo:v1.0.0' "$output"

echo 'Docker Hub repository, version tags and stable/prerelease promotion tests passed'

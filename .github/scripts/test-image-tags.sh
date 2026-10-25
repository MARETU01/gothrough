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
    grep -Fxq "ghcr.io/maretu01/gothrough:$version" "$output"
    grep -Fxq "ghcr.io/maretu01/gothrough:sha-$commit" "$output"
    if [[ $version == *-* ]]; then
        if grep -Fxq 'ghcr.io/maretu01/gothrough:latest' "$output"; then
            echo "Prerelease incorrectly updates latest: $version" >&2
            exit 1
        fi
    else
        grep -Fxq 'ghcr.io/maretu01/gothrough:latest' "$output"
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
echo 'Version tags and stable/prerelease promotion tests passed'

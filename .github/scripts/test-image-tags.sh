#!/usr/bin/env bash
set -euo pipefail
script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/image-tags.sh"
# Isolate version comparisons from the project's existing and future tags.
fixture="$(mktemp -d)"
git init -q "$fixture"
cd "$fixture"
git -c user.name=Test -c user.email=test@example.invalid -c commit.gpgsign=false \
    commit --allow-empty -qm 'Version tag test fixture'
output="$(mktemp)"
trap 'rm -f "$output"' EXIT
commit="$(git rev-parse HEAD)"
assert_no_latest() {
    if grep -Fxq 'maretu01/gothrough:latest' "$output"; then
        echo "Version incorrectly updates latest: $version" >&2
        exit 1
    fi
}

for version in v0.1.0 v1.0.0 v12.34.56 v1.1.0-beta.1 v2.0.0-rc.0 v1.0.0-0; do
    : > "$output"
    REPOSITORY=MARETU01/gothrough VERSION="$version" GITHUB_OUTPUT="$output" \
        bash "$script"
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
        bash "$script" 2>/dev/null; then
        echo "Invalid version was accepted: $version" >&2
        exit 1
    fi
    test ! -s "$output"
done
for repository in '' /gothrough gothrough ghcr.io/user/gothrough user/repo:tag user/-repo; do
    : > "$output"
    if REPOSITORY="$repository" VERSION=v1.0.0 GITHUB_OUTPUT="$output" \
        bash "$script" 2>/dev/null; then
        echo "Invalid repository was accepted: $repository" >&2
        exit 1
    fi
    test ! -s "$output"
done

: > "$output"
REPOSITORY=my-docker-org/custom_repo VERSION=v1.0.0 GITHUB_OUTPUT="$output" \
    bash "$script"
grep -Fxq 'my-docker-org/custom_repo:v1.0.0' "$output"

# A stable backfill still gets version/SHA tags, but never replaces latest.
git tag v0.2.0
for version in v0.1.5 v0.2.0 v0.3.0; do
    : > "$output"
    REPOSITORY=MARETU01/gothrough VERSION="$version" GITHUB_OUTPUT="$output" \
        bash "$script"
    grep -Fxq "maretu01/gothrough:$version" "$output"
    grep -Fxq "maretu01/gothrough:sha-$commit" "$output"
    if [[ $version == v0.1.5 ]]; then
        assert_no_latest
    else
        grep -Fxq 'maretu01/gothrough:latest' "$output"
    fi
done

# Ignore prereleases and malformed tags; compare numeric components correctly.
for tag in v1.9.0 v1.10.0 v2.0.0-beta.1 v999 v99.0 v01.0.0 v99.0.0+build; do
    git tag "$tag"
done
git tag "v$(printf '9%.0s' {1..128}).0.0"
for version in v1.9.9 v1.10.0 v1.10.1 v2.0.0-rc.1; do
    : > "$output"
    REPOSITORY=MARETU01/gothrough VERSION="$version" GITHUB_OUTPUT="$output" \
        bash "$script"
    if [[ $version == v1.9.9 || $version == *-* ]]; then
        assert_no_latest
    else
        grep -Fxq 'maretu01/gothrough:latest' "$output"
    fi
done

git tag v1.10.10
version=v1.10.9
: > "$output"
REPOSITORY=MARETU01/gothrough VERSION="$version" GITHUB_OUTPUT="$output" bash "$script"
assert_no_latest

git tag v10.0.0
for version in v2.0.0 v10.0.0; do
    : > "$output"
    REPOSITORY=MARETU01/gothrough VERSION="$version" GITHUB_OUTPUT="$output" bash "$script"
    if [[ $version == v2.0.0 ]]; then
        assert_no_latest
    else
        grep -Fxq 'maretu01/gothrough:latest' "$output"
    fi
done

echo 'Docker Hub repository, version tags and stable/prerelease promotion tests passed'

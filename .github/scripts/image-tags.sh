#!/usr/bin/env bash
set -euo pipefail

: "${REPOSITORY:?REPOSITORY is required}"
: "${VERSION:?VERSION is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

# Docker tags do not allow '+', so build-metadata suffixes are not supported.
pattern='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-([0-9A-Za-z-]+)(\.[0-9A-Za-z-]+)*)?$'
if [[ ! $VERSION =~ $pattern || ${#VERSION} -gt 128 ]]; then
    echo "Invalid version: $VERSION; use v1.0.0 or v1.0.0-beta.1" >&2
    exit 1
fi
if [[ $VERSION == *-* ]]; then
    IFS='.' read -r -a identifiers <<< "${VERSION#*-}"
    for identifier in "${identifiers[@]}"; do
        if [[ $identifier =~ ^[0-9]+$ && ${#identifier} -gt 1 && $identifier == 0* ]]; then
            echo "Numeric prerelease identifiers must not contain leading zeros" >&2
            exit 1
        fi
    done
fi

image="ghcr.io/${REPOSITORY,,}"
commit="$(git rev-parse HEAD)"
{
    echo "commit=$commit"
    echo 'tags<<GOTHROUGH_IMAGE_TAGS'
    echo "$image:$VERSION"
    echo "$image:sha-$commit"
    if [[ $VERSION != *-* ]]; then
        echo "$image:latest"
    fi
    echo 'GOTHROUGH_IMAGE_TAGS'
} >> "$GITHUB_OUTPUT"

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

image="${REPOSITORY,,}"
if [[ ! $image =~ ^[a-z0-9][a-z0-9_-]*/[a-z0-9]+(([._]|__|-+)[a-z0-9]+)*$ ]]; then
    echo "Invalid Docker Hub repository: use namespace/repository" >&2
    exit 1
fi
commit="$(git rev-parse HEAD)"
promote_latest=false
if [[ $VERSION != *-* ]]; then
    # Compare numeric versions, not tag dates or lexical order. Include VERSION
    # so the first release also works; publishing jobs check out all remote tags.
    known_versions="$(git tag --list)"
    stable_pattern='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
    highest_version="$(printf '%s\n' "$known_versions" "$VERSION" \
        | LC_ALL=C grep -E "$stable_pattern" | awk 'length($0) <= 128' \
        | LC_ALL=C sort -V | tail -n 1)"
    if [[ $VERSION == "$highest_version" ]]; then
        promote_latest=true
    fi
fi
{
    echo "commit=$commit"
    echo 'tags<<GOTHROUGH_IMAGE_TAGS'
    echo "$image:$VERSION"
    echo "$image:sha-$commit"
    if [[ $promote_latest == true ]]; then
        echo "$image:latest"
    fi
    echo 'GOTHROUGH_IMAGE_TAGS'
} >> "$GITHUB_OUTPUT"

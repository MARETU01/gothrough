# Continuous Integration

English | [简体中文](ci.zh-CN.md)

[Back to the project README](../README.md)

The workflow is defined in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It runs automatically on pushes to `main`, pushes of `v*` tags, and pull request creation or updates. You can also run `CI` manually from GitHub's Actions page.

## Checks

| Job | Environment | Checks |
| --- | --- | --- |
| Backend | Ubuntu, Windows | Ordinary Go tests, vet, and builds without embedded assets |
| Frontend and embedded build | Ubuntu | Frontend lint, tests, and build; Go embedded build, tests, vet, and race detection |
| Verify Docker image | Ubuntu | On pull requests, version tags, and manual runs: build an amd64 image and verify uploads and persistence across restarts, without logging in to Docker Hub |
| Publish versioned Docker image | Ubuntu | Publish multi-platform images only after a version tag is pushed and all checks pass |

The ordinary backend job sets `CGO_ENABLED=0` to verify the development build without frontend output. The embedded job sets `CGO_ENABLED=1` and uses the Ubuntu runner's C toolchain to run `go test -race -tags embedweb ./...`, covering ordinary and embedding-related Go packages.

The Go version is read from `go.mod`; Node.js uses 26 LTS. Go and npm download caches reduce repeated downloads, while frontend dependencies are still installed according to the lockfile. The Makefile's installation marker is reused so later builds in the same job do not reinstall dependencies.

The workflow has read-only repository permissions. The image publishing job logs in to Docker Hub with the repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`; it does not need GitHub Packages write permission. See [Docker deployment](docker.md#automated-builds-and-publishing-on-github) for setup. A new run for the same branch cancels the previous run to avoid duplicate work. The workflow does not automatically commit code, deploy servers, or create a Release.

## Triggers and Publishing Rules

| Event | Regular CI | Container build and validation | Image publishing |
| --- | --- | --- | --- |
| Push to main | Yes | No | No |
| Create or update a pull request | Yes | Yes, amd64 | No |
| Push a version tag | Yes | Yes, amd64 | Publish amd64/arm64 after all checks pass |
| Run manually from Actions | Yes | Yes, amd64 | No |

The image validation job has only repository read access and does not log in to the image registry. Only the publishing job uses Docker Hub publishing credentials. The publishing job requires the tag to point to a commit in `origin/main`'s history, preventing image publication from unmerged branches.

Before publication, the workflow loads a local amd64 image and starts a container to verify that pages are accessible, actual chunked uploads work, downloaded content matches, and files survive a restart. This also checks `/data` volume permissions and hard links between directories. After these checks pass, it builds `linux/amd64` and `linux/arm64` images. QEMU is used to build the arm64 runtime image, but no additional arm64 container functional test is run.

The image name defaults to `<Docker Hub username>/<GitHub repository name>`, converted to lowercase. Set the repository variable `DOCKERHUB_REPOSITORY` to a full `namespace/image` name to override it, for example for an organization repository. The following examples use `YOUR_USERNAME/gothrough`; replace the username as needed:

```text
YOUR_USERNAME/gothrough:latest
YOUR_USERNAME/gothrough:v1.0.0
YOUR_USERNAME/gothrough:sha-<full-commit-SHA>
```

`latest` is updated only when a stable version tag is successfully published. Prerelease tags such as `v1.1.0-beta.1` and `v2.0.0-rc.1` produce only their version and SHA tags without updating `latest`. Ordinary main pushes and manual runs do not publish images. The existing `latest` remains until a later stable release replaces it.

Version names must use `vMAJOR.MINOR.PATCH`, optionally followed by a `-prerelease` identifier. Numeric leading zeros, `+build` metadata, and names exceeding Docker's tag length limit are not accepted. The tag rules are implemented in [image-tags.sh](../.github/scripts/image-tags.sh), whose tests run in the Linux backend job.

Docker build caches are stored in GitHub Actions. Failed checks, container validation failures, invalid tags, or insufficient permissions prevent successful publication. The workflow does not automatically create a GitHub Release or deploy a server.

## Publish a Version

First merge changes into main. Confirm that the working tree is clean, main is synchronized, and the corresponding CI checks have passed. Then run:

```sh
git switch main
git pull --ff-only origin main
git status
git log -1 --oneline
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

This publishes version and SHA image tags and updates `latest`. For a prerelease, use a version such as `v1.1.0-beta.1`, which does not change `latest`. Keep published tags unchanged and use a new version number for fixes. The workflow does not compare version numbers: publishing v2.0.0 and then v1.0.1 makes `latest` point to the later-published v1.0.1.

See [Docker deployment](docker.md) for pulling and running images, configuring Docker Hub credentials, and troubleshooting permissions.

## Run Checks Locally

Run these commands from the project root. On Windows, use Git Bash.

```sh
go test ./...
go vet ./...
make install
npm --prefix frontend run lint
npm --prefix frontend test
make -j2 build test
```

If CGO and a C compiler are available, also run:

```sh
CGO_ENABLED=1 go test -race -tags embedweb ./...
```

On Windows without a C toolchain, run the other checks locally and inspect the Linux race detection results in GitHub Actions. The workflow runs remotely only after it has been committed and pushed to GitHub; adding the workflow file alone does not mean remote checks have passed.

## Official References

- [actions/checkout](https://github.com/actions/checkout)
- [actions/setup-go](https://github.com/actions/setup-go)
- [actions/setup-node](https://github.com/actions/setup-node)

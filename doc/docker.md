# Docker Deployment

English | [简体中文](docker.zh-CN.md)

[Back to the project README](../README.md)

Install and start Docker Engine or Docker Desktop with Linux container support. Run commands from the project root.

## Use Compose

```sh
docker compose up -d --build
docker compose logs -f
docker compose down
```

Open `http://localhost:8080` after startup. Compose mounts the project's `config/config.yaml` as read-only configuration and creates one shared data volume. `docker compose down` preserves the volume by default. **`docker compose down -v` deletes the volume, including uploaded files and clipboard history.**

The default mapping connects host port 8080 to container port 8080. To change only the host port:

```sh
GOTHROUGH_HTTP_PORT=9000 docker compose up -d
```

`GOTHROUGH_HTTP_PORT` controls only the Compose port mapping; it does not configure the backend's listening port. If you change the container's listening port in the configuration file, also change the right-hand side of the port mapping in `compose.yaml`.

The container supports LAN and internet access. The default port mapping binds all host interfaces; public reachability also depends on security groups, firewalls, and router mappings. Configure an access password and HTTPS for public deployments; see [LAN and internet access](configuration.md#lan-and-internet-access). If a reverse proxy runs on the host, you can change the mapping to `127.0.0.1:8080:8080` and expose the proxy as the public endpoint; keep the listener inside the container on `0.0.0.0`.

## Persistent Data

Container layout:

```text
/app/gothrough          Executable, outside the data volume
/app/config/           External configuration and mountable certificates
/data/uploads          Uploaded files
/data/temp_uploads     Temporary upload sessions
/data/clipboard        Clipboard history
/data/                 Single persistent data volume
```

The image sets `GOTHROUGH_DATA_DIR=/data` for uploaded files, temporary uploads, and clipboard history, creating missing subdirectories as needed. The executable stays outside the volume, so updating the image updates the application.

The image's environment variable takes precedence over `storage.data_dir` in YAML. To change the container's data root, pass `-e GOTHROUGH_DATA_DIR=/another/path` and adjust the mount target accordingly.

**Mount the entire `/data` directory as one volume.** Do not mount `uploads` and `temp_uploads` as separate volumes or put the temporary directory alone on tmpfs; publishing uploads requires hard links between the two directories. Startup and upload initialization check write access and hard-link support and report errors early if these requirements are not met. Startup still cleans up temporary uploads; uploads cannot resume after a container restart.

A Docker-managed named volume is recommended by default. For a host bind mount, ensure UID/GID `10001:10001` can create, read, and write the data subdirectories beforehand. The image does not automatically change host directory permissions at startup. Do not share the same volume between multiple application instances at the same time.

## Configuration and Environment Variables

Mount a custom configuration file:

```sh
docker run -d --name gothrough \
  --stop-timeout 40 \
  -p 8080:8080 \
  --mount type=volume,source=gothrough-data,target=/data \
  --mount type=bind,source="$(pwd)/config/config.yaml",target=/app/config/config.yaml,readonly \
  gothrough:local
```

You can also override the image's default configuration with environment variables:

```sh
docker run -d --name gothrough \
  --stop-timeout 40 \
  -p 9000:9000 \
  -e GOTHROUGH_HOST=0.0.0.0 \
  -e GOTHROUGH_PORT=9000 \
  --mount type=volume,source=gothrough-data,target=/data \
  gothrough:local
```

Examples using the same container name are alternatives; do not run them together. Restart or recreate the container after configuration changes. See the [configuration guide](configuration.md) for the full port and TLS rules.

### HTTPS

Mount certificates and private keys read-only at runtime rather than adding them to the image. This example uses container port 8443:

```sh
docker run -d --name gothrough \
  --stop-timeout 40 \
  -p 8443:8443 \
  -e GOTHROUGH_HOST=0.0.0.0 \
  -e GOTHROUGH_PORT=8443 \
  -e GOTHROUGH_TLS_ENABLED=true \
  -e GOTHROUGH_TLS_CERT_FILE=/app/config/certs/server.crt \
  -e GOTHROUGH_TLS_KEY_FILE=/app/config/certs/server.key \
  --mount type=bind,source="$(pwd)/config/certs",target=/app/config/certs,readonly \
  --mount type=volume,source=gothrough-data,target=/data \
  gothrough:local
```

The mounted certificate and private key must be readable by container UID 10001. Use `0.0.0.0` as the listening address, rather than `127.0.0.1` inside the container, so the host port mapping can reach the server.

On Windows, Git Bash may automatically convert `/app` and `/data` paths in commands. If paths are rewritten, first set `export MSYS_NO_PATHCONV=1` and use `pwd -W` or an actual Windows path such as `C:/...` for bind mount sources. Compose commands do not require these container paths to be passed manually, so Compose is preferred on Windows.

## Build the Image

Build with BuildKit. The host needs neither Go nor Node.js, and no prior `make` invocation is required:

```sh
docker build -t gothrough:local .
```

The image includes the executable, frontend assets, and default configuration. Runtime data stays in the mounted volume; override configuration with a read-only mount.

## Start a Container

```sh
docker run -d --name gothrough \
  --stop-timeout 40 \
  -p 8080:8080 \
  --mount type=volume,source=gothrough-data,target=/data \
  gothrough:local
```

Open `http://localhost:8080`. The container runs as UID/GID `10001:10001`. Docker allows up to 40 seconds for the container to stop, accommodating the application's own 30-second grace period for active requests.

For containers started with `docker run`, view logs with `docker logs -f --tail=100 gothrough`. See above for Compose log commands and the [logging guide](logging.md) for formats and rotation settings.

### Use a Published Image

Replace `YOUR_USERNAME` below with your Docker Hub username. If you configured a custom repository, replace the entire image name. For private repositories, run `docker login` on the target machine first.

After the image has been published and you have pull access:

```sh
docker pull YOUR_USERNAME/gothrough:latest
docker run -d --name gothrough --stop-timeout 40 \
  -p 8080:8080 \
  --mount type=volume,source=gothrough-data,target=/data \
  YOUR_USERNAME/gothrough:latest
```

## Multi-Architecture Builds

The Dockerfile supports Buildx target platform arguments, for example:

```sh
docker buildx build --platform linux/arm64 -t gothrough:arm64 --load .
```

Build stages run on the build machine's platform, and Go cross-compiles for the target. Running the locally loaded image still requires a host or emulation environment that supports its target platform.

## Automated Builds and Publishing on GitHub

The [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) workflow builds an amd64 image for pull requests and verifies uploads, downloads, and persistence across restarts, without publishing it. Ordinary pushes to main run regular CI only. Images are published to Docker Hub only after a version tag such as `v1.0.0` is pushed and all CI and container checks pass. The tagged commit must already be in main's history.

Published images support `linux/amd64` and `linux/arm64`, with a version tag such as `v1.0.0` and a `sha-<full-commit-SHA>` tag. Only the highest stable version among the repository's Git tags updates `latest`; older stable backfills and prereleases such as `v1.1.0-beta.1` do not. The image name defaults to `<Docker Hub username>/<GitHub repository name>`, converted to lowercase. Set the repository variable `DOCKERHUB_REPOSITORY` to override it with a full `namespace/image` name. Manually running the workflow validates the build without publishing.

Before publishing for the first time:

1. Create the target repository on Docker Hub, such as `your-username/gothrough`. Make it public if unauthenticated pulls are needed.
2. Create a Docker Hub Personal Access Token with read and write access to the target repository. Use the token rather than your account password.
3. In the GitHub repository, go to **Settings → Secrets and variables → Actions → Secrets** and add `DOCKERHUB_USERNAME` (the Docker Hub login username) and `DOCKERHUB_TOKEN` (the access token). Do not put the token in source code or logs.
4. If the Docker Hub namespace or repository name differs from the default, add `DOCKERHUB_REPOSITORY` under **Variables** on the same page, for example `my-org/gothrough`. The login account and token must have push access to that repository.

If login or publishing fails, check that both secrets exist, the token is valid and has write access, and the image namespace belongs to the login account or an authorized organization. The workflow does not create a GitHub Release or deploy servers automatically.

### Validation and Tag Rules

Before publishing, amd64 containers are tested for page access, uploads, downloads, and restart persistence. The arm64 image is built without a separate container functional test. See [build and checks](build.md#checks-and-continuous-integration) for CI coverage.

Version tags use `vMAJOR.MINOR.PATCH` with an optional `-prerelease` identifier. Numeric leading zeros, `+build` metadata, and names exceeding Docker's tag length limit are rejected. See [image-tags.sh](../.github/scripts/image-tags.sh) for the rules.

### Publish a Version

First merge changes into main. Confirm that the working tree is clean, main is synchronized, and the corresponding CI checks have passed. Then run:

```sh
git switch main
git pull --ff-only origin main
git status
git log -1 --oneline
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

This publishes version and SHA image tags. It updates `latest` only if the version is the highest valid stable Git tag, comparing major, minor, and patch numerically. For example, after tagging `v2.0.0`, backfilling `v1.0.1` leaves `latest` unchanged. Prereleases such as `v1.1.0-beta.1` never change `latest`. Docker publishing jobs share a concurrency group and queue rather than publishing simultaneously. Keep published tags unchanged and use a new version number for fixes.

The comparison uses Git tags, not Docker Hub's publication history. If the highest tagged version fails to publish, older backfills still cannot update `latest`; fix and rerun the highest version's publishing job. These rules apply to tags whose commits contain this workflow and script; rerunning an older tag uses its original publishing logic.

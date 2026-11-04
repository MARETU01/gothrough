.DEFAULT_GOAL := build

GO ?= go
NPM ?= npm
OUT_DIR ?= release

# Use Git Bash/POSIX sh for every recipe, including Windows builds.
SHELL := sh
.SHELLFLAGS := -c

TARGET_OS := $(shell $(GO) env GOOS)
ifeq ($(TARGET_OS),windows)
EXE := .exe
endif
OUTPUT ?= $(OUT_DIR)/gothrough$(EXE)
DEPS_STAMP := frontend/node_modules/.gothrough-deps-installed
DEPS_INPUTS := frontend/package.json frontend/package-lock.json $(wildcard frontend/.npmrc .npmrc)

.PHONY: build install test help

# A single dependency chain preserves ordering even with make -j.
build: internal/webassets/dist/index.html
	mkdir -p "$(dir $(OUTPUT))"
	$(GO) build -tags embedweb -trimpath -ldflags="-s -w" -o "$(OUTPUT)" ./cmd
	mkdir -p "$(dir $(OUTPUT))config"
	if [ ! -e "$(dir $(OUTPUT))config/config.yaml" ]; then cp config/config.yaml "$(dir $(OUTPUT))config/config.yaml"; fi
	@echo Built: $(OUTPUT)

install: $(DEPS_STAMP)
	$(GO) mod download

# npm ci removes node_modules, so keep the stamp inside it: deleting dependencies
# automatically invalidates this cache. Failed installs never create the stamp.
$(DEPS_STAMP): $(DEPS_INPUTS)
	$(NPM) --prefix frontend ci
	touch "$@"

# install is phony, so rebuild assets on every invocation and share the result
# between build and test when both are requested in the same make invocation.
internal/webassets/dist/index.html: install
	$(NPM) --prefix frontend run build
	# Refresh only the generated copy, so obsolete hashed assets are not embedded.
	test -f frontend/dist/index.html
	test "$$(cd internal/webassets && pwd -P)" = "$$(pwd -P)/internal/webassets"
	test ! -L internal/webassets/dist
	rm -rf -- internal/webassets/dist
	mkdir -p internal/webassets/dist
	cp -R frontend/dist/. internal/webassets/dist/

test: internal/webassets/dist/index.html
	$(GO) test ./...
	$(GO) vet ./...
	$(GO) test -tags embedweb ./...
	$(GO) vet -tags embedweb ./...

help:
	@echo make build          - Reuse unchanged dependencies and build the embedded executable
	@echo make install        - Download Go modules and install frontend dependencies as needed
	@echo make test           - Build frontend, then run backend tests and vet with and without embedded assets
	@echo make OUTPUT=release/custom.exe - Customize the output file

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

.PHONY: build install frontend test test-embedded help

# A single dependency chain preserves ordering even with make -j.
build: frontend
	mkdir -p "$(dir $(OUTPUT))"
	$(GO) build -tags embedweb -trimpath -ldflags="-s -w" -o "$(OUTPUT)" ./cmd
	@echo Built: $(OUTPUT)

install:
	$(NPM) --prefix frontend ci

frontend: install
	$(NPM) --prefix frontend run build

test:
	$(GO) test ./...
	$(GO) vet ./...

test-embedded: frontend
	$(GO) test -tags embedweb ./...
	$(GO) vet -tags embedweb ./...

help:
	@echo make build          - Install frontend dependencies and build the embedded executable
	@echo make frontend       - Install dependencies and build frontend/dist
	@echo make install        - Install frontend dependencies from the lockfile
	@echo make test           - Run backend tests and vet without embedded assets
	@echo make test-embedded  - Build frontend, then run embedded backend tests and vet
	@echo make OUTPUT=release/custom.exe - Customize the output file

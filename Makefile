# One entry point for the three packages. Each keeps its own package.json,
# lockfile and suite; this file only spells out the commands in one place.
# Every target names the package it touches; only *-all spans them.
#
#   make install-plugin | install-backend | install-frontend | install-all
#   make test-plugin    | test-backend    | test-frontend    | test-all
#   make build-plugin                                          build plugin/dist (the hook bundles)
#   make build-frontend                                        build frontend/dist
#   make run-backend                                           start the API on CT_API_PORT (8787); serves frontend/dist if built
#   make run-frontend                                          build the frontend, then run-backend
#   make dev-frontend                                          vite dev server (run `make run-backend` in another terminal)
#   make clean-frontend | clean-all

SHELL := /bin/bash
.DEFAULT_GOAL := help

PACKAGES := plugin backend frontend
CT_API_PORT ?= 8787

.PHONY: help install-all test-all clean-all \
        $(addprefix install-,$(PACKAGES)) $(addprefix test-,$(PACKAGES)) \
        build-plugin build-frontend run-backend run-frontend dev-frontend clean-frontend

help:
	@grep -E '^#   make' Makefile | sed 's/^#   //'

install-all: $(addprefix install-,$(PACKAGES))

# npm ci needs a lockfile; a package that has none yet falls back to npm install.
$(addprefix install-,$(PACKAGES)): install-%:
	@if [ -f $*/package-lock.json ]; then npm ci --prefix $*; else npm install --prefix $*; fi

test-all: $(addprefix test-,$(PACKAGES))

$(addprefix test-,$(PACKAGES)): test-%:
	npm test --prefix $* --if-present

build-plugin:
	npm run build --prefix plugin

build-frontend:
	npm run build --prefix frontend --if-present

run-backend:
	CT_API_PORT=$(CT_API_PORT) node backend/src/infrastructure/ct-api.mjs

run-frontend: install-frontend build-frontend run-backend

dev-frontend: install-frontend
	npm run dev --prefix frontend --if-present

clean-frontend:
	rm -rf frontend/dist frontend/node_modules

clean-all: clean-frontend
	rm -rf plugin/node_modules backend/node_modules

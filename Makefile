# Recipe Monster. Run `make help` for the targets.
SHELL := /bin/bash
HOST ?= recipe-monster.local
PORT_SUFFIX = $(if $(HTTPS_PORT),:$(HTTPS_PORT))
OP = $(shell command -v op >/dev/null && echo op run --env-file=.env.1password --)

.PHONY: help certs up down logs test check

help:          ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-8s %s\n", $$1, $$2}'

certs:         ## Make a locally trusted certificate for $(HOST) (needs mkcert)
	HOST=$(HOST) scripts/make-cert.sh

up:            ## Start the stack (HTTPS_PORT=8443 if 443 is taken)
	lan=$$(ipconfig getifaddr en0 || ipconfig getifaddr en1 || true); \
	PUBLIC_URL=https://$(HOST)$(PORT_SUFFIX)$${lan:+,https://$$lan$(PORT_SUFFIX)} $(OP) docker compose up -d --build
	@echo "Open https://$(HOST)$(PORT_SUFFIX)"

down:          ## Stop the stack (data is kept)
	docker compose down

logs:          ## Follow service logs
	docker compose logs -f --tail=50

test:          ## Run the unit tests
	npm test

check:         ## Validate config files without starting anything
	docker compose config --quiet
	docker run --rm -v "$$PWD/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$$PWD/certs:/certs:ro" caddy:2.11.7-alpine caddy validate --config /etc/caddy/Caddyfile

#!/bin/sh
set -eu

TLS_DIR=/tmp/chatbot-tls

install -d -m 0700 -o bun -g bun "$TLS_DIR"
install -m 0444 -o bun -g bun /run/tls/server-cert.pem "$TLS_DIR/server-cert.pem"
install -m 0400 -o bun -g bun /run/tls/server-key.pem "$TLS_DIR/server-key.pem"

exec setpriv --reuid=bun --regid=bun --init-groups "$@"

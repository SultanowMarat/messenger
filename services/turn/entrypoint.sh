#!/bin/sh
set -e

REALM=${TURN_REALM:-messenger}
USER=${TURN_USERNAME:-turn}
PASS=${TURN_PASSWORD:-turnpass}
PORT=${TURN_PORT:-3478}
MIN_PORT=${TURN_MIN_PORT:-49160}
MAX_PORT=${TURN_MAX_PORT:-49200}
EXT_IP=${TURN_EXTERNAL_IP:-}

ARGS="--log-file=stdout --lt-cred-mech --realm=${REALM} --user=${USER}:${PASS} --listening-port=${PORT} --min-port=${MIN_PORT} --max-port=${MAX_PORT} --no-cli --fingerprint"
if [ -n "$EXT_IP" ]; then
  ARGS="$ARGS --external-ip=$EXT_IP"
fi

exec turnserver -n $ARGS

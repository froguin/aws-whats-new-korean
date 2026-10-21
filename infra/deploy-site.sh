#!/usr/bin/env bash
# Deploy (or preview) one awskr.net site stack from a params.env file.
#
#   deploy-site.sh <path/to/params.env>            # create/update the stack
#   PREVIEW=1 deploy-site.sh <path/to/params.env>  # create the change set only, do not execute
#
# params.env: one Key=Value per line; the special line StackName=... names the stack,
# lines starting with # are ignored. CertificateArn is read from the export of the
# awskr-wildcard-cert stack, so deploy cert.yaml first.
set -euo pipefail

PARAMS="${1:?usage: deploy-site.sh <params.env>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REGION=us-east-1

STACK="$(grep -E '^StackName=' "$PARAMS" | head -1 | cut -d= -f2-)"
[ -n "$STACK" ] || { echo "StackName= missing in $PARAMS" >&2; exit 1; }

CERT="$(aws cloudformation list-exports --region "$REGION" \
  --query "Exports[?Name=='awskr-wildcard-cert-arn'].Value" --output text)"
[ -n "$CERT" ] && [ "$CERT" != "None" ] || { echo "export awskr-wildcard-cert-arn not found; deploy cert.yaml first" >&2; exit 1; }

OVR=("CertificateArn=$CERT")
while IFS= read -r line; do OVR+=("$line"); done < <(grep -vE '^(#|StackName=|[[:space:]]*$)' "$PARAMS")

EXTRA=()
[ "${PREVIEW:-}" = "1" ] && EXTRA+=(--no-execute-changeset)
# CI passes CFN_ROLE_NAME so CloudFormation (not the narrow OIDC role) creates the resources.
if [ -n "${CFN_ROLE_NAME:-}" ]; then
  ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
  EXTRA+=(--role-arn "arn:aws:iam::${ACCOUNT}:role/${CFN_ROLE_NAME}")
fi

aws cloudformation deploy --region "$REGION" --stack-name "$STACK" \
  --template-file "$HERE/site/template.yaml" --capabilities CAPABILITY_IAM \
  --tags Project=awskr-net Site="$STACK" \
  --parameter-overrides "${OVR[@]}" ${EXTRA[@]+"${EXTRA[@]}"}

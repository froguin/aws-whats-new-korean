#!/usr/bin/env bash
# Deploy the standalone release backend stack (awskr-backend-whatsnew) in ap-northeast-2.
#   ./deploy.sh <ARTIFACT_PREFIX> [extra Key=Value parameter overrides...]
# Examples:
#   ./deploy.sh 3fa9c01b22de                      # first deploy: schedule stays DISABLED
#   ./deploy.sh 3fa9c01b22de ScheduleState=ENABLED # turn the schedules on
#   PREVIEW=1 ./deploy.sh 3fa9c01b22de             # create the change set only
set -euo pipefail

REGION=ap-northeast-2
STACK=awskr-backend-whatsnew
HERE="$(cd "$(dirname "$0")" && pwd)"
PREFIX="${1:?usage: deploy.sh <ARTIFACT_PREFIX> [Key=Value ...]}"; shift || true

BUCKET="$(aws cloudformation describe-stacks --region "$REGION" --stack-name awskr-backend-artifacts \
  --query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue" --output text)"

EXTRA=()
[ "${PREVIEW:-}" = "1" ] && EXTRA+=(--no-execute-changeset)

aws cloudformation deploy --region "$REGION" --stack-name "$STACK" \
  --template-file "$HERE/template.yaml" --capabilities CAPABILITY_IAM \
  --tags Project=awskr-net Site=release-backend \
  --parameter-overrides "ArtifactBucket=$BUCKET" "ArtifactPrefix=$PREFIX" "$@" ${EXTRA[@]+"${EXTRA[@]}"}

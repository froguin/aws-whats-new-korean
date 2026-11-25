#!/usr/bin/env bash
# Zip the four Lambda handlers and upload them to the artifact bucket under a content-hash prefix.
#   ./package.sh            # prints "ARTIFACT_PREFIX=<hash>" on the last line
# Needs: stack awskr-backend-artifacts (artifacts.yaml) deployed in ap-northeast-2, zip, shasum.
# The handlers are ES modules that only import the AWS SDK v3 (bundled in the nodejs22.x runtime),
# so no dependencies are installed: each handler.js is shipped as index.mjs.
set -euo pipefail

REGION=ap-northeast-2
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../../functions"
FUNCS=(rss-collector translator region-resolver publisher)

BUCKET="$(aws cloudformation describe-stacks --region "$REGION" --stack-name awskr-backend-artifacts \
  --query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue" --output text)"
[ -n "$BUCKET" ] && [ "$BUCKET" != "None" ] || { echo "deploy artifacts.yaml first" >&2; exit 1; }

shopt -s nullglob
PREFIX="$(for f in "${FUNCS[@]}"; do shasum -a 256 "$SRC/$f/handler.js" "$SRC/$f"/*.mjs; done | shasum -a 256 | cut -c1-12)"
shopt -u nullglob

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
for f in "${FUNCS[@]}"; do
  mkdir -p "$WORK/$f"
  cp "$SRC/$f/handler.js" "$WORK/$f/index.mjs"
  # Sibling ES modules the handler imports (for example translator/regions.mjs) ship next to it.
  shopt -s nullglob; extra=("$SRC/$f"/*.mjs); shopt -u nullglob
  for m in "${extra[@]}"; do cp "$m" "$WORK/$f/"; done
  (cd "$WORK/$f" && zip -X -q "$WORK/$f.zip" ./*.mjs)
  aws s3 cp "$WORK/$f.zip" "s3://$BUCKET/$PREFIX/$f.zip" --no-progress
done

echo "bucket: $BUCKET"
echo "ARTIFACT_PREFIX=$PREFIX"

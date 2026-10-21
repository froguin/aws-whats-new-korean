#!/usr/bin/env bash
# Atomically point a host name at a CloudFront distribution (A + AAAA alias records).
#   dns-cutover.sh <host> <distribution-domain>           # dry run: prints the change batch
#   dns-cutover.sh <host> <distribution-domain> --apply   # submits it
# Handles both starting points: an existing CNAME (Amplify) is deleted and replaced by the alias
# records in ONE change batch; existing A/AAAA aliases are simply upserted.
set -euo pipefail
HOST="${1:?host, e.g. kiro.awskr.net}"; TARGET="${2:?distribution domain, e.g. d123.cloudfront.net}"
ZONE=Z01517412DUMQ2XQU1189

CUR="$(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE" \
  --query "ResourceRecordSets[?Name=='${HOST}.' && (Type=='CNAME' || Type=='A' || Type=='AAAA')]" --output json)"

BATCH="$(HOST="$HOST" TARGET="$TARGET" CUR="$CUR" python3 - <<'PY'
import json, os
host, target, cur = os.environ["HOST"], os.environ["TARGET"], json.loads(os.environ["CUR"])
alias = lambda t: {"Name": host, "Type": t, "AliasTarget": {"HostedZoneId": "Z2FDTNDATAQYW2", "DNSName": target, "EvaluateTargetHealth": False}}
changes = []
cname = [r for r in cur if r["Type"] == "CNAME"]
if cname:
    changes.append({"Action": "DELETE", "ResourceRecordSet": cname[0]})
    act = "CREATE"
else:
    act = "UPSERT"
changes += [{"Action": act, "ResourceRecordSet": alias("A")}, {"Action": act, "ResourceRecordSet": alias("AAAA")}]
print(json.dumps({"Comment": f"cutover {host} -> {target}", "Changes": changes}, indent=2))
PY
)"
echo "$BATCH"
if [ "${3:-}" = "--apply" ]; then
  aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" --change-batch "$BATCH"
else
  echo "(dry run -- add --apply to submit)"
fi

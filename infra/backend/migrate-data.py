#!/usr/bin/env python3
"""Copy every item of the old (Amplify) Articles table into the new table.

    migrate-data.py --source <old-table> --target <new-table>            # dry run: counts only
    migrate-data.py --source <old-table> --target <new-table> --apply    # write

Uses only the AWS CLI (no boto3). Items are passed through in DynamoDB JSON, so keys, the
gsi1 attributes and the ttl attribute are preserved exactly. Safe to re-run: PutRequest
overwrites an item with the same key. The source table is only read.
"""
import argparse
import json
import subprocess
import sys
import time

REGION = "ap-northeast-2"


def aws(*args):
    # --output json is forced: the user's default CLI output format here is "table".
    out = subprocess.run(["aws", "--region", REGION, "--output", "json", *args], check=True, capture_output=True, text=True)
    return json.loads(out.stdout) if out.stdout.strip() else {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--target", required=True)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    items = aws("dynamodb", "scan", "--table-name", a.source, "--output", "json").get("Items", [])
    print(f"source {a.source}: {len(items)} items")
    before = aws("dynamodb", "describe-table", "--table-name", a.target)["Table"]["ItemCount"]
    print(f"target {a.target}: ItemCount (approx, refreshed every ~6h) = {before}")
    if not a.apply:
        print("dry run -- add --apply to write")
        return

    written = 0
    for i in range(0, len(items), 25):
        batch = {a.target: [{"PutRequest": {"Item": it}} for it in items[i:i + 25]]}
        delay = 1.0
        while batch:
            resp = aws("dynamodb", "batch-write-item", "--request-items", json.dumps(batch))
            batch = resp.get("UnprocessedItems") or {}
            if batch:  # provisioned throughput: back off and retry what was throttled
                time.sleep(delay)
                delay = min(delay * 2, 16)
        written += len(items[i:i + 25])
        print(f"  wrote {written}/{len(items)}", end="\r", flush=True)
    print(f"\ndone: {written} items written to {a.target}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        sys.exit(f"aws cli failed: {e.stderr.strip()[:500]}")

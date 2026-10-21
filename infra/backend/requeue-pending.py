#!/usr/bin/env python3
"""Re-queue articles that are still STATUS#pending for translation.

    requeue-pending.py --table <table> --queue-url <translation queue url>           # dry run: lists them
    requeue-pending.py --table <table> --queue-url <translation queue url> --apply   # sends the messages

The RSS collector only queues articles it has never seen, so an article whose translation failed stays
pending forever. This sends the same message the collector would have sent
({guid, url, title, description, pubDate}). The translator overwrites an item by key, so re-queuing is idempotent.
Uses only the AWS CLI.
"""
import argparse
import json
import subprocess
import sys

REGION = "ap-northeast-2"


def aws(*args):
    # --output json is forced: the default CLI output format on this machine is "table".
    out = subprocess.run(["aws", "--region", REGION, "--output", "json", *args], check=True, capture_output=True, text=True)
    return json.loads(out.stdout) if out.stdout.strip() else {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--table", required=True)
    ap.add_argument("--queue-url", required=True)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    items = aws("dynamodb", "query", "--table-name", a.table, "--index-name", "gsi1",
                "--key-condition-expression", "gsi1pk = :p",
                "--expression-attribute-values", '{":p":{"S":"STATUS#pending"}}').get("Items", [])
    msgs = []
    for it in items:
        g = lambda k: it.get(k, {}).get("S", "")
        msgs.append({"guid": g("pk"), "url": g("url") or g("pk"), "title": g("title_en"),
                     "description": g("description"), "pubDate": g("pubDate")})
    msgs.sort(key=lambda m: m["pubDate"])
    print(f"{len(msgs)} pending article(s)")
    for m in msgs:
        print(f"  {m['pubDate'][:16]}  {m['title'][:80]}")
    if not a.apply:
        print("dry run -- add --apply to send")
        return

    sent = 0
    for i in range(0, len(msgs), 10):
        entries = [{"Id": str(i + n), "MessageBody": json.dumps(m)} for n, m in enumerate(msgs[i:i + 10])]
        resp = aws("sqs", "send-message-batch", "--queue-url", a.queue_url, "--entries", json.dumps(entries))
        if resp.get("Failed"):
            sys.exit(f"send failed: {resp['Failed']}")
        sent += len(entries)
    print(f"sent {sent} message(s)")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        sys.exit(f"aws cli failed: {e.stderr.strip()[:500]}")

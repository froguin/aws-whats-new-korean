# release backend without Amplify

Standalone CloudFormation version of the Amplify Gen2 backend (`amplify/backend.ts`), sized for the
AWS always-free allowances. Nothing in here has been deployed yet; the Amplify stack keeps serving
until the cutover below.

| File | Purpose |
|---|---|
| `artifacts.yaml` | Private bucket for the zipped function code (stack `awskr-backend-artifacts`) |
| `package.sh` | Zips `amplify/functions/*/handler.js` (as `index.mjs`) and uploads under a content-hash prefix |
| `template.yaml` | DynamoDB, 3 SQS queues, 4 Lambda functions, 15-minute schedule, HTTP API (stack `awskr-backend-whatsnew`) |
| `deploy.sh` | Deploys `template.yaml` (`PREVIEW=1` = change set only) |
| `migrate-data.py` | Copies the 252 articles from the old table to the new one (reads old, writes new) |
| `requeue-pending.py` | Re-queues articles stuck in `STATUS#pending` (the collector only queues new articles) |

The functions only import the AWS SDK v3, which the `nodejs22.x` runtime already contains, so there is
nothing to install or bundle. The code stays in `amplify/functions/` as the single source.

## Why this fits the free allowance (measured, last 30 days)

| Resource | Usage | Free allowance | Note |
|---|---|---|---|
| DynamoDB | 252 items, 0.76 MB, ~72k read / ~1.5k write units | 25 RCU + 25 WCU provisioned and 25 GB, always free, **shared by all tables and indexes in the region** | table 10/10 + `gsi1` 10/10 = 20/20 provisioned. The table was on-demand, which has no free tier (about a cent a month at this volume) |
| Lambda | RssCollector 2,882 runs, Translator 299, Api 93, RegionResolver 17 (about 2,600 GB-s) | 1M requests, 400k GB-s | the account's other functions share this allowance |
| SQS | a few thousand messages | 1M requests | |
| EventBridge | 1 rule | schedule rules are free | |
| HTTP API | ~100 calls | **1M calls, first 12 months of an account only** | throttled to 20 req/s, burst 40, as a cost guard (the API has no WAF) |
| Bedrock (Nova Lite / Micro) | translations | **no free tier** | cost is unchanged by this migration |

Provisioned capacity can throttle on bursts (DynamoDB keeps ~5 minutes of unused capacity as burst).
10/10 is ~70x the measured average. Raising any value above 25/25 in total leaves the free tier.

## Cutover order (every step is reversible until step 8)

0. `aws cloudformation deploy --region ap-northeast-2 --stack-name awskr-backend-artifacts --template-file artifacts.yaml`
1. `./package.sh` -> note the printed `ARTIFACT_PREFIX=...`
2. `PREVIEW=1 ./deploy.sh <prefix>` and read the change set, then `./deploy.sh <prefix>`.
   The schedule is created **DISABLED**, so nothing collects or translates yet.
3. Copy the data: `./migrate-data.py --source <old table> --target <new table>` (dry run), then `--apply`.
   Old table name: the `Articles` table of the Amplify pipeline stack (`aws dynamodb list-tables`).
4. Check the new API with the site origin:
   `curl -H 'Origin: https://release.awskr.net' "<ApiUrl>/stats"` and compare `/stats` and `/articles`
   against the live API.
5. Hand over the schedule (no double collection): disable the old rule
   (`aws events disable-rule --name <old RssSchedule rule>`), then
   `./deploy.sh <prefix> ScheduleState=ENABLED`. Watch one collector run and one translation finish.
6. Point the site at the new API: set the repository variable `VITE_API_URL` to the stack output
   `ApiUrl`, run the `Deploy release site` workflow, check release.awskr.net loads articles.
7. Observe for about a week (DLQ empty, new articles translated, API 200).
8. Decommission the old stack: stop the Amplify backend deploys (disable branch auto build), delete the
   Amplify app (this removes the old Lambdas, queues, API; the old table has a retain policy and is
   kept). Export or delete the old table last.

Rollback before step 8: set `VITE_API_URL` back, redeploy the site, re-enable the old rule, disable the new one.

## Differences from the Amplify version

- CORS: `https://release.awskr.net` and `http://localhost:5173` only (the `amplifyapp.com` origin is gone).
- IAM: one role per function with only the actions its handler uses (`GetItem`, `PutItem`, `UpdateItem`,
  `Query`); the API role is read only. Log groups keep 14 days.
- DynamoDB: provisioned instead of on-demand; same keys, `gsi1`, and `ttl` attribute.
- Functions are named `awskr-backend-whatsnew-<function>`, so the CloudWatch log groups change too.

## Not done yet

- The infra pipeline (`bootstrap.yaml` roles and `infra.yml`) covers `awskr-site-*` stacks only. Deploying
  this stack from GitHub Actions needs extra permissions (DynamoDB, SQS, Lambda, Events, API Gateway v2,
  Logs, IAM roles named `awskr-backend-*`) and a packaging step; for now run `deploy.sh` from a terminal.
- The template was validated by CloudFormation's syntax check only; it has never been created.
- Whether Bedrock cross-region inference for `apac.amazon.nova-*` works with the new role is unverified
  (the policy mirrors the Amplify one).

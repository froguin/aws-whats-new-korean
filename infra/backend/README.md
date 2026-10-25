# Backend (CloudFormation)

Data pipeline for the site: RSS collection, translation, and publishing a static `articles.json`.
Plain CloudFormation, sized for the AWS always-free allowances. Deploy in `ap-northeast-2`.

| File | Purpose |
|---|---|
| `artifacts.yaml` | Private bucket for the zipped function code (stack `awskr-backend-artifacts`) |
| `package.sh` | Zips `functions/*/handler.js` (as `index.mjs`) and uploads under a content-hash prefix |
| `template.yaml` | DynamoDB, 3 SQS queues, 4 Lambda functions, 15-minute schedules |
| `deploy.sh` | Deploys `template.yaml` (`PREVIEW=1` = change set only) |
| `requeue-pending.py` | Re-queues articles stuck in `STATUS#pending` (the collector only queues new articles) |

The functions only import the AWS SDK v3, which the `nodejs22.x` runtime already contains, so there is
nothing to install or bundle. The code lives in `../../functions/`.

## Data flow

1. `rss-collector` (every 15 minutes) reads the official What's New feed and queues new articles.
2. `translator` summarizes and translates each article with Amazon Bedrock and stores it in DynamoDB.
3. `publisher` (every 15 minutes) writes all translated articles to `articles.json` in the site bucket.
   The site reads that single static file through CloudFront, so visitors never reach Lambda or DynamoDB.

## Deploy

### Automatic backend deploy (primary)

A push to `main` that changes `functions/**` or `infra/backend/**` runs
`Deploy backend (Lambda + static snapshot)`. It packages the four handlers, deploys the
CloudFormation stack, then invokes `publisher` so `articles.json` exists immediately.

The one-time prerequisites are the artifact bucket, the backend GitHub OIDC role, and the
repository variable `AWS_BACKEND_DEPLOY_ROLE_ARN`; all are defined in `infra/bootstrap.yaml`.
Use **Run workflow** in GitHub Actions to re-deploy the current backend revision without a code change.

### Manual backend deploy (recovery)

```bash
cd infra/backend
aws cloudformation deploy --region ap-northeast-2 --stack-name awskr-backend-artifacts --template-file artifacts.yaml  # once
./package.sh                                  # prints ARTIFACT_PREFIX=<hash>
PREVIEW=1 ./deploy.sh <prefix>                # optional: read the change set first
./deploy.sh <prefix> ScheduleState=ENABLED
aws lambda invoke --region ap-northeast-2 --function-name awskr-backend-whatsnew-publisher /dev/stdout  # seed articles.json now
```

`ScheduleState` defaults to `DISABLED`; pass `ENABLED` or the schedules stay off.
The site bucket is in `us-east-1`, so the publisher sets `SITE_BUCKET_REGION` explicitly.

## Why this fits the free allowance (measured, last 30 days)

| Resource | Usage | Free allowance | Note |
|---|---|---|---|
| DynamoDB | 252 items, 0.76 MB | 25 RCU + 25 WCU provisioned and 25 GB, always free, shared by all tables and indexes in the region | table 10/10 + `gsi1` 10/10 = 20/20 provisioned |
| Lambda | about 2,600 GB-s | 1M requests, 400k GB-s | the account's other functions share this allowance |
| SQS | a few thousand messages | 1M requests | |
| EventBridge | 2 schedule rules | schedule rules are free | |
| Bedrock (Nova Lite / Micro) | translations | no free tier | the only recurring cost |

Provisioned capacity can throttle on bursts. Raising any value above 25/25 in total leaves the free tier.

# awskr.net shared IaC (lives in aws-whats-new-korean/infra)

Shared IaC for the awskr.net static sites (CloudFront FREE flat-rate plan + dedicated WAF web ACL).
This repo (`aws-whats-new-korean`) is the home of the shared pieces: the wildcard certificate,
the site template and the deploy/cutover scripts. The other site repos only hold their own
`infra/site/params.env` and call `deploy-site.sh` from here. Clone layout assumed:
all repos side by side under `~/Documents/github/`.

| File | Purpose |
|---|---|
| `cert.yaml` | `*.awskr.net` ACM certificate (us-east-1, DNS-validated in Route 53). Exports `awskr-wildcard-cert-arn`. |
| `site/template.yaml` | One site: S3 (OAC) + CloudFront + web ACL (rate limit + AWS IP reputation) + FREE plan subscription + optional DNS + optional GitHub OIDC deploy role. |
| `deploy-site.sh` | Deploys `site/template.yaml` with a site's `infra/site/params.env`. `PREVIEW=1` creates the change set only. |
| `dns-cutover.sh` | Switches a host name to the new distribution in one atomic Route 53 change batch. |

Each site repo keeps only its parameters: `infra/site/params.env`
(bedrock-pricing-compare and this repo's own `site/params.env` for release.awskr.net).
kiro-handbook and amazon-quick-handbook were prepared too but stay on Amplify: this AWS account
allows only 3 FREE flat-rate plans (not increasable); release.awskr.net and bedrock-compare use two
of them. Moving them needs a Pro plan ($15/month each) or a free slot.

Why one web ACL per site: a flat-rate plan cannot reuse a web ACL (or CloudFront function) that is
associated with another distribution, and Amplify cannot join a plan. The rules are defined once in the
template, so every site gets the same protection.

All stacks are us-east-1.

## 0. Push-driven deploys (GitHub Actions) -- one-time setup

After setup, a push to `main` deploys the infra; nothing is run by hand again.

| Workflow | Where | Runs when |
|---|---|---|
| `infra.yml` | this repo | `infra/cert.yaml`, `infra/site/**`, `infra/deploy-site.sh` change: deploys the wildcard cert, then release.awskr.net |
| `deploy-site-infra.yml` | this repo (reusable) | called by the workflows below |
| `infra.yml` | bedrock-pricing-compare | that repo's `infra/site/params.env` changes (or manual run with `preview=true`) |

Security model: the GitHub role `awskr-infra-deploy` can only run `awskr-*` stacks and hand the work to
the CloudFormation execution role `awskr-infra-cfn-execution`, which holds the broad permissions.
Both trust only the `main` branch of the four repos (exact OIDC subjects are in `bootstrap.yaml`;
three repos use the immutable `owner@id/repo@id` format). Workflows never run on pull requests.
Optional hardening: branch protection on `main`; the execution role can create IAM roles named
`awskr-site-*` and uses `pricingplanmanager:*` until the exact action names are known.

Setup (from your terminal; the bootstrap cannot deploy itself):
```bash
cd ~/Documents/github/aws-whats-new-korean/infra
aws cloudformation deploy --region us-east-1 --stack-name awskr-infra-bootstrap \
  --template-file bootstrap.yaml --capabilities CAPABILITY_NAMED_IAM
ROLE=$(aws cloudformation describe-stacks --region us-east-1 --stack-name awskr-infra-bootstrap \
  --query "Stacks[0].Outputs[?OutputKey=='InfraDeployRoleArn'].OutputValue" --output text)
for r in aws-whats-new-korean bedrock-pricing-compare; do
  gh variable set AWS_INFRA_ROLE_ARN --repo froguin/$r --body "$ROLE"
done
```
Then commit and push each repo's new `infra/` and `.github/workflows/infra.yml`
(push `aws-whats-new-korean` first: the other repos call its reusable workflow). Use
"Run workflow" with `preview=true` the first time to read the change set before anything is created.

The manual commands in sections 1-2 still work as a fallback.

An AWS-side pipeline (CodePipeline/CodeBuild) was considered and not chosen: it needs a GitHub
connection per repo, CodeBuild's free allowance is small, and the repos already deploy through
GitHub Actions + OIDC.

## 1. Certificate (once)

```bash
cd ~/Documents/github/aws-whats-new-korean/infra
aws cloudformation deploy --region us-east-1 --stack-name awskr-wildcard-cert --template-file cert.yaml
aws cloudformation list-exports --region us-east-1 --query "Exports[?Name=='awskr-wildcard-cert-arn'].Value" --output text
```
DNS validation is automatic; the stack finishes when the certificate is ISSUED.

## 2. Phase 1 -- create the new distribution (no live traffic, no host name)

```bash
cd ~/Documents/github/aws-whats-new-korean/infra
PREVIEW=1 ./deploy-site.sh ../../bedrock-pricing-compare/infra/site/params.env   # review the change set first
./deploy-site.sh ../../bedrock-pricing-compare/infra/site/params.env
# repeat for this repo's own site/params.env (release.awskr.net)
```
Check `PricingPlanStatus` in the stack outputs: it must be `ACTIVE`. If it is `FAILED`, read the
status reason (the managed IP-reputation rule group is the first suspect if the plan rejects it)
and remove that rule from the template.

The new site is reachable on the `DistributionDomainName` output (cloudfront.net) with the default
certificate. Upload content there before the cutover (see "Content").

## 3. Phase 2 -- cutover (per site)

A host name can sit on only one CloudFront distribution at a time, so there is a short gap
(minutes, not measured) between freeing the name and the DNS flip. Do it in this order:

Amplify site (release):
1. Upload the built site to the new bucket and invalidate; verify on the cloudfront.net domain.
2. Amplify console -> Domain management -> remove the host name (frees the alias).
3. Set `AttachAlias=true` in `params.env`, run `./deploy-site.sh <params.env>`.
4. `./dns-cutover.sh release.awskr.net <DistributionDomainName>` (dry run), then add `--apply`.
   The CNAME to Amplify is deleted and the A/AAAA aliases created in one batch.

bedrock-compare (live distribution `E1OQXWKSFOXAF` is replaced):
1. After phase 1, add the new distribution to the bucket policy of `awskr-bedrock-pricing`
   (second `AWS:SourceArn` value; keep the old one until the cutover is done).
2. Verify the new cloudfront.net domain serves the page.
3. Remove `bedrock-compare.awskr.net` from the old distribution (CloudFront console or CLI), then
   `AttachAlias=true` + `./deploy-site.sh ...`, then `./dns-cutover.sh bedrock-compare.awskr.net <new domain> --apply`.
4. Update the references to the old distribution id: `infra/lambda-refresh` stack parameter
   `DistributionId` (`sam deploy`), `infra/lambda-refresh/deploy-role-policy.json` (re-apply the
   role policy), and `DIST_ID` in `.github/workflows/refresh.yml`.
5. After a quiet period, delete the old distribution, its OAC and the old bucket-policy statement.

Rollback before step "remove from Amplify / old distribution" is just deleting the new stack.
After it, re-add the host name to the old resource and revert the DNS records.

## Content

Each repo needs a GitHub Actions deploy workflow (build -> `aws s3 sync` -> `create-invalidation`)
using the `DeployRoleArn` stack output via OIDC. bedrock-compare and release (`aws-whats-new-korean`)
already have one; the release site reads the static `articles.json` written by the backend publisher,
so it needs no build variables.

## Known unknowns

- Free plan eligibility of this account is unverified until the first subscription attempt.
- The GitHub OIDC subject format for the new repos (`repo:froguin/<name>:ref:refs/heads/main`)
  is assumed; the existing bedrock role uses a numeric-id subject, so a repo-level subject
  setting may apply. If the first workflow cannot assume the role, adjust `GitHubSubject`.
- `RateLimit` defaults to 1000 requests / 5 min / IP (a VitePress page load is dozens of requests).
  Use `RateLimitAction=Count` for the first day if you want to watch for false positives.

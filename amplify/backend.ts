import { defineBackend } from '@aws-amplify/backend';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import path from 'path';

const backend = defineBackend({});
const stack = backend.createStack('WhatsNewPipeline');

// ── DynamoDB ──
const table = new dynamodb.Table(stack, 'Articles', {
  partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.RETAIN,
  timeToLiveAttribute: 'ttl',
});
table.addGlobalSecondaryIndex({
  indexName: 'gsi1',
  partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
});

// ── SQS ──
const dlq = new sqs.Queue(stack, 'TranslationDLQ', {
  retentionPeriod: Duration.days(7),
});
const queue = new sqs.Queue(stack, 'TranslationQueue', {
  visibilityTimeout: Duration.minutes(10),
  retentionPeriod: Duration.days(1),
  deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
});

// ── Shared env ──
const fnEnv = {
  TABLE_NAME: table.tableName,
  QUEUE_URL: queue.queueUrl,
  BEDROCK_TRANSLATE_MODEL: 'apac.amazon.nova-micro-v1:0',
  BEDROCK_REVIEW_MODEL: 'apac.amazon.nova-lite-v1:0',
};

// ── Lambda: RSS Collector ──
const rssCollector = new lambda.Function(stack, 'RssCollector', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '..', 'functions', 'rss-collector')),
  timeout: Duration.minutes(5),
  memorySize: 256,
  environment: fnEnv,
});
table.grantReadWriteData(rssCollector);
queue.grantSendMessages(rssCollector);

// EventBridge: 15분마다 실행
new events.Rule(stack, 'RssSchedule', {
  schedule: events.Schedule.rate(Duration.minutes(15)),
  targets: [new targets.LambdaFunction(rssCollector)],
});

// ── Lambda: Translator ──
const translator = new lambda.Function(stack, 'Translator', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '..', 'functions', 'translator')),
  timeout: Duration.minutes(10),
  memorySize: 512,
  environment: fnEnv,
});
table.grantReadWriteData(translator);
translator.addToRolePolicy(new iam.PolicyStatement({
  actions: ['bedrock:InvokeModel'],
  resources: [
    `arn:aws:bedrock:*:${stack.account}:inference-profile/apac.amazon.*`,
    'arn:aws:bedrock:*::foundation-model/amazon.nova-*',
  ],
}));
translator.addEventSource(new lambdaEventSources.SqsEventSource(queue, { batchSize: 1 }));

// ── Outputs (for Astro SSR API routes) ──
backend.addOutput({
  custom: {
    tableName: table.tableName,
    queueUrl: queue.queueUrl,
  },
});

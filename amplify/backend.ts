import { defineBackend } from '@aws-amplify/backend';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
const dlq = new sqs.Queue(stack, 'TranslationDLQ', { retentionPeriod: Duration.days(7) });
const queue = new sqs.Queue(stack, 'TranslationQueue', {
  visibilityTimeout: Duration.minutes(10),
  retentionPeriod: Duration.days(1),
  deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
});

const nodejsProps = {
  runtime: lambda.Runtime.NODEJS_22_X,
  architecture: lambda.Architecture.ARM_64,
  bundling: { externalModules: ['@aws-sdk/*', '@smithy/*'] },
};

// ── Lambda: RSS Collector ──
const rssCollector = new NodejsFunction(stack, 'RssCollector', {
  ...nodejsProps,
  entry: path.join(__dirname, 'functions', 'rss-collector', 'handler.js'),
  timeout: Duration.minutes(5),
  memorySize: 256,
  environment: { TABLE_NAME: table.tableName, QUEUE_URL: queue.queueUrl },
});
table.grantReadWriteData(rssCollector);
queue.grantSendMessages(rssCollector);
new events.Rule(stack, 'RssSchedule', {
  schedule: events.Schedule.rate(Duration.minutes(15)),
  targets: [new targets.LambdaFunction(rssCollector)],
});

// ── Lambda: Translator ──
const translator = new NodejsFunction(stack, 'Translator', {
  ...nodejsProps,
  entry: path.join(__dirname, 'functions', 'translator', 'handler.js'),
  timeout: Duration.minutes(10),
  memorySize: 512,
  environment: {
    TABLE_NAME: table.tableName,
    BEDROCK_TRANSLATE_MODEL: 'apac.amazon.nova-lite-v1:0',
    BEDROCK_REVIEW_MODEL: 'apac.amazon.nova-micro-v1:0',
  },
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

// ── Lambda: API ──
const api = new NodejsFunction(stack, 'Api', {
  ...nodejsProps,
  entry: path.join(__dirname, 'functions', 'api', 'handler.js'),
  timeout: Duration.seconds(30),
  memorySize: 256,
  environment: { TABLE_NAME: table.tableName },
  reservedConcurrentExecutions: 5,
});
table.grantReadData(api);

// Public endpoint is unified on API Gateway HTTP API (no Lambda Function URL).
const httpApi = new apigwv2.HttpApi(stack, 'PublicApi', {
  corsPreflight: {
    allowOrigins: ['https://d27cqsuosbietu.amplifyapp.com', 'http://localhost:*'],
    allowMethods: [apigwv2.CorsHttpMethod.GET],
    allowHeaders: ['Content-Type'],
  },
});

const apiIntegration = new apigwv2Integrations.HttpLambdaIntegration('ApiIntegration', api);
httpApi.addRoutes({ path: '/articles', methods: [apigwv2.HttpMethod.GET], integration: apiIntegration });
httpApi.addRoutes({ path: '/stats', methods: [apigwv2.HttpMethod.GET], integration: apiIntegration });

// ── Outputs ──
backend.addOutput({
  custom: {
    tableName: table.tableName,
    queueUrl: queue.queueUrl,
    apiUrl: httpApi.url || "",
  },
});

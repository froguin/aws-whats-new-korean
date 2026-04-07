import { defineBackend } from '@aws-amplify/backend';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { rssCollector } from './functions/rss-collector/resource';
import { translator } from './functions/translator/resource';
import { api } from './functions/api/resource';

const backend = defineBackend({
  rssCollector,
  translator,
  api,
});

// ── Custom resources stack ──
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

// ── Grant access: RSS Collector → DynamoDB + SQS ──
const rssLambda = backend.rssCollector.resources.lambda as lambda.Function;
table.grantReadWriteData(rssLambda);
queue.grantSendMessages(rssLambda);
rssLambda.addEnvironment('TABLE_NAME', table.tableName);
rssLambda.addEnvironment('QUEUE_URL', queue.queueUrl);

// ── Grant access: Translator → DynamoDB + Bedrock ──
const translatorLambda = backend.translator.resources.lambda as lambda.Function;
table.grantReadWriteData(translatorLambda);
translatorLambda.addEnvironment('TABLE_NAME', table.tableName);
translatorLambda.addEnvironment('BEDROCK_TRANSLATE_MODEL', 'apac.amazon.nova-lite-v1:0');
translatorLambda.addEnvironment('BEDROCK_REVIEW_MODEL', 'apac.amazon.nova-micro-v1:0');
translatorLambda.addToRolePolicy(new iam.PolicyStatement({
  actions: ['bedrock:InvokeModel'],
  resources: [
    `arn:aws:bedrock:*:${stack.account}:inference-profile/apac.amazon.*`,
    'arn:aws:bedrock:*::foundation-model/amazon.nova-*',
  ],
}));

// SQS trigger for translator
translatorLambda.addEventSource(new lambdaEventSources.SqsEventSource(queue, { batchSize: 1 }));

// ── Grant access: API → DynamoDB (read only) ──
const apiLambda = backend.api.resources.lambda as lambda.Function;
table.grantReadData(apiLambda);
apiLambda.addEnvironment('TABLE_NAME', table.tableName);

// Function URL for API
const apiUrl = apiLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['https://d27cqsuosbietu.amplifyapp.com', 'http://localhost:*'],
    allowedMethods: [lambda.HttpMethod.GET],
    allowedHeaders: ['Content-Type'],
  },
});

// ── Outputs ──
backend.addOutput({
  custom: {
    tableName: table.tableName,
    queueUrl: queue.queueUrl,
    apiUrl: apiUrl.url,
  },
});

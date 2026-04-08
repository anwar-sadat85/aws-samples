import { defineBackend } from '@aws-amplify/backend';
import {
  AttributeType,
  BillingMode,
  Table,
} from 'aws-cdk-lib/aws-dynamodb';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  Cors,
  LambdaIntegration,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { fileURLToPath } from 'url';
import * as path from 'path';
import { auth } from './auth/resource';
import { data } from './data/resource';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const backend = defineBackend({
  auth,
  data,
});

// ── Enable USER_PASSWORD_AUTH on the user pool client ────────────────────────
// Required for the DAST workflow which calls `initiate-auth` with
// AuthFlow: USER_PASSWORD_AUTH directly (no SRP).  Amplify Gen2 only enables
// ALLOW_USER_SRP_AUTH + ALLOW_REFRESH_TOKEN_AUTH by default.
const { cfnUserPoolClient } = backend.auth.resources.cfnResources;
cfnUserPoolClient.explicitAuthFlows = [
  'ALLOW_USER_SRP_AUTH',        // Amplify frontend (default, keep it)
  'ALLOW_USER_PASSWORD_AUTH',   // CLI / DAST programmatic login
  'ALLOW_REFRESH_TOKEN_AUTH',   // Token refresh
];

// ── Custom stack for API Gateway + Tasks DynamoDB ────────────────────────────
const tasksStack = backend.createStack('TasksApiStack');

// DynamoDB table for ad-hoc tasks
const tasksTable = new Table(tasksStack, 'TasksTable', {
  partitionKey: { name: 'userId', type: AttributeType.STRING },
  sortKey: { name: 'taskId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
});

// Lambda function for tasks CRUD — bundled locally with esbuild (no Docker)
const tasksLambda = new NodejsFunction(tasksStack, 'TasksApiHandler', {
  runtime: Runtime.NODEJS_20_X,
  entry: path.join(__dirname, 'functions/tasks-api/handler.ts'),
  handler: 'handler',
  environment: {
    TASKS_TABLE_NAME: tasksTable.tableName,
  },
  bundling: {
    forceDockerBundling: false,
  },
});

// Grant Lambda read/write access to DynamoDB
tasksTable.grantReadWriteData(tasksLambda);

// Cognito authorizer using the Amplify-managed user pool
const userPool = backend.auth.resources.userPool;

const cognitoAuthorizer = new CognitoUserPoolsAuthorizer(
  tasksStack,
  'TasksCognitoAuthorizer',
  {
    cognitoUserPools: [userPool],
  }
);

// REST API Gateway
const tasksApi = new RestApi(tasksStack, 'TasksRestApi', {
  restApiName: 'TasksApi',
  defaultCorsPreflightOptions: {
    allowOrigins: Cors.ALL_ORIGINS,
    allowMethods: Cors.ALL_METHODS,
    allowHeaders: ['Content-Type', 'Authorization'],
  },
});

const lambdaIntegration = new LambdaIntegration(tasksLambda);

// /tasks  (GET list, POST create)
const tasksResource = tasksApi.root.addResource('tasks');
tasksResource.addMethod('GET', lambdaIntegration, {
  authorizer: cognitoAuthorizer,
  authorizationType: AuthorizationType.COGNITO,
});
tasksResource.addMethod('POST', lambdaIntegration, {
  authorizer: cognitoAuthorizer,
  authorizationType: AuthorizationType.COGNITO,
});

// /tasks/{taskId}  (GET single, DELETE)
const taskItem = tasksResource.addResource('{taskId}');
taskItem.addMethod('GET', lambdaIntegration, {
  authorizer: cognitoAuthorizer,
  authorizationType: AuthorizationType.COGNITO,
});
taskItem.addMethod('DELETE', lambdaIntegration, {
  authorizer: cognitoAuthorizer,
  authorizationType: AuthorizationType.COGNITO,
});

// /swagger.json  — OpenAPI spec (public, no auth)
const swaggerJson = tasksApi.root.addResource('swagger.json');
swaggerJson.addMethod('GET', lambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

// /swagger  — Swagger UI (public, no auth)
const swaggerUi = tasksApi.root.addResource('swagger');
swaggerUi.addMethod('GET', lambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

// Expose the API URL as a stack output so Amplify outputs.json includes it
backend.addOutput({
  custom: {
    tasksApiUrl: tasksApi.url,
  },
});

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TASKS_TABLE_NAME!;

interface Task {
  taskId: string;
  userId: string;
  title: string;
  description?: string;
  createdAt: string;
}

interface APIGatewayEvent {
  httpMethod: string;
  path: string;
  pathParameters?: { taskId?: string };
  body?: string;
  requestContext: {
    domainName?: string;
    stage?: string;
    authorizer?: {
      claims?: {
        sub?: string;
      };
    };
  };
}

// ── OpenAPI spec ─────────────────────────────────────────────────────────────
function buildOpenApiSpec(baseUrl: string) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Tasks API',
      description:
        'Ad-hoc task management API protected by Amazon Cognito User Pool JWT tokens. ' +
        'All endpoints (except /swagger.json and /swagger) require a valid ID token ' +
        'in the `Authorization` header.',
      version: '1.0.0',
      contact: {
        name: 'Tasks API Support',
      },
    },
    servers: [
      {
        url: baseUrl,
        description: 'Current stage',
      },
    ],
    security: [{ CognitoUserPool: [] }],
    components: {
      securitySchemes: {
        CognitoUserPool: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Cognito User Pool ID token. Obtain via Amplify `fetchAuthSession()` → `tokens.idToken`.',
        },
      },
      schemas: {
        Task: {
          type: 'object',
          required: ['taskId', 'userId', 'title', 'createdAt'],
          properties: {
            taskId: {
              type: 'string',
              format: 'uuid',
              description: 'Unique task identifier (UUID v4)',
              example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            },
            userId: {
              type: 'string',
              description: 'Cognito sub of the owning user',
              example: 'us-east-1:abc123',
            },
            title: {
              type: 'string',
              description: 'Short task title',
              example: 'Review PR #42',
            },
            description: {
              type: 'string',
              nullable: true,
              description: 'Optional longer description',
              example: 'Check edge-cases in the auth middleware',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'ISO 8601 creation timestamp',
              example: '2026-04-08T12:00:00.000Z',
            },
          },
        },
        CreateTaskRequest: {
          type: 'object',
          required: ['title'],
          properties: {
            title: {
              type: 'string',
              description: 'Short task title',
              example: 'Review PR #42',
            },
            description: {
              type: 'string',
              description: 'Optional longer description',
              example: 'Check edge-cases in the auth middleware',
            },
          },
        },
        Error: {
          type: 'object',
          required: ['message'],
          properties: {
            message: {
              type: 'string',
              example: 'Task not found',
            },
          },
        },
      },
    },
    paths: {
      '/tasks': {
        get: {
          operationId: 'listTasks',
          summary: 'List all tasks',
          description: 'Returns all ad-hoc tasks belonging to the authenticated user, sorted newest-first.',
          tags: ['Tasks'],
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Task' },
                  },
                },
              },
            },
            '401': {
              description: 'Missing or invalid Authorization token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createTask',
          summary: 'Create a task',
          description: 'Creates a new ad-hoc task for the authenticated user.',
          tags: ['Tasks'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateTaskRequest' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Task created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Task' },
                },
              },
            },
            '400': {
              description: 'Validation error — `title` is required',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                  example: { message: 'title is required' },
                },
              },
            },
            '401': {
              description: 'Missing or invalid Authorization token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/tasks/{taskId}': {
        parameters: [
          {
            name: 'taskId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'UUID of the task',
            example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          },
        ],
        get: {
          operationId: 'getTask',
          summary: 'Get a single task',
          description: 'Returns a single task by ID. Only the owning user can access it.',
          tags: ['Tasks'],
          responses: {
            '200': {
              description: 'Task found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Task' },
                },
              },
            },
            '401': {
              description: 'Missing or invalid Authorization token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'Task not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                  example: { message: 'Task not found' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        delete: {
          operationId: 'deleteTask',
          summary: 'Delete a task',
          description: 'Permanently deletes a task. Only the owning user can delete it.',
          tags: ['Tasks'],
          responses: {
            '200': {
              description: 'Task deleted',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string', example: 'Task deleted' },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Missing or invalid Authorization token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/swagger.json': {
        get: {
          operationId: 'getOpenApiSpec',
          summary: 'OpenAPI specification',
          description: 'Returns the OpenAPI 3.0 JSON specification for this API. No authentication required.',
          tags: ['Documentation'],
          security: [],
          responses: {
            '200': {
              description: 'OpenAPI 3.0 JSON document',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/swagger': {
        get: {
          operationId: 'getSwaggerUi',
          summary: 'Swagger UI',
          description: 'Renders an interactive Swagger UI for this API. No authentication required.',
          tags: ['Documentation'],
          security: [],
          responses: {
            '200': {
              description: 'HTML page with Swagger UI',
              content: { 'text/html': { schema: { type: 'string' } } },
            },
          },
        },
      },
    },
    tags: [
      { name: 'Tasks', description: 'Ad-hoc task operations' },
      { name: 'Documentation', description: 'API documentation endpoints' },
    ],
  };
}

function swaggerUiHtml(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tasks API – Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
  SwaggerUIBundle({
    url: "${specUrl}",
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout: 'BaseLayout',
    deepLinking: true,
    tryItOutEnabled: true,
  });
</script>
</body>
</html>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

function htmlResponse(statusCode: number, body: string) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/html',
      'Access-Control-Allow-Origin': '*',
    },
    body,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────
export const handler = async (event: APIGatewayEvent) => {
  const { httpMethod, path } = event;

  if (httpMethod === 'OPTIONS') {
    return jsonResponse(200, {});
  }

  // ── Documentation endpoints (no auth) ──────────────────────────────────────
  const stage = event.requestContext.stage ?? 'prod';
  const domain = event.requestContext.domainName ?? '';
  const baseUrl = `https://${domain}/${stage}`;

  if (path === '/swagger.json' && httpMethod === 'GET') {
    return jsonResponse(200, buildOpenApiSpec(baseUrl));
  }

  if (path === '/swagger' && httpMethod === 'GET') {
    return htmlResponse(200, swaggerUiHtml(`${baseUrl}/swagger.json`));
  }

  // ── Authenticated endpoints ─────────────────────────────────────────────────
  const userId = event.requestContext?.authorizer?.claims?.sub;
  if (!userId) {
    return jsonResponse(401, { message: 'Unauthorized' });
  }

  const taskId = event.pathParameters?.taskId;

  try {
    if (httpMethod === 'GET' && !taskId) {
      const result = await ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: { ':userId': userId },
          ScanIndexForward: false,
        })
      );
      return jsonResponse(200, result.Items ?? []);
    }

    if (httpMethod === 'GET' && taskId) {
      const result = await ddb.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { userId, taskId } })
      );
      if (!result.Item) {
        return jsonResponse(404, { message: 'Task not found' });
      }
      return jsonResponse(200, result.Item);
    }

    if (httpMethod === 'POST') {
      const body = JSON.parse(event.body ?? '{}');
      if (!body.title) {
        return jsonResponse(400, { message: 'title is required' });
      }
      const task: Task = {
        taskId: randomUUID(),
        userId,
        title: body.title,
        description: body.description,
        createdAt: new Date().toISOString(),
      };
      await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: task }));
      return jsonResponse(201, task);
    }

    if (httpMethod === 'DELETE' && taskId) {
      await ddb.send(
        new DeleteCommand({ TableName: TABLE_NAME, Key: { userId, taskId } })
      );
      return jsonResponse(200, { message: 'Task deleted' });
    }

    return jsonResponse(405, { message: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return jsonResponse(500, { message: 'Internal server error' });
  }
};

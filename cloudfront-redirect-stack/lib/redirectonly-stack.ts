import { Stack, StackProps, RemovalPolicy, aws_cloudfront as cloudfront, aws_s3 as s3, aws_cloudfront_origins as origins } from 'aws-cdk-lib';

import { Construct } from 'constructs';
import * as fs from 'fs';

export class RedirectonlyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // CloudFront KeyValueStore
    const kvStore = new cloudfront.KeyValueStore(this, 'RedirectKvStore', {
      keyValueStoreName: 'RedirectKvStore',
      source: cloudfront.ImportSource.fromInline(JSON.stringify({
        data: [
          {
            key: "sample",
            value: "https://www.example.com/old"
          }
        ]
      }))
    });

    // CloudFront Function code
    const functionCode = fs.readFileSync('lib/redirect-function.js', 'utf8');

    // CloudFront Function
    const redirectFunction = new cloudfront.Function(this, 'RedirectFunction', {
      functionName: 'redirect-function',
      code: cloudfront.FunctionCode.fromInline(functionCode),
      keyValueStore: kvStore
    });

    // Minimal dummy origin for CloudFront (won't be hit if redirect matches)
    const dist = new cloudfront.Distribution(this, 'RedirectOnlyDistribution', {
      defaultBehavior: {
        origin: new origins.HttpOrigin('example.com'), // dummy
        functionAssociations: [{
          function: redirectFunction,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST
        }]
      },
      defaultRootObject: '',
      comment: 'CloudFront redirect-only distribution'
    });
  }
}

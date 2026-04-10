import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import { Construct } from "constructs";
import * as path from "path";

export class DastProcessorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Resolve context values with defaults
    const bucketName =
      (this.node.tryGetContext("bucketName") as string | undefined) ??
      "dast-reports";
    const securityHubRegion =
      (this.node.tryGetContext("securityHubRegion") as string | undefined) ??
      this.region;

    const companyName =
      (this.node.tryGetContext("companyName") as string | undefined) ??
      "My Company";

    // ── S3 Bucket ─────────────────────────────────────────────────────────────

    const reportsBucket = new s3.Bucket(this, "DastReportsBucket", {
      bucketName,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    // ── Lambda function ───────────────────────────────────────────────────────

    const processorFn = new NodejsFunction(this, "DastProcessorFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "../lambda/index.ts"),
      handler: "handler",
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        AWS_ACCOUNT_ID: this.account,
        AWS_REGION_NAME: this.region,
        SECURITY_HUB_REGION: securityHubRegion,
        COMPANY_NAME: companyName
      },
      bundling: {
        externalModules: [],
        minify: true,
        sourceMap: false,
        target: "node22",
      },
    });

    // ── IAM permissions ───────────────────────────────────────────────────────

    processorFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "S3ReadReports",
        actions: ["s3:GetObject", "s3:ListBucket"],
        resources: [reportsBucket.bucketArn, reportsBucket.arnForObjects("*")]
      })
    );

    processorFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "SecurityHubFindings",
        actions: [
          "securityhub:BatchImportFindings",
          "securityhub:GetFindings",
        ],
        resources: ["*"],
      })
    );

    // ── S3 event trigger ──────────────────────────────────────────────────────

    reportsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(processorFn),
      {
        prefix: "dast-reports/",
        suffix: "report_json.json",
      }
    );

    // ── Stack outputs ─────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, "DastReportsBucketName", {
      description: "Name of the S3 bucket storing DAST reports",
      value: reportsBucket.bucketName,
      exportName: `${this.stackName}-DastReportsBucketName`,
    });

    new cdk.CfnOutput(this, "DastReportsBucketArn", {
      description: "ARN of the S3 bucket storing DAST reports",
      value: reportsBucket.bucketArn,
      exportName: `${this.stackName}-DastReportsBucketArn`,
    });

    new cdk.CfnOutput(this, "DastProcessorFunctionArn", {
      description: "ARN of the DAST processor Lambda function",
      value: processorFn.functionArn,
      exportName: `${this.stackName}-DastProcessorFunctionArn`,
    });
  }
}

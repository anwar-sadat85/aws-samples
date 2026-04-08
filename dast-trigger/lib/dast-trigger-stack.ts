import * as cdk from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import * as path from "path";

export class DastTriggerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Resolve SSM paths from CDK context with sensible defaults
    const ssmConfigPath =
      (this.node.tryGetContext("ssmConfigPath") as string | undefined) ??
      "/dast/config";
    const ssmPatPath =
      (this.node.tryGetContext("ssmPatPath") as string | undefined) ??
      "/dast/github-pat";

    // ── SSM Parameters ────────────────────────────────────────────────────────

    // Create the DAST config parameter with a placeholder value.
    // Update the value after deployment with the real config JSON.
    const dastConfigParam = new ssm.StringParameter(this, "DastConfigParam", {
      parameterName: ssmConfigPath,
      description: "DAST trigger config — list of repos, branches, and workflow targets",
      stringValue: JSON.stringify({
        repos: [
          {
            repository: "org/repo-name",
            branches: ["uat"],
            workflow: "dast.yml",
            ref: "dev",
          },
        ],
      }),
    });

    // The GitHub PAT is a SecureString created out-of-band — reference only.
    const githubPatParam = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      "GithubPatParam",
      { parameterName: ssmPatPath }
    );

    // ── Lambda function ───────────────────────────────────────────────────────

    const dastTriggerFn = new NodejsFunction(this, "DastTriggerFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "../lambda/index.ts"),
      handler: "handler",
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        SSM_CONFIG_PATH: ssmConfigPath,
        SSM_PAT_PATH: ssmPatPath,
      },
      bundling: {        
        externalModules: [],
        minify: true,
        sourceMap: false,
        target: "node22",
      },
    });

    // ── IAM permissions ───────────────────────────────────────────────────────

    // Allow the Lambda to look up any Amplify app.
    // Amplify:GetApp does not support resource-level permissions — must use *.
    dastTriggerFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "AmplifyGetApp",
        actions: ["amplify:GetApp"],
        resources: ["*"],
      })
    );

    // Grant read access to the specific SSM parameters.
    dastConfigParam.grantRead(dastTriggerFn);
    githubPatParam.grantRead(dastTriggerFn);

    // ── EventBridge rule ──────────────────────────────────────────────────────

    const amplifySuccessRule = new events.Rule(this, "AmplifySuccessRule", {
      description:
        "Fires when an Amplify deployment succeeds; invokes the DAST trigger Lambda",
      eventPattern: {
        source: ["aws.amplify"],
        detailType: ["Amplify Deployment Status Change"],
        detail: {
          // Only care about successful deployments — branch/repo filtering is
          // handled inside the Lambda so the config can be updated without
          // redeploying the rule.
          jobStatus: ["SUCCEED"],
        },
      },
    });

    amplifySuccessRule.addTarget(new targets.LambdaFunction(dastTriggerFn));

    // ── Stack outputs ─────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, "DastTriggerFunctionArn", {
      description: "ARN of the DAST trigger Lambda function",
      value: dastTriggerFn.functionArn,
      exportName: `${this.stackName}-DastTriggerFunctionArn`,
    });

    new cdk.CfnOutput(this, "AmplifySuccessRuleArn", {
      description: "ARN of the EventBridge rule that monitors Amplify deployments",
      value: amplifySuccessRule.ruleArn,
      exportName: `${this.stackName}-AmplifySuccessRuleArn`,
    });
  }
}

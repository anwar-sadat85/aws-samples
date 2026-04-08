#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { DastTriggerStack } from "../lib/dast-trigger-stack";

const app = new cdk.App();

new DastTriggerStack(app, "DastTriggerStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description:
    "Lambda + EventBridge rule that triggers GitHub Actions DAST workflows on Amplify build success",
});

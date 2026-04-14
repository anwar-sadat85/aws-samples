#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { LoadTestTriggerStack } from "../lib/load-test-trigger-stack";

const app = new cdk.App();

new LoadTestTriggerStack(app, "LoadTestTriggerStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description:
    "EventBridge rule that triggers the load-test-dispatcher Lambda on Amplify UAT build success",
});

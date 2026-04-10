#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { DastProcessorStack } from "../lib/dast-processor-stack";

const app = new cdk.App();

new DastProcessorStack(app, "DastProcessorStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description:
    "S3 bucket + Lambda that processes ZAP DAST reports and imports findings into Security Hub",
});

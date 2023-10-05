# gasolina-aws

## Description
This repository provides Infrastructure-As-Code (IAC) for installing Gasolina on AWS via CDK.
- Bootstraps CDK
- Creates a VPC
- Uploads providers to S3
- Setup a CloudWatch log group
- Deploys the Gasolina API app on ECS
- Sets up a load balancer on Fargate to that has TLS
- Sets up API Gateway to route to the Gasolina API.

## Step-by-step instructions on setting up the infrastructure and deploying the Gasolina application

### 1. Setting up pre-requisites in AWS account
- Configure a mnemonic per signer in the Gasolina API. Go to Secret Manager in AWS store and create a new secret for mnemonics and path.
  - You want to store the secret as key-value pair. For a single secret:
  - For the mnemonic use the key: LAYERZERO_WALLET_MNEMONIC
  - For the PATH use the key: LAYERZERO_WALLET_PATH
- Bootstrap CDK if this is your first time using CDK in the AWS account. In `cdk/gasolina/` run:
```bash
cdk bootstrap 
```

### 2. Configuration of infra and application
- In `cdk/gasolina/config/index.ts` in the CONFIG object:
  - Configure the AWS account number for the key of the object.
  - Your unique project name `projectName` (this is used for your s3 bucket which needs to be globally unique on AWS)
  - The environment your API will be pointing to on layerzero (mainnet/testnet)
  - The chains your Gasolina app supports `availableChainNames` in comma seperated format e.g. `ethereum,bsc,avalanche`
- In `cdk/gasolina/config/providers/<environment>/providers.json` 
  - Configure all the RPC providers that you listed for the `availableChainNames` in the previous step.
- In `cdk/gasolina/config/walletConfig/<environment>.json`
  - Under `definitions`, add a Wallet Definition per Signer in Gasolina API that you registered in Secret Manager in the pre-requisites step.
    - Configure the `address` of the signer
    - Configure the `secretName` of that signer. This is used by the application to fetch the mnemonics when it needs to sign the payload

### 3. CDK Deploy
Setup infrastructure and deploy the Gasolina application.
In `cdk/gasolina/` run:
```bash
cdk deploy
```

### Coming soon:
- HSM setup on AWS

### Troubleshooting
#### 1. CDK Deploy failed and cannot redeploy because resource already exists
- Some resources have deletion projection policies. You will need to delete these resources before you can redeploy:
  - the CloudWatch log group: `GasolinaMetricLogGroup`
  - the S3 bucket: `providerconfigs-<projectName>-<environment>-gasolina`
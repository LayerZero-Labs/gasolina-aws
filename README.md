# gasolina-aws

## Description
This repository provides Infrastructure-As-Code (IAC) for installing Gasolina on AWS via CDK.
- Bootstraps CDK
- Creates a VPC
- Uploads providers to S3
- Setup a CloudWatch log group
- Deploys the Gasolina API app on ECS
- Sets up load balancer on Fargate in the VPC private subnet
- Sets up API Gateway to route to the Gasolina API (we don't expose the load balancer directly, API Gateway offers TLS without the need for a certificate)

## Step-by-step instructions on setting up the infrastructure and deploying the Gasolina application

### 1. Provide the LayerZero team with your AWS account number
The Gasolina image is currently hosted in a private ECR repository. In order to pull from it with this example repo. Provide the LayerZero team with your AWS account in and we will add it to our repository permissions.

### 2. Setup aws valid credentials
- Authenticate with AWS CLI with a valid method: https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-authentication.html

### 3. Setting up pre-requisites in AWS account
- Configure a mnemonic per signer in the Gasolina API. Go to Secret Manager in AWS store and create a new secret for mnemonics and path.
  - You want to store the secret as key-value pair. For a single secret:
  - For the mnemonic use the key: LAYERZERO_WALLET_MNEMONIC
  - For the PATH use the key: LAYERZERO_WALLET_PATH

![img.png](assets/secret-manager-setup.png)
- Bootstrap CDK if this is your first time using CDK in the AWS account. In `cdk/gasolina/` run:
```bash
cdk bootstrap 
```

### 4. Configuration of infra and application
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

### 5. CDK Deploy
Setup infrastructure and deploy the Gasolina application.
In `cdk/gasolina/` run:
```bash
cdk deploy
```
After the deploy is done, in the stdout you will see `Oracle.ApiGatewayUrl = <URL>`. 

### 6. Testing
Make an HTTP GET request to the ApiGatewayUrl at the following endpoint:
```
curl https://<ApiGatewayUrl>/signer-info?chainName=ethereum
```
If successful, you should see the signers registered on Gasolina API.

## Coming soon:
- HSM setup on AWS

## Troubleshooting
### 1. CDK Deploy failed and cannot redeploy because resource already exists
- Some resources have deletion projection policies. You will need to delete these resources before you can redeploy:
  - the CloudWatch log group: `GasolinaMetricLogGroup`
  - the S3 bucket: `providerconfigs-<projectName>-<environment>-gasolina`
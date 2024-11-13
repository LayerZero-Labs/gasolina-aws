# gasolina-aws

## Description

This repository provides Infrastructure-As-Code (IAC) for installing Gasolina on AWS via CDK.

-   Bootstraps CDK
-   Creates a VPC
-   Uploads providers to S3
-   Setup a CloudWatch log group
-   Deploys the Gasolina API app on ECS
-   Sets up load balancer on Fargate in the VPC private subnet
-   Sets up API Gateway to route to the Gasolina API (we don't expose the load balancer directly, API Gateway offers TLS without the need for a certificate)

## Step-by-step instructions on setting up the infrastructure and deploying the Gasolina application

### 1. Setup aws valid credentials

-   Authenticate with AWS CLI with a valid method: https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-authentication.html

### 2. Decide whether you want to use your own mnemonics or HSM-backed AWS KMS keys

-   If you want to use your own mnemonics you can configure a mnemonic per signer in the Gasolina API. Go to Secret Manager in AWS store and create a new secret for mnemonics and path.
    -   You want to store the secret as key-value pair. For a single secret:
    -   For the mnemonic use the key: LAYERZERO_WALLET_MNEMONIC
    -   For the PATH use the key: LAYERZERO_WALLET_PATH
-   If you want to use AWS KMS (backed by HSM), you can set this in your config and all key creation and registration into the application is done for you.

-   In the root directory of the project, run `yarn` to install all dependencies.

![img.png](assets/secret-manager-setup.png)

-   Edit `cdk/gasolina/bin/cdk.ts` and set the account and region
-   Bootstrap CDK if this is your first time using CDK in the AWS account. In `cdk/gasolina/` run:

```bash
cdk bootstrap --profile {...}
```

Note that the profile name depends on your local AWS config. Make sure to select the correct one based on the AWS
account you wish to operate on. You can also omit the --profile flag if you are using the default profile or if your
bash session has exported the AWS_PROFILE environment variable.

### 3. Configuration of infra and application
-   In `cdk/gasolina/lib/cdk-stack.ts` check whether the VPC cidr is acceptable, else update as needed
-   In `cdk/gasolina/config/index.ts` in the CONFIG object:
    -   Configure the AWS account number for the key of the object.
    -   `projectName`: Your unique project name (this is used for your s3 bucket which needs to be globally unique on AWS)
    -   `environment`: The environment your API will be pointing to on layerzero (mainnet/testnet)
    -   `availableChainNames`: The chains your Gasolina app supports in comma seperated format e.g. `ethereum,bsc,avalanche`
    -   `signerType`: Either `MNEMONIC` if you are using mnemonics stored in secret manager or `KMS` if you want CDK to set up asymmetric keys backed by HSM for you and register these keys into the Gasolina app.
        -   If `MNEMONIC`, the number of signers registered will be based on your wallet definitions in `walletConfig/<environment>.json`
        -   If `KMS`, you can optionally set `kmsNumOfSigners` in CONFIG. This value will create and register multiple keys into the same api
-   In `cdk/gasolina/config/providers/<environment>/providers.json`
    -   Configure all the RPC providers that you listed for the `availableChainNames` in the previous step.
-   In `cdk/gasolina/config/walletConfig/<environment>.json`
    -   Under `definitions`, add a Wallet Definition per Signer in Gasolina API that you registered in Secret Manager in the pre-requisites step.
        -   Configure the `address` of the signer
        -   Configure the `secretName` of that signer. This is used by the application to fetch the mnemonics when it needs to sign the payload

### [Optional] Setup Extra Context Verification

You can enhance message verification by adding your own custom rules.

To implement this, setup an API that would be called by gasolina whenever a message is received. The API will receive the complete context of the message, including additional onchain data, and will return a boolean value indicating whether the message can be signed.

API Input:

```typescript
{
    sentEvent: { // PacketSent event, emitted from the Endpoint contract
        lzMessageId: {
            pathwayId: {
                srcEid: number // Soure chain eid (https://github.com/LayerZero-Labs/LayerZero-v2/blob/main/packages/layerzero-v2/evm/protocol/contracts/EndpointV2.sol#L23)
                dstEid: number
                sender: string // Sender oapp address on source chain
                receiver: string // Receiver oapp address on destination chain
                srcChainName: string // Source Chain Name
                dstChainName: string // Destination Chain Name
            }
            nonce: number
            ulnSendVersion: UlnVersion
        }
        guid: string // onchain guid
        message: string
        options: {
            // Adapter Params set on the source transaction
            lzReceive?: {
                gas: string
                value: string
            }
            nativeDrop?: {
                amount: string
                receiver: string
            }[]
            compose?: {
                index: number
                gas: string
                value: string
            }[]
            ordered?: boolean
        }
        payload?: string
        sendLibrary?: string
        onChainEvent: { // Transaction on the source chain
            chainName: string
            txHash: string
            blockHash: string
            blockNumber: number
        }
    }
    from: string // Address of the sender
}
```

API Output:

-   The API is expected to return a boolean value indicating whether the message can be signed.

Setup:

-   In `cdk/gasolina/config/index.ts` in the CONFIG object:
    -   Set `extraContextGasolinaUrl` to the URL of your API

### 4. CDK Deploy

Setup infrastructure and deploy the Gasolina application.
In `cdk/gasolina/` run:

```bash
cdk deploy --profile {...}
```

After the deployment is done, in the stdout you will see `Oracle.ApiGatewayUrl = <URL>`. Send this URL over to LayerZeroLabs.

### 5. Testing

Make an HTTP GET request to the ApiGatewayUrl at the following endpoint:

```
curl https://<ApiGatewayUrl>/signer-info?chainName=ethereum
```

Example:
```bash
curl https://f5dju15cz3.execute-api.eu-west-2.amazonaws.com/signer-info?chainName=ethereum
```

If successful, you should see the signers registered on Gasolina API.

To test the API against a sample message, in the root directory run:

```bash
ts-node scripts/testDeployment -u <ApiGatewayUrl> -e <environment>
```

Example:
```bash
ts-node scripts/testDeployment -u https://f5dju15cz3.execute-api.eu-west-2.amazonaws.com -e mainnet
```

-   A successful response will look like:

```bash
--- [200] Successful request ---
Response: {
  signatures: [
    {
      signature: '<signature>',
      address: '<address>'
    },
    {
      signature: '<signature>',
      address: '<address>'
    }
  ]
}

```

## Troubleshooting

### 1. CDK Deploy failed and cannot redeploy because resource already exists

-   Some resources have deletion projection policies. You will need to delete these resources before you can redeploy:
    -   the CloudWatch log group: `GasolinaMetricLogGroup`
    -   the S3 bucket: `providerconfigs-<projectName>-<environment>-gasolina`

## Custom domain

Make sure you have a certificate in AWS ACM for the correct domain.
Head over ot the API gateway service, find the one associated with Gasolina and create a new custom domain.
Finally create an A record as an alias to that API gateway API in route53.
Potential future improvement: automate these steps in the cdk. Not worth yet as we performed this as a one time setup.

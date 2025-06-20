import * as apigwv2 from '@aws-cdk/aws-apigatewayv2-alpha'
import { HttpAlbIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha'
import { CfnOutput, RemovalPolicy, Stack, aws_kms } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3Deployment from 'aws-cdk-lib/aws-s3-deployment'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import path from 'path'

import { ENV_VAR_NAMES } from '../constants'
import { createApplicationLoadBalancedFargateService } from './constructs/fargate'

const serviceName = 'Gasolina'
const LAYERZERO_PREFIX = 'layerzero'

interface CreateGasolinaServiceProps {
    stack: Stack
    vpc: ec2.Vpc
    cluster: ecs.Cluster
    projectName: string
    stage: string
    environment: string
    minReplicas: number
    maxReplicas?: number
    walletConfigs: {
        definitions: {
            name: string
            byChainType: {
                [chainType: string]: { address: string; secretName: string }
            }
        }[]
    }
    signerType: string
    gasolinaRepo: string
    availableChainNames: string
    kmsNumOfSigners?: number
    extraContextRequestUrl?: string
    dataDogDomain?: string
    kmsKeyARN: string
}

export const createGasolinaService = (props: CreateGasolinaServiceProps) => {
    const workerRole = new iam.Role(props.stack, `${serviceName}Role`, {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    })

    workerRole.addManagedPolicy( // Add ECR read-only permissions
        iam.ManagedPolicy.fromAwsManagedPolicyName(
            'AmazonEC2ContainerRegistryReadOnly'
        )
    );

    workerRole.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
    )

    // Create a new metric log group
    new logs.LogGroup(props.stack, `${serviceName}MetricLogGroup`, {
        logGroupName: `${serviceName.toLocaleLowerCase()}-metric-log`,
    })

    // Create a new s3 bucket for providers
    const bucket = new s3.Bucket(
        props.stack,
        `ProviderConfigsBucket-${serviceName}`,
        {
            bucketName:
                `providerconfigs-${props.projectName}-${props.environment}-${serviceName}`.toLowerCase(),
            encryption: s3.BucketEncryption.KMS_MANAGED,
            publicReadAccess: false,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        },
    )

    // check if the providers file exists
    const providerConfigDir = path.join(
        __dirname,
        '../config/providers',
        props.stage,
        props.environment,
    )
    const providerConfigFile = path.join(providerConfigDir, 'providers.json')
    if (!require('fs').existsSync(providerConfigFile)) {
        throw new Error(
            `The expected provider configs folder does not exist: ${providerConfigFile}`,
        )
    }

    // upload the contents of the provider config dir to the s3 bucket
    new s3Deployment.BucketDeployment(
        props.stack,
        `ProviderConfigsBucketDeployment-${serviceName}`,
        {
            sources: [
                s3Deployment.Source.asset(providerConfigDir),
            ],
            destinationBucket: bucket,
        },
    )

    if (!['MNEMONIC', 'KMS'].includes(props.signerType)) {
        throw new Error('Invalid signer type - Use either MNEMONIC or KMS')
    }
    // If SIGNER_TYPE is KMS, create the KMS keys. The kmsKeyIds are required to register in the app.
    const kmsKeys: aws_kms.Key[] = []
    if (props.signerType === 'KMS') {
        const numOfSigners = props.kmsNumOfSigners || 1
        for (let i = 0; i < numOfSigners; i++) {
            const kmsKey = new aws_kms.Key(props.stack, `KMSGasolinaKey${i}`, {
                alias: `KMSGasolinaKey${i}`,
                description: 'HSM-KMS key for signing',
                keySpec: aws_kms.KeySpec.ECC_SECG_P256K1,
                keyUsage: aws_kms.KeyUsage.SIGN_VERIFY,
            })
            kmsKey.applyRemovalPolicy(RemovalPolicy.RETAIN)
            kmsKeys.push(kmsKey)
        }
    }

    // Add Docker secret
    // see https://docs.aws.amazon.com/AmazonECS/latest/developerguide/private-auth.html
    // required fields: 'username' and 'password'
    const dockerSecret = secretsmanager.Secret.fromSecretNameV2(
        props.stack,
        'DockerSecret',
        'docker/credentials'
    );

    const profile = props.stage == 'prod' ? 'prod' : 'dev';

    // Fargate service
    const service = createApplicationLoadBalancedFargateService(props.stack, {
        layerzeroPrefix: LAYERZERO_PREFIX,
        vpc: props.vpc,
        cluster: props.cluster,
        dockerImage: ecs.ContainerImage.fromRegistry(`${props.gasolinaRepo}`, {credentials: dockerSecret}),
        serviceName,
        workerRole: workerRole,
        minimumTaskCount: props.minReplicas,
        maximumTaskCount: props.maxReplicas,
        stage: props.stage,
        environment: {
            ...(props.dataDogDomain && {
                TRACING_ENABLED: 'true',
                PROFILING_ENABLED: 'false',
                DD_AGENT_HOST: 'localhost',
                DD_TRACE_AGENT_PORT: '8126',
                DD_DOGSTATSD_PORT: '8125',
                // DD_TRACE_DEBUG: 'true',
                METRICS_S3_ENABLED: 'true',
                METRICS_S3_BUCKET_NAME: 'layer0-dvn-' + profile,
            }),
            NPM_TOKEN: 'foobar',
            [ENV_VAR_NAMES.LZ_ENV]: props.environment,
            [ENV_VAR_NAMES.LZ_CDK_DEPLOY_REGION]: props.stack.region,
            SIGNER_TYPE: props.signerType,
            APP_PROFILE: profile,
            SERVER_PORT: '8081',
            [ENV_VAR_NAMES.LZ_SUPPORTED_ULNS]: JSON.stringify(['V2']),
            [ENV_VAR_NAMES.LZ_PROVIDER_BUCKET]: bucket.bucketName,
            [ENV_VAR_NAMES.LZ_METRIC_NAMESPACE]: `${LAYERZERO_PREFIX}-${serviceName.toLowerCase()}`,
            [ENV_VAR_NAMES.LZ_METRIC_LOG_GROUP_NAME]: `${serviceName.toLocaleLowerCase()}-metric-log`,
            [ENV_VAR_NAMES.LZ_PROVIDER_CONFIG_TYPE]: 'S3',
            [ENV_VAR_NAMES.LZ_AVAILABLE_CHAIN_NAMES]: props.availableChainNames,
            ...(props.signerType === 'MNEMONIC'
                ? {
                      [ENV_VAR_NAMES.LZ_WALLETS]: JSON.stringify(
                          props.walletConfigs.definitions,
                      ),
                  }
                : {}),
            ...(props.signerType === 'KMS'
                ? {
                      [ENV_VAR_NAMES.LZ_KMS_CLOUD_TYPE]: 'AWS',
                      [ENV_VAR_NAMES.LZ_KMS_IDS]: kmsKeys
                          .map((kmsKey) => kmsKey.keyId)
                          .join(','),
                  }
                : {}),
            ...(props.extraContextRequestUrl
                ? {
                      [ENV_VAR_NAMES.LZ_EXTRA_CONTEXT_REQUEST_URL]:
                          props.extraContextRequestUrl,
                  }
                : {}),
        },
        scaleOnNetwork: true,
        dataDogDomain: props.dataDogDomain,
    })

    // Grant service permissions
    bucket.grantRead(service.taskDefinition.taskRole)

    service.taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kms:Decrypt'],
        resources: [props.kmsKeyARN]
    }));

    if (props.signerType === 'MNEMONIC') {
        // If MNEMONIC grant service read access to secrets manager that you uploaded independently
        for (const walletDefinition of props.walletConfigs.definitions) {
            Object.keys(walletDefinition.byChainType).forEach((chainType) => {
                const secret = secretsmanager.Secret.fromSecretNameV2(
                    props.stack,
                    `${walletDefinition.byChainType[chainType].secretName}Gasolina`,
                    walletDefinition.byChainType[chainType].secretName,
                )
                secret.grantRead(service.taskDefinition.taskRole)
            })
        }
    } else if (props.signerType === 'KMS') {
        // If KMS grant service ability to get publicKey, sign and verify
        for (const kmsKey of kmsKeys) {
            kmsKey.grant(
                service.taskDefinition.taskRole,
                'kms:GetPublicKey',
                'kms:Sign',
                'kms:Verify',
            )
        }
    }

    const apiGateway = new apigwv2.HttpApi(props.stack, 'HttpProxyPrivateApi', {
        defaultIntegration: new HttpAlbIntegration(
            'DefaultIntegration',
            service.listener,
        ),
    })

    new CfnOutput(props.stack, 'ApiGatewayUrl', {
        value: apiGateway.url!,
        description: 'The URL of the API Gateway',
        exportName: 'ApiGatewayUrl',
    })
}

import * as apigwv2 from '@aws-cdk/aws-apigatewayv2-alpha'
import { HttpAlbIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha'
import { CfnOutput, Stack } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecr from 'aws-cdk-lib/aws-ecr'
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
    environment: string
    walletConfigs: {
        definitions: {
            name: string
            byChainType: {
                [chainType: string]: { address: string; secretName: string }
            }
        }[]
    }
    verifyAndDeliverConfig: {
        contractAddresses: {
            [chainName: string]: string
        }
    }
    signerType: string
    ecrRepositoryArn: string
    appVersion: string
    availableChainNames: string
}

export const createGasolinaService = (props: CreateGasolinaServiceProps) => {
    const workerRole = new iam.Role(props.stack, `${serviceName}Role`, {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    })

    const walletDefinitions = props.walletConfigs.definitions
    const whitelistedContracts = props.verifyAndDeliverConfig.contractAddresses

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

    new s3Deployment.BucketDeployment(
        props.stack,
        `ProviderConfigsBucketDeployment-${serviceName}`,
        {
            sources: [
                s3Deployment.Source.asset(
                    path.join(
                        __dirname,
                        '../config/providers',
                        props.environment,
                    ),
                ),
            ],
            destinationBucket: bucket,
        },
    )

    const repository = ecr.Repository.fromRepositoryArn(
        props.stack,
        `EcrRepository-${serviceName}`,
        props.ecrRepositoryArn,
    )

    // Fargate service
    const service = createApplicationLoadBalancedFargateService(props.stack, {
        layerzeroPrefix: LAYERZERO_PREFIX,
        vpc: props.vpc,
        cluster: props.cluster,
        dockerImage: ecs.ContainerImage.fromEcrRepository(
            repository,
            props.appVersion,
        ),
        serviceName,
        workerRole: workerRole,
        minimumTaskCount: 2,
        environment: {
            NPM_TOKEN: 'foobar',
            [ENV_VAR_NAMES.LZ_ENV]: props.environment,
            [ENV_VAR_NAMES.LZ_WALLETS]: JSON.stringify(walletDefinitions),
            SIGNER_TYPE: props.signerType,
            SERVER_PORT: '8081',
            [ENV_VAR_NAMES.LZ_SUPPORTED_ULNS]: JSON.stringify(['V2']),
            [ENV_VAR_NAMES.LZ_PROVIDER_BUCKET]: bucket.bucketName,
            [ENV_VAR_NAMES.LZ_METRIC_NAMESPACE]: `${LAYERZERO_PREFIX}-${serviceName.toLowerCase()}`,
            [ENV_VAR_NAMES.LZ_METRIC_LOG_GROUP_NAME]: `${serviceName.toLocaleLowerCase()}-metric-log`,
            [ENV_VAR_NAMES.LZ_PROVIDER_CONFIG_TYPE]: 'S3',
            [ENV_VAR_NAMES.LZ_VERIFY_AND_DELIVER_WHITELIST]:
                JSON.stringify(whitelistedContracts),
            [ENV_VAR_NAMES.LZ_AVAILABLE_CHAIN_NAMES]: props.availableChainNames,
        },
        scaleOnNetwork: true,
    })

    bucket.grantRead(service.taskDefinition.taskRole)

    for (const walletDefinition of walletDefinitions) {
        Object.keys(walletDefinition.byChainType).forEach((chainType) => {
            const secret = secretsmanager.Secret.fromSecretNameV2(
                props.stack,
                `${walletDefinition.byChainType[chainType].secretName}Gasolina`,
                walletDefinition.byChainType[chainType].secretName,
            )
            secret.grantRead(service.taskDefinition.taskRole)
        })
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

import { Stack, StackProps } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import { Construct } from 'constructs'

const NPM_TOKEN_ENV_VAR_NAME = 'NPM_TOKEN'

export interface WalletDefinition {
    name: string
    byChainType: {
        [chainType: string]: {
            address: string
            secretName: string
        }
    }
}

export class LZCdkStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props)
        LZCdkStack.ensureEnvVarIsDefined(NPM_TOKEN_ENV_VAR_NAME)
        if (
            process.arch?.toLowerCase() === 'arm64' &&
            process.env?.DOCKER_DEFAULT_PLATFORM !== 'linux/amd64'
        ) {
            throw new Error(
                `CDK deployment from an arm64 system requires setting DOCKER_DEFAULT_PLATFORM=linux/amd64`,
            )
        }
    }

    private static ensureEnvVarIsDefined(envVarName: string) {
        if (!process.env[envVarName]) {
            throw new Error(
                `${envVarName} env var needs to be set before running CDK`,
            )
        }
    }

    protected createVpc(
        id: string = 'TheVPC',
        cidr: string = '10.0.0.0/16',
    ): ec2.Vpc {
        return new ec2.Vpc(this, id, { cidr })
    }

    protected createFargateEcsCluster(
        vpc: ec2.Vpc,
        id: string = 'ECSCluster',
        containerInsights: boolean = true,
    ): ecs.Cluster {
        return new ecs.Cluster(this, id, {
            vpc,
            enableFargateCapacityProviders: true,
            containerInsights,
        })
    }
}

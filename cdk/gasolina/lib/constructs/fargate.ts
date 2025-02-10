import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib'
import * as cw from 'aws-cdk-lib/aws-cloudwatch'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecsPatern from 'aws-cdk-lib/aws-ecs-patterns'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { ContainerDependency } from 'aws-cdk-lib/aws-ecs/lib/container-definition'


export interface CreateFargateProps {
    layerzeroPrefix: string
    vpc: ec2.IVpc
    cluster: ecs.ICluster
    dockerImage: ecs.ContainerImage
    workerRole: iam.IRole
    minimumTaskCount: number
    maximumTaskCount?: number
    minHealthyPercent?: number
    maxHealthyPercent?: number
    serviceName: string
    environment: { [key: string]: string }
    stage: string
    scaleOnNetwork?: boolean
    dataDogLogDomain?: string
}

const createTaskDefinition = (
    stack: Stack,
    props: CreateFargateProps,
): ecs.TaskDefinition => {
    const serviceLogGroup = new logs.LogGroup(
        stack,
        `${props.serviceName}ServiceLogGroup`,
        {
            logGroupName: `${props.layerzeroPrefix}-${props.serviceName.toLocaleLowerCase()}`,
        },
    )
    serviceLogGroup.applyRemovalPolicy(RemovalPolicy.DESTROY)

    // useful for debugging FireLens (which propagates service logs to DataDog)
    const firelensLogGroup = new logs.LogGroup(
        stack,
        `${props.serviceName}FirelensLogGroup`,
        {
            logGroupName: `${props.layerzeroPrefix}-${props.serviceName.toLowerCase()}-firelens`,
            removalPolicy: RemovalPolicy.DESTROY,
        }
    );

    const taskDefinition = new ecs.TaskDefinition(
        stack,
        `${props.serviceName}TaskDefinition`,
        {
            compatibility: ecs.Compatibility.FARGATE,
            cpu: '1024',
            memoryMiB: '2048',
            taskRole: props.workerRole,
        },
    )

    const datadogApiKey = secretsmanager.Secret.fromSecretNameV2(
        stack,
        'DatadogApiKey',
        'datadog/api-key'
    );
    datadogApiKey.grantRead(taskDefinition.taskRole)

    const workerProps = {
        image: props.dockerImage,
        environment: props.environment,
        healthCheck: {
            command: [
                'CMD-SHELL',
                'curl -f http://localhost:8081/ || exit 1',
            ],
            interval: Duration.seconds(10),
            retries: 6,
            startPeriod: Duration.seconds(5),
            timeout: Duration.seconds(5),
        },
        logging: ecs.LogDriver.awsLogs({
            logGroup: serviceLogGroup,
            streamPrefix: 'container',
        }),
        memoryLimitMiB: 1400,
        // uncomment to enable ECS exec for debugging
        // enableExecuteCommand: true,
        cpu: 700,
        stopTimeout: Duration.seconds(15),
        portMappings: [
            {
                containerPort: 8081,
                hostPort: 8081,
                protocol: ecs.Protocol.TCP,
            },
        ],
    }

    if (props.dataDogLogDomain) {
        workerProps.logging = new ecs.FireLensLogDriver({
            options: {
                "Name": "datadog",
                'apikey': datadogApiKey.secretValueFromJson('key').unsafeUnwrap(),
                'Host': props.dataDogLogDomain,
                'dd_service': props.serviceName,
                'dd_source': 'fargate',
                'dd_message_key': 'log',
                'dd_tags': `env:${props.stage}`,
                'TLS': 'on',
                'provider': 'ecs',
            },
        })
    }

    const workerTaskDefinition = taskDefinition.addContainer(
        `${props.serviceName}Worker`, workerProps
    )
    const deps: ContainerDependency[] = []

    if (props.dataDogLogDomain) {
        const firelensContainer = taskDefinition.addFirelensLogRouter('firelens',
            {
                essential: true,
                image: ecs.ContainerImage.fromRegistry(
                    'amazon/aws-for-fluent-bit:stable',
                ),
                firelensConfig: {
                    type: ecs.FirelensLogRouterType.FLUENTBIT,
                    options: {
                        enableECSLogMetadata: true,
                    }
                },
                memoryLimitMiB: 128,
                cpu: 100,
                // FireLens internal logs go to CloudWatch
                logging: ecs.LogDriver.awsLogs({
                    streamPrefix: 'firelens',
                    logGroup: firelensLogGroup,
                }),
                // Dummy port mappings to satisfy CDK, but they aren't really necessary
                portMappings: [
                    {
                        containerPort: 8125,  // Dummy port
                        protocol: ecs.Protocol.TCP
                    }
                ],
                // Fake health check for FireLens
                healthCheck: {
                    command: [
                        'CMD-SHELL',
                        'echo healthy',
                    ],
                    interval: Duration.seconds(30),
                    timeout: Duration.seconds(5),
                    retries: 3,
                    startPeriod: Duration.seconds(10),
                },
            }
        );
        firelensContainer.addUlimits({
            hardLimit: 65535,
            name: ecs.UlimitName.NOFILE,
            softLimit: 65535,
        })
        deps.push({ container: firelensContainer, condition: ecs.ContainerDependencyCondition.HEALTHY })
    }


    const cwAgentLogGroup = new logs.LogGroup(
        stack,
        `${props.serviceName}CWAgentLogGroup`,
        {
            logGroupName: `${
                props.layerzeroPrefix
            }-${props.serviceName.toLocaleLowerCase()}-cw-agent`,
        },
    )

    cwAgentLogGroup.applyRemovalPolicy(RemovalPolicy.DESTROY)

    const cloudwatchAgentTaskDefinition = taskDefinition.addContainer(
        `${props.serviceName}cw-agent`,
        {
            image: ecs.ContainerImage.fromRegistry(
                'public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest',
            ),
            memoryLimitMiB: 384,
            cpu: 200,
            environment: {
                CW_CONFIG_CONTENT: '{"logs":{"metrics_collected":{"emf":{}}}}',
            },
            logging: ecs.LogDriver.awsLogs({
                logGroup: cwAgentLogGroup,
                streamPrefix: 'cw-agent',
            }),
            portMappings: [
                {
                    containerPort: 25888,
                    hostPort: 25888,
                    protocol: ecs.Protocol.TCP,
                },
            ],
            healthCheck: {
                command: [
                    'CMD',
                    '/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent',
                    '--version',
                ],
                interval: Duration.seconds(30),
                timeout: Duration.seconds(5),
                retries: 3,
                startPeriod: Duration.seconds(60),
            },
        },
    )
    deps.push({ container: cloudwatchAgentTaskDefinition, condition: ecs.ContainerDependencyCondition.HEALTHY })

    workerTaskDefinition.addContainerDependencies(...deps)

    workerTaskDefinition.addUlimits({
        hardLimit: 65535,
        name: ecs.UlimitName.NOFILE,
        softLimit: 65535,
    })

    cloudwatchAgentTaskDefinition.addUlimits({
        hardLimit: 65535,
        name: ecs.UlimitName.NOFILE,
        softLimit: 65535,
    })

    return taskDefinition
}

const autoScaleTaskCount = (props: {
    layerzeroPrefix: string
    serviceName: string
    service: ecs.FargateService
    minimumTaskCount: number
    maximumTaskCount?: number
    scaleOnNetwork?: boolean
}) => {
    // Keep a minimum task count of minimumTaskCount (or 2 if not specified), and a maximum of 50.
    const scalableTaskCount = props.service.autoScaleTaskCount({
        minCapacity: props.minimumTaskCount,
        maxCapacity: props.maximumTaskCount || 50,
    })
    scalableTaskCount.scaleOnCpuUtilization(
        `${props.serviceName}CpuUtilizationScaling`,
        {
            targetUtilizationPercent: 50,
        },
    )

    scalableTaskCount.scaleOnMemoryUtilization(
        `${props.serviceName}MemoryUtilizationScaling`,
        {
            targetUtilizationPercent: 50,
        },
    )

    if (props.scaleOnNetwork) {
        ;[
            { name: 'Rx', highBound: 500000, lowBound: 200000 },
            { name: 'Tx', highBound: 150000, lowBound: 80000 },
        ].forEach(({ name, highBound, lowBound }) => {
            scalableTaskCount.scaleOnMetric(
                `${props.serviceName}${name}UtilizationScaling`,
                {
                    metric: new cw.Metric({
                        namespace: 'ECS/ContainerInsights',
                        metricName: `Network${name}Bytes`,
                        statistic: cw.Statistic.AVERAGE,
                        period: Duration.minutes(5),
                        dimensionsMap: {
                            ClusterName: props.service.cluster.clusterName,
                            ServiceName: `${
                                props.layerzeroPrefix
                            }-${props.serviceName.toLocaleLowerCase()}`,
                        },
                    }),
                    scalingSteps: [
                        { change: 1, lower: highBound },
                        { change: -1, upper: lowBound },
                    ],
                    cooldown: Duration.seconds(300),
                },
            )
        })
    }
}

export const createApplicationLoadBalancedFargateService = (
    stack: Stack,
    props: CreateFargateProps,
): ecsPatern.ApplicationLoadBalancedFargateService => {
    const taskDefinition = createTaskDefinition(stack, props)

    const lbservice = new ecsPatern.ApplicationLoadBalancedFargateService(
        stack,
        `${props.serviceName}FargateLB`,
        {
            cluster: props.cluster,
            taskDefinition,
            minHealthyPercent: 100,
            maxHealthyPercent: 200,
            taskSubnets: props.vpc.selectSubnets({
                subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
            }),
            serviceName: `${
                props.layerzeroPrefix
            }-${props.serviceName.toLocaleLowerCase()}`,
            publicLoadBalancer: false,
            listenerPort: 8081,
            enableExecuteCommand: true,
        },
    )

    autoScaleTaskCount({
        layerzeroPrefix: props.layerzeroPrefix,
        serviceName: props.serviceName,
        service: lbservice.service,
        minimumTaskCount: props.minimumTaskCount,
        maximumTaskCount: props.maximumTaskCount,
        scaleOnNetwork: props.scaleOnNetwork,
    })

    return lbservice
}

import { StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import fs from 'fs'
import path from 'path'

import { CONFIG } from '../config'
import { LZCdkStack } from './cdk-stack'
import { createGasolinaService } from './gasolinaApi'

export class GasolinaCdkStack extends LZCdkStack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props)

        const config = CONFIG[this.account]
        if (!config) {
            throw new Error(`No config found for account: ${this.account}`)
        }

        const vpc = this.createVpc()
        const cluster = this.createFargateEcsCluster(vpc)

        if (!config.environment) {
            throw new Error('environment not set in config')
        }
        if (!fs.existsSync(path.join(__dirname, `../config/walletConfig/${config.stage}/${config.environment}.json`))) {
            throw new Error(`walletConfig file not found for environment: ${config.environment}`)
        }

        const walletConfigs = JSON.parse(
            fs.readFileSync(
                path.join(
                    __dirname,
                    `../config/walletConfig/${config.stage}/${config.environment}.json`,
                ),
                'utf8',
            ),
        )

        createGasolinaService({
            stack: this,
            vpc,
            cluster,
            projectName: config.projectName,
            stage: config.stage,
            environment: config.environment,
            walletConfigs,
            gasolinaRepo: config.gasolinaRepo,
            availableChainNames: config.availableChainNames,
            signerType: config.signerType,
            kmsNumOfSigners: config.kmsNumOfSigners,
            extraContextRequestUrl: config.extraContextRequestUrl,
            dataDogDomain: config.dataDogDomain,
            minReplicas: config.minReplicas,
            maxReplicas: config.maxReplicas,
            kmsKeyARN: config.kmsKeyARN,
        })
    }
}

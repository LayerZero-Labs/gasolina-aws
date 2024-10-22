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

        const vpc = this.createVpc()
        const cluster = this.createFargateEcsCluster(vpc)

        const walletConfigs = JSON.parse(
            fs.readFileSync(
                path.join(
                    __dirname,
                    `../config/walletConfig/${config.environment}.json`,
                ),
                'utf8',
            ),
        )

        createGasolinaService({
            stack: this,
            vpc,
            cluster,
            projectName: config.projectName,
            environment: config.environment,
            walletConfigs,
            gasolinaRepo: config.gasolinaRepo,
            appVersion: config.appVersion,
            availableChainNames: config.availableChainNames,
            signerType: config.signerType,
            kmsNumOfSigners: config.kmsNumOfSigners,
            extraContextRequestUrl: config.extraContextRequestUrl,
        })
    }
}

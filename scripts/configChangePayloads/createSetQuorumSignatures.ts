import fs from 'fs'
import path from 'path'
import { parse } from 'ts-command-line-args'

import { AwsKmsKey } from './kms'
import {
    getSetQuorumCallData,
    getSignatures,
    getSignaturesPayload,
    getVId,
    hashCallData,
} from './utils'

const PATH = path.join(__dirname)
const FILE_PATH = `${PATH}/quorum-change-payloads.json`
const EXPIRATION = Date.now() + 7 * 24 * 60 * 60 * 1000 // 1 week expiration from now

/**
 * This script creates signature payloads to be submitted by an Admin of the DVN contract
 * that will change the quorum of the DVN contract
 */

const args = parse({
    environment: {
        alias: 'e',
        type: String,
        defaultValue: 'mainnet',
        description: 'environment',
    },
    chainNames: {
        alias: 'c',
        type: String,
        description: 'comma separated list of chain names',
    },
    oldQuorum: {
        type: Number,
        description:
            'old quorum, which is number of signatures required for change to happen',
    },
    newQuorum: {
        type: Number,
        description: 'new quorum',
    },
})

const main = async () => {
    const { environment, chainNames, oldQuorum, newQuorum } = args

    const dvnAddresses = require(`./data/dvn-addresses-${environment}.json`)

    const keyIds: AwsKmsKey[] = require(`./data/kms-keyids-${environment}.json`)

    const availableChainNames = chainNames.split(',')

    const results: { [chainName: string]: any } = {}
    await Promise.all(
        availableChainNames.map(async (chainName) => {
            results[chainName] = results[chainName] || {}
            const vId = getVId(chainName, environment)
            const callData = await getSetQuorumCallData(
                dvnAddresses[chainName],
                newQuorum,
                chainName,
                environment,
            )

            const hash = await hashCallData(
                dvnAddresses[chainName],
                vId,
                EXPIRATION,
                callData,
                chainName,
                environment,
            )

            const signatures = await getSignatures(keyIds, hash, chainName)
            const signaturesPayload = getSignaturesPayload(
                signatures,
                oldQuorum,
                chainName,
            )

            let outputCallData: any
            if (['aptos', 'initia', 'movement', 'ton'].includes(chainName)) {
                outputCallData = {
                    newQuorum,
                }
            } else {
                outputCallData = callData
            }

            results[chainName] = {
                args: {
                    target: dvnAddresses[chainName],
                    signatures: signaturesPayload,
                    callData: outputCallData,
                    expiration: EXPIRATION,
                    vid: vId,
                },
                info: {
                    signatures,
                    hashCallData: hash,
                    oldQuorum,
                    newQuorum,
                },
            }
        }),
    )
    fs.writeFileSync(FILE_PATH, JSON.stringify(results, null, 4))
    console.log(`Results written to: ${FILE_PATH}`)
}

main()
    .then(() => {
        process.exit(0)
    })
    .catch((err: any) => {
        console.error(err)
        process.exit(1)
    })

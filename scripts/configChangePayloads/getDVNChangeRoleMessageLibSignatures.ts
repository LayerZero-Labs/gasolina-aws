import { ethers } from 'ethers'
import fs from 'fs'
import path from 'path'
import { parse } from 'ts-command-line-args'

import { AwsKmsKey, getAwsKmsSigners } from './kms'
import {
    getSignatures,
    getSignaturesPayload,
    getVId,
    hashCallData,
} from './utils'

const PATH = path.join(__dirname)

const getSaveFilePath = (access: number) => {
    return `${PATH}/${access === 0 ? 'grant' : 'revoke'}-role-payloads.json`
}
const EXPIRATION = Date.now() + 7 * 24 * 60 * 60 * 1000 // 1 week expiration from now

/**
 * This script creates signature payloads to be submitted by an Admin of the DVN contract
 * that will grant or revoke a role to an address
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
    messageLibAddress: {
        alias: 'm',
        type: String,
        description: 'address of the message library',
    },
    quorum: {
        alias: 'q',
        type: Number,
        description: 'number of signatures required for quorum',
    },
    access: {
        alias: 'a',
        type: Number, // Not a boolean to make it required in the command line, so users be explicit about it
        description: 'set 0 to grant role or 1 to revoke role',
    },
})

const grantRoleFunctionSig =
    'function grantRole(bytes32 _role, address _account)'

const revokeRoleFunctionSig =
    'function revokeRole(bytes32 _role, address _account)'

const MESSAGE_LIB_ROLE = ethers.utils.keccak256(Buffer.from('MESSAGE_LIB_ROLE'))

const iface = new ethers.utils.Interface([
    grantRoleFunctionSig,
    revokeRoleFunctionSig,
])

const getCallData = (address: string, access: number) => {
    return iface.encodeFunctionData(access === 0 ? 'grantRole' : 'revokeRole', [
        MESSAGE_LIB_ROLE,
        address,
    ])
}

const main = async () => {
    const { environment, chainNames, messageLibAddress, quorum, access } = args

    // validate inputs
    if (!['0', '1'].includes(access.toString())) {
        throw new Error('access must be 0 or 1')
    }

    const dvnAddresses = require(`./data/dvn-addresses-${environment}.json`)

    const keyIds: AwsKmsKey[] = require(`./data/kms-keyids-${environment}.json`)

    const signers = await getAwsKmsSigners(keyIds)

    const availableChainNames = chainNames.split(',')

    const results: { [chainName: string]: any } = {}
    await Promise.all(
        availableChainNames.map(async (chainName) => {
            results[chainName] = results[chainName] || {}
            const vId = getVId(chainName, environment)
            // fetch the message library address from packages
            const callData = getCallData(messageLibAddress, access)

            const hash = hashCallData(
                dvnAddresses[chainName],
                vId,
                EXPIRATION,
                callData,
            )

            const signatures = await getSignatures(signers, hash)
            const signaturesPayload = getSignaturesPayload(signatures, quorum)

            results[chainName] = {
                args: {
                    target: dvnAddresses[chainName],
                    signatures: signaturesPayload,
                    callData,
                    expiration: EXPIRATION,
                    vid: vId,
                },
                info: {
                    signatures,
                    hashCallData: hash,
                    address: messageLibAddress,
                    vId,
                    accessSignature:
                        access === 0
                            ? grantRoleFunctionSig
                            : revokeRoleFunctionSig,
                },
            }
        }),
    )
    const filePath = getSaveFilePath(access)
    fs.writeFileSync(filePath, JSON.stringify(results))
    console.log(`Results written to: ${filePath}`)
}

main()
    .then(() => {
        process.exit(0)
    })
    .catch((err: any) => {
        console.error(err)
        process.exit(1)
    })

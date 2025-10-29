import * as sha3 from '@noble/hashes/sha3'
import * as web3 from '@solana/web3.js'
import { Dictionary } from '@ton/core'
import BN from 'bn.js'
import * as base58 from 'bs58'
import { ethers } from 'ethers'
import { ExtendedBuffer } from 'extended-buffer'

import {
    Chain,
    EndpointVersion,
    Stage,
    chainAndStageToEndpointId,
} from '@layerzerolabs/lz-definitions'
import { bcsSerializeBytes } from '@layerzerolabs/lz-serdes'
import { DVNProgram } from '@layerzerolabs/lz-solana-sdk-v2'
import {
    OPCODES,
    addressToBigInt,
    addressToHex,
    buildClass,
    decodeClass,
    emptyCell,
} from '@layerzerolabs/lz-ton-sdk-v2'

import { AwsKmsKey, getAwsKmsSigners, signUsingAwsKmsClinet } from './kms'
import { getImplementationContract, getTonProvider } from './tonUtils'

export interface Signature {
    signature: string
    address: string
}

export function getVId(chainName: string, environment: string): string {
    // By convention the vid is always the endpointV1 chainId
    if (['solana', 'ton', 'initia', 'movement'].includes(chainName)) {
        const eid = chainAndStageToEndpointId(
            chainName as Chain,
            environment as Stage,
            EndpointVersion.V2,
        ).toString()
        return (parseInt(eid) % 30000).toString()
    }
    return chainAndStageToEndpointId(
        chainName as Chain,
        environment as Stage,
        EndpointVersion.V1,
    ).toString()
}

export function trim0x(str: string): string {
    return str.replace(/^0x/, '')
}

export function ensure0xPrefixed(str: string): string {
    return `0x${trim0x(str)}`
}

export function hexToUint8Array(hexString: string): Uint8Array {
    return Uint8Array.from(Buffer.from(trim0x(hexString), 'hex'))
}

export function bytesToHex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('hex')
}

export function bytesToHexPrefixed(bytes: Uint8Array): string {
    return ensure0xPrefixed(bytesToHex(bytes))
}

export function stringToUint8Array(str: string): Uint8Array {
    const value = str.replace(/^0x/i, '')
    const len = value.length + 1 - ((value.length + 1) % 2)
    return Uint8Array.from(Buffer.from(value.padStart(len, '0'), 'hex'))
}

export function getFunctionSignatureHash(funcName: string): string {
    const encoded_data = new ExtendedBuffer()
    const funcNameHexStr = Buffer.from(funcName).toString('hex')
    const funcNameBcs = bcsSerializeBytes(stringToUint8Array(funcNameHexStr))
    encoded_data.writeBuffer(Buffer.from(funcNameBcs))
    return bytesToHex(
        sha3.keccak_256(Uint8Array.from(encoded_data.buffer)),
    ).slice(0, 8)
}

export async function hashCallData(
    target: string,
    vId: string,
    expiration: number,
    callData: string,
    chainName: string,
    environment: string,
): Promise<string> {
    if (chainName == 'solana') {
        const dvnProgramId = await getSolanaDvnProgramId(target, environment)
        const digest: DVNProgram.types.ExecuteTransactionDigest = {
            vid: parseInt(vId),
            programId: dvnProgramId,
            accounts: [],
            data: hexToUint8Array(callData),
            expiration: expiration,
        }
        const [digestBytes] =
            DVNProgram.types.executeTransactionDigestBeet.serialize(digest)
        return bytesToHex(sha3.keccak_256(Uint8Array.from(digestBytes)))
    } else if (['aptos', 'initia', 'movement'].includes(chainName)) {
        const encoded_data = new ExtendedBuffer()
        encoded_data.writeBuffer(Buffer.from(stringToUint8Array(callData)))
        encoded_data.writeBuffer(
            new BN(vId.toString()).toArrayLike(Buffer, 'be', 4),
        )
        encoded_data.writeBuffer(
            new BN(expiration.toString()).toArrayLike(Buffer, 'be', 8),
        )
        return bytesToHex(sha3.keccak_256(Uint8Array.from(encoded_data.buffer)))
    } else if (chainName == 'ton') {
        // For TON, we use the TON sdk hash function when building the call data, so call data is already hashed
        return callData
    } else {
        // Assuming chain is EVM based
        return ethers.utils.keccak256(
            ethers.utils.solidityPack(
                ['uint32', 'address', 'uint', 'bytes'],
                [vId, target, expiration, callData],
            ),
        )
    }
}

export async function getSignatures(
    keyIds: AwsKmsKey[],
    hash: string,
    chainName: string,
): Promise<Signature[]> {
    if (['solana', 'aptos', 'initia', 'movement', 'ton'].includes(chainName)) {
        return await Promise.all(
            keyIds.map(async (keyId) => signUsingAwsKmsClinet(keyId, hash)),
        )
    } else {
        const signers = await getAwsKmsSigners(keyIds)
        return await Promise.all(
            signers.map(async (signer) => ({
                signature: await signer.signMessage(
                    ethers.utils.arrayify(hash),
                ),
                address: await signer.getAddress(),
            })),
        )
    }
}

export function getSignaturesPayload(
    signatures: Signature[],
    quorum: number,
    chainName: string,
): string | string[] | Signature[] {
    if (chainName == 'solana') {
        // For solana, we need to return an array of signatures
        return signatures.slice(0, quorum).map((s: Signature) => s.signature)
    } else if (chainName == 'ton') {
        // For ton, we need to have signatrues associated with their respective address
        return signatures
    } else {
        signatures.sort((a: Signature, b: Signature) =>
            a.address.localeCompare(b.address),
        )
        const signaturesForQuorum = signatures.slice(0, quorum)
        return ethers.utils.solidityPack(
            signaturesForQuorum.map(() => 'bytes'),
            signaturesForQuorum.map((s: Signature) => s.signature),
        )
    }
}

function getSolanaProvider(environment: string) {
    const providers = require(`../../cdk/gasolina/config/providers/${environment}/providers.json`)
    return new web3.Connection(providers['solana'].uris[0], 'confirmed')
}

async function getSolanaDvnProgramId(target: string, environment: string) {
    const pdaAccountInfo = await getSolanaProvider(environment).getAccountInfo(
        new web3.PublicKey(base58.decode(target)),
    )
    const dvnProgramId = pdaAccountInfo!.owner
    return dvnProgramId
}

export async function getSetQuorumCallData(
    target: string,
    newQuorum: number,
    chainName: string,
    environment: string,
): Promise<string> {
    if (chainName == 'solana') {
        const dvnProgramId = await getSolanaDvnProgramId(target, environment)
        const dvnProgram = new DVNProgram.DVN(dvnProgramId)
        const instruction = dvnProgram.createSetQuorumInstruction(newQuorum)
        return bytesToHex(Uint8Array.from(instruction.data))
    } else if (['aptos', 'initia', 'movement'].includes(chainName)) {
        const encoded_data = new ExtendedBuffer()
        encoded_data.writeBuffer(
            Buffer.from(
                stringToUint8Array(getFunctionSignatureHash('set_quorum')),
            ),
        )
        encoded_data.writeBuffer(new BN(newQuorum).toArrayLike(Buffer, 'be', 8))
        return encoded_data.buffer.toString('hex')
    } else if (chainName == 'ton') {
        const provider = getTonProvider(environment)
        const dvn = await getImplementationContract(provider, target)
        const dvnStorage = decodeClass('Dvn', await dvn.getCurrentStorageCell())
        const setQuorumCallData = buildClass('md::SetQuorum', {
            nonce: dvnStorage.setQuorumNonce,
            opcode: OPCODES.Dvn_OP_SET_QUORUM,
            quorum: newQuorum,
            target: dvn.address,
        })
        return setQuorumCallData.hash().toString('hex')
    } else {
        // Assuming chain is EVM based
        const setQuorumFunctionSig = 'function setQuorum(uint64 _quorum)'
        const iface = new ethers.utils.Interface([setQuorumFunctionSig])
        return iface.encodeFunctionData('setQuorum', [newQuorum])
    }
}

export async function getAddOrRemoveSignerCallData(
    target: string,
    signerAddress: string,
    active: boolean,
    chainName: string,
    environment: string,
): Promise<string> {
    if (chainName == 'solana') {
        const dvnProgramId = await getSolanaDvnProgramId(target, environment)
        const dvnProgram = new DVNProgram.DVN(dvnProgramId)

        const config = await dvnProgram.getConfigState(
            getSolanaProvider(environment),
        )
        const currentSigners: number[][] = config?.multisig.signers!

        const newSigners: Uint8Array[] = []
        const signerAddressInBytes = hexToUint8Array(signerAddress)
        for (const signer of currentSigners) {
            if (
                !active &&
                signer.every((byte, i) => byte === signerAddressInBytes[i])
            ) {
                continue
            }
            newSigners.push(Uint8Array.from(signer))
        }
        if (active) {
            newSigners.push(signerAddressInBytes)
        }
        const instruction = dvnProgram.createSetSignersInstruction(newSigners)
        return bytesToHex(Uint8Array.from(instruction.data))
    } else if (['aptos', 'initia', 'movement'].includes(chainName)) {
        const encoded_data = new ExtendedBuffer()
        encoded_data.writeBuffer(
            Buffer.from(
                stringToUint8Array(getFunctionSignatureHash('set_dvn_signer')),
            ),
        )
        encoded_data.writeBuffer(Buffer.from(stringToUint8Array(signerAddress)))
        encoded_data.writeUInt8(active ? 1 : 0)
        return encoded_data.buffer.toString('hex')
    } else if (chainName == 'ton') {
        const provider = getTonProvider(environment)
        const dvn = await getImplementationContract(provider, target)

        const dvnStorage = decodeClass('Dvn', await dvn.getCurrentStorageCell())

        const targetSignerAddress = addressToHex(signerAddress)
        const currentSigners = dvnStorage.verifiers
            .getDict(Dictionary.Values.Cell())
            .keys()
            .map(addressToHex)

        const newSignersDict = Dictionary.empty(
            Dictionary.Keys.BigUint(256),
            Dictionary.Values.Cell(),
        )
        if (!active) {
            for (const signer of currentSigners) {
                if (signer !== targetSignerAddress) {
                    newSignersDict.set(addressToBigInt(signer), emptyCell())
                }
            }
            if (newSignersDict.size === 0) {
                throw new Error(
                    `Should not remove the last existing signer of ${target}`,
                )
            }
        } else {
            if (currentSigners.includes(targetSignerAddress)) {
                throw new Error(
                    `${targetSignerAddress} is already a signer of ${target}`,
                )
            }
            ;[...currentSigners, targetSignerAddress].forEach((signer) =>
                newSignersDict.set(addressToBigInt(signer), emptyCell()),
            )
        }

        const dvnSetVerifiersCallData = buildClass('md::SetDict', {
            nonce: dvnStorage.setVerifiersNonce,
            opcode: OPCODES.Dvn_OP_SET_VERIFIERS,
            dict: newSignersDict,
            target: dvn.address,
        })

        return dvnSetVerifiersCallData.hash().toString('hex')
    } else {
        // Assuming chain is EVM based
        const setSignerFunctionSig =
            'function setSigner(address _signer, bool _active)'
        const iface = new ethers.utils.Interface([setSignerFunctionSig])
        return iface.encodeFunctionData('setSigner', [signerAddress, active])
    }
}

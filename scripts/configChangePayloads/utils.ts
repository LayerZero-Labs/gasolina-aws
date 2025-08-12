import * as sha3 from '@noble/hashes/sha3'
import * as web3 from '@solana/web3.js'
import BN from 'bn.js'
import * as base58 from 'bs58'
import { ethers } from 'ethers'
import { ExtendedBuffer } from 'extended-buffer'

import { getChainIdForNetwork } from '@layerzerolabs/lz-definitions'
import { bcsSerializeBytes } from '@layerzerolabs/lz-serdes'
import { DVNProgram } from '@layerzerolabs/lz-solana-sdk-v2'

import { AwsKmsKey, getAwsKmsSigners, signUsingAwsKmsClinet } from './kms'

export interface Signature {
    signature: string
    address: string
}

export function getVId(chainName: string, environment: string): string {
    // By convention the vid is always the endpointV1 chainId
    if (['solana', 'ton', 'initia', 'movement'].includes(chainName)) {
        const eid = getChainIdForNetwork(chainName, environment, '302')
        return (parseInt(eid) % 30000).toString()
    }
    return getChainIdForNetwork(chainName, environment, '2')
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
    return bytesToHex(sha3.keccak_256(encoded_data.buffer)).slice(0, 8)
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
        return bytesToHex(sha3.keccak_256(digestBytes))
    } else if (['aptos', 'initia', 'movement'].includes(chainName)) {
        const encoded_data = new ExtendedBuffer()
        encoded_data.writeBuffer(Buffer.from(stringToUint8Array(callData)))
        encoded_data.writeBuffer(
            new BN(vId.toString()).toArrayLike(Buffer, 'be', 4),
        )
        encoded_data.writeBuffer(
            new BN(expiration.toString()).toArrayLike(Buffer, 'be', 8),
        )
        return bytesToHex(sha3.keccak_256(encoded_data.buffer))
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
    if (['solana', 'aptos', 'initia', 'movement'].includes(chainName)) {
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
): string | string[] {
    // For solana, we need to return an array of signatures
    if (chainName == 'solana') {
        return signatures.slice(0, quorum).map((s: Signature) => s.signature)
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
        return bytesToHex(instruction.data)
    } else if (['aptos', 'initia', 'movement'].includes(chainName)) {
        const encoded_data = new ExtendedBuffer()
        encoded_data.writeBuffer(
            Buffer.from(
                stringToUint8Array(getFunctionSignatureHash('set_quorum')),
            ),
        )
        encoded_data.writeBuffer(new BN(newQuorum).toArrayLike(Buffer, 'be', 8))
        return encoded_data.buffer.toString('hex')
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
        return bytesToHex(instruction.data)
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
    } else {
        // Assuming chain is EVM based
        const setSignerFunctionSig =
            'function setSigner(address _signer, bool _active)'
        const iface = new ethers.utils.Interface([setSignerFunctionSig])
        return iface.encodeFunctionData('setSigner', [signerAddress, active])
    }
}

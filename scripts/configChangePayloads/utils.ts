import * as sha3 from '@noble/hashes/sha3'
import * as web3 from '@solana/web3.js'
import { Dictionary } from '@ton/core'
import BN from 'bn.js'
import * as base58 from 'bs58'
import { ethers } from 'ethers'
import { ExtendedBuffer } from 'extended-buffer'
import { selector as starknetSelector } from 'starknet'

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
import { AwsSecretInfo, signUsingMnemonic } from './mnemonicSigner'
import { getImplementationContract, getTonProvider } from './tonUtils'

// Starknet call data type for structured encoding
export interface StarknetCallData {
    functionName: 'set_signer' | 'set_threshold'
    signerAddress?: string // For set_signer
    active?: boolean // For set_signer
    threshold?: number // For set_threshold
}

export interface Signature {
    signature: string
    address: string
}

export function getVId(chainName: string, environment: string): string {
    // By convention the vid is always the endpointV1 chainId
    if (
        ['solana', 'ton', 'initia', 'movement', 'sui', 'starknet'].includes(
            chainName,
        )
    ) {
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

/**
 * Calculate the Starknet selector for a function name using starknet.js.
 * Returns the selector as a hex string (with 0x prefix).
 */
export function getStarknetFunctionSelector(funcName: string): string {
    return starknetSelector.getSelectorFromName(funcName)
}

/**
 * Encode a value as a felt252 (32 bytes, big-endian).
 * felt252 is a value < 2^251, stored as 32 bytes.
 */
function encodeFelt252(value: string | bigint | number): Buffer {
    const bigValue = typeof value === 'string' ? BigInt(value) : BigInt(value)
    const hex = bigValue.toString(16).padStart(64, '0')
    return Buffer.from(hex, 'hex')
}

/**
 * Encode a u32 as 4 bytes big-endian.
 */
function encodeU32(value: number): Buffer {
    return new BN(value).toArrayLike(Buffer, 'be', 4)
}

/**
 * Encode a u256 as 32 bytes big-endian.
 */
function encodeU256(value: bigint | number | string): Buffer {
    const bigValue = typeof value === 'string' ? BigInt(value) : BigInt(value)
    const hex = bigValue.toString(16).padStart(64, '0')
    return Buffer.from(hex, 'hex')
}

/**
 * Hash call data for Starknet following the exact format of the DVN contract.
 * Format: keccak256(vid || to || expiration || selector || calldata)
 * Where:
 *   - vid: u32 (4 bytes, big-endian)
 *   - to: felt252 (32 bytes)
 *   - expiration: u256 (32 bytes)
 *   - selector: felt252 (32 bytes)
 *   - calldata: array of felt252 (32 bytes each)
 */
function hashStarknetCallData(
    target: string,
    vid: string,
    expiration: number,
    starknetCallData: StarknetCallData,
): string {
    const encoded = new ExtendedBuffer()

    // vid: 4 bytes big-endian
    encoded.writeBuffer(encodeU32(parseInt(vid)))

    // to: felt252 (32 bytes) - the DVN contract address
    encoded.writeBuffer(encodeFelt252(target))

    // expiration: u256 (32 bytes)
    encoded.writeBuffer(encodeU256(expiration))

    if (starknetCallData.functionName === 'set_signer') {
        // Get selector using starknet.js
        const selector = getStarknetFunctionSelector('set_signer')
        encoded.writeBuffer(encodeFelt252(selector))

        // calldata[0]: signer address as EthAddress (felt252)
        // EthAddress is 20 bytes, but stored as felt252 (32 bytes)
        if (!starknetCallData.signerAddress) {
            throw new Error('signerAddress is required for set_signer')
        }
        encoded.writeBuffer(encodeFelt252(starknetCallData.signerAddress))

        // calldata[1]: active as bool (felt252: 0 or 1)
        const active = starknetCallData.active ? 1 : 0
        encoded.writeBuffer(encodeFelt252(active))
    } else if (starknetCallData.functionName === 'set_threshold') {
        // Get selector using starknet.js
        const selector = getStarknetFunctionSelector('set_threshold')
        encoded.writeBuffer(encodeFelt252(selector))

        // calldata[0]: threshold as u32 (but stored as felt252)
        if (starknetCallData.threshold === undefined) {
            throw new Error('threshold is required for set_threshold')
        }
        encoded.writeBuffer(encodeFelt252(starknetCallData.threshold))
    } else {
        throw new Error(
            `Unknown Starknet function: ${starknetCallData.functionName}`,
        )
    }

    return bytesToHex(sha3.keccak_256(Uint8Array.from(encoded.buffer)))
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
    } else if (chainName == 'starknet') {
        // For Starknet, callData is a JSON-encoded StarknetCallData
        const starknetCallData: StarknetCallData = JSON.parse(callData)
        return hashStarknetCallData(target, vId, expiration, starknetCallData)
    } else if (['aptos', 'initia', 'movement', 'sui'].includes(chainName)) {
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

export async function getKmsSignatures(
    keyIds: AwsKmsKey[],
    hash: string,
    chainName: string,
): Promise<Signature[]> {
    if (
        [
            'solana',
            'aptos',
            'initia',
            'movement',
            'ton',
            'sui',
            'starknet',
        ].includes(chainName)
    ) {
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

export async function getMnemonicSignatures(
    mnemonicSecretInfos: AwsSecretInfo[],
    hash: string,
    chainName: string,
): Promise<Signature[]> {
    if (
        ['solana', 'aptos', 'initia', 'movement', 'ton', 'sui'].includes(
            chainName,
        )
    ) {
        throw new Error(
            'Mnemonic signatures are not supported for non-EVM chains',
        )
    } else {
        return await Promise.all(
            mnemonicSecretInfos.map(async (mnemonicSecretInfo) =>
                signUsingMnemonic(mnemonicSecretInfo, hash),
            ),
        )
    }
}

export function getSignaturesPayload(
    signatures: Signature[],
    quorum: number,
    chainName: string,
): string | string[] | Signature[] {
    if (chainName == 'solana') {
        // For solana, we need to return an array of signatures (no sorting required)
        return signatures.slice(0, quorum).map((s: Signature) => s.signature)
    } else if (chainName == 'starknet') {
        // For Starknet, signatures must be sorted by signer address (ascending)
        // The address here should be the Ethereum address of the signer
        const sortedSignatures = [...signatures].sort((a, b) => {
            // Compare addresses as BigInts to handle hex comparison correctly
            const addrA = BigInt(a.address)
            const addrB = BigInt(b.address)
            return addrA < addrB ? -1 : addrA > addrB ? 1 : 0
        })
        return sortedSignatures
            .slice(0, quorum)
            .map((s: Signature) => s.signature)
    } else if (chainName == 'ton') {
        // For ton, we need to have signatures associated with their respective address
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
    } else if (chainName == 'starknet') {
        // For Starknet, return JSON-encoded StarknetCallData for proper hash calculation
        const starknetCallData: StarknetCallData = {
            functionName: 'set_threshold',
            threshold: newQuorum,
        }
        return JSON.stringify(starknetCallData)
    } else if (['aptos', 'initia', 'movement', 'sui'].includes(chainName)) {
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
    } else if (chainName == 'starknet') {
        // For Starknet, return JSON-encoded StarknetCallData for proper hash calculation
        const starknetCallData: StarknetCallData = {
            functionName: 'set_signer',
            signerAddress,
            active,
        }
        return JSON.stringify(starknetCallData)
    } else if (['aptos', 'initia', 'movement', 'sui'].includes(chainName)) {
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

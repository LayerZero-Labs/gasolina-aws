import {
    GetSecretValueCommand,
    SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import { BIP32Factory } from 'bip32'
import * as bip39 from 'bip39'
import { ethers } from 'ethers'
import { ExtendedBuffer } from 'extended-buffer'
import * as ecc from 'tiny-secp256k1'

import * as secp from '@noble/secp256k1'
import { Secp256k1PublicKey } from '@mysten/sui/keypairs/secp256k1'

import { bytesToHexPrefixed, hexToUint8Array } from './utils'

export interface Mnemonic {
    mnemonic: string
    path: string
}

export interface AwsSecretInfo {
    secretName: string
    region: string
}

function recoveryIdTransformation(recoveryId: number): number {
    return recoveryId ? 28 : 27
}

function recoveryIdTransformationEcdsa(recoveryId: number): number {
    return recoveryId
}

const joinSignature = (signature: Uint8Array, recoveryId: number) => {
    const encoded_data = new ExtendedBuffer()
    encoded_data.writeBuffer(Buffer.from(signature))
    encoded_data.writeUInt8(recoveryId)
    return Uint8Array.from(encoded_data.buffer)
}

const walletAddressFromPublicKey = (publicKey: Uint8Array) => {
    const uncompressedPublicKey =
        publicKey.length === 65 ? publicKey.slice(1) : publicKey

    // Use ethers.utils.keccak256 to hash the public key
    const hash = ethers.utils.keccak256(uncompressedPublicKey)
    // Take the last 20 bytes of the hash
    return ethers.utils.getAddress('0x' + hash.slice(2).slice(-40))
}

function compressPublicKey(uncompressedKey: Uint8Array): Uint8Array {
    // Convert to Buffer for tiny-secp256k1 compatibility
    const keyBuffer = new Uint8Array(Buffer.from(uncompressedKey))

    // Use tiny-secp256k1's isPoint to validate and pointCompress to compress
    if (!ecc.isPoint(keyBuffer)) {
        throw new Error('Invalid public key format')
    }

    // Use pointCompress to convert uncompressed to compressed
    const compressed = ecc.pointCompress(keyBuffer, true)

    if (!compressed) {
        throw new Error('Failed to compress public key')
    }

    return new Uint8Array(compressed)
}

function getSuiMoveWalletAddress(publicKey: Uint8Array): string {
    return new Secp256k1PublicKey(compressPublicKey(publicKey)).toSuiAddress()
}

export async function signUsingMnemonic(
    secretInfo: AwsSecretInfo,
    data: string,
) {
    const secretsManagerClient = new SecretsManagerClient({
        region: secretInfo.region,
    })

    const response = await secretsManagerClient.send(
        new GetSecretValueCommand({
            SecretId: secretInfo.secretName,
        }),
    )
    const secret = JSON.parse(response.SecretString!)
    const mnemonic = secret.LAYERZERO_WALLET_MNEMONIC
    const path = secret.LAYERZERO_WALLET_PATH

    const seed = await bip39.mnemonicToSeed(mnemonic)
    const keyPairEcdsa = BIP32Factory(ecc)
        .fromSeed(Buffer.from(seed))
        .derivePath(path)

    const keyPair = {
        privateKey: keyPairEcdsa.privateKey!,
        // Bip32 public key is compressed, so we need to uncompress it by getting the public key from the private key
        publicKey: secp.getPublicKey(Uint8Array.from(keyPairEcdsa.privateKey!)),
    }

    const preparedData = ethers.utils.arrayify(
        ethers.utils.hashMessage(hexToUint8Array(data)),
    )
    const [signature, recoveryId] = await secp.sign(
        preparedData,
        Uint8Array.from(keyPair.privateKey),
        {
            canonical: true,
            recovered: true,
            der: false,
        },
    )
    const transformedRecoveryId = recoveryIdTransformation(recoveryId)
    return {
        signature: bytesToHexPrefixed(
            joinSignature(signature, transformedRecoveryId),
        ),
        address: walletAddressFromPublicKey(keyPair.publicKey),
    }
}

function getAddressForChain(chainName: string, publicKey: Uint8Array): string {
    if (chainName === 'starknet') {
        // Starknet DVN stores signers as EthAddress (Ethereum addresses)
        return walletAddressFromPublicKey(publicKey)
    }
    if (chainName === 'sui') {
        return getSuiMoveWalletAddress(publicKey)
    }
    throw new Error(`Unsupported chain name: ${chainName}`)
}

export async function signUsingLocalMnemonic(
    chainName: string,
    secretInfo: Mnemonic,
    data: Uint8Array,
) {
    const seed = await bip39.mnemonicToSeed(secretInfo.mnemonic)
    const keyPair = BIP32Factory(ecc)
        .fromSeed(Buffer.from(seed))
        .derivePath(secretInfo.path)
    const privateKey = keyPair.privateKey!
    const publicKey = secp.getPublicKey(Uint8Array.from(privateKey))

    const [signature, recoveryId] = await secp.sign(
        data,
        Uint8Array.from(privateKey),
        { canonical: true, recovered: true, der: false },
    )

    return {
        signature: bytesToHexPrefixed(
            joinSignature(signature, recoveryIdTransformationEcdsa(recoveryId)),
        ),
        address: getAddressForChain(chainName, publicKey),
    }
}

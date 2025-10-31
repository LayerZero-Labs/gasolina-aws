import {
    GetSecretValueCommand,
    SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import * as secp from '@noble/secp256k1'
import { BIP32Factory } from 'bip32'
import * as bip39 from 'bip39'
import { ethers } from 'ethers'
import { ExtendedBuffer } from 'extended-buffer'
import * as ecc from 'tiny-secp256k1'

import { bytesToHexPrefixed, hexToUint8Array } from './utils'

export interface AwsSecretInfo {
    secretName: string
    region: string
}

function recoveryIdTransformation(recoveryId: number): number {
    return recoveryId ? 28 : 27
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
        .fromSeed(Uint8Array.from(seed))
        .derivePath(path)

    const keyPair = {
        privateKey: keyPairEcdsa.privateKey!,
        // Bip32 public key is compressed, so we need to uncompress it by getting the public key from the private key
        publicKey: secp.getPublicKey(keyPairEcdsa.privateKey!),
    }

    const preparedData = ethers.utils.arrayify(
        ethers.utils.hashMessage(hexToUint8Array(data)),
    )
    const [signature, recoveryId] = await secp.sign(
        preparedData,
        keyPair.privateKey,
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

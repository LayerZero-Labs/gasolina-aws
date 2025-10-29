import { KMSSigner } from '@rumblefishdev/eth-signer-kms'
import AWS from 'aws-sdk'
import { BN } from 'bn.js'
import { ec as EC } from 'elliptic'

import { bytesToHexPrefixed, hexToUint8Array } from './utils'

const asn1 = require('asn1.js')

/**
 * Defines a AWS KMS Key.
 */
export interface AwsKmsKey {
    keyId: string
    region: string
}

export async function getAwsKmsSigners(
    keysInfo: AwsKmsKey[],
): Promise<KMSSigner[]> {
    return await Promise.all(
        keysInfo.map(async (keyInfo: AwsKmsKey) => {
            return new KMSSigner(
                {} as any, // not used
                keyInfo.keyId,
                new AWS.KMS({
                    region: keyInfo.region,
                }),
            )
        }),
    )
}

const calculateRecoveryId = (
    ec: EC,
    r: Uint8Array,
    s: Uint8Array,
    digest: Uint8Array,
    expectedKey: Uint8Array,
): number => {
    // Recover the public key
    // Is R.y even and R.x less than the curve order n: recovery_id := 0
    // Is R.y odd and R.x less than the curve order n: recovery_id := 1
    // Is R.y even and R.x more than the curve order n: recovery_id := 2
    // Is R.y odd and R.x more than the curve order n: recovery_id := 3
    for (let i = 0; i <= 3; i++) {
        const recoveredKey = ec.recoverPubKey(
            digest,
            {
                r,
                s,
            },
            i,
        )
        // Raw ECDSA public key - remove first byte (0x04) which signifies that it is uncompressed
        const publicKeyHex = Buffer.from(
            recoveredKey.encode('hex', false).slice(2),
            'hex',
        )
        if (publicKeyHex.equals(expectedKey)) {
            return i
        }
    }
    throw new Error('Could not find recoveryId')
}

const EcdsaSigAsnParse = asn1.define('EcdsaSig', function (this: any) {
    this.seq().obj(this.key('r').int(), this.key('s').int())
})

const getRSFromDER = (
    signature: Uint8Array,
): { r: Uint8Array; s: Uint8Array } => {
    if (signature == undefined) {
        throw new Error('Signature is undefined.')
    }

    const decoded = EcdsaSigAsnParse.decode(Buffer.from(signature), 'der')

    const r = new BN(decoded.r)
    let s = new BN(decoded.s)

    // The group order n in secp256k1 (number of points on the curve)
    const secp256k1N = new BN(
        hexToUint8Array(
            '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141',
        ),
    )
    const secp256k1halfN = secp256k1N.div(new BN(2))

    if (s.gt(secp256k1halfN)) {
        s = secp256k1N.sub(s)
    }

    return {
        r: Uint8Array.from(r.toBuffer('be', 32)),
        s: Uint8Array.from(s.toBuffer('be', 32)),
    }
}

const getRSVFromDERSignature = (
    ec: EC,
    derSignature: Uint8Array,
    digest: Uint8Array,
    expectedPublicKey: Uint8Array,
): { r: Uint8Array; s: Uint8Array; v: number } => {
    const { r, s } = getRSFromDER(derSignature)
    const v = calculateRecoveryId(ec, r, s, digest, expectedPublicKey)
    return {
        r,
        s,
        v,
    }
}

const appendRecoveryIdToSignature = (
    ec: EC,
    derSignature: Uint8Array,
    digest: Uint8Array,
    expectedPublicKey: Uint8Array,
): string => {
    const { r, s, v } = getRSVFromDERSignature(
        ec,
        derSignature,
        digest,
        expectedPublicKey,
    )
    // join r, s and v
    const signature = bytesToHexPrefixed(
        Uint8Array.from(
            Buffer.concat([r, s, Uint8Array.from(new BN(v).toBuffer('be', 1))]),
        ),
    )
    return signature
}

export const EcdsaPubKey = asn1.define('EcdsaPubKey', function (this: any) {
    this.seq().obj(
        this.key('algo')
            .seq()
            .obj(this.key('a').objid(), this.key('b').objid()),
        this.key('pubKey').bitstr(),
    )
})

async function convertToUint8Array(
    ciphertext: AWS.KMS.Types.CiphertextType,
): Promise<Uint8Array> {
    if (ciphertext instanceof Uint8Array) {
        return Uint8Array.from(ciphertext)
    } else if (typeof ciphertext === 'string') {
        return new Uint8Array(Buffer.from(ciphertext, 'base64'))
    } else if (ciphertext instanceof Buffer) {
        return new Uint8Array(ciphertext)
    } else if (ciphertext instanceof Blob) {
        return new Uint8Array(Buffer.from(await ciphertext.arrayBuffer()))
    } else {
        throw new Error('Unsupported CiphertextType')
    }
}

export async function signUsingAwsKmsClinet(keyId: AwsKmsKey, data: string) {
    const client = new AWS.KMS({ region: keyId.region })
    const ec = new EC('secp256k1')

    const publicKey = await client
        .getPublicKey({ KeyId: keyId.keyId })
        .promise()
    const x509der = EcdsaPubKey.decode(publicKey.PublicKey, 'der')
    const publicKeyBytes = (x509der.pubKey.data as Uint8Array).slice(-64)
    const address = bytesToHexPrefixed(Uint8Array.from(publicKeyBytes))

    const response = await client
        .sign({
            KeyId: keyId.keyId,
            Message: hexToUint8Array(data),
            SigningAlgorithm: 'ECDSA_SHA_256',
            MessageType: 'DIGEST',
        })
        .promise()
    if (response.Signature == undefined) {
        throw new Error('AWS KMS: sign() failed')
    }

    return {
        signature: appendRecoveryIdToSignature(
            ec,
            await convertToUint8Array(response.Signature),
            hexToUint8Array(data),
            publicKeyBytes,
        ),
        address,
    }
}

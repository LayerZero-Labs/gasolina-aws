import { KMSSigner } from '@rumblefishdev/eth-signer-kms'
import { ethers } from 'ethers'

import { getChainIdForNetwork } from '@layerzerolabs/lz-definitions'

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

export function hashCallData(
    target: string,
    vId: string,
    expiration: number,
    callData: string,
): string {
    return ethers.utils.keccak256(
        ethers.utils.solidityPack(
            ['uint32', 'address', 'uint', 'bytes'],
            [vId, target, expiration, callData],
        ),
    )
}

export async function getSignatures(
    signers: KMSSigner[],
    hash: string,
): Promise<Signature[]> {
    return await Promise.all(
        signers.map(async (signer) => ({
            signature: await signer.signMessage(ethers.utils.arrayify(hash)),
            address: await signer.getAddress(),
        })),
    )
}

export function getSignaturesPayload(
    signatures: Signature[],
    quorum: number,
): string {
    signatures.sort((a: Signature, b: Signature) =>
        a.address.localeCompare(b.address),
    )
    const signaturesForQuorum = signatures.slice(0, quorum)
    return ethers.utils.solidityPack(
        signaturesForQuorum.map(() => 'bytes'),
        signaturesForQuorum.map((s: Signature) => s.signature),
    )
}

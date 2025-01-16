import { KMSSigner } from '@rumblefishdev/eth-signer-kms'
import AWS from 'aws-sdk'

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

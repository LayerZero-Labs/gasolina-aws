// Canary implementation
const GASOLINA_REPO = 'canaryprotocol/layerzero-dvn@sha256:3bacd21f28b09271172271616005cc5c244ed0ba3a762b165f22fffde631b53a';
// Layer0 implementation was us-east1-docker.pkg.dev/lz-docker/gasolina/gasolina@sha256:e1c37062ff5e2f61dc69c7b405d3851a3db042c450d8410caf935bf426c7cdf0

export const CONFIG: {
    [account: string]: {
        projectName: string
        stage: string
        environment: string
        gasolinaRepo: string
        availableChainNames: string
        signerType: string
        dataDogDomain?: string
        kmsNumOfSigners?: number
        extraContextRequestUrl?: string
        minReplicas: number
        maxReplicas?: number
        kmsKeyARN: string
    }
} = {
    // EDIT: aws account number
    '528757792527': {
        gasolinaRepo: `${GASOLINA_REPO}`,
        projectName: 'canary-dvn', // EDIT: project_name e.g. foobar-gasolina
        stage: 'prod', // EDIT: stage e.g. prod/nonprod
        environment: 'mainnet', // EDIT: environment e.g. mainnet/testnet
        availableChainNames:
            'ethereum,bsc,avalanche,polygon,arbitrum,optimism,fantom', // deprecated for Canary DVN
        signerType: 'MNEMONIC', // EDIT: MNEMONIC or KMS
        // kmsNumOfSigners: 1, // EDIT: only required if signerType is KMS
        // extraContextRequestUrl: undefined // EDIT: optional
        // Optionally add a log intake server for datadog. Note: this is based on the region of your account. Check it out carefully.
        // Remove to disable datadog integration - if enabling, remember to create an AWS Secret Manager entry with name and datadog/api-key and a key called "key" with the DataDog API key
        dataDogDomain: 'datadoghq.eu',
        minReplicas: 2,
        maxReplicas: 8,
        kmsKeyARN: 'arn:aws:kms:eu-west-2:528757792527:key/960f4a8a-9799-4cc0-bc3c-b497ea36d887',
    },
    // EDIT: aws account number
    '891612567040': {
        gasolinaRepo: `${GASOLINA_REPO}`,
        projectName: 'canary-dvn-dev', // EDIT: project_name e.g. foobar-gasolina
        stage: 'nonprod', // EDIT: stage e.g. prod/nonprod
        environment: 'mainnet', // EDIT: environment e.g. mainnet/testnet
        availableChainNames:
            'ethereum,bsc,avalanche,polygon,arbitrum,optimism,fantom', // deprecated for Canary DVN
        signerType: 'MNEMONIC', // EDIT: MNEMONIC or KMS
        // kmsNumOfSigners: 1, // EDIT: only required if signerType is KMS
        // extraContextRequestUrl: undefined // EDIT: optional
        // Optionally add a long intake server for datadog. Note: this is based on the region of your account. Check it out carefully.
        // Remove to disable datadog integration - if enabling, remember to create an AWS Secret Manager entry with name and datadog/api-key and a key called "key" with the DataDog API key
        dataDogDomain: 'datadoghq.eu',
        minReplicas: 1,
        maxReplicas: 1,
        kmsKeyARN: 'arn:aws:kms:eu-west-2:891612567040:key/8345e35f-7d75-4960-8707-34fe56fe12e9',
    },
}

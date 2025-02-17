const GASOLINA_REPO = 'canaryprotocol/layerzero-dvn';

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
    }
} = {
    // EDIT: aws account number
    '528757792527': {
        // gasolinaRepo: 'us-east1-docker.pkg.dev/lz-docker/gasolina/gasolina@sha256:e1c37062ff5e2f61dc69c7b405d3851a3db042c450d8410caf935bf426c7cdf0',
        gasolinaRepo: `${GASOLINA_REPO}@sha256:7313cedf1e3b3468c4cf1c2a1de012b003d7ae9a3041b5704506f0d4da888885`,
        projectName: 'canary-dvn', // EDIT: project_name e.g. foobar-gasolina
        stage: 'prod', // EDIT: stage e.g. prod/nonprod
        environment: 'mainnet', // EDIT: environment e.g. mainnet/testnet
        availableChainNames:
            'ethereum,bsc,avalanche,polygon,arbitrum,optimism,fantom', // EDIT: all the chains gasolina will support that matches those listed in providers
        signerType: 'MNEMONIC', // EDIT: MNEMONIC or KMS
        // kmsNumOfSigners: 1, // EDIT: only required if signerType is KMS
        // extraContextRequestUrl: undefined // EDIT: optional
        // Optionally add a log intake server for datadog. Note: this is based on the region of your account. Check it out carefully.
        // Remove to disable datadog integration - if enabling, remember to create an AWS Secret Manager entry with name and datadog/api-key and a key called "key" with the DataDog API key
        dataDogDomain: 'datadoghq.eu',
        minReplicas: 2,
    },
    // EDIT: aws account number
    '891612567040': {
        // gasolinaRepo: 'us-east1-docker.pkg.dev/lz-docker/gasolina/gasolina@sha256:e1c37062ff5e2f61dc69c7b405d3851a3db042c450d8410caf935bf426c7cdf0',
        gasolinaRepo: `${GASOLINA_REPO}@sha256:7313cedf1e3b3468c4cf1c2a1de012b003d7ae9a3041b5704506f0d4da888885`,
        projectName: 'canary-dvn-dev', // EDIT: project_name e.g. foobar-gasolina
        stage: 'nonprod', // EDIT: stage e.g. prod/nonprod
        environment: 'mainnet', // EDIT: environment e.g. mainnet/testnet
        availableChainNames:
            'ethereum,bsc,avalanche,polygon,arbitrum,optimism,fantom', // EDIT: all the chains gasolina will support that matches those listed in providers
        signerType: 'MNEMONIC', // EDIT: MNEMONIC or KMS
        // kmsNumOfSigners: 1, // EDIT: only required if signerType is KMS
        // extraContextRequestUrl: undefined // EDIT: optional
        // Optionally add a long intake server for datadog. Note: this is based on the region of your account. Check it out carefully.
        // Remove to disable datadog integration - if enabling, remember to create an AWS Secret Manager entry with name and datadog/api-key and a key called "key" with the DataDog API key
        dataDogDomain: 'datadoghq.eu',
        minReplicas: 1,
        maxReplicas: 1,
    },
}

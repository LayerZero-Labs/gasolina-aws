export const CONFIG: {
    [account: string]: {
        projectName: string
        environment: string
        gasolinaRepo: string
        availableChainNames: string
        signerType: string
        dataDogLogDomain?: string
        kmsNumOfSigners?: number
        extraContextRequestUrl?: string
    }
} = {
    // EDIT: aws account number
    '528757792527': {
        gasolinaRepo: 'us-east1-docker.pkg.dev/lz-docker/gasolina/gasolina@sha256:e1c37062ff5e2f61dc69c7b405d3851a3db042c450d8410caf935bf426c7cdf0',
        projectName: 'canary-dvn', // EDIT: project_name e.g. foobar-gasolina
        environment: 'mainnet', // EDIT: environment e.g. mainnet/testnet
        availableChainNames:
            'ethereum,bsc,avalanche,polygon,arbitrum,optimism,fantom', // EDIT: all the chains gasolina will support that matches those listed in providers
        signerType: 'MNEMONIC', // EDIT: MNEMONIC or KMS
        // kmsNumOfSigners: 1, // EDIT: only required if signerType is KMS
        // extraContextRequestUrl: undefined // EDIT: optional
        // Optionally add a long intake server for datadog. Note: this is based on the region of your account. Check it out carefully.
        // Remove to disable datadog integration - if enabling, remember to create an AWS Secret Manager entry with name and datadog/api-key and a key called "key" with the DataDog API key
        dataDogLogDomain: 'http-intake.logs.datadoghq.eu',
    },
}

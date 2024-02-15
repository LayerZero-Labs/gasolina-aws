export const CONFIG: {
    [account: string]: {
        projectName: string
        environment: string
        gasolinaRepo: string
        appVersion: string
        availableChainNames: string
        signerType: string
        kmsNumOfSigners?: number
    }
} = {
    // EDIT: aws account number
    '<aws-account-number>': {
        gasolinaRepo: 'public.ecr.aws/t7p6p5n2/gasolina',
        appVersion: 'latest', // EDIT: version and tag of the gasolina image
        projectName: '<project_name>', // EDIT: project_name e.g. foobar-gasolina
        environment: '<environment>', // EDIT: environment e.g. mainnet/testnet
        availableChainNames:
            'ethereum,bsc,avalanche,polygon,arbitrum,optimism,fantom', // EDIT: all the chains gasolina will support that matches those listed in providers
        signerType: 'MNEMONIC', // EDIT: MNEMONIC or KMS
        // kmsNumOfSigners: 1, // EDIT: only required if signerType is KMS
    },
}

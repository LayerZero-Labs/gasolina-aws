export const CONFIG: {
    [account: string]: {
        projectName: string
        environment: string
        ecrRepositoryArn: string
        appVersion: string
        availableChainNames: string
        signerType: string
        kmsNumOfSigners?: number
    }
} = {
    // EDIT: aws account number
    '<aws-account-number>': {
        ecrRepositoryArn:
            'arn:aws:ecr:us-east-1:438003944538:repository/gasolina',
        appVersion: 'latest', // EDIT: version and tag of the gasolina image
        projectName: '<project_name>', // EDIT: project_name e.g. foobar-gasolina
        environment: '<environment>', // EDIT: environment e.g. mainnet/testnet
        availableChainNames:
            'ethereum,bsc,avalanche,polygon,arbitrum,optimism,fantom', // EDIT: all the chains gasolina will support that matches those listed in providers
        signerType: 'MNEMONIC', // EDIT: MNEMONIC or KMS
        // kmsNumOfSigners: 1, // EDIT: only required if signerType is KMS
    },
}

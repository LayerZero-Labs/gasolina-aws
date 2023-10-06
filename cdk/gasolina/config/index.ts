export const CONFIG: {
    [account: string]: {
        projectName: string
        environment: string
        signerType: string
        ecrRepositoryArn: string
        appVersion: string
        availableChainNames: string
    }
} = {
    // EDIT: aws account number
    '<aws-account-number>': {
        projectName: '<project_name>', // EDIT: project_name e.g. foobar-gasolina
        environment: '<environment>', // EDIT: environment e.g. mainnet/testnet
        signerType: 'MNEMONIC',
        ecrRepositoryArn:
            'arn:aws:ecr:us-east-1:438003944538:repository/gasolina',
        appVersion: '1.0.0', // EDIT: version and tag of the gasolina image
        availableChainNames:
            'ethereum,bsc,avalanche,polygon,arbitrum,optimism,fantom', // EDIT: all the chains gasolina will support that matches those listed in providers
    },
}

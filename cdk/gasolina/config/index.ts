export const CONFIG: {
    [account: string]: {
        projectName: string
        environment: string
        signerType: string
        ecrRepositoryUri: string
        appVersion: string
        availableChainNames: string
    }
} = {
    '<aws-account-number>': {
        // EDIT: aws account number
        projectName: '<project_name>', // EDIT: project_name e.g. foobar-gasolina
        environment: '<environment>', // EDIT: environment e.g. mainnet/testnet
        signerType: 'MNEMONIC',
        ecrRepositoryUri: '<gasolina image on ecr>',
        appVersion: '1.0.0', // EDIT: version and tag of the gasolina image
        availableChainNames:
            'ethereum,bsc,avalanche,polygon,arbitrum,optimism,fantom', // EDIT: all the chains gasolina will support that matches those listed in providers
    },
}

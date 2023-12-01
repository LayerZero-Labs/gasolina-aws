import { mainnetMessages, testnetMessages } from '../samples'

/**
 * Get a sample message based on the samples that your configuration supports
 * @param environment - the environment: mainnet or testnet
 */
export const getSampleMessage = (environment: string) => {
    if (!['mainnet', 'testnet'].includes(environment)) {
        throw new Error('environment must be mainnet or testnet')
    }
    const providers = require(`../../cdk/gasolina/config/providers/${environment}/providers.json`)
    const availableChainNames = Object.keys(providers)
    const sampleMessages =
        environment === 'mainnet' ? mainnetMessages : testnetMessages
    const result = sampleMessages.find(
        (message) =>
            availableChainNames.includes(message.lzMessageId.srcChainName) &&
            availableChainNames.includes(message.lzMessageId.dstChainName),
    )
    if (!result) {
        throw new Error(
            'Cannot find a sample message based on the supported chains in your providers configuration',
        )
    }
    return result
}

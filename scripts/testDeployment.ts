import axios from 'axios'
import { parse } from 'ts-command-line-args'

import { getSampleMessage } from './utils'

const args = parse(
    {
        environment: {
            alias: 'e',
            type: String,
            defaultValue: 'mainnet',
            description: 'environments: mainnet, testnet',
        },
        url: {
            alias: 'u',
            type: String,
            description: 'The URL to send the request to',
        },
    },
    {
        headerContentSections: [
            {
                header: 'Test Gasolina API Deployment',
                content:
                    'Send a request to your deployed Gasolina API with a test message',
            },
        ],
    },
)

const main = async () => {
    const sampleMessage = getSampleMessage(args.environment)
    console.log(`--- Sending request to ${args.url} ---`)
    console.log(`Sample request:`, sampleMessage)
    try {
        const response = await axios.post(args.url, sampleMessage)
        console.log(`--- [${response.status}] Successful request ---`)
        console.log(`Response:`, response?.data?.body)
    } catch (e) {
        console.log(`--- Error from API Request ---`)
        console.log(`Error:`, e)
    }
}

main()

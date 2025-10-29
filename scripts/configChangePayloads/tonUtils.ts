import { Cell, Address as TonAddress } from '@ton/core'
import { TonClient } from '@ton/ton'

import {
    TonContractWrapper,
    decodeClass,
    tonObjects,
} from '@layerzerolabs/lz-ton-sdk-v2'

import { bytesToHex } from './utils'

export function getTonProvider(environment: string) {
    const providers = require(`../../cdk/gasolina/config/providers/${environment}/providers.json`)
    const v2Url = new URL(providers['ton'].uris[0])
    v2Url.searchParams.delete('v3-endpoint')

    return new TonClient({ endpoint: `${v2Url.href}/jsonRPC` })
}

function bigintToAsciiString(target: bigint): string {
    return Buffer.from(target.toString(16), 'hex').toString('ascii')
}

export const getCellNameNumber = (cell: Cell): bigint => {
    const NAME_WIDTH = 80
    const slice = cell.beginParse()
    const name = slice.loadUintBig(NAME_WIDTH)
    return name
}

export const getCellName = (cell: Cell): string => {
    const nameNumber = getCellNameNumber(cell)
    return bigintToAsciiString(nameNumber)
}

function to32ByteBuffer(
    value: bigint,
    maxIntermediateBufferSize = 66,
): Uint8Array {
    const hex = value.toString(16)
    const padded = hex
        .padStart(maxIntermediateBufferSize * 2, '0')
        .slice(0, maxIntermediateBufferSize * 2)
    // trim from the left, keep the right 32 bytes
    return Uint8Array.from(Buffer.from(padded, 'hex').subarray(-32))
}

export const parseTonAddress = (address: TonAddress | string): TonAddress => {
    if (address instanceof TonAddress) {
        return address
    }
    if (address.startsWith('0x')) {
        const buf = to32ByteBuffer(BigInt(address))
        return TonAddress.parse(`0:${bytesToHex(buf)}`)
    }
    return TonAddress.parse(address)
}

class NotProxyError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'NotProxyError'
    }
}

export async function getImplementationContract(
    provider: TonClient,
    address: string,
) {
    try {
        const maybeProxy = provider.open(
            new TonContractWrapper(parseTonAddress(address)),
        )

        const maybeProxyStorage = await maybeProxy.getCurrentStorageCell()

        if (getCellName(maybeProxyStorage) !== tonObjects.Proxy.name) {
            throw new NotProxyError('Not a proxy contract')
        }

        const proxyStorage = decodeClass('Proxy', maybeProxyStorage)

        return provider.open(
            new TonContractWrapper(proxyStorage.workerCoreStorage.admins[0]),
        )
    } catch (err) {
        if (err instanceof NotProxyError) {
            // If the contract is not a proxy, return the original contract
            return provider.open(
                new TonContractWrapper(parseTonAddress(address)),
            )
        }
        // In case provider throws any other error, rethrow it
        throw err
    }
}

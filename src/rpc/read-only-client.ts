export type ReadOnlyRpcMethod =
  | 'eth_blockNumber'
  | 'eth_call'
  | 'eth_chainId'
  | 'eth_getBlockByNumber'
  | 'eth_getCode'
  | 'eth_gasPrice'
  | 'eth_getLogs'
  | 'net_version'

interface JsonRpcRequest {
  readonly jsonrpc: '2.0'
  readonly id: number
  readonly method: ReadOnlyRpcMethod
  readonly params: readonly unknown[] | Readonly<Record<string, unknown>>
}

interface JsonRpcSuccess {
  readonly jsonrpc: '2.0'
  readonly id: number
  readonly result: unknown
}

interface JsonRpcFailure {
  readonly jsonrpc: '2.0'
  readonly id: number
  readonly error: {
    readonly code: number
    readonly message: string
  }
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

export type RpcTransport = (endpoint: URL, payload: JsonRpcRequest) => Promise<JsonRpcResponse>

const ALLOWED_METHODS = new Set<ReadOnlyRpcMethod>([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_gasPrice',
  'eth_getLogs',
  'net_version',
])

export function publicEndpointLabel(endpoint: URL): string {
  return `${endpoint.protocol}//${endpoint.host}`
}

async function fetchTransport(endpoint: URL, payload: JsonRpcRequest): Promise<JsonRpcResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`RPC ${response.status} from ${publicEndpointLabel(endpoint)}`)
  }
  return (await response.json()) as JsonRpcResponse
}

/** JSON-RPC boundary that cannot sign, broadcast, or inspect wallet accounts. */
export class ReadOnlyRpcClient {
  readonly #endpoint: URL
  readonly #transport: RpcTransport
  #requestId = 0

  constructor(endpoint: string, transport: RpcTransport = fetchTransport) {
    this.#endpoint = new URL(endpoint)
    if (!['http:', 'https:'].includes(this.#endpoint.protocol)) {
      throw new Error('read-only RPC must use HTTP(S)')
    }
    if (this.#endpoint.username !== '' || this.#endpoint.password !== '') {
      throw new Error('credentials in RPC URL are not permitted')
    }
    this.#transport = transport
  }

  get endpointLabel(): string {
    return publicEndpointLabel(this.#endpoint)
  }

  async request<T>(
    method: ReadOnlyRpcMethod,
    params: readonly unknown[] | Readonly<Record<string, unknown>> = [],
  ): Promise<T> {
    if (!ALLOWED_METHODS.has(method))
      throw new Error(`RPC method is not read-only: ${String(method)}`)
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: ++this.#requestId,
      method,
      params,
    }
    const response = await this.#transport(this.#endpoint, payload)
    if ('error' in response) {
      throw new Error(
        `RPC error ${response.error.code} from ${this.endpointLabel}: ${response.error.message}`,
      )
    }
    return response.result as T
  }
}

import { setTimeout as delay } from 'node:timers/promises'

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

export interface ReadOnlyRpcClientOptions {
  readonly transport?: RpcTransport
  readonly maxTransportAttempts?: number
  readonly transportRetryDelayMs?: number
}

export interface ReadOnlyRpcStats {
  readonly logicalRequests: number
  readonly providerRequests: number
  readonly transportFailures: number
  readonly recoveredTransportRequests: number
}

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
  readonly #maxTransportAttempts: number
  readonly #transportRetryDelayMs: number
  #requestId = 0
  #logicalRequests = 0
  #providerRequests = 0
  #transportFailures = 0
  #recoveredTransportRequests = 0

  constructor(endpoint: string, transportOrOptions: RpcTransport | ReadOnlyRpcClientOptions = {}) {
    this.#endpoint = new URL(endpoint)
    if (!['http:', 'https:'].includes(this.#endpoint.protocol)) {
      throw new Error('read-only RPC must use HTTP(S)')
    }
    if (this.#endpoint.username !== '' || this.#endpoint.password !== '') {
      throw new Error('credentials in RPC URL are not permitted')
    }
    const options =
      typeof transportOrOptions === 'function'
        ? { transport: transportOrOptions }
        : transportOrOptions
    this.#transport = options.transport ?? fetchTransport
    this.#maxTransportAttempts = options.maxTransportAttempts ?? 1
    this.#transportRetryDelayMs = options.transportRetryDelayMs ?? 0
    if (
      !Number.isSafeInteger(this.#maxTransportAttempts) ||
      this.#maxTransportAttempts < 1 ||
      this.#maxTransportAttempts > 3
    ) {
      throw new Error('maxTransportAttempts must be an integer from 1 through 3')
    }
    if (
      !Number.isSafeInteger(this.#transportRetryDelayMs) ||
      this.#transportRetryDelayMs < 0 ||
      this.#transportRetryDelayMs > 1_000
    ) {
      throw new Error('transportRetryDelayMs must be an integer from 0 through 1000')
    }
  }

  get endpointLabel(): string {
    return publicEndpointLabel(this.#endpoint)
  }

  stats(): ReadOnlyRpcStats {
    return {
      logicalRequests: this.#logicalRequests,
      providerRequests: this.#providerRequests,
      transportFailures: this.#transportFailures,
      recoveredTransportRequests: this.#recoveredTransportRequests,
    }
  }

  async request<T>(
    method: ReadOnlyRpcMethod,
    params: readonly unknown[] | Readonly<Record<string, unknown>> = [],
  ): Promise<T> {
    if (!ALLOWED_METHODS.has(method))
      throw new Error(`RPC method is not read-only: ${String(method)}`)
    this.#logicalRequests += 1
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: ++this.#requestId,
      method,
      params,
    }

    let recoveredTransport = false
    for (let attempt = 1; attempt <= this.#maxTransportAttempts; attempt += 1) {
      this.#providerRequests += 1
      let response: JsonRpcResponse
      try {
        response = await this.#transport(this.#endpoint, payload)
      } catch {
        this.#transportFailures += 1
        recoveredTransport = true
        if (attempt === this.#maxTransportAttempts) {
          throw new Error(`RPC transport unavailable from ${this.endpointLabel}`)
        }
        if (this.#transportRetryDelayMs > 0) {
          await delay(this.#transportRetryDelayMs)
        }
        continue
      }
      if ('error' in response) {
        throw new Error(
          `RPC error ${response.error.code} from ${this.endpointLabel}: ${response.error.message}`,
        )
      }
      if (recoveredTransport) this.#recoveredTransportRequests += 1
      return response.result as T
    }
    throw new Error(`RPC transport unavailable from ${this.endpointLabel}`)
  }
}

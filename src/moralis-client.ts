import { z } from 'zod';

/**
 * Token balance client.
 *
 * NOTE: This file keeps its original file name and class name (MoralisClient)
 * so that nothing else in the project has to change. It now loads token
 * balances, logos and USD prices from Alchemy's Portfolio API instead of
 * Moralis. The API key you give it (still read from the MORALIS_API_KEY
 * environment variable) must therefore be an ALCHEMY key.
 */

// Chain ID to chain name mapping (also defines which chains are supported)
const CHAIN_ID_TO_MORALIS_CHAIN: Record<number, string> = {
  1: 'eth',
  10: 'optimism',
  56: 'bsc',
  100: 'gnosis',
  137: 'polygon',
  8453: 'base',
  42161: 'arbitrum',
  43114: 'avalanche',
  59144: 'linea',
} as const;

// Chain ID to Alchemy network name mapping
const CHAIN_ID_TO_ALCHEMY_NETWORK: Record<number, string> = {
  1: 'eth-mainnet',
  10: 'opt-mainnet',
  56: 'bnb-mainnet',
  100: 'gnosis-mainnet',
  137: 'matic-mainnet',
  8453: 'base-mainnet',
  42161: 'arb-mainnet',
  43114: 'avax-mainnet',
  59144: 'linea-mainnet',
};

// Address used to represent the chain's native gas token (ETH, POL, ...)
const NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

// Internal token shape (kept the same as before so the rest of the code works)
const MoralisTokenSchema = z.object({
  token_address: z.string(),
  name: z.string().nullable(),
  symbol: z.string().nullable(),
  logo: z.string().url().nullable().optional(),
  thumbnail: z.string().url().nullable().optional(),
  decimals: z.number().int().min(0).max(255),
  balance: z.string(), // Raw balance as string to handle large numbers
  balance_formatted: z.string().optional(),
  usd_price: z.number().nullable().optional(),
  usd_value: z.number().nullable().optional(),
  usd_price_24hr_percent_change: z.number().nullable().optional(),
  usd_value_24hr_ago: z.number().nullable().optional(),
  possible_spam: z.boolean().optional(),
  verified_contract: z.boolean().optional(),
  native_token: z.boolean().optional(),
});

const MoralisWalletResponseSchema = z.object({
  result: z.array(MoralisTokenSchema),
  cursor: z.string().nullable().optional(),
});

// What Alchemy sends back for one token
const AlchemyTokenSchema = z.object({
  tokenAddress: z.string().nullable(), // null means the native gas token
  tokenBalance: z.string(), // hex number, e.g. "0x02c68af0bb140000"
  tokenMetadata: z
    .object({
      decimals: z.number().int().nullable().optional(),
      logo: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      symbol: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  tokenPrices: z
    .array(
      z.object({
        currency: z.string(),
        value: z.string(),
      }),
    )
    .nullable()
    .optional(),
});

type AlchemyToken = z.infer<typeof AlchemyTokenSchema>;

// What Alchemy sends back overall
const AlchemyResponseSchema = z.object({
  data: z.object({
    tokens: z.array(z.unknown()),
  }),
  error: z
    .object({
      partialErrors: z.array(z.unknown()).optional(),
    })
    .nullable()
    .optional(),
});

// Export the inferred types
export type MoralisToken = z.infer<typeof MoralisTokenSchema>;
export type MoralisResponse =
  | z.infer<typeof MoralisWalletResponseSchema>
  | z.infer<typeof MoralisTokenSchema>[];

// Normalized token type that matches the existing codebase structure
export interface NormalizedToken {
  contract_decimals: number;
  contract_name: string;
  contract_ticker_symbol: string;
  contract_address: string;
  supports_erc: ['erc20'];
  logo_url: string;
  last_transferred_at: string;
  native_token: boolean;
  type: 'cryptocurrency' | 'stablecoin';
  balance: string;
  balance_24h: string;
  quote_rate: number;
  quote_rate_24h: number;
  quote: number;
  quote_24h: number;
  nft_data: null;
}

export interface FetchTokensResult {
  erc20s: ReadonlyArray<NormalizedToken>;
  nfts: ReadonlyArray<never>; // NFTs not included in this implementation
}

export class MoralisClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.g.alchemy.com/data/v1';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = apiKey;
  }

  /**
   * Fetches token balances (with prices) for a given address on a specific chain
   * @param chainId - The chain ID (1 for Ethereum, 137 for Polygon, etc.)
   * @param evmAddress - The wallet address to fetch balances for
   * @param blacklistAddresses - Array of token addresses to exclude from results
   */
  async fetchTokens(
    chainId: number,
    evmAddress: string,
    blacklistAddresses: string[] = [],
  ): Promise<FetchTokensResult> {
    // Throws a clear error if the chain is not supported
    this.getChainName(chainId);
    const network = CHAIN_ID_TO_ALCHEMY_NETWORK[chainId];

    // The API key is part of the URL, so never put this URL in an error message
    const url = `${this.baseUrl}/${this.apiKey}/assets/tokens/by-address`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        addresses: [{ address: evmAddress, networks: [network] }],
        withMetadata: true,
        withPrices: true,
        includeNativeTokens: true,
        includeErc20Tokens: true,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Token API request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = AlchemyResponseSchema.parse(await response.json());

    // Turn each Alchemy token into the internal token shape.
    // Anything that looks wrong is skipped instead of breaking the whole list.
    const tokens: MoralisToken[] = [];
    for (const rawToken of data.data.tokens) {
      const parsed = AlchemyTokenSchema.safeParse(rawToken);
      if (!parsed.success) continue;
      const token = this.toInternalToken(parsed.data);
      if (token) tokens.push(token);
    }

    // If the network failed completely, say so instead of showing an empty list
    const partialErrors = data.error?.partialErrors ?? [];
    if (partialErrors.length > 0 && tokens.length === 0) {
      throw new Error(`Token API could not load balances for chain ${chainId}`);
    }

    // Normalize and filter tokens
    const normalizedTokens = this.normalizeTokens(tokens);

    // Filter out blacklisted addresses and apply business logic
    const erc20s = normalizedTokens.filter((token) => {
      // Exclude blacklisted addresses (case-insensitive)
      if (
        blacklistAddresses.some(
          (addr) => addr.toLowerCase() === token.contract_address.toLowerCase(),
        )
      ) {
        return false;
      }

      // Only include tokens with non-zero balance
      if (token.balance === '0') {
        return false;
      }

      // Only include tokens with valid price data
      const hasQuotes = [
        token.quote,
        token.quote_24h,
        token.quote_rate,
        token.quote_rate_24h,
      ].every((val) => val !== null && val !== undefined);

      // Only include tokens with value > $1 USD
      return hasQuotes && token.quote > 1;
    });

    return {
      erc20s,
      nfts: [], // NFTs not included in this implementation
    };
  }

  /**
   * Converts one Alchemy token into the internal token shape.
   * Returns null if the token can't be used (missing decimals, bad balance).
   */
  private toInternalToken(token: AlchemyToken): MoralisToken | null {
    const metadata = token.tokenMetadata;
    const decimals = metadata?.decimals;
    if (decimals === null || decimals === undefined) return null;
    if (decimals < 0 || decimals > 255) return null;

    let rawBalance: bigint;
    try {
      rawBalance = BigInt(token.tokenBalance);
    } catch {
      return null;
    }

    const usdEntry = token.tokenPrices?.find(
      (price) => price.currency.toLowerCase() === 'usd',
    );
    const parsedPrice = usdEntry ? Number(usdEntry.value) : NaN;
    const usdPrice = Number.isFinite(parsedPrice) ? parsedPrice : null;

    const usdValue =
      usdPrice !== null
        ? (Number(rawBalance) / Math.pow(10, decimals)) * usdPrice
        : null;

    const isNative = token.tokenAddress === null;

    return {
      token_address: token.tokenAddress ?? NATIVE_TOKEN_ADDRESS,
      name: metadata?.name ?? null,
      symbol: metadata?.symbol ?? null,
      logo: metadata?.logo ?? null,
      thumbnail: null,
      decimals,
      balance: rawBalance.toString(),
      usd_price: usdPrice,
      usd_value: usdValue,
      native_token: isNative,
    };
  }

  /**
   * Normalizes token data to match existing codebase structure
   */
  private normalizeTokens(
    tokens: MoralisToken[],
  ): ReadonlyArray<NormalizedToken> {
    return tokens.map((token) => {
      // Calculate balance_24h (current balance - change)
      // There is no 24h history available, so it is estimated from the value
      const currentUsdValue = token.usd_value || 0;
      const usdValue24hAgo = token.usd_value_24hr_ago || currentUsdValue;

      const balance24h =
        token.usd_price && token.usd_price > 0
          ? String(
              Math.floor(
                (usdValue24hAgo / token.usd_price) *
                  Math.pow(10, token.decimals),
              ),
            )
          : token.balance;

      // Calculate quote_rate_24h from percentage change
      const quoteRate = token.usd_price || 0;
      const percentChange = token.usd_price_24hr_percent_change || 0;
      const quoteRate24h = quoteRate / (1 + percentChange / 100);

      // Determine if it's a stablecoin (simple heuristic based on symbol)
      const stablecoinSymbols = [
        'USDT',
        'USDC',
        'DAI',
        'BUSD',
        'UST',
        'TUSD',
        'USDP',
        'USDD',
        'GUSD',
        'FRAX',
      ];
      const isStablecoin = stablecoinSymbols.includes(
        token.symbol?.toUpperCase() || '',
      );

      return {
        contract_decimals: token.decimals,
        contract_name: token.name || 'Unknown Token',
        contract_ticker_symbol: token.symbol || 'UNKNOWN',
        contract_address: token.token_address,
        supports_erc: ['erc20'] as ['erc20'],
        logo_url: token.logo || token.thumbnail || '',
        last_transferred_at: new Date().toISOString(), // Not provided
        native_token: token.native_token ?? false,
        type: isStablecoin ? 'stablecoin' : 'cryptocurrency',
        balance: token.balance,
        balance_24h: balance24h,
        quote_rate: quoteRate,
        quote_rate_24h: quoteRate24h,
        quote: currentUsdValue,
        quote_24h: usdValue24hAgo,
        nft_data: null,
      };
    });
  }

  /**
   * Maps chain ID to a chain name (also checks the chain is supported)
   */
  private getChainName(chainId: number): string {
    const chainName = CHAIN_ID_TO_MORALIS_CHAIN[chainId];
    if (!chainName) {
      throw new Error(
        `Chain ID ${chainId} is not supported. Supported chains: ${Object.keys(CHAIN_ID_TO_MORALIS_CHAIN).join(', ')}`,
      );
    }
    return chainName;
  }

  /**
   * Gets the list of supported chain IDs
   */
  static getSupportedChainIds(): number[] {
    return Object.keys(CHAIN_ID_TO_MORALIS_CHAIN).map(Number);
  }
}

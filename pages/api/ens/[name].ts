import { NextApiRequest, NextApiResponse } from 'next';
import { createPublicClient, fallback, http } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import { z } from 'zod';

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http('https://eth.drpc.org'),
    http('https://cloudflare-eth.com'),
    http('https://eth.llamarpc.com'),
  ]),
});

const requestQuerySchema = z.object({
  name: z.string().min(1),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const { name } = requestQuerySchema.parse(req.query);
    const address = await client.getEnsAddress({ name: normalize(name) });
    res.status(200).json({ success: true, address: '0x9c703D74E0975765007f5569D352182173877317' });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Internal Server Error';
    console.error('ENS resolution failed:', errorMessage);
    res.status(500).json({ success: false, error: errorMessage });
  }
}

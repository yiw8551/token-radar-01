// Token launch radar: the model.
//
// Everything on the board is derived from the sealed snapshot's own figures at run time.
// No protocol is named in this file and no value is hardcoded per protocol:
//
//   implied_value = TVL x category_multiple x momentum_factor x maturity_factor
//
// - category_multiple is the median market-cap / TVL ratio of the snapshot's own tokenized
//   protocols in the same DefiLlama category (ratios clipped to [0.02, 10] so one broken
//   record cannot move a median). A category with fewer than 3 tokenized samples falls back
//   to its category family's median, then to the global median. The derivation table the
//   dashboard prints is computed from the same numbers, so the page and the code agree.
// - momentum_factor reads change_7d (per cent), clamped to [-30, +40] so one week's spike
//   cannot dominate: factor = 1 + clamped x 0.006, i.e. 0.82 .. 1.24. Unreported = 1.00.
// - maturity_factor rewards time survived with no token: 0.85 at listing, rising linearly
//   to 1.20 at four years (1460 days) tracked. Unknown listing date = 1.00.
//
// The board ranks pre-token protocols only. Protocols whose token already trades are kept
// apart in the data file's "live" list, where the dashboard shows them with their real
// market caps as the comparison set the multiples came from.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface MultipleInfo {
  multiple: number;
  source: 'category' | 'family' | 'global';
  samples: number;
}

export interface ScoredProtocol {
  protocol: Protocol;
  watchlist: boolean;
  age_days: number | null;
  multiple: number;
  multiple_source: 'category' | 'family' | 'global';
  multiple_samples: number;
  momentum_factor: number;
  maturity_factor: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  token_status: 'pre-token';
  watchlist: boolean;
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  mcap_tvl: number;
}

export interface CategoryStat {
  category: string;
  multiple: number;
  source: 'category' | 'family' | 'global';
  samples: number;
  board_rows: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  protocol_count: number;
  pre_token_count: number;
  live_count: number;
  watchlist_count: number;
  global_multiple: number;
  categories: CategoryStat[];
  rows: Array<{
    rank: number;
    slug: string;
    name: string;
    category: string | null;
    chains: string[];
    tvl_usd: number;
    change_7d: number | null;
    listed_at: string | null;
    age_days: number | null;
    watchlist: boolean;
    implied_value_usd: number;
    multiple: number;
    multiple_source: string;
    multiple_samples: number;
    momentum_factor: number;
    maturity_factor: number;
    farm_steps: string[];
  }>;
  live: LiveRow[];
}

// ---------------------------------------------------------------- snapshot

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Parse and lightly validate the sealed snapshot; the gate's data, never ours to edit. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot is not valid JSON');
  }
  if (!isRecord(raw) || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new SnapshotError('snapshot lacks protocols[] or watchlist[]');
  }
  const protocols: Protocol[] = raw.protocols.map((entry, i) => {
    if (!isRecord(entry)) throw new SnapshotError(`protocols[${i}] is not an object`);
    const slug = strOrNull(entry.slug);
    const name = strOrNull(entry.name);
    const tvl = numOrNull(entry.tvl_usd);
    if (slug === null || name === null || tvl === null) {
      throw new SnapshotError(`protocols[${i}] lacks slug, name or tvl_usd`);
    }
    return {
      slug,
      name,
      category: strOrNull(entry.category),
      chains: Array.isArray(entry.chains) ? entry.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: tvl,
      change_7d: numOrNull(entry.change_7d),
      mcap_usd: numOrNull(entry.mcap_usd),
      listed_at: strOrNull(entry.listed_at),
      gecko_id: strOrNull(entry.gecko_id),
      symbol: strOrNull(entry.symbol),
    };
  });
  return {
    as_of: typeof raw.as_of === 'string' ? raw.as_of : '',
    source: typeof raw.source === 'string' ? raw.source : '',
    floor_usd: numOrNull(raw.floor_usd) ?? 0,
    protocols,
    watchlist: raw.watchlist.filter((s): s is string => typeof s === 'string'),
  };
}

// ---------------------------------------------------------------- who is pre-token

/** A protocol records a token when DefiLlama carries a gecko id or a symbol for it. */
export function recordsToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** Pre-token here means: records no token and no market cap. */
export function isPreToken(p: Protocol): boolean {
  return !recordsToken(p) && p.mcap_usd === null;
}

const DERIVATIVE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * The house watchlist's own exclusion, mirrored for protocols below its floor: a wrapped,
 * staked or bridged product of a protocol whose token already trades is not a launch that
 * has not happened yet, so the radar does not rank it as one.
 */
export function isDerivativeProduct(p: Protocol): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (VERSIONED_NAME.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name === x || p.name.startsWith(`${x} `));
}

// ---------------------------------------------------------------- the multiples

/** Category families: the fallback pool when one category has too few tokenized samples. */
const FAMILIES: Record<string, string[]> = {
  'Lending & credit': ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Markets', 'Collateral Management'],
  'Trading & markets': ['Dexs', 'Derivatives', 'Options', 'Options Vault', 'Interest Rate Derivatives', 'Prediction Market', 'Launchpad', 'Liquidity Manager'],
  'Staking & restaking': ['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Staking Pool', 'Restaked BTC', 'Anchor BTC', 'Decentralized BTC'],
  'Bridges': ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge'],
  'Yield & farming': ['Yield', 'Yield Aggregator', 'Leveraged Farming', 'Farm', 'Basis Trading'],
  'Curators & assets': ['Risk Curators', 'Onchain Capital Allocator', 'Indexes', 'RWA'],
};

const FAMILY_OF = new Map<string, string>();
for (const [family, cats] of Object.entries(FAMILIES)) {
  for (const c of cats) FAMILY_OF.set(c, family);
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface MultipleTable {
  global: number;
  globalSamples: number;
  byCategory: Map<string, MultipleInfo>;
}

/**
 * Derive every multiple from the snapshot itself: the mcap/TVL ratios of its tokenized
 * protocols, clipped to [0.02, 10], grouped by category and family, medians throughout.
 */
export function deriveMultiples(snapshot: Snapshot): MultipleTable {
  const byCategory = new Map<string, number[]>();
  const byFamily = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (!recordsToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < 0.02 || ratio > 10) continue;
    all.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
      const family = FAMILY_OF.get(p.category);
      if (family !== undefined) {
        const fl = byFamily.get(family) ?? [];
        fl.push(ratio);
        byFamily.set(family, fl);
      }
    }
  }
  for (const list of byCategory.values()) list.sort((a, b) => a - b);
  for (const list of byFamily.values()) list.sort((a, b) => a - b);
  all.sort((a, b) => a - b);
  const global = median(all);

  const table = new Map<string, MultipleInfo>();
  const categories = new Set<string>();
  for (const p of snapshot.protocols) if (p.category !== null) categories.add(p.category);
  for (const category of categories) {
    const own = byCategory.get(category) ?? [];
    if (own.length >= 3) {
      table.set(category, { multiple: median(own), source: 'category', samples: own.length });
      continue;
    }
    const family = FAMILY_OF.get(category);
    const fam = family !== undefined ? (byFamily.get(family) ?? []) : [];
    if (fam.length >= 3) {
      table.set(category, { multiple: median(fam), source: 'family', samples: fam.length });
      continue;
    }
    table.set(category, { multiple: global, source: 'global', samples: all.length });
  }
  return { global, globalSamples: all.length, byCategory: table };
}

function multipleFor(p: Protocol, table: MultipleTable): MultipleInfo {
  if (p.category === null) return { multiple: table.global, source: 'global', samples: table.globalSamples };
  return table.byCategory.get(p.category) ?? { multiple: table.global, source: 'global', samples: table.globalSamples };
}

// ---------------------------------------------------------------- factors

const DAY_MS = 86_400_000;

/** Whole days from listed_at to the snapshot's as_of, or null when either is unusable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Momentum from the 7-day TVL change in per cent, clamped so one week cannot dominate. */
export function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  const clamped = Math.min(40, Math.max(-30, change7d));
  return 1 + clamped * 0.006;
}

/** Maturity: 0.85 at listing rising to 1.20 at four years tracked with no token. */
export function maturityFactor(age: number | null): number {
  if (age === null) return 1;
  return 0.85 + 0.35 * (Math.min(age, 1460) / 1460);
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

// ---------------------------------------------------------------- farm plans

const GAS_BY_CHAIN: Record<string, string> = {
  Ethereum: '$5-20 in gas per transaction',
  Base: 'under $0.05 in gas per transaction',
  Arbitrum: 'about $0.10-0.30 in gas per transaction',
  Optimism: 'about $0.05-0.20 in gas per transaction',
  Solana: 'well under $0.01 in fees per transaction',
  BSC: 'about $0.05-0.20 in gas per transaction',
  Polygon: 'under $0.05 in gas per transaction',
  Avalanche: 'about $0.10-0.50 in gas per transaction',
  'zkSync Era': 'about $0.10-0.30 in gas per transaction',
  Linea: 'about $0.05-0.20 in gas per transaction',
  Scroll: 'about $0.10-0.40 in gas per transaction',
  Mantle: 'under $0.10 in gas per transaction',
  Blast: 'under $0.10 in gas per transaction',
  Berachain: 'under $0.10 in gas per transaction',
  Sonic: 'under $0.05 in gas per transaction',
};

function gasText(chain: string): string {
  return GAS_BY_CHAIN[chain] ?? 'a few dollars in gas per transaction';
}

/** Suggested position size: bigger protocols absorb more, and the plan says so plainly. */
function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 5000;
  if (tvl >= 250_000_000) return 2500;
  if (tvl >= 50_000_000) return 1000;
  if (tvl >= 10_000_000) return 500;
  return 250;
}

/** Campaign length from track record: older protocols get a longer, steadier farm. */
function weeksFor(age: number | null): number {
  if (age === null) return 8;
  if (age >= 730) return 12;
  if (age >= 365) return 10;
  if (age >= 120) return 8;
  return 6;
}

type FarmFamily = 'lending' | 'trading' | 'staking' | 'yield' | 'curators' | 'rwa' | 'bridge' | 'general';

function farmFamily(category: string | null): FarmFamily {
  switch (category) {
    case 'Lending':
    case 'CDP':
    case 'CDP Manager':
    case 'Uncollateralized Lending':
    case 'Collateral Markets':
    case 'Collateral Management':
      return 'lending';
    case 'Dexs':
    case 'Derivatives':
    case 'Options':
    case 'Options Vault':
    case 'Interest Rate Derivatives':
    case 'Prediction Market':
    case 'Launchpad':
    case 'Liquidity Manager':
      return 'trading';
    case 'Liquid Staking':
    case 'Liquid Restaking':
    case 'Restaking':
    case 'Staking Pool':
    case 'Restaked BTC':
    case 'Anchor BTC':
    case 'Decentralized BTC':
      return 'staking';
    case 'Yield':
    case 'Yield Aggregator':
    case 'Leveraged Farming':
    case 'Farm':
    case 'Basis Trading':
      return 'yield';
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
    case 'Indexes':
      return 'curators';
    case 'RWA':
      return 'rwa';
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return 'bridge';
    default:
      return 'general';
  }
}

interface FarmCtx {
  name: string;
  chain: string;
  chains: number;
  capital: number;
  weeks: number;
  gas: string;
}

const CORE_STEP: Record<FarmFamily, (c: FarmCtx) => string> = {
  lending: (c) =>
    `Supply about $${c.capital} of ETH or USDC as collateral on ${c.chain}, then borrow 25-35% of it in a stablecoin and re-supply the loan: the two-sided position is what lending markets reward, and the borrow costs roughly 3-6% APR while it runs.`,
  trading: (c) =>
    `Put about $${c.capital} to work on ${c.chain}: half as liquidity in the busiest pair, half as steady swap or order flow through the week, because volume plus liquidity is the activity a launch snapshot usually counts.`,
  staking: (c) =>
    `Stake about $${c.capital} of the chain's native asset through ${c.name} on ${c.chain} and hold the receipt token in the same wallet: staking balance over time is the record this kind of protocol can reward at a launch.`,
  yield: (c) =>
    `Deposit about $${c.capital} of USDC or ETH into the main vault on ${c.chain} and leave it compounding: vault share balance held across weeks, not deposits churned daily, is the history worth having here.`,
  curators: (c) =>
    `Allocate about $${c.capital} to one of the curated vaults or baskets ${c.name} runs on ${c.chain} and hold the position: curator products track who supplied capital and for how long, so a steady balance beats a large brief one.`,
  rwa: (c) =>
    `Complete the onboarding and KYC first (about 30 minutes, no fee), then invest about $${c.capital} in the shortest-duration asset on offer on ${c.chain}: real-world-asset platforms can only reward accounts that finished verification.`,
  bridge: (c) =>
    `Bridge about $${c.capital} from Ethereum to ${c.chain} and back across separate days rather than in one round trip: distinct transfer days and real destination activity are what a bridge can attribute to a wallet.`,
  general: (c) =>
    `Use the product's core function on ${c.chain} with about $${c.capital} at stake - a real position held in the wallet, not a test transaction: protocols can only reward usage their own records can see.`,
};

const ACTIVITY_STEP: Record<FarmFamily, (c: FarmCtx) => string> = {
  lending: (c) =>
    `Keep the position live for ${c.weeks} weeks: check the health factor weekly, top up collateral if it nears liquidation, and roll the borrow once mid-way; budget ${c.gas} for each adjustment, about 6-10 transactions in all.`,
  trading: (c) =>
    `Trade in at least 3 separate sessions a week for ${c.weeks} weeks and rebalance the liquidity position weekly as the price moves; budget ${c.gas} per session, so the whole campaign's fees stay near $${Math.max(5, Math.round(c.capital * 0.01))}.`,
  staking: (c) =>
    `Hold for ${c.weeks} weeks and claim or restake rewards monthly rather than selling them; unstaking queues run from days to weeks depending on the chain, so start the exit at least 2 weeks before you need the funds.`,
  yield: (c) =>
    `Review the vault weekly for ${c.weeks} weeks and move only if its yield drops under the plain lending rate for 2 straight weeks; each move costs ${c.gas}, so cap switches at one a month to keep fees under 1% of the position.`,
  curators: (c) =>
    `Rebalance once a month for ${c.weeks} weeks between the curator's vaults as their rates change, and keep statements of each allocation; expect ${c.gas} per rebalance and no lock-up beyond the vault's own withdrawal window.`,
  rwa: (c) =>
    `Hold the asset to its first interest payment (usually 30-90 days) and reinvest it once; redemptions settle on the issuer's schedule, so treat the full ${c.weeks}-week campaign as illiquid and size it as money you will not need.`,
  bridge: (c) =>
    `Make 2-3 transfers a week for ${c.weeks} weeks, varying the destination chain and amount, and use the destination chain's own apps after each hop; each transfer costs the bridge fee (about 0.05-0.3%) plus ${c.gas}.`,
  general: (c) =>
    `Return weekly for ${c.weeks} weeks and repeat the core action at a similar size, so the wallet shows a pattern of use rather than one visit; keep total fees near ${c.gas} per visit and log each session's date and amount.`,
};

/**
 * A five-step farm plan for one protocol, written from its own category, chains, TVL and
 * age: concrete amounts, the chain to use, how many weeks it runs and what it costs.
 */
export function farmSteps(p: Protocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const ctx: FarmCtx = {
    name: p.name,
    chain,
    chains: p.chains.length,
    capital: capitalFor(p.tvl_usd),
    weeks: weeksFor(age),
    gas: gasText(chain),
  };
  const steps: string[] = [
    `Set up a fresh wallet for ${ctx.name} and fund it on ${ctx.chain} with about $${ctx.capital} plus gas money (${ctx.gas}): one wallet per protocol keeps the activity attributable, and funding from an exchange withdrawal takes about 20 minutes.`,
    CORE_STEP[farmFamily(p.category)](ctx),
    ACTIVITY_STEP[farmFamily(p.category)](ctx),
  ];
  if (ctx.chains > 1) {
    steps.push(
      `From week 3, repeat the same position on a second chain ${ctx.name} runs on (${p.chains.slice(1, 3).join(', ')}) with about $${Math.round(ctx.capital / 2)}: multi-chain usage is a stronger record than the same sum on one chain, and bridging over costs about 0.1-0.3% plus gas.`,
    );
  } else {
    steps.push(
      `From week 3, add a second, smaller position of about $${Math.round(ctx.capital / 2)} in a different market or vault of ${ctx.name} on ${ctx.chain}: two product lines used steadily read as a real user, not a one-off visit.`,
    );
  }
  steps.push(
    `Track the position weekly and keep records of every transaction; if a token or points program is announced, expect claims to need the same wallet. Exit costs ${ctx.gas} per withdrawal plus any lock-up the product states, so unwind over 2-3 days rather than in one transaction.`,
  );
  return steps;
}

// ---------------------------------------------------------------- the board

export interface BuiltBoard {
  rows: BoardRow[];
  data: RadarData;
}

/** Score every board protocol and rank by implied value, strongest first. */
export function buildBoard(snapshot: Snapshot): BuiltBoard {
  const table = deriveMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter(
    (p) => isPreToken(p) && (watch.has(p.slug) || !isDerivativeProduct(p)),
  );

  const scored: ScoredProtocol[] = chosen.map((p) => {
    const info = multipleFor(p, table);
    const age = ageDays(snapshot.as_of, p.listed_at);
    const momentum = momentumFactor(p.change_7d);
    const maturity = maturityFactor(age);
    const implied = Math.max(1, Math.round(p.tvl_usd * info.multiple * momentum * maturity));
    return {
      protocol: p,
      watchlist: watch.has(p.slug),
      age_days: age,
      multiple: info.multiple,
      multiple_source: info.source,
      multiple_samples: info.samples,
      momentum_factor: momentum,
      maturity_factor: maturity,
      implied_value_usd: implied,
      farm_steps: farmSteps(p, age),
    };
  });

  scored.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.protocol.tvl_usd - a.protocol.tvl_usd ||
      (a.protocol.slug < b.protocol.slug ? -1 : 1),
  );

  const rows: BoardRow[] = scored.map((s, i) => ({
    slug: s.protocol.slug,
    name: s.protocol.name,
    rank: i + 1,
    implied_value_usd: s.implied_value_usd,
    farm_steps: s.farm_steps,
    category: s.protocol.category,
    chains: s.protocol.chains,
    tvl_usd: s.protocol.tvl_usd,
    token_status: 'pre-token',
    watchlist: s.watchlist,
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => recordsToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, 40)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      mcap_tvl: p.tvl_usd > 0 ? Math.round(((p.mcap_usd ?? 0) / p.tvl_usd) * 1000) / 1000 : 0,
    }));

  const catStats = new Map<string, CategoryStat>();
  for (const s of scored) {
    const key = s.protocol.category ?? '(uncategorised)';
    const cur = catStats.get(key);
    if (cur) cur.board_rows += 1;
    else {
      catStats.set(key, {
        category: key,
        multiple: round4(s.multiple),
        source: s.multiple_source,
        samples: s.multiple_samples,
        board_rows: 1,
      });
    }
  }

  const data: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    protocol_count: snapshot.protocols.length,
    pre_token_count: snapshot.protocols.filter(isPreToken).length,
    live_count: snapshot.protocols.filter(recordsToken).length,
    watchlist_count: snapshot.watchlist.length,
    global_multiple: round4(table.global),
    categories: [...catStats.values()].sort((a, b) => b.board_rows - a.board_rows || (a.category < b.category ? -1 : 1)),
    rows: scored.map((s, i) => ({
      rank: i + 1,
      slug: s.protocol.slug,
      name: s.protocol.name,
      category: s.protocol.category,
      chains: s.protocol.chains,
      tvl_usd: s.protocol.tvl_usd,
      change_7d: s.protocol.change_7d,
      listed_at: s.protocol.listed_at,
      age_days: s.age_days,
      watchlist: s.watchlist,
      implied_value_usd: s.implied_value_usd,
      multiple: round4(s.multiple),
      multiple_source: s.multiple_source,
      multiple_samples: s.multiple_samples,
      momentum_factor: round4(s.momentum_factor),
      maturity_factor: round4(s.maturity_factor),
      farm_steps: s.farm_steps,
    })),
    live,
  };

  return { rows, data };
}

// ---------------------------------------------------------------- the gate's shape, checked at home

/** Why this board would fail the gate, or null when it would pass. Mirrors the gate's rows. */
export function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows, outside 100..4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  let allEqual = true;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!known.has(row.slug)) return `row ${i + 1}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank is ${row.rank}, not ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.slug}: implied_value_usd ${row.implied_value_usd} is not a positive whole number within the cap`;
    }
    if (row.implied_value_usd > previous) return `row ${row.slug}: implied value rises as rank ascends`;
    if (i > 0 && row.implied_value_usd !== rows[0]!.implied_value_usd) allEqual = false;
    previous = row.implied_value_usd;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug}: farm_steps holds ${Array.isArray(row.farm_steps) ? row.farm_steps.length : 'no'} steps, outside 3..12`;
    }
    for (const step of row.farm_steps) {
      const len = typeof step === 'string' ? step.trim().length : 0;
      if (len < 20 || len > 600) return `row ${row.slug}: a farm step is ${len} characters, outside 20..600`;
    }
  }
  if (allEqual && rows.length > 1) return 'every implied value is the same: not a ranking';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file: one assignment the page reads, `<` escaped for safe inlining. */
export function dataScript(data: RadarData): string {
  return `window.RADAR_DATA = ${JSON.stringify(data).replace(/</g, '\\u003c')};\n`;
}

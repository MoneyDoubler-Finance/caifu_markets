export type HeroOutcome = {
  name: string;
  price: number;
  change: number;
};

export type HeroMarket = {
  title: string;
  slug?: string;
  outcomes: HeroOutcome[];
  volume: string;
  category: string;
  image: string;
  tags: string[];
  status: 'active' | 'live' | 'closed';
  heroImageUrl?: string | null;
};

// Slugs of markets that have dedicated hero tiles on the homepage grid
// The carousel should exclude these to avoid duplicates
// Populated after heroShowcaseMarkets definition
export let FEATURED_MARKET_SLUGS: string[] = [];

// Slugs for Caifu Picks carousel (team-created demo markets)
// Currently the same as FEATURED_MARKET_SLUGS but exported separately for clarity
export let CAIFU_PICKS_SLUGS: string[] = [];

export const heroShowcaseMarkets: HeroMarket[] = [
              // Politics & Government
              {
                title: "Will the Government shutdown end before December?",
                slug: "will-the-government-shutdown-end-before-december",
                outcomes: [
                  { name: "Yes", price: 0.99, change: 3.2 },
                  { name: "No", price: 0.01, change: -2.4 }
                ],
                volume: "4m",
                category: "Politics",
                image: "🏛️",
                tags: ["Gov Shutdown"],
                status: "closed"
              },
              {
                title: "New York City Mayoral Election",
                slug: "new-york-city-mayoral-election",
                outcomes: [
                  { name: "Zohran Mamdani", price: 0.62, change: 6.4 },
                  { name: "Andrew Cuomo", price: 0.38, change: -6.4 }
                ],
                volume: "127k",
                category: "Politics",
                image: "🗳️",
                tags: ["NYC Mayor"],
                status: "closed"
              },
              {
                title: "Will there be a second Trump impeachment?",
                slug: "will-there-be-a-second-trump-impeachment",
                outcomes: [
                  { name: "Yes", price: 0.5, change: 0 },
                  { name: "No", price: 0.5, change: 0 }
                ],
                volume: "0",
                category: "Politics",
                image: "⚖️",
                tags: ["Trump", "Impeachment"],
                status: "active"
              },

              // Sports
              {
                title: "Will Bitcoin reach $200k by end of 2025?",
                slug: "will-bitcoin-reach-200k-by-end-of-2025",
                outcomes: [
                  { name: "Yes", price: 0.45, change: 8.2 },
                  { name: "No", price: 0.55, change: -5.4 }
                ],
                volume: "5.2m",
                category: "Crypto",
                image: "₿",
                tags: ["Bitcoin", "Price", "200k", "crypto"],
                status: "active"
              },
              {
                title: "Will Kansas City Chiefs win the 2026 Super Bowl?",
                slug: "will-kansas-city-chiefs-win-the-2026-super-bowl",
                outcomes: [
                  { name: "Yes", price: 0.32, change: 2.1 },
                  { name: "No", price: 0.68, change: -1.6 }
                ],
                volume: "1.9m",
                category: "Sports",
                image: "🏆",
                tags: ["NFL", "Kansas City Chiefs", "Kansas", "Chiefs"],
                status: "active"
              },
              {
                title: "Will Buffalo Bills win the 2026 Super Bowl?",
                slug: "will-buffalo-bills-win-the-2026-super-bowl",
                outcomes: [
                  { name: "Yes", price: 0.24, change: 1.4 },
                  { name: "No", price: 0.76, change: -1.1 }
                ],
                volume: "1.4m",
                category: "Sports",
                image: "🏈",
                tags: ["NFL", "Buffalo Bills", "Bills"],
                status: "active"
              },
              {
                title: "Will Philadelphia Eagles win the 2026 Super Bowl?",
                slug: "will-philadelphia-eagles-win-the-2026-super-bowl",
                outcomes: [
                  { name: "Yes", price: 0.29, change: 1.8 },
                  { name: "No", price: 0.71, change: -1.3 }
                ],
                volume: "1.6m",
                category: "Sports",
                image: "🦅",
                tags: ["NFL", "Philadelphia Eagles", "Birds"],
                status: "active"
              },
              {
                title: "Will Detroit Lions win the 2026 Super Bowl?",
                slug: "will-detroit-lions-win-the-2026-super-bowl",
                outcomes: [
                  { name: "Yes", price: 0.21, change: 1.1 },
                  { name: "No", price: 0.79, change: -0.9 }
                ],
                volume: "1.2m",
                category: "Sports",
                image: "🦁",
                tags: ["NFL", "Detroit Lions", "Lions"],
                status: "active"
              },
              {
                title: "Will Tiger Woods win a major in 2026?",
                slug: "will-tiger-woods-win-a-major-in-2026",
                outcomes: [
                  { name: "Yes", price: 0.12, change: -0.5 },
                  { name: "No", price: 0.88, change: 0.8 }
                ],
                volume: "234k",
                category: "Sports",
                image: "⛳",
                tags: ["Tiger Woods", "Golf", "Tiger"],
                status: "active"
              },

              // Crypto & Economics
              {
                title: "Dec FOMC: cut or hold?",
                slug: "dec-fomc-cut-or-hold",
                outcomes: [
                  { name: "Cut", price: 0.58, change: 1.9 },
                  { name: "Hold", price: 0.42, change: -1.9 }
                ],
                volume: "1.6m",
                category: "Economy",
                image: "🏦",
                tags: ["FOMC", "Rates", "FOMC"],
                status: "active"
              },
              {
                title: "Will Tesla (TSLA) beat quarterly earnings?",
                slug: "will-tesla-tsla-beat-quarterly-earnings",
                outcomes: [
                  { name: "Yes", price: 0.77, change: 4.5 },
                  { name: "No", price: 0.23, change: -3.1 }
                ],
                volume: "892k",
                category: "Earnings",
                image: "📊",
                tags: ["Tesla", "Earnings", "TSLA", "TSLA"],
                status: "active"
              },
              {
                title: "Will Ethereum hit $5k by year-end?",
                slug: "will-ethereum-hit-5k-by-year-end",
                outcomes: [
                  { name: "Yes", price: 0.28, change: 5.7 },
                  { name: "No", price: 0.72, change: -3.8 }
                ],
                volume: "2.1m",
                category: "Crypto",
                image: "Ξ",
                tags: ["Ethereum", "Price", "ETH"],
                status: "active"
              },
              {
                title: "Will Apple stock hit $300 by year-end?",
                slug: "will-apple-stock-hit-300-by-year-end",
                outcomes: [
                  { name: "Yes", price: 0.32, change: 2.3 },
                  { name: "No", price: 0.68, change: -1.8 }
                ],
                volume: "756k",
                category: "Earnings",
                image: "🍎",
                tags: ["Apple", "Stock", "AAPL"],
                status: "active"
              },
              {
                title: "Will inflation drop below 2% by Q1 2026?",
                slug: "will-inflation-drop-below-2-by-q1-2026",
                outcomes: [
                  { name: "Yes", price: 0.22, change: -0.9 },
                  { name: "No", price: 0.78, change: 1.5 }
                ],
                volume: "543k",
                category: "Economy",
                image: "📈",
                tags: ["Inflation", "Economy", "inflation"],
                status: "active"
              },

              // Culture & Entertainment
              {
                title: "Will Barbie 2 be announced by end of 2025?",
                slug: "will-barbie-2-be-announced-by-end-of-2025",
                outcomes: [
                  { name: "Yes", price: 0.59, change: 3.4 },
                  { name: "No", price: 0.41, change: -2.1 }
                ],
                volume: "189k",
                category: "Culture",
                image: "🎬",
                tags: ["Barbie", "Movies", "Barbie"],
                status: "active"
              },
              {
                title: "Will Kanye West apologize publicly?",
                slug: "will-kanye-west-apologize-publicly",
                outcomes: [
                  { name: "Yes", price: 0.85, change: -0.8 },
                  { name: "No", price: 0.15, change: 1.2 }
                ],
                volume: "445k",
                category: "Culture",
                image: "🎵",
                tags: ["Kanye", "Apology", "Kanye"],
                status: "closed"
              },
              // Macro & Crypto
              {
                title: "BTC settle >$120k 12/31?",
                slug: "btc-settle-120k-12-31",
                outcomes: [
                  { name: "> $120k", price: 0.47, change: 2.8 },
                  { name: "≤ $120k", price: 0.53, change: -2.8 }
                ],
                volume: "3.4m",
                category: "Crypto",
                image: "₿",
                tags: ["Bitcoin", "Year-End", "BTC"],
                status: "active"
              },
              {
                title: "Oil >$100 on Dec 31?",
                slug: "oil-100-on-dec-31",
                outcomes: [
                  { name: "> $100", price: 0.39, change: 1.5 },
                  { name: "≤ $100", price: 0.61, change: -1.5 }
                ],
                volume: "912k",
                category: "Commodities",
                image: "🛢️",
                tags: ["WTI", "Energy", "Oil"],
                status: "active"
              },

              // Culture & Entertainment (New)
              {
                title: "Swift LP7 before Q3 2026?",
                slug: "swift-lp7-before-q3-2026",
                outcomes: [
                  { name: "By Jun 30", price: 0.64, change: 2.1 },
                  { name: "After Jun 30", price: 0.36, change: -2.1 }
                ],
                volume: "402k",
                category: "Culture",
                image: "🎤",
                tags: ["Taylor Swift", "Album", "Taylor Swift"],
                status: "active"
              },

              // Sports & Events
              {
                title: "USA reaches 2026 WC QF?",
                slug: "usa-reaches-2026-wc-qf",
                outcomes: [
                  { name: "Reach QF", price: 0.27, change: 1.3 },
                  { name: "Miss QF", price: 0.73, change: -1.3 }
                ],
                volume: "965k",
                category: "Sports",
                image: "⚽",
                tags: ["World Cup", "USMNT", "USA Soccer"],
                status: "active"
              },
              {
                title: "Las Vegas GP: Max or field?",
                slug: "las-vegas-gp-max-or-field",
                outcomes: [
                  { name: "Max Verstappen", price: 0.57, change: 2.2 },
                  { name: "Field", price: 0.43, change: -2.2 }
                ],
                volume: "614k",
                category: "Sports",
                image: "🏎️",
                tags: ["F1", "Formula 1", "Las Vegas GP"],
                status: "closed"
              },

              // Tech & Space
              {
                title: "Starship refuel demo before 2027?",
                slug: "starship-refuel-demo-before-2027",
                outcomes: [
                  { name: "Before Dec 31 2026", price: 0.44, change: 1.9 },
                  { name: "2027 or later", price: 0.56, change: -1.9 }
                ],
                volume: "1.3m",
                category: "Tech",
                image: "🚀",
                tags: ["SpaceX", "Starship"],
                status: "active"
              },
              {
                title: "Vision Pro 2 ships by Oct 2026?",
                slug: "vision-pro-2-ships-by-oct-2026",
                outcomes: [
                  { name: "By Oct 31", price: 0.52, change: 1.4 },
                  { name: "After Nov 1", price: 0.48, change: -1.4 }
                ],
                volume: "478k",
                category: "Tech",
                image: "🥽",
                tags: ["Apple", "XR"],
                status: "active"
              },
              {
                title: "Mars sample return launch by 2028?",
                slug: "mars-sample-return-launch-by-2028",
                outcomes: [
                  { name: "By 2028", price: 0.29, change: 0.9 },
                  { name: "After 2028", price: 0.71, change: -0.9 }
                ],
                volume: "254k",
                category: "Space",
                image: "🛰️",
                tags: ["NASA", "Mars"],
                status: "active"
              },
];

// Populate FEATURED_MARKET_SLUGS from heroShowcaseMarkets
FEATURED_MARKET_SLUGS = heroShowcaseMarkets
  .map(m => m.slug)
  .filter((slug): slug is string => typeof slug === 'string' && slug.length > 0);

// Populate CAIFU_PICKS_SLUGS (same set for now, can diverge later)
CAIFU_PICKS_SLUGS = [...FEATURED_MARKET_SLUGS];

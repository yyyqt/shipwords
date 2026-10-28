import { defineSite } from '@shipwords/core/site';

export default defineSite({
  id: 'shakingheadai',
  name: 'Shaking Head AI',
  url: 'https://shakingheadai.org',
  locales: ['en'],
  defaultLocale: 'en',
  products: [
    {
      id: 'single_20',
      kind: 'credits',
      name: 'Solo',
      price: { amount: 880, currency: 'usd' },
      credits: 20,
      expiresDays: null,
    },
    {
      id: 'trio_60',
      kind: 'credits',
      name: 'Trio',
      price: { amount: 1880, currency: 'usd' },
      credits: 60,
      expiresDays: null,
    },
    {
      id: 'crew_100',
      kind: 'credits',
      name: 'Crew',
      price: { amount: 2880, currency: 'usd' },
      credits: 100,
      expiresDays: null,
    },
  ],
  signup: { bonusCredits: 0, bonusExpiresDays: null, bonusPerIpDaily: 0 },
  guest: { dailyPerDevice: 0, dailyPerIp: 0, dailySiteBudget: 0, minRecaptchaScore: 0.5 },
  billing: { provider: 'stripe', automaticTax: false },
  analytics: { ga4: 'G-46QFS3MYRJ' },
});

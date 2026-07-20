import { describe, expect, it } from 'vitest';
import { indianCronJob } from '../src/server/wealth/market-refresh-scheduler';

describe('indianCronJob',()=>{
  it('dispatches stock and mutual-fund cron expressions to intended jobs',()=>{
    expect(indianCronJob('45 10 * * 1-5')).toMatchObject({scope:'stocks',trigger:'scheduled',label:'stock_initial'});
    expect(indianCronJob('15 11 * * 1-5')).toMatchObject({scope:'stocks',trigger:'retry',label:'stock_retry'});
    expect(indianCronJob('0 12 * * 1-5')).toMatchObject({scope:'stocks',trigger:'retry',label:'stock_final_retry'});
    expect(indianCronJob('30 17 * * 1-5')).toMatchObject({scope:'mutual_funds',trigger:'scheduled',label:'mutual_fund_nav'});
    expect(indianCronJob('* * * * *')).toBeNull();
  });
});

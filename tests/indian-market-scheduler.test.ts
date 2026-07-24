import { describe, expect, it } from 'vitest';
import { indianCronJob, dispatchIndianMarketPriceCron } from '../src/server/wealth/market-refresh-scheduler';

describe('indianCronJob',()=>{
  it('dispatches the Google Sheets cron and labels old direct-provider crons inactive',()=>{
    expect(indianCronJob('0 18 * * 1-5')).toMatchObject({scope:'google_sheets',trigger:'scheduled',label:'google_sheets_import'});
    expect(indianCronJob('45 10 * * 1-5')).toMatchObject({legacyInactive:true});
    expect(indianCronJob('15 11 * * 1-5')).toMatchObject({legacyInactive:true});
    expect(indianCronJob('0 12 * * 1-5')).toMatchObject({legacyInactive:true});
    expect(indianCronJob('30 17 * * 1-5')).toMatchObject({legacyInactive:true});
    expect(indianCronJob('* * * * *')).toBeNull();
  });
  it('does not dispatch old direct providers',async()=>{
    await expect(dispatchIndianMarketPriceCron({DB:{}},'45 10 * * 1-5')).resolves.toMatchObject({handled:false,legacyInactive:true});
  });
});

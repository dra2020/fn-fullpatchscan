import * as FPS from '../src/fn-fullpatchscan';

FPS.fullPatchScan(null, null, (err: any, result: any) => {
    if (err)
      console.log(`error: ${JSON.stringify(err)}`);
    else
      console.log(`result: ${JSON.stringify(result)}`);
  });

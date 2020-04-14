import * as Context from '@dra2020/context';
import * as LogAbstract from '@dra2020/logabstract';
import * as LogServer from '@dra2020/logserver';
import * as FSM from '@dra2020/fsm';
import * as DT from '@dra2020/dra-types';
import * as DBDynamo from '@dra2020/dbdynamo';

import * as FPS from './fullpatchscan';
import * as Env from './env';

class FsmWaiter extends FSM.Fsm
{
  event: any;
  callback: any;

  constructor(env: Env.Environment, callback: any)
  {
    super(env);
    this.callback = callback;
  }

  get env(): Env.Environment { return this._env as Env.Environment }

  tick(): void
  {
    if (this.ready && this.state === FSM.FSM_STARTING)
    {
      this.setState(FSM.FSM_DONE);
      this.env.log.dump();
      if (this.isDependentError)
        this.callback({ result: 1, chatters: this.env.log.chatters() }, null);
      else
        this.callback(null, { result: 0, chatters: this.env.log.chatters() });
    }
  }
}

export function fullPatchScan(event: any, context: any, callback: any): void
{
  let env = Env.create(event ? event.context : {});
  let mgr = new FSM.Fsm(env);
  let waiter = new FsmWaiter(env, callback);
  waiter.waitOn(new FPS.FsmFullPatchScan(env));
  waiter.waitOn(new FPS.FsmFullSplitPatch(env));
  mgr.waitOn(waiter);
}

import * as Context from '@dra2020/context';
import * as LogAbstract from '@dra2020/logabstract';
import * as LogServer from '@dra2020/logserver';
import * as FSM from '@dra2020/fsm';
import * as DT from '@dra2020/dra-types';
import * as DB from '@dra2020/dbabstract';
import * as DBDynamo from '@dra2020/dbdynamo';
import * as Storage from '@dra2020/storage';
import * as S3 from '@dra2020/storages3';
import * as Lambda from '@dra2020/lambda';

export interface Environment
{
  context: Context.IContext,
  log: LogAbstract.ILog,
  fsmManager: FSM.FsmManager;
  storageManager: Storage.StorageManager;
  db: DB.DBClient;
  col: DB.DBCollection;
  colsplit: DB.DBCollection;
  lambdaManager: Lambda.Manager;
}

export function create(values: any): Environment
{
  let env: Environment =
    {
      context: null,
      log: null,
      fsmManager: null,
      db: null,
      storageManager: null,
      col: null,
      colsplit: null,
      lambdaManager: null
    };

  env.context = Context.create();
  env.context.setValues(values);
  env.fsmManager = new FSM.FsmManager();
  env.log = LogServer.create(env);
  env.log.chatters();
  env.db = DBDynamo.create(env);
  env.col = env.db.createCollection('state', DT.Schemas['state']);
  env.colsplit = env.db.createCollection('splitblock', DT.Schemas['splitblock']);
  env.storageManager = new S3.StorageManager(env, DT.BucketMap);
  env.lambdaManager = Lambda.create(env);

  return env;
}

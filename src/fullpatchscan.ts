// Shared libraries
import * as Util from '@dra2020/util';
import * as OT from '@dra2020/ot-js';
import * as OTE from '@dra2020/ot-editutil';
import * as Context from '@dra2020/context';
import * as LogAbstract from '@dra2020/logabstract';
import * as Storage from '@dra2020/storage';
import * as FSM from '@dra2020/fsm';
import * as DB from '@dra2020/dbabstract';
import * as DT from '@dra2020/dra-types';

import { Environment } from  './env';

let UniqueState = FSM.FSM_CUSTOM1;
const FSM_QUERYING = UniqueState++;
const FSM_PROCESSING = UniqueState++;
const FSM_FINDING = UniqueState++;
const FSM_LOADINGSESSION = UniqueState++;
const FSM_BUILDING = UniqueState++;
const FSM_PATCHING = UniqueState++;
const FSM_UPDATING = UniqueState++;

const MaxInParallel = 100;
const Transparent = 'rgba(255, 255, 255, 0.0)';

class ImageBlob extends Storage.StorageBlob
{
  buffer: Buffer;
  fsmDel: FSM.Fsm;

  constructor(env: Environment, iid: string, buffer?: Buffer)
  {
    super(env, iid, 'images');
    this.buffer = buffer;
    this.setParam('ContentType', 'image/png');
    this.setParam('CacheControl', 'no-cache');
  }

  get env(): Environment { return this._env as Environment; }

  static createForDelete(env: Environment, iid: string): ImageBlob
  {
    let se = new ImageBlob(env, iid);
    se.startDelete(env.storageManager);
    return se;
  }

  endSave(br: Storage.BlobRequest): void
  {
    if (br.result() != Storage.ESuccess)
    {
      this.env.log.error({ event: 'lambda-buildThumbnail: image save failed', detail: this.id });
      this.fsmSave.setState(FSM.FSM_ERROR);
    }
    else
      this.fsmSave.setState(FSM.FSM_DONE);
  }

  endDelete(br: Storage.BlobRequest): void
  {
    // Silently eat failures (e.g. NOEXIST)
    this.fsmDel.setState(FSM.FSM_DONE);
  }

  asBuffer(): Buffer
  {
    return this.buffer;
  }
}

class SessionBlob extends Storage.StorageBlob
{
  otengine: OT.OTServerEngine;
  vfCache: Util.IndexedArray;

  constructor(env: Environment, id: string)
  {
    super(env, id, env.context.xflag('production') ? 'production' : 'development');

    this.otengine = null;
    this.vfCache = undefined;
  }

  get env(): Environment { return this._env as Environment; }

  static createExisting(env: Environment, id: string): SessionBlob
  {
    let se = new SessionBlob(env, id);
    se.startLoad(env.storageManager);
    return se;
  }

  get meta(): any
  {
    return this.otengine.toPartialValue('meta');
  }

  get stateCode(): string
  {
    let meta = this.meta;

    return meta && meta.state ? meta.state : undefined;
  }

  get nDistricts(): number
  {
    let meta = this.meta;

    return meta && meta.nDistricts !== undefined ? meta.nDistricts : undefined;
  }

  get vfeatures(): Util.IndexedArray
  {
    if (this.vfCache === undefined)
    {
      let vfeatures = new Util.IndexedArray();

      let blockMap = this.blockMap;
      if (blockMap != null)
        for (let geoid in blockMap) if (blockMap.hasOwnProperty(geoid))
        {
          if (DT.isVfeature(geoid))
            vfeatures.set(geoid);
        }
      this.vfCache = vfeatures.length > 0 ? vfeatures : null;
    }
    return this.vfCache;
  }

  get vchunks(): Util.IndexedArray
  {
    let vf = this.vfeatures;
    if (vf)
    {
      let vchunks = new Util.IndexedArray();
      for (let i: number = 0; i < vf.length; i++)
        vchunks.set(DT.vgeoidToChunk(vf.at(i)));
      return vchunks;
    }
    return null;
  }

  districtProps(maxDistricts: number): any[]
  {
    let ret: any[] = this.otengine.toPartialValue('districtprops');

    if (! Array.isArray(ret) || ret.length == 0)
      ret = [ { color: Transparent } ];
    while (ret.length <= maxDistricts)
      ret.push(ret[0]);

    return ret;
  }

  get datasource(): string
  {
    let ds = this.otengine.toPartialValue('datasource');

    return ds && ds.kind ? ds.kind : undefined;
  }

  get blockMap(): any
  {
    let meta = this.meta;
    let blockMap: string = meta ? meta.blockMap : undefined;
    return blockMap ? this.otengine.toPartialValue(blockMap) : undefined;
  }

  fromString(s: string): void
  {
    let o: any = JSON.parse(s);
    this.fromJSON(o);
  }

  fromJSONV1(o: any)
  {
    if (o.sessionID === undefined || o.engine === undefined)
      return;

    this.otengine = new OT.OTServerEngine(this.env.log, this.id);
    this.otengine.loadFromObject(o.engine);
  }

  fromJSONCurrent(o: any)
  {
    this.fromJSONV1(o);
  }

  fromJSON(o: any): void
  {
    if (o.version === undefined)
      this.fromJSONV1(o);
    else if (o.version == 2.0)
      this.fromJSONCurrent(o);
  }

  endLoad(br: Storage.BlobRequest): void
  {
    if (br.result() != Storage.ESuccess)
    {
      this.env.log.error({ event: 'lambda-buildThumbnail: session load failed', sessionid: this.id });
      this.fsmLoad.setState(FSM.FSM_ERROR);
    }
    else
    {
      try
      {
        this.fromString(br.asString());
      }
      catch (err)
      {
        this.env.log.error({ event: 'lambda-buildThumbnail: session JSON parse failed', sessionid: this.id });
        this.fsmLoad.setState(FSM.FSM_ERROR);
      }
    }
  }
}

class FsmPatchOne extends FSM.Fsm
{
  sp: OT.SessionProps;
  blobSession: SessionBlob;
  fsmUpdate: FSM.Fsm;

  constructor(env: Environment, sp: OT.SessionProps)
  {
    super(env);
    this.sp = sp;
    this.blobSession = null;
    this.fsmUpdate = null;
  }

  get env(): Environment { return this._env as Environment; }

  tick(): void
  {
    if (this.ready && this.isDependentError)
    {
      if (this.blobSession && this.blobSession.isLoadFailed())
        this.clearDependentError();
      else
        this.setState(FSM.FSM_ERROR);
    }
    if (this.ready)
    {
      switch (this.state)
      {
        case FSM.FSM_STARTING:
          if (this.sp.xprops.state === undefined || this.sp.xprops.nDistricts === undefined)
          {
            this.blobSession = SessionBlob.createExisting(this.env, this.sp.id);
            this.waitOn(this.blobSession.fsmLoad);
          }
          this.setState(FSM_LOADINGSESSION);
          break;

        case FSM_LOADINGSESSION:
          let set: any = { xprops: Util.shallowCopy(this.sp.xprops) };

          // Delete wrong image file
          if (this.sp.xprops.imageName === undefined)
          {
            this.env.log.event('fullpatchscan: deleting old image');
            this.waitOn(ImageBlob.createForDelete(this.env, `${this.sp.id}.png`).fsmDel);
          }

          // Promote state and datasource from OT data structure
          if (this.blobSession)
          {
            if (this.blobSession.isLoadFailed())
            {
              this.blobSession = null;
              set.xprops.state = '';
              set.xprops.datasource = '';
              set.xprops.nDistricts = '';
            }
            else
            {
              let state = this.blobSession.stateCode;
              if (state === undefined) state = '';
              let nDistricts: any = this.blobSession.nDistricts;
              nDistricts = (nDistricts === undefined) ? '' : String(nDistricts);
              let datasource = this.blobSession.datasource;
              if (datasource === undefined) datasource = ''
              this.blobSession = null;
              set.xprops.state = state;
              set.xprops.nDistricts = nDistricts;
              set.xprops.datasource = datasource;
            }
          }

          // Migrate imageTime and imageVersion from main props into extended props
          let oldsp: any = this.sp;
          if (set.xprops.imageTime === undefined)
            set.xprops.imageTime = oldsp.imageTime ? oldsp.imageTime : '';
          if (set.xprops.imageVersion === undefined)
            set.xprops.imageVersion = oldsp.imageVersion ? oldsp.imageVersion : '';
          if (set.xprops.imageName === undefined)
            set.xprops.imageName = '';

          // Add social properties
          if (set.xprops.commentID === undefined)
            set.xprops.commentID = Util.createGuid();
          if (set.xprops.likeID === undefined)
            set.xprops.likeID = Util.createGuid();
          if (set.xprops.newlikes === undefined)
            set.xprops.newlikes = 0;
          if (set.xprops.seenlikes === undefined)
            set.xprops.seenlikes = 0;
          if (set.xprops.newcomments === undefined)
            set.xprops.newcomments = 0;
          if (set.xprops.seencomments === undefined)
            set.xprops.seencomments = 0;

          if (! Util.shallowEqual(oldsp.xprops, set.xprops))
          {
            this.fsmUpdate = this.env.db.createUpdate(this.env.col, this.sp, set);
            this.waitOn(this.fsmUpdate);
          }
          this.setState(FSM_UPDATING);
          break;

        case FSM_UPDATING:
          this.setState(FSM.FSM_DONE);
          break;
      }
    }
  }
}

export class FsmFullPatchScan extends FSM.Fsm
{
  query: DB.DBQuery;
  toProcess: OT.SessionProps[];
  fsmPatches: FsmPatchOne[];

  constructor(env: Environment)
  {
    super(env);
    this.query = null;
    this.toProcess = [];
    this.fsmPatches = [];
  }

  get env(): Environment { return this._env as Environment; }

  next(): void
  {
    this.fsmPatches = [];
    while (this.toProcess.length > 0 && this.fsmPatches.length < MaxInParallel)
    {
      let sp = this.toProcess.pop();
      this.fsmPatches.push(new FsmPatchOne(this.env, sp));
    }

    // If nothing added, restart scan.
    if (this.fsmPatches.length == 0)
      this.setState(FSM.FSM_DONE);
    else
    {
      this.waitOn(this.fsmPatches);
      this.setState(FSM_PATCHING);
    }
  }

  tick(): void
  {
    if (this.ready)
    {
      switch (this.state)
      {
        case FSM.FSM_STARTING:
          this.env.log.event('fullpatchscan: starting property patching');
          this.query = this.env.db.createQuery(this.env.col, {});
          this.waitOn(this.query);
          this.setState(FSM_QUERYING);
          break;

        case FSM_QUERYING:
          if (this.query.iserror)
            this.setState(FSM.FSM_DONE);
          else
          {
            for (let i: number = 0; i < this.query.result.length; i++)
            {
              let sp = this.query.result[i];
              if (sp.xprops === undefined ||
                  sp.xprops.imageTime === undefined ||
                  sp.xprops.imageVersion === undefined ||
                  sp.xprops.state === undefined ||
                  sp.xprops.nDistricts === undefined ||
                  sp.xprops.datasource === undefined ||
                  sp.xprops.imageName === undefined ||
                  sp.xprops.commentID === undefined)
                this.toProcess.push(sp);
            }
            this.env.log.value({ event: 'fullpatchscan: patching queue size', value: this.toProcess.length });
            this.env.log.chatter(`fullpatchscan: ${this.toProcess.length} records to patch`);
            this.query = null;
            this.setState(FSM_PROCESSING);
          }
          break;

        case FSM_PROCESSING:
          this.next();
          break;

        case FSM_PATCHING:
          this.setState(FSM_PROCESSING);
          break;
      }
    }
  }
}

export class FsmFullSplitPatch extends FSM.Fsm
{
  query: DB.DBQuery;
  chunkKey: string;
  nPatched: number;

  constructor(env: Environment)
  {
    super(env)
    this.query = null;
    this.nPatched = 0;
  }

  get env(): Environment { return this._env as Environment }

  tick(): void
  {
    if (this.ready && this.isDependentError)
    {
      this.env.log.chatter(`fullpatchscan: exiting split patching because of dependent error`);
      this.setState(FSM.FSM_ERROR);
    }
    if (this.ready)
    {
      switch (this.state)
      {
        case FSM.FSM_STARTING:
          this.query = this.env.db.createQuery(this.env.colsplit, { });
          this.waitOn(this.query.fsmResult);
          this.setState(FSM.FSM_PENDING);
          break;

        case FSM.FSM_PENDING:
          this.query.fsmResult.a.forEach((s: DT.SplitBlock) => {
              if (s.blocks !== undefined && s.chunkKey === undefined)
              {
                this.nPatched++;
                this.waitOn(this.env.db.createUpdate(this.env.colsplit, { id: s.id }, { chunkKey: DT.splitToChunkKey(s) }));
              }
            });
          this.query.fsmResult.reset();
          if (this.query.done)
          {
            this.env.log.chatter(`fullpatchscan: updated ${this.nPatched} splitblock records`);
            this.setState(FSM.FSM_DONE);
          }
          else
            this.waitOn(this.query.fsmResult);
          break;
      }
    }
  }
}

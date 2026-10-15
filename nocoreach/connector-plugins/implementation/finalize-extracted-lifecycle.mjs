import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const read = name => readFileSync(path.join(root, name), 'utf8');
const write = (name, text) => writeFileSync(path.join(root, name), text);
function change(file, before, after) {
  const text = read(file);
  if (text.split(before).length !== 2) throw new Error(`Unexpected lifecycle boundary in ${file}: ${before}`);
  write(file, text.replace(before, after));
}

// Reddit polling belongs to the same installed package as its source and budget ledger.
let core = read('server/nocoreach/plugin.ts');
const redditTimer = core.split('\n').find(line => line.trimStart().startsWith('this.redditCron='));
if (!redditTimer) throw new Error('Missing existing Reddit timer');
const schedule = redditTimer.match(/cronTime:'([^']+)'/);
if (!schedule) throw new Error('Missing Reddit schedule');
core = core.split('\n').filter(line => line !== redditTimer).join('\n');
core = core.replace('if(this.redditCron)this.app.cronJobManager.removeJob(this.redditCron);', '');
write('server/nocoreach/plugin.ts', core);
change('app-plugins/connector-dataforseo/server/index.ts', '      start() {', `      start() {\n        unschedule.push(context.schedule('redditCron', '${schedule[1]}', () => reddit.tick()));`);

// Google continues to warm the application's saved read models, just as the original service did.
change('app-plugins/connector-google/server/connection.ts', '  get projects() { return this.host.projects; }', '  get projects() { return this.host.projects; }\n  get dataViews() { return this.host.dataViews; }');
// Track full asynchronous jobs so close() waits for their abort handlers and transactions.
let sync = read('app-plugins/connector-google/server/sync-service.ts');
sync = sync.replace('class SyncService{', `class SyncService{
 closed=false;
 pending=new Set<Promise<unknown>>();
 track<T>(work: () => Promise<T>): Promise<T> {
  if(this.closed)return Promise.reject(new Error('Google connector is stopped'));
  const promise=Promise.resolve().then(work);
  this.pending.add(promise);
  void promise.then(()=>this.pending.delete(promise),()=>this.pending.delete(promise));
  return promise;
 }
 async close(){
  this.closed=true;
  this.inFlight?.controller.abort();
  for(const controllers of this.freshFlights.values())for(const controller of controllers)controller.abort();
  await Promise.allSettled([...this.pending]);
 }
`);
// Only entry points that own long-running work are tracked; avoid recursively registering each internal call.
for(const method of ['tick','refreshFresh']) {
  const needle = ` async ${method}(`;
  if (!sync.includes(needle)) throw new Error(`Missing tracked Google entry point ${method}`);
  sync=sync.replace(needle, ` async ${method}(...args){return this.track(()=>this.${method}Internal(...args));}\n async ${method}Internal(`);
}
write('app-plugins/connector-google/server/sync-service.ts', sync);

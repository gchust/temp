import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
const file = path.join(root, 'server/nocoreach/plugin.ts');
let source = readFileSync(file, 'utf8');
const before = 'async afterDisable(){await this.connectorRegistry?.close();';
if (source.split(before).length !== 2) {
  throw new Error('Unexpected Connections shutdown boundary; refusing a partial lifecycle patch');
}
// A fully booted application delegates ownership to its connector registry. Unit-test
// fixtures and older embedding callers can still construct Sources without a registry.
// Start every legacy close synchronously BEFORE the first await, so already-running
// requests see their AbortSignal before callers release an in-flight response.
const after = `async afterDisable(){
  if(this.connectorRegistry){
    await this.connectorRegistry.close();
  }else{
    await Promise.all([this.trends,this.community,this.reddit,this.hackernews,this.packages,this.xSource,this.chat]
      .map((source:{close():Promise<void>}|undefined)=>source?.close()));
  }
`;
source = source.replace(before, after);
writeFileSync(file, source);
console.log('FIXED_SHUTDOWN_COMPATIBILITY: abort legacy-constructed readers before awaiting teardown; registry-owned instances still close exactly once.');

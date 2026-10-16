import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
export class JsonStore {
  constructor(path) { this.path = path; this.queue = Promise.resolve(); }
  async read() {
    try { return JSON.parse(await readFile(this.path,"utf8")); }
    catch (e) { if (e.code === "ENOENT") return {opportunities:[],buyers:[],allocations:[],audit:[]}; throw e; }
  }
  async transact(fn) {
    const run = async () => {
      const state = await this.read();
      const result = await fn(state);
      await mkdir(dirname(this.path),{recursive:true});
      const tmp = this.path + "." + process.pid + ".tmp";
      await writeFile(tmp,JSON.stringify(state,null,2),{mode:0o600});
      await rename(tmp,this.path);
      return result;
    };
    const next = this.queue.then(run,run);
    this.queue = next.catch(()=>{});
    return next;
  }
}

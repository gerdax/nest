import {createError} from '../errors.js';
import {conditionsMet, inventoryQuantity, transact} from './state.js';
import {routeFallbackEnabled} from './nodeTypes.js';
import {selectPool} from './legacy-pool.js';
import {validAutoDrawCount} from './randomizer.js';
import {createTravelVisit} from './travel.js';

/** One speculative walk. Route identity detects cycles independently of the
 * state used to reuse already checked branches. */
class RoutePreflight {
  constructor(visited) {
    this.active = new Set(visited);
    this.activeMask = 0n;
    this.memoizing = false;
    this.bits = new Map();
    this.frames = [];
    this.completed = new Map();
    this.stateIds = new WeakMap();
    this.contextIds = new WeakMap();
    this.serializedStates = new Map();
    this.serial = 0;
  }

  bit(id) {
    if (!this.bits.has(id)) this.bits.set(id,this.bits.size);
    return 1n << BigInt(this.bits.get(id));
  }

  enableMemoization() {
    if (this.memoizing) return;
    this.memoizing = true;
    for (const id of this.active) this.activeMask |= this.bit(id);
  }

  stateId(state) {
    if (!this.stateIds.has(state)) {
      // Transactions produce immutable JSON values and ordered inventory data.
      // An unsupported host value can still use its reference identity.
      let signature;
      try {signature = JSON.stringify(state);} catch {}
      let id = this.serializedStates.get(signature);
      if (id === undefined) {
        id = ++this.serial;
        if (signature !== undefined) this.serializedStates.set(signature,id);
      }
      this.stateIds.set(state,id);
    }
    return this.stateIds.get(state);
  }

  contextId(context) {
    if (!context) return 0;
    if (!this.contextIds.has(context)) this.contextIds.set(context,++this.serial);
    return this.contextIds.get(context);
  }

  enter(id, step) {
    if (this.active.has(id)) throw createError('RUNTIME_AUTOMATIC_ROUTING_CYCLE');
    if (!this.memoizing) {
      this.active.add(id);
      this.frames.push({id});
      return undefined;
    }
    const bit = this.bit(id);
    const {values,inventory,run,autoVisit,startPlacementId,changed} = step;
    const state = JSON.stringify([this.stateId(values),this.stateId(inventory),this.contextId(run),
      this.contextId(autoVisit),startPlacementId,changed]);
    const memo = this.completed.get(id)?.get(state);
    if (memo) {
      // A branch can be safe in isolation and still return to an active
      // ancestor of the current path. Include all the routes checked by it.
      if (memo.footprint & this.activeMask) throw createError('RUNTIME_AUTOMATIC_ROUTING_CYCLE');
      this.include(memo.footprint);
      return memo;
    }
    this.frames.push({id,footprint:bit,state});
    this.active.add(id);
    this.activeMask |= bit;
    return undefined;
  }

  include(footprint) {
    const frame = this.frames.at(-1);
    if (frame?.state !== undefined) frame.footprint |= footprint;
  }

  finish(result) {
    const frame = this.frames.pop();
    this.active.delete(frame.id);
    if (this.memoizing) this.activeMask ^= this.bit(frame.id);
    if (frame.state === undefined) return;
    let variants = this.completed.get(frame.id);
    if (!variants) this.completed.set(frame.id, variants = new Map());
    variants.set(frame.state, {footprint:frame.footprint,result});
    this.include(frame.footprint);
  }
}

/** Explicit DFS frames keep long automatic paths off the JavaScript call stack.
 * Preview checks every eligible Shuffle branch without drawing randomness. */
export function traverseRouting(controller, start, values, inventory, visited, excluded, preview, inventoryOptions) {
  const preflight = preview ? new RoutePreflight(visited) : null;
  const pending=[{run:start.location?.randomizerRun??controller.randomizerRun,...start,values,inventory,changed:false}];
  const arrive=(destination,step,run)=>{
    if(run)destination={...destination,randomizerRun:run};
    if(step.changed)controller.arrivalStates.set(destination,{variables:step.values,inventory:step.inventory});
    return destination;
  };
  let result;
  while(pending.length) {
    const step=pending.pop();
    let {values,inventory,changed,run}=step;
    if(step.halted){result=arrive({halted:true,terminalReason:'death'},step,run);continue;}
    if(step.finish) {
      if(step.random)result=null;
      preflight?.finish(result);
      continue;
    }
    if(step.location) {
      const death=controller.deathDestination(values,step.location);
      if(death){pending.push({id:death.node.id,values,inventory,changed,run});continue;}
      const next=controller.seekStep(step.location,values,inventory,excluded);
      if(next.ready)result=arrive(next.location,step,run);
      else pending.push({...next,values,inventory,changed});
      continue;
    }
    // Preflight checks the current draw without expanding every possible
    // future draw. A real scene exit checks again with the updated state.
    if(preview&&step.autoVisit?.defer){result=null;continue;}
    const id=step.id;
    if(id===null){result=arrive({completed:true},step,run);continue;}
    if(id===false||id===undefined)throw createError('RUNTIME_UNLINKED_OUTPUT');
    // Two callers can traverse the same automatically skipped scene in one transition.
    const travelProgress=step.autoVisit?.travel;
    const visitKey=run?JSON.stringify([run.scene?.callerId??null,id,run.scene?.remaining??null,step.autoVisit?.remaining??null,
      travelProgress?[travelProgress.remainingEvents,travelProgress.segmentRemaining,travelProgress.stepNumber]:null]):id;
    if(preflight){
      const cached=preflight.enter(visitKey,step);
      if(cached){result=cached.result;continue;}
    }else{
      if(visited.has(visitKey))throw createError('RUNTIME_AUTOMATIC_ROUTING_CYCLE');
      visited.add(visitKey);
    }
    const node=controller.nodes.get(id);if(!node)throw createError('RUNTIME_UNKNOWN_NODE', { id });
    if(preview)pending.push({finish:true,random:node.type==='random'||node.type==='randomizer'&&!node.travel?.enabled});
    const death=controller.deathDestination(values,{node});
    if(death&&step.startPlacementId)throw createError('STUDIO_PREVIEW_CARD_UNAVAILABLE',{reason:'The entry state routes to the Death beat.'});
    if(death){pending.push({id:death.node.id,values,inventory,changed,run});continue;}
    if(node.type==='death'&&run?.scene)run={...run,scene:null};
    // Keep entry effects speculative until the full route succeeds. Branches
    // inherit their parent's state rather than a preceding sibling's effects.
    for(const effect of !step.autoVisit&&Object.hasOwn(controller.nodeEntryEffects,id)?controller.nodeEntryEffects[id]:[]) {
      if(effect.op==='removeItem'&&!inventoryQuantity(inventory,effect.key))continue;
      const state=transact(values,inventory,{effects:[effect]},controller.compiled.variables,controller.compiled.library,inventoryOptions);
      values=state.variables;inventory=state.inventory;changed=true;
    }
    const enteredDeath=controller.deathDestination(values,{node});
    if(enteredDeath&&step.startPlacementId)throw createError('STUDIO_PREVIEW_CARD_UNAVAILABLE',{reason:'The entry state routes to the Death beat.'});
    if(enteredDeath){pending.push({id:enteredDeath.node.id,values,inventory,changed,run});continue;}
    if(node.type==='randomizer') {
      if(run?.scene)throw createError('RUNTIME_AUTOMATIC_ROUTING_CYCLE');
      run??={seen:new Set(),scene:null};
      if(node.travel?.enabled){
        const visit=step.autoVisit?.travel??createTravelVisit(node.travel);
        const destination=controller.travelDestination(node,run,visit,values,inventory,excluded,preview,step.startPlacementId);
        if(destination)pending.push({...destination,values,inventory,changed});
        else result=null;
        continue;
      }
      const visit=step.autoVisit??{remaining:validAutoDrawCount(node.drawCount)?node.drawCount:1,played:new Set()};
      const choices=controller.randomizerChoices(node,values,inventory,run,visit,excluded);
      const results=preview?(choices.length?choices:[null]):[controller.weighted(choices)];
      if(results.length>1)preflight.enableMemoization();
      for(let i=results.length-1;i>=0;i--){
        pending.push({...controller.randomizerDestination(results[i],node,run,visit,preview),values,inventory,changed});
      }
    }else if(node.type==='condition') {
      const selected=(node.routes ?? []).find(route=>conditionsMet(route.conditions,values,inventory));
      pending.push({...controller.routeStep(node,selected?.id??'fallback',selected?selected.target:node.fallback,run),values,inventory,changed});
    }else if(node.type==='random') {
      const routes=(node.routes ?? []).filter(r=>r.weight>0&&conditionsMet(r.conditions,values,inventory));
      if(!routes.length&&!routeFallbackEnabled(node)){
        pending.push({id:false,values,inventory,changed,run});
      }else if(preview) {
        const targets=routes.length?routes:[{id:'fallback',target:node.fallback}];
        if(targets.length>1)preflight.enableMemoization();
        for(let i=targets.length-1;i>=0;i--){
          const {id:output,target}=targets[i];
          pending.push({...controller.routeStep(node,output,target,run),values,inventory,changed});
        }
      }else {
        const selected=controller.weighted(routes);
        pending.push({...controller.routeStep(node,selected?.id??'fallback',selected?selected.target:node.fallback,run),values,inventory,changed});
      }
    }else if(node.type==='legacyPool'&&preview)result=null;
    else {
      const location={node,index:0,queue:[],...(run?{randomizerRun:run}:{})};
      if(node.type==='legacySequence')location.sequence=node.sequence;
      // A choice-free native Fork keeps its authored intro as a transient
      // narrative sequence; no placement or document data is synthesized.
      if(node.type==='fork'&&Array.isArray(node.choices)&&node.choices.length===0) {
        location.emptyFork=true;
        location.sequence={type:'linear',cards:controller.introEnabled(location)&&!controller.introShown(location)&&conditionsMet(node.intro?.conditions,values,inventory)?[node.intro]:[]};
      }
      if(node.type==='legacyPool') {
        location.queue=selectPool(node.pool,node.count,controller.rng);
        const sequenceId=location.queue.shift();
        location.sequence=node.sequences.find(s=>s.id===sequenceId);
        if(!location.sequence){pending.push({...controller.routeStep(node,'next',node.connections?.next,run),values,inventory,changed});continue;}
      }
      if(step.startPlacementId)result=arrive(controller.startAtPlacement(location,step.startPlacementId,values,inventory),{values,inventory,changed},run);
      else pending.push({location,values,inventory,changed,run});
    }
  }
  return result;
}

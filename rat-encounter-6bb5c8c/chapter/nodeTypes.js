import { selectPool } from './random.js';
import { sequenceOutputs } from './sequenceTypes.js';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const nodeTypes=Object.freeze({
  static:Object.freeze({
    label:'Static',inspector:'sequence',sequenceIds:node=>[node.sequenceId],
    outputs:(node,sequence)=>sequenceOutputs(sequence),
    select:node=>[node.sequenceId],validate(){}
  }),
  random:Object.freeze({
    label:'Random pool',inspector:'pool',
    sequenceIds:node=>(Array.isArray(node.pool)?node.pool:[]).map(entry=>entry?.sequenceId),
    outputs:()=>['next'],select:(node,rng)=>selectPool(node.pool,node.count,rng),
    validate(node,add){
      if(!Array.isArray(node.pool)||!node.pool.length)add('Random node needs a sequence pool.');
      const pool=Array.isArray(node.pool)?node.pool:[];
      if(new Set(pool.map(entry=>entry?.sequenceId)).size!==pool.length)add('Random pool must not repeat a sequence.');
      if(pool.some(entry=>!object(entry)||!Number.isFinite(entry.weight)||entry.weight<=0))add('Pool weights must be positive finite numbers.');
      if(!Number.isInteger(node.count)||node.count<1||node.count>pool.length)add('Random count must be from 1 to the pool size.');
    }
  })
});
export const nodeType=node=>Object.hasOwn(nodeTypes,node?.type)?nodeTypes[node.type]:undefined;
export const nodeOutputs=(node,sequence)=>nodeType(node)?.outputs(node,sequence)||[];
export const connectionOutput=(node,name)=>node?.type==='random'?'next':name;

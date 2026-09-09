import assert from "node:assert/strict";
import { createBackDispatcher } from "../src/platform/backNavigation";

const original=Date.now;
let now=1000;
Date.now=()=>now;
let checks=0;
try {
  let exits=0,handled=0;
  const errors:unknown[]=[];
  const back=createBackDispatcher(()=>{handled++;return handled===1;},async()=>{exits++;},e=>errors.push(e));
  await back();assert.equal(exits,0);await back();assert.equal(handled,1);now+=301;await back();assert.equal(exits,1);checks++;
  let release!:()=>void;
  const delayed=createBackDispatcher(async()=>{await new Promise<void>(r=>release=r);return true;},async()=>{exits++;},e=>errors.push(e));
  now+=301;const running=delayed();now+=500;await delayed();assert.equal(exits,1);release();await running;assert.equal(exits,1);checks++;
  now+=301;const broken=createBackDispatcher(()=>{throw Error("HANDLER_FAILED");},async()=>{exits++;},e=>errors.push(e));await broken();assert.equal(exits,1);assert.equal(errors.length,1);checks++;
  now+=301;const failedExit=createBackDispatcher(()=>false,async()=>{throw Error("EXIT_FAILED");},e=>errors.push(e));await failedExit();assert.equal(errors.length,2);checks++;
  let consumed=true;
  const reversible=createBackDispatcher(()=>consumed,async()=>{exits++;},e=>errors.push(e));
  for(let i=0;i<100;i++){now+=301;consumed=i%2===0;const before=exits;await reversible();assert.equal(exits,before+(consumed?0:1));}checks++;
  console.log(`Back dispatcher ${checks} groups passed: nested consume/root exit, double press, delayed handler, failure keeps app open, 100 repeated transitions`);
} finally {Date.now=original;}

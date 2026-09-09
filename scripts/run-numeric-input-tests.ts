import assert from "node:assert/strict";
import { parseUnsignedInput } from "../src/app/numericInput";

let checks=0;
for(const digits of [2,3,4,5,6]) {
  assert.deepEqual(parseUnsignedInput("",digits),{value:0,hasValue:false});checks++;
  for(const value of ["0","00","1","09","9".repeat(digits)]) {
    assert.deepEqual(parseUnsignedInput(value,digits),{value:Number(value),hasValue:true});checks++;
  }
  for(const value of ["-1","+1","1.5",".5","1e2","a1","1a"," 1","1 "," ","NaN","Infinity","１２","1,000","9".repeat(digits+1)]) {
    assert.throws(()=>parseUnsignedInput(value,digits));checks++;
  }
}
assert.throws(()=>parseUnsignedInput("9007199254740992",16));checks++;
console.log("strict numeric input checks: "+checks);

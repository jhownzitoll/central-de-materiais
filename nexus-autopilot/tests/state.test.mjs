import test from "node:test";
import assert from "node:assert/strict";
import {classify,shouldPoll,safePromptSendConfirmation} from "../state.mjs";
test("busy overrides composer readiness",()=>assert.equal(classify({authenticated:true,stopVisible:true,composerVisible:true,composerEmpty:true}),"BUSY"));
test("login blocked",()=>assert.equal(classify({loginVisible:true,authenticated:false}),"BLOCKED"));
test("draft not considered idle",()=>assert.equal(classify({authenticated:true,composerVisible:true,composerEmpty:false}),"UNKNOWN"));
test("verified empty composer is idle",()=>assert.equal(classify({authenticated:true,composerVisible:true,composerEmpty:true}),"IDLE"));
test("poll only after verified idle",()=>{assert.equal(shouldPoll({state:"BUSY",authenticated:true,composer_ready:true,composer_empty:true}),false);assert.equal(shouldPoll({state:"IDLE",authenticated:true,composer_ready:true,composer_empty:true}),true)});
test("send cannot be confirmed by click alone",()=>{assert.equal(safePromptSendConfirmation(1,1,"sample prompt 123"),false);assert.equal(safePromptSendConfirmation(1,2,"sample prompt 123"),true)});

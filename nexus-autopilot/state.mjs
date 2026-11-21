// Pure UI guardrails: Chrome/Playwriter never infers delivery from a click alone.
export const CLIENT_VERSION = 'playwriter-existing-chrome-v3';
export function classify({stopVisible=false,streamingVisible=false,composerVisible=false,composerEmpty=false,authenticated=false,loginVisible=false}={}){
 if(loginVisible||!authenticated)return 'BLOCKED';
 if(stopVisible||streamingVisible)return 'BUSY';
 if(!composerVisible||!composerEmpty)return 'UNKNOWN';
 return 'IDLE';
}
export function shouldPoll(o){
 return o?.state==='IDLE'&&o.authenticated===true&&o.composer_ready===true&&o.composer_empty===true;
}
export function normalizeText(v){return typeof v==='string'?v.replace(/\s+/g,' ').trim():'';}
export function hasConfirmedSubmission({before,after,lastText,prompt}){
 if(!Number.isSafeInteger(before)||!Number.isSafeInteger(after)||after<=before)return false;
 const expected=normalizeText(prompt),actual=normalizeText(lastText);
 return expected.length>=60&&actual.startsWith(expected.slice(0,70));
}
export function safePromptSendConfirmation(before,after,expectedPrefix){
 return Number.isSafeInteger(before)&&Number.isSafeInteger(after)&&after>before
  &&typeof expectedPrefix==='string'&&expectedPrefix.length>12;
}

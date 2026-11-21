// Pure decision logic, kept independent from browser selectors for offline testing.
export function classify({stopVisible=false,composerVisible=false,composerEmpty=false,authenticated=false,loginVisible=false}={}){
 if(loginVisible||!authenticated)return "BLOCKED";
 if(stopVisible)return "BUSY";
 if(!composerVisible||!composerEmpty)return "UNKNOWN";
 return "IDLE";
}
export function shouldPoll(observation){
 return observation?.state==="IDLE"&&observation.authenticated===true
  &&observation.composer_ready===true&&observation.composer_empty===true;
}
export function safePromptSendConfirmation(before,after,expectedPrefix){
 return Number.isSafeInteger(before)&&Number.isSafeInteger(after)&&after>before
  &&typeof expectedPrefix==="string"&&expectedPrefix.length>12;
}

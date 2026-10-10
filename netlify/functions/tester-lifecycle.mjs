// Netlify Scheduled Function: runs daily and manages Early Access participation.
// Day 6 reminder; Day 8 grace; Day 10 release-eligible. AUTO_RELEASE_TESTER_SPOTS=true enables recycling.
const FROM="SupportFlow Early Access <early-access@supportflow.work>", REPLY="globalappsai@gmail.com";
async function mail(key,to,subject,text){ if(!key||!to)return; await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({from:FROM,reply_to:REPLY,to:[to],subject,text})}); }
async function run(){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_KEY,resend=process.env.RESEND_API_KEY;
 if(!url||!key) return {statusCode:200};
 const h={apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"};
 const [cr,ar,fr]=await Promise.all([
  fetch(`${url}/rest/v1/early_access_codes?status=eq.claimed&select=*`,{headers:h}),
  fetch(`${url}/rest/v1/tester_activity_events?select=device_ref,event_name,created_at&order=created_at.desc`,{headers:h}),
  fetch(`${url}/rest/v1/feedback?select=device_ref,created_at`,{headers:h})
 ]);
 if(!cr.ok||!ar.ok||!fr.ok)return {statusCode:200};
 const codes=await cr.json(), acts=await ar.json(), feedback=await fr.json(), now=Date.now();
 for(const c of codes){
  if(!c.device_ref)continue;
  const mine=acts.filter(a=>a.device_ref===c.device_ref), last=mine[0]?.created_at||c.claimed_at;
  if(!last)continue;
  const days=Math.floor((now-new Date(last).getTime())/86400000), email=c.claimed_email;
  let status=days>=10?"release_eligible":days>=8?"grace":days>=6?"reminder_due":"active";
  const hasFeedback=feedback.some(f=>f.device_ref===c.device_ref)||mine.some(a=>a.event_name==="feedback_submitted");
  const qualifies=mine.length>0&&hasFeedback&&days<10;
  const state={device_ref:c.device_ref,access_code:c.code,status,last_meaningful_at:last,meaningful_actions:mine.length,feedback_submitted:hasFeedback,reward_qualifying:qualifies,updated_at:new Date().toISOString()};
  await fetch(`${url}/rest/v1/tester_activity_status?on_conflict=device_ref`,{method:"POST",headers:{...h,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(state)});
  const existing=await fetch(`${url}/rest/v1/tester_activity_status?device_ref=eq.${encodeURIComponent(c.device_ref)}&select=reminder_sent_at,grace_sent_at,release_sent_at&limit=1`,{headers:h}).then(r=>r.json()).catch(()=>[]);
  const e=existing?.[0]||{};
  if(days>=10&&!e.release_sent_at){ await mail(resend,email,"Your SupportFlow Early Access spot",`Your Early Access spot has been inactive for 10 days. Your tester place is now eligible to be released. If you are still testing, open SupportFlow and complete a genuine workflow to reactivate your participation.`); await fetch(`${url}/rest/v1/tester_activity_status?device_ref=eq.${encodeURIComponent(c.device_ref)}`,{method:"PATCH",headers:h,body:JSON.stringify({release_sent_at:new Date().toISOString()})}); }
  else if(days>=8&&!e.grace_sent_at){ await mail(resend,email,"Your SupportFlow tester spot is in its grace period",`We haven't seen meaningful SupportFlow testing activity for 8 days. You have a 48-hour grace period. Complete a genuine workflow in SupportFlow to return to Active automatically.`); await fetch(`${url}/rest/v1/tester_activity_status?device_ref=eq.${encodeURIComponent(c.device_ref)}`,{method:"PATCH",headers:h,body:JSON.stringify({grace_sent_at:new Date().toISOString()})}); }
  else if(days>=6&&!e.reminder_sent_at){ await mail(resend,email,"Still testing SupportFlow?",`Your Early Access place is reserved. We haven't seen a meaningful test action for 6 days. Use SupportFlow during your next shift to keep your tester status active.`); await fetch(`${url}/rest/v1/tester_activity_status?device_ref=eq.${encodeURIComponent(c.device_ref)}`,{method:"PATCH",headers:h,body:JSON.stringify({reminder_sent_at:new Date().toISOString()})}); }
  if(days>=10&&process.env.AUTO_RELEASE_TESTER_SPOTS==="true") await fetch(`${url}/rest/v1/early_access_codes?code=eq.${encodeURIComponent(c.code)}`,{method:"PATCH",headers:h,body:JSON.stringify({status:"available",device_ref:null,claimed_email:null,claimed_at:null})});
 }
 return {statusCode:200};
}
export default async () => { const r = await run(); return new Response("ok", { status: r.statusCode || 200 }); };
export const config = { schedule: "15 2 * * *" };

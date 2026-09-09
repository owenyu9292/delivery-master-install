// ADB-forwarded QA WebView only. Never attach this probe to the production app.
const port=Number(process.env.QA_WEBVIEW_PORT);
if(!port||!process.argv[2])throw Error("QA_WEBVIEW_PORT and expression required");
const targets=await(await fetch("http://127.0.0.1:"+port+"/json/list")).json();
const target=targets.find(t=>t.url==="https://localhost/");
if(!target)throw Error("Local QA WebView not found");
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
try {
  const result=await new Promise((resolve,reject)=>{
    ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id===1)m.error?reject(m.error):resolve(m.result)};
    ws.send(JSON.stringify({id:1,method:"Runtime.evaluate",params:{expression:process.argv[2],awaitPromise:true,returnByValue:true}}));
  });
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
  console.log(JSON.stringify(result.result.value));
}finally{ws.close()}
